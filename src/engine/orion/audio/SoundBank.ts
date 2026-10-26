import { audioBus, AUDIBLE_DISTANCE, type Placement, type Route } from "./AudioBus";
import { SOUND_FILES as WORLD_SOUND_FILES } from "./SoundManifest";
import { VEHICLE_SOUND_FILES } from "./VehicleSoundManifest";
import { synthesizeSounds } from "./SynthSounds";

/**
 * Recorded sounds: fetched and decoded once, then played as many times as needed.
 *
 * The files are studio recordings (see SoundManifest and CREDITS.md), cut, levelled and looped
 * by scripts/prepare-sounds.py. Everything is loaded once the game becomes audible (the loading
 * screen has gone) — the whole set is a few megabytes, the sounds heard at once first; until a
 * file has arrived, callers fall back to the synthesised sound they had before.
 *
 * One-shots are played with a little random pitch and level, and pick among the takes recorded
 * of each, so a burst of fire or a pile-up never repeats the same waveform twice in a row.
 */

const BASE = "/audio/";
/** Every recorded sound: the world's (prepare-sounds.py) and the vehicles' (prepare-vehicle-sounds.py). */
const SOUND_FILES: Readonly<Record<string, readonly string[]>> = { ...WORLD_SOUND_FILES, ...VEHICLE_SOUND_FILES };

const buffers = new Map<string, AudioBuffer>();
/** Sounds rendered in code rather than recorded (see SynthSounds), by id. */
const synthesized = new Map<string, AudioBuffer>();
const requested = new Set<string>();
const lastTake = new Map<string, number>();

/**
 * How many of each sound may ring at once. Past this the oldest is faded out to make room: a
 * burst of fire stays a run of distinct shots instead of a pile of overlapping tails, and a
 * fire-fight can't build up hundreds of live nodes.
 */
const VOICE_LIMITS: Readonly<Record<string, number>> = {
	"pistol-close": 3, "rifle-close": 4, "shotgun-close": 3,
	"pistol-far": 3, "rifle-far": 3, "shotgun-far": 3, "gun-distant": 3,
	"hit-wall": 4, "hit-ground": 4, "hit-glass": 2, "hit-flesh": 3, impact: 4,
	casing: 3, whizz: 2, crack: 2, punch: 3, "tyre-hiss": 3,
	explosion: 4, "explosion-far": 3, "crash-heavy": 3, "crash-light": 4, glass: 3,
};
const DEFAULT_VOICES = 6;
/** Seconds to fade a voice that's made way for a newer one: short, but not a click. */
const STEAL_FADE = 0.03;

interface ActiveVoice {
	source: AudioBufferSourceNode;
	output: GainNode;
	level: number;
}

const active = new Map<string, ActiveVoice[]>();

/** Starts loading every recorded sound; cheap to call again. */
export function preloadSounds(context: BaseAudioContext): void {
	for (const sound of preloadOrder(Object.keys(SOUND_FILES))) for (const file of SOUND_FILES[sound]) load(context, file);
	if (synthesized.size === 0) for (const [id, buffer] of synthesizeSounds(context)) synthesized.set(id, buffer);
}

/** Heard from the first second of play: engines, the street, footsteps, the player's own hands. */
const FIRST_SOUNDS = /^(engine-|idle-|tyre-roll|amb-|foot|punch|whoosh|door)/;

/**
 * The order recordings are fetched in: the ones heard at once first, the rest after. The browser
 * runs a handful of requests at a time, so this decides which arrive within the first seconds.
 */
export function preloadOrder(sounds: readonly string[]): string[] {
	return [...sounds.filter((sound) => FIRST_SOUNDS.test(sound)), ...sounds.filter((sound) => !FIRST_SOUNDS.test(sound))];
}

