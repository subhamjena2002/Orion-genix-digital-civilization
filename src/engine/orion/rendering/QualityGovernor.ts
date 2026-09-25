/**
 * Dynamic resolution and quality scaling.
 *
 * A fixed quality setting either wastes a fast GPU or drowns a slow one, and the same machine
 * swings between the two as the scene changes (a burning street full of smoke costs far more
 * than an empty road). The governor watches frame times and steps the level down as soon as
 * the game drops below the target, then feels its way back up once there's headroom.
 *
 * The best signal is the time the frame actually took to produce (CPU plus GPU, when the browser
 * exposes GPU timers). Failing that it falls back to frame intervals — but those never drop
 * below the display's refresh, and a 30 Hz screen (or a throttled window) would otherwise read
 * as permanently overloaded. So the interval is judged against the fastest the display has
 * recently delivered, not a fixed 60 fps.
 *
 * A level that proved too slow is remembered and retried only after a much longer calm spell,
 * so it can't oscillate every few seconds.
 */

export interface QualityLevel {
	name: string;
	/** Share of the canvas resolution the 3D scene is rendered at (then upscaled). */
	renderScale: number;
	/** MSAA samples on the HDR scene target. */
	samples: 1 | 2 | 4;
	bloom: boolean;
	/** Contrast-adaptive sharpening applied when upscaling. */
	sharpness: number;
	shadowResolution: number;
	/** How many of the nearest fires get a real light. */
	fireLights: number;
}

/**
 * Best first. Only used when the player opts into adaptive quality; by default the game stays
 * on "ultra". Steps give up the least visible things first: MSAA and fire lights, then shadow
 * texel density, and only at the bottom does the scene render below native resolution.
 */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
	{ name: "ultra", renderScale: 1, samples: 4, bloom: true, sharpness: 0, shadowResolution: 4096, fireLights: 4 },
	{ name: "high", renderScale: 1, samples: 2, bloom: true, sharpness: 0, shadowResolution: 4096, fireLights: 4 },
	{ name: "medium", renderScale: 1, samples: 2, bloom: true, sharpness: 0, shadowResolution: 2048, fireLights: 3 },
	{ name: "low", renderScale: 0.9, samples: 2, bloom: true, sharpness: 0.2, shadowResolution: 2048, fireLights: 2 },
	{ name: "minimum", renderScale: 0.8, samples: 1, bloom: true, sharpness: 0.3, shadowResolution: 2048, fireLights: 1 },
];

export interface GovernorOptions {
	levelCount: number;
	startLevel: number;
	/** Frame time the game aims for, in seconds. */
	targetFrameTime?: number;
}

/** Frames longer than this are hitches (tab switch, asset load), not a measure of load. */
const IGNORE_FRAME_TIME = 0.25;
const SMOOTHING = 0.08;
/** Below target by this factor counts as too slow... */
const SLOW_FACTOR = 1.2;
/** ...and within this factor of it counts as keeping up. */
const KEEPING_UP_FACTOR = 1.1;
/** How long it has to be too slow before stepping down. */
const DOWNGRADE_AFTER = 0.8;
/** How long it has to keep up before trying the next level up. */
const UPGRADE_AFTER = 4;
/** Extra wait before retrying a level that has already proved too slow. */
const RETRY_FAILED_AFTER = 25;
/** Measurements right after a change are skipped while the new targets settle. */
const SETTLE_SECONDS = 1;
/** Frames remembered for estimating the display's refresh interval. */
const REFRESH_WINDOW = 90;
/** Nothing refreshes faster than this, so shorter intervals are timer noise. */
const FASTEST_REFRESH = 1 / 240;
/** Refresh intervals longer than this (under 50 Hz) need to look like a steady cap. */
const SLOW_DISPLAY = 1 / 50;
/** No display refreshes slower than 30 Hz, so a steady 20 fps is load, not a cap. */
const SLOWEST_DISPLAY = 1 / 28;
/** A steady cap: the average interval within this factor of the fastest. */
const STEADY_CAP = 1.06;

export class QualityGovernor {
	private current: number;
	private average: number;
	private slowFor = 0;
	private keepingUpFor = 0;
	private sinceChange = 0;
	/** Levels that were too slow, and how long ago. */
	private readonly failedAgo = new Map<number, number>();
	private readonly target: number;
	private readonly levelCount: number;
	private readonly intervals = new Float32Array(REFRESH_WINDOW);
	private intervalIndex = 0;
	private intervalCount = 0;

