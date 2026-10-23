/**
 * Runs a list of small jobs a few milliseconds' worth per frame instead of all at once, for
 * scene work that would otherwise freeze a frame the player sees (MilitaryBase lays the army base
 * this way: ~490 pieces, each with a collider, took ~185–360 ms in one go — measured, Phase 2.2).
 *
 * Every frame runs at least one job, so the work always finishes, then stops once `budgetMs` is
 * spent. Nothing runs in the call itself: the first jobs run next frame. A job that throws is
 * reported (`onError`) and the rest go on.
 */

export interface FrameBudgetOptions {
	/** Most milliseconds of jobs per frame (one job always runs, however long it takes). */
	budgetMs: number;
	/** Schedules `run` for the next frame; returns its cancel. Defaults to requestAnimationFrame. */
	nextFrame?: (run: () => void) => () => void;
	now?: () => number;
	onError?: (error: unknown, index: number) => void;
}

export interface FrameBudgetRun {
	/** True once every job has run; false if cancelled first. */
	done: Promise<boolean>;
	/** Stops before the next job; no job runs after it. Safe to call more than once. */
	cancel(): void;
}

const animationFrame = (run: () => void) => {
	const id = requestAnimationFrame(run);
	return () => cancelAnimationFrame(id);
};

export function runInFrames(jobs: readonly (() => void)[], options: FrameBudgetOptions): FrameBudgetRun {
	const { budgetMs, nextFrame = animationFrame, now = () => performance.now() } = options;
	const onError = options.onError ?? ((error: unknown) => console.error("[orion] scheduled job failed", error));
	let next = 0;
	let cancelled = false;
	let stopFrame: (() => void) | null = null;
	let settled = false;
	let resolveDone!: (completed: boolean) => void;
	const done = new Promise<boolean>((resolve) => {
		resolveDone = resolve;
	});
	const finish = (completed: boolean) => {
		if (settled) return;
		settled = true;
		resolveDone(completed);
	};

	const frame = () => {
		stopFrame = null;
		if (cancelled) return;
		const start = now();
		do {
			const index = next++;
			try {
				jobs[index]();
			} catch (error) {
				onError(error, index);
			}
			if (cancelled) return;
		} while (next < jobs.length && now() - start < budgetMs);
		if (next < jobs.length) stopFrame = nextFrame(frame);
		else finish(true);
	};

	if (jobs.length === 0) finish(true);
	else stopFrame = nextFrame(frame);

	return {
		done,
		cancel() {
			if (cancelled) return;
			cancelled = true;
			stopFrame?.();
			stopFrame = null;
			finish(false);
		},
	};
}

/**
 * For long async work done in pieces (VehicleLod builds a car's levels group by group): call the
 * returned function between pieces; it waits for a fresh task (so the browser can draw) once the
 * current slice has run `budgetMs`, and otherwise returns at once. A macrotask, not a frame: work
 * like this must also finish in a background tab, where frames stop.
 */
export function timeSlicer(budgetMs: number, now: () => number = () => performance.now(), wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0))): () => Promise<void> {
	let sliceStart = now();
	return async () => {
		if (now() - sliceStart < budgetMs) return;
		await wait();
		sliceStart = now();
	};
}

/**
 * Lets at most `limit` of something happen per frame, shared by everyone who asks: returns a
 * function that says yes (and counts it) while the frame `frame` still has room. For work that
 * many objects would otherwise all do in the same frame — cars setting up (OrionVehicleModel), or
 * switching to a coarser level of detail together when that level first becomes usable.
 */
export function perFrameAllowance(limit: number): (frame: number) => boolean {
	let current = Number.NaN;
	let left = 0;
	return (frame: number) => {
		if (frame !== current) {
			current = frame;
			left = limit;
		}
		if (left <= 0) return false;
		left--;
		return true;
	};
}

export interface CalmGateOptions {
	/** Frames in a row that must each have taken under `frameMs` before work goes ahead. */
	frames: number;
	frameMs: number;
	/**
	 * Longest the gate stays shut, ms, counted from when it began waiting or from the last piece of
	 * work done by anyone (not per caller): on a machine that never runs that smoothly, work still
	 * goes ahead at least this often.
	 */
	maxWaitMs: number;
}

export interface CalmGate {
	/**
	 * Whether work may run in `frame`, at time `now`. Asked any number of times a frame; the first
	 * ask in a frame measures the frame before it. While `active` is false the gate is open.
	 */
	allows(frame: number, now: number, active: boolean): boolean;
	/** The work ran: the next piece waits for a fresh run of calm frames. */
	used(now: number): void;
}

/**
 * Holds work back until the game has been running smoothly for a few frames, and spaces pieces
 * apart the same way. For work that can wait without anyone noticing but stutters when it lands on
 * an already busy frame — cars merging their parts after the loading screen has gone, while the
 * first frames of play compile shaders and parse the models loaded after it (OrionVehicleModel).
 */
export function calmGate(options: CalmGateOptions): CalmGate {
	const { frames, frameMs, maxWaitMs } = options;
	let currentFrame = Number.NaN;
	let lastFrameStart: number | null = null;
	let calm = 0;
	let waitingSince: number | null = null;
	return {
		allows(frame, now, active) {
			if (frame !== currentFrame) {
				currentFrame = frame;
				if (lastFrameStart !== null) calm = now - lastFrameStart < frameMs ? calm + 1 : 0;
				lastFrameStart = now;
			}
			if (!active) {
				waitingSince = null;
				return true;
			}
			waitingSince ??= now;
			return calm >= frames || now - waitingSince >= maxWaitMs;
		},
		used(now) {
			calm = 0;
			waitingSince = now;
		},
	};
}