function load(context: BaseAudioContext, file: string): void {
	if (requested.has(file)) return;
	requested.add(file);
	fetch(BASE + file)
		.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`${response.status} ${file}`))))
		.then((data) => context.decodeAudioData(data))
		.then((buffer) => {
			buffers.set(file, buffer);
		})
		// A missing or undecodable file just leaves that sound on its synthesised fallback.
		.catch(() => undefined);
}

/** A decoded take of `sound`, avoiding the one played last; null until any has loaded. */
export function takeOf(sound: string): AudioBuffer | null {
	const rendered = synthesized.get(sound);
	if (rendered) return rendered;
	const files = SOUND_FILES[sound];
	if (!files) return null;
	const loaded = files.map((file) => buffers.get(file)).filter((buffer): buffer is AudioBuffer => Boolean(buffer));
	if (loaded.length === 0) return null;
	const previous = lastTake.get(sound) ?? -1;
	let index = Math.floor(Math.random() * loaded.length);
	if (loaded.length > 1 && index === previous) index = (index + 1) % loaded.length;
	lastTake.set(sound, index);
	return loaded[index];
}

/** Whether every take of `sound` has arrived. */
export function soundReady(sound: string): boolean {
	if (synthesized.has(sound)) return true;
	const files = SOUND_FILES[sound];
	return Boolean(files && files.length > 0 && files.every((file) => buffers.has(file)));
}

export interface OneShotOptions {
	/** Level before distance. */
	level?: number;
	/** Playback speed; also pitch. */
	rate?: number;
	/** How far level and pitch may wander either way, 0..1. */
	variation?: number;
	/** Seconds from now. */
	delay?: number;
	/** Upper limit (Hz) on the air-absorption low-pass, whatever the distance. */
	ceiling?: number;
	/** How much goes to the city's echo (AudioBus.echo), 0..1: gunfire and blasts, not footsteps. */
	echo?: number;
	/** Which part of the mix it belongs to (see AudioBus); "world" if not given. */
	channel?: Route;
	/**
	 * Earlier voices of the same sound drop to this share of their level as this one starts: in
	 * rapid fire each new shot cuts the last one's tail short, as a real gun's report masks it.
	 */
	choke?: number;
}

/** The echo send for a sound this far off: a little close to, more of what arrives with distance. */
function echoSend(echo: number, distance: number): number {
	return echo * Math.min(1.6, 0.35 + Math.max(0, distance - 6) / 50);
}

/** Makes room among the voices of `sound`, and quietens the tails of those that stay. */
function claimVoice(context: AudioContext, sound: string, at: number, choke: number | undefined): ActiveVoice[] {
	let voices = active.get(sound);
	if (!voices) {
		voices = [];
		active.set(sound, voices);
	}
	const limit = VOICE_LIMITS[sound] ?? DEFAULT_VOICES;
	while (voices.length >= limit) {
		const oldest = voices.shift();
		if (!oldest) break;
		const now = context.currentTime;
		oldest.output.gain.cancelScheduledValues(now);
		oldest.output.gain.setTargetAtTime(0, now, STEAL_FADE / 3);
		try {
			oldest.source.stop(now + STEAL_FADE);
		} catch {
			// Already stopped.
		}
	}
	if (choke !== undefined) {
		for (const voice of voices) {
			voice.level *= choke;
			voice.output.gain.setTargetAtTime(voice.level, at, 0.02);
		}
	}
	return voices;
}

/**
 * Plays a take of `sound` at a point in the world: distance roll-off, pan and air absorption
 * from AudioBus. Returns false when nothing is loaded yet (so the caller can fall back).
 */