	public constructor(options: GovernorOptions) {
		this.levelCount = Math.max(1, options.levelCount);
		this.current = clampLevel(options.startLevel, this.levelCount);
		this.target = options.targetFrameTime ?? 1 / 60;
		this.average = this.target;
	}

	/** Index into the level list; 0 is the best. */
	public get level(): number {
		return this.current;
	}

	/** Smoothed frame time, in seconds. */
	public get averageFrameTime(): number {
		return this.average;
	}

	/**
	 * Feeds one frame. `frameTime` is the interval since the last frame; `workTime`, when known,
	 * is how long the frame took to produce (the larger of CPU and GPU time). Returns the new
	 * level when it changes, otherwise null.
	 */
	public sample(frameTime: number, workTime?: number): number | null {
		for (const [level, ago] of this.failedAgo) this.failedAgo.set(level, ago + Math.min(frameTime, IGNORE_FRAME_TIME));
		if (!(frameTime > 0) || frameTime > IGNORE_FRAME_TIME) {
			this.slowFor = 0;
			this.keepingUpFor = 0;
			return null;
		}
		this.recordInterval(frameTime);
		const measured = workTime !== undefined && workTime > 0 ? workTime : frameTime;
		// Work time is independent of vsync; an interval can't beat the display's refresh.
		const target = workTime !== undefined && workTime > 0 ? this.target : Math.max(this.target, this.refreshInterval());
		this.average += (measured - this.average) * SMOOTHING;
		this.sinceChange += frameTime;
		if (this.sinceChange < SETTLE_SECONDS) return null;

		this.slowFor = this.average > target * SLOW_FACTOR ? this.slowFor + frameTime : 0;
		this.keepingUpFor = this.average <= target * KEEPING_UP_FACTOR ? this.keepingUpFor + frameTime : 0;

		if (this.slowFor >= DOWNGRADE_AFTER && this.current < this.levelCount - 1) {
			this.failedAgo.set(this.current, 0);
			return this.change(this.current + 1);
		}
		if (this.keepingUpFor >= UPGRADE_AFTER && this.current > 0) {
			const better = this.current - 1;
			const failed = this.failedAgo.get(better);
			if (failed === undefined || failed >= RETRY_FAILED_AFTER) return this.change(better);
		}
		return null;
	}

	/**
	 * The display's refresh interval, estimated from the shortest recent frame. A slow display
	 * (below 50 Hz) is only believed when frames arrive like clockwork: an overloaded GPU on a
	 * 60 Hz screen also produces 33 ms frames, but mixed with longer ones. Nothing slower than
	 * 30 Hz is believed at all.
	 */
	public refreshInterval(): number {
		if (this.intervalCount === 0) return this.target;
		let fastest = Infinity;
		let total = 0;
		for (let i = 0; i < this.intervalCount; i++) {
			fastest = Math.min(fastest, this.intervals[i]);
			total += this.intervals[i];
		}
		fastest = Math.max(FASTEST_REFRESH, fastest);
		if (fastest > SLOWEST_DISPLAY) return this.target;
		const steady = total / this.intervalCount <= fastest * STEADY_CAP;
		return fastest > SLOW_DISPLAY && !steady ? this.target : fastest;
	}

	private recordInterval(frameTime: number) {
		this.intervals[this.intervalIndex] = frameTime;
		this.intervalIndex = (this.intervalIndex + 1) % REFRESH_WINDOW;
		this.intervalCount = Math.min(REFRESH_WINDOW, this.intervalCount + 1);
	}

	private change(level: number): number {
		this.current = level;
		this.slowFor = 0;
		this.keepingUpFor = 0;
		this.sinceChange = 0;
		// Start the new level's measurement from the target rather than the old level's figure.
		this.average = this.target;
		return level;
	}
}

/**
 * Where adaptive quality starts: always the best level. Guessing lower from the canvas size
 * blurred the image on machines that could have run it at full quality.
 */
export function startingLevel(): number {
	return 0;
}

function clampLevel(level: number, count: number): number {
	return Math.max(0, Math.min(count - 1, Math.round(level)));
}

/** The level in force, for systems that scale their own cost (fire lights, particle counts). */
let active: QualityLevel = QUALITY_LEVELS[0];

export function activeQuality(): QualityLevel {
	return active;
}

export function setActiveQuality(level: QualityLevel): void {
	active = level;
}