export function playOneShot(sound: string, placed: Placement, options: OneShotOptions = {}): boolean {
	const bus = audioBus();
	const context = bus.ensure();
	const channel = bus.channel(options.channel ?? "world");
	if (!context || !channel) return false;
	const buffer = takeOf(sound);
	if (!buffer) return false;
	const startAt = context.currentTime + (options.delay ?? 0);
	const voices = claimVoice(context, sound, startAt, options.choke);
	const variation = options.variation ?? 0.05;
	const wander = () => 1 + (Math.random() * 2 - 1) * variation;
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.playbackRate.value = (options.rate ?? 1) * wander();
	const output = context.createGain();
	const level = (options.level ?? 1) * placed.gain * wander();
	output.gain.value = level;
	const air = context.createBiquadFilter();
	air.type = "lowpass";
	air.frequency.value = Math.min(placed.muffle, options.ceiling ?? 20000);
	const panner = context.createStereoPanner();
	panner.pan.value = placed.pan;
	source.connect(air).connect(output).connect(panner).connect(channel);
	if (options.echo && bus.echo) {
		// Further off, more of what reaches you is the echo.
		const send = context.createGain();
		send.gain.value = echoSend(options.echo, placed.distance);
		output.connect(send).connect(bus.echo);
	}
	const voice: ActiveVoice = { source, output, level };
	voices.push(voice);
	source.onended = () => {
		const index = voices.indexOf(voice);
		if (index >= 0) voices.splice(index, 1);
		panner.disconnect();
		output.disconnect();
	};
	source.start(startAt);
	return true;
}

/**
 * A recorded loop that keeps running: its level, pan, pitch and muffling steered every frame.
 * Built only once its file has loaded; `voice()` returns null until then.
 */
export class LoopVoice {
	private source: AudioBufferSourceNode | null = null;
	private gain: GainNode | null = null;
	private air: BiquadFilterNode | null = null;
	private panner: StereoPannerNode | null = null;

	public constructor(private readonly sound: string, private readonly smoothing = 0.08, private readonly channel: Route = "world") {}

	public get ready(): boolean {
		return this.source !== null || soundReady(this.sound);
	}

	/** Steers the loop; starts it the first time it's asked to sound and its file is there. */
	public set(level: number, placed: Placement, rate = 1, ceiling = 20000): void {
		const bus = audioBus();
		const context = bus.ensure();
		const output = bus.channel(this.channel);
		if (!context || !output) return;
		if (!this.source) {
			if (level <= 0.0002) return;
			const buffer = takeOf(this.sound);
			if (!buffer) return;
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.loop = true;
			const gain = context.createGain();
			gain.gain.value = 0.0001;
			const air = context.createBiquadFilter();
			air.type = "lowpass";
			const panner = context.createStereoPanner();
			source.connect(air).connect(gain).connect(panner).connect(output);
			// Somewhere into the loop, so two instances of one sound never line up.
			source.start(context.currentTime, Math.random() * buffer.duration);
			this.source = source;
			this.gain = gain;
			this.air = air;
			this.panner = panner;
		}
		const now = context.currentTime;
		this.gain?.gain.setTargetAtTime(Math.max(0.0001, level * placed.gain), now, this.smoothing);
		this.air?.frequency.setTargetAtTime(Math.min(placed.muffle, ceiling), now, this.smoothing);
		this.panner?.pan.setTargetAtTime(placed.pan, now, this.smoothing);
		this.source.playbackRate.setTargetAtTime(rate, now, this.smoothing);
	}

	/** Whether the loop is playing (it is built the first time it's asked to sound). */
	public get playing(): boolean {
		return this.source !== null;
	}

	public stop(): void {
		try {
			this.source?.stop();
		} catch {
			// Already stopped.
		}
		this.panner?.disconnect();
		this.source = null;
		this.gain = null;
		this.air = null;
		this.panner = null;
	}
}

const scratch: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };

/** Plays a take of `sound` at a point in the world (see playOneShot). */
export function playAt(sound: string, x: number, y: number, z: number, options: OneShotOptions = {}): boolean {
	const placed = audioBus().place(x, y, z, scratch);
	if (placed.distance > AUDIBLE_DISTANCE) return false;
	return playOneShot(sound, placed, options);
}

/** A placement for the listener's own position: full level, centred, unmuffled. */
export const AT_LISTENER: Readonly<Placement> = { gain: 1, pan: 0, muffle: 20000, distance: 0 };
