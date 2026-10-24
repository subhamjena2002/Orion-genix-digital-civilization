/**
 * The one audio context the game uses, the listener everything is placed against, and the mix.
 *
 * Everything plays into one of a few channels (see Channel), each with its own level, so the
 * player's own gun sits on top of distant fire, and engines and the street sit under both. The
 * channels meet in the effects level (the player's "Effects" setting), then the master (their
 * "Master" setting and mute), then a gentle compressor. There is no music in the game yet; it
 * would get its own level beside effects rather than going through it.
 *
 * Engines, gunfire and impacts all mix through here: a browser gives a page a limited number of
 * audio contexts, and two of them would need two listeners kept in step. Most of it is studio
 * recordings (SoundBank, EngineGrainWorklet); the synthesised versions in EngineVoices and
 * CombatAudio stand in until those have loaded.
 *
 * Placement is deliberately simple: a distance roll-off, a left/right pan, and a low-pass that
 * opens up as things get closer, which is what distance actually does to sound outdoors. It is
 * not HRTF, and it doesn't need to be for a camera that never rolls.
 */

/** Beyond this, nothing is worth mixing. */
export const AUDIBLE_DISTANCE = 220;
/** At this distance a sound is at half volume. */
const HALF_VOLUME_DISTANCE = 18;
/** Master level, below 1 so a volley of shots plus traffic doesn't clip. */
const MASTER_LEVEL = 0.55;
/** Seconds between attempts to resume a context the browser suspended. */
const RESUME_INTERVAL = 1;
/** Length of the city's echo (s): the time for a gunshot to die away between the buildings. */
const ECHO_SECONDS = 2.4;
/**
 * Level of everything sent to the echo, against the dry sound. The impulse response is
 * normalised to unit energy (see cityEcho), so this is what the echo of a send at 1 comes back at.
 */
const ECHO_RETURN = 0.5;
/**
 * The mix: each channel's level against the others. The player's gun is the loudest thing in the
 * game on purpose; other people's gunfire a step under it, and ducked further for a moment each
 * time the player fires, so a fire-fight across the street never masks your own shot.
 */
const CHANNEL_LEVELS = {
	/** The player's own weapon: their shots, and the thump under them. */
	own: 1,
	/** Everybody else's gunfire, rockets and explosions. */
	gunfire: 0.8,
	/** Bullets landing, casings, fly-bys. */
	impacts: 0.7,
	/** Engines, tyres, sirens, aircraft, crashes, horns. */
	vehicles: 0.85,
	/** The street and the sea. */
	ambience: 0.75,
	/** Doors, glass, punches, reloading: everything else in the world. */
	world: 0.9,
} as const;
export type Channel = keyof typeof CHANNEL_LEVELS;
/** How far other gunfire drops while the player fires, and over what (s). */
const DUCK_LEVEL = 0.55;
const DUCK_HOLD = 0.12;
const DUCK_RELEASE = 0.25;
/** Length of the shared white-noise loop, in seconds: long enough that its repeat isn't heard. */
const NOISE_SECONDS = 5;

export interface Placement {
	/** Gain from distance alone, 0..1. */
	gain: number;
	/** -1 fully left, +1 fully right. */
	pan: number;
	/** Low-pass cutoff (Hz) standing in for air absorption. */
	muffle: number;
	distance: number;
}

class AudioBus {
	private context: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private effectsGain: GainNode | null = null;
	private readonly channels = new Map<Channel, GainNode>();
	private echoInput: GainNode | null = null;
	private noiseLoop: AudioBuffer | null = null;
	private sinceResume = 0;
	/**
	 * Silent until the world has loaded: the loading screen turns the sound on as it fades
	 * (setAudible). Engines and the street were otherwise heard behind it while it was still up.
	 */
	private audible = false;
	/** The player's settings (see AudioSettings): 0..1 each, and mute. */
	private readonly levels = { master: 1, effects: 1, muted: false };
	private readonly listener = { x: 0, y: 0, z: 0, rightX: 1, rightZ: 0 };

	/** Where the camera is and which way its right-hand side points (flat, unit). */
	public setListener(x: number, y: number, z: number, rightX: number, rightZ: number): void {
		this.listener.x = x;
		this.listener.y = y;
		this.listener.z = z;
		this.listener.rightX = rightX;
		this.listener.rightZ = rightZ;
	}

	/**
	 * The context, creating it on first use. Browsers only allow audio after a user gesture, so
	 * this can return a suspended context: nodes built on it stay silent and start sounding once
	 * the player clicks or presses a key. Resuming is retried on a timer rather than every frame.
	 */
	public ensure(): AudioContext | null {
		if (this.context) return this.context;
		if (typeof AudioContext === "undefined") return null;
		const context = new AudioContext();
		this.context = context;
		// For checking the mix in development: window.__orionAudio.context / .master.
		if (process.env.NODE_ENV !== "production") (globalThis as Record<string, unknown>).__orionAudio = this;
		const master = context.createGain();
		master.gain.value = this.masterTarget();
		this.masterGain = master;
		const effects = context.createGain();
		effects.gain.value = this.levels.effects;
		effects.connect(master);
		this.effectsGain = effects;
		for (const [channel, level] of Object.entries(CHANNEL_LEVELS) as [Channel, number][]) {
			const gain = context.createGain();
			gain.gain.value = level;
			gain.connect(effects);
			this.channels.set(channel, gain);
		}
		// Traffic, gunfire and an explosion at once would otherwise clip; this rides the peaks.
		// Gently: it used to sit at -18 dB, 6:1, which squashed the engines flat all the time and
		// audibly pumped them down on every shot. Now it only acts on the loud moments.
		const compressor = context.createDynamicsCompressor();
		compressor.threshold.value = -10;
		compressor.knee.value = 18;
		compressor.ratio.value = 3;
		compressor.attack.value = 0.008;
		compressor.release.value = 0.3;
		master.connect(compressor).connect(context.destination);

		// The street's echo: loud sounds are sent here as well as straight out (see echo).
		const echo = context.createConvolver();
		echo.buffer = cityEcho(context);
		const echoReturn = context.createGain();
		echoReturn.gain.value = ECHO_RETURN;
		const echoInput = context.createGain();
		echoInput.connect(echo).connect(echoReturn).connect(effects);
		this.echoInput = echoInput;

		const length = Math.floor(context.sampleRate * NOISE_SECONDS);
		const noise = context.createBuffer(1, length, context.sampleRate);
		const channel = noise.getChannelData(0);
		for (let i = 0; i < length; i++) channel[i] = Math.random() * 2 - 1;
		this.noiseLoop = noise;
		return context;
	}

	/** Called once a frame by whoever is mixing; nudges a suspended context back to life. */
	public tick(dt: number): void {
		const context = this.context;
		if (!context || context.state !== "suspended") return;
		this.sinceResume += dt;
		if (this.sinceResume < RESUME_INTERVAL) return;
		this.sinceResume = 0;
		void context.resume();
	}

	/** Turns the whole mix on or off, with a short fade; kept for a context not created yet. */
	public setAudible(on: boolean): void {
		this.audible = on;
		this.rampMaster(on ? 0.8 : 0.05);
	}

	/** Whether the mix is on: off while the loading screen is up. */
	public isAudible(): boolean {
		return this.audible;
	}

	/** The player's volume settings (0..1) and mute; kept for a context not created yet. */
	public setLevels(master: number, effects: number, muted: boolean): void {
		this.levels.master = clamp01(master);
		this.levels.effects = clamp01(effects);
		this.levels.muted = muted;
		const context = this.context;
		if (context && this.effectsGain) this.effectsGain.gain.setTargetAtTime(this.levels.effects, context.currentTime, 0.03);
		this.rampMaster(0.08);
	}

	/** How loud speech should be (0..1): the player's master volume, the same curve, 0 muted or hidden. */
	public dialogueLevel(): number {
		if (!this.audible || this.levels.muted) return 0;
		return this.levels.master * this.levels.master;
	}

	private masterTarget(): number {
		if (!this.audible || this.levels.muted) return 0;
		// Squared, so the slider feels even: half way is a quarter of the power, about -12 dB.
		return MASTER_LEVEL * this.levels.master * this.levels.master;
	}

	private rampMaster(seconds: number) {
		const context = this.context;
		const master = this.masterGain;
		if (!context || !master) return;
		const now = context.currentTime;
		master.gain.cancelScheduledValues(now);
		master.gain.setValueAtTime(master.gain.value, now);
		master.gain.linearRampToValueAtTime(this.masterTarget(), now + seconds);
	}

	/** Where a sound of this kind plays into (see CHANNEL_LEVELS); null before the context exists. */
	public channel(channel: Channel): GainNode | null {
		return this.channels.get(channel) ?? null;
	}

	/**
	 * The player just fired: other gunfire dips for a moment, so their own shot is the one heard.
	 * Re-ducking while already ducked only extends the dip, it never stacks.
	 */
	public duckForOwnShot(): void {
		const context = this.context;
		const gunfire = this.channels.get("gunfire");
		if (!context || !gunfire) return;
		const now = context.currentTime;
		const param = gunfire.gain;
		param.cancelScheduledValues(now);
		param.setValueAtTime(param.value, now);
		param.linearRampToValueAtTime(CHANNEL_LEVELS.gunfire * DUCK_LEVEL, now + 0.01);
		param.setValueAtTime(CHANNEL_LEVELS.gunfire * DUCK_LEVEL, now + DUCK_HOLD);
		param.linearRampToValueAtTime(CHANNEL_LEVELS.gunfire, now + DUCK_HOLD + DUCK_RELEASE);
	}

	/**
	 * The city's echo: send a sound here (as well as to the master) and it comes back off the
	 * buildings — a few hard slaps from the nearest walls, then a darkening wash. It's what turns
	 * a gunshot from a click in a void into a shot in a street.
	 */
	public get echo(): GainNode | null {
		return this.echoInput;
	}

	/** Two seconds of white noise, shared by everything that needs a noise source. */
	public get noise(): AudioBuffer | null {
		return this.noiseLoop;
	}

	/** How a point in the world should sound from where the camera is. */
	public place(x: number, y: number, z: number, out?: Placement): Placement {
		const dx = x - this.listener.x;
		const dy = y - this.listener.y;
		const dz = z - this.listener.z;
		const distance = Math.hypot(dx, dy, dz);
		const result = out ?? { gain: 0, pan: 0, muffle: 20000, distance: 0 };
		result.distance = distance;
		result.gain = HALF_VOLUME_DISTANCE / (HALF_VOLUME_DISTANCE + distance);
		// Sideways component against the camera's right, so sounds swing across the stereo field.
		result.pan = distance > 0.5
			? Math.max(-1, Math.min(1, (dx * this.listener.rightX + dz * this.listener.rightZ) / distance)) * 0.8
			: 0;
		result.muffle = 20000 / (1 + distance / 25);
		return result;
	}

	/** A looping noise source started at a random offset, so two of them never phase together. */
	public startNoise(context: AudioContext): AudioBufferSourceNode | null {
		if (!this.noiseLoop) return null;
		const source = context.createBufferSource();
		source.buffer = this.noiseLoop;
		source.loop = true;
		source.start(context.currentTime, Math.random() * this.noiseLoop.duration);
		return source;
	}
}

function clamp01(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

/**
 * The impulse response of a city street, built rather than recorded: a few soft early
 * reflections (the facades across the road, the end of the block), each a little duller than the
 * one before, over a diffuse tail that decays and loses its top end — air and brick absorb the
 * highs first. Left and right differ, so the echo is wide.
 *
 * The reflections are deliberately quiet and smeared into the tail. They used to be hard slaps
 * nearly as loud as the shot itself, and since the recordings already carry their own outdoor
 * reflections, the player heard every pistol shot followed by a second crack 50–200 ms later:
 * two shots per trigger pull. The whole response is normalised to unit energy so the send levels
 * mean the same thing whatever it's built from.
 */
function cityEcho(context: BaseAudioContext): AudioBuffer {
	const rate = context.sampleRate;
	const length = Math.floor(rate * ECHO_SECONDS);
	const buffer = context.createBuffer(2, length, rate);
	// Seeded, so every run of the game has the same street.
	let seed = 0x9e3779b9;
	const random = () => {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		return ((seed >>> 0) / 4294967296) * 2 - 1;
	};
	// Slap-backs: delay (s) and level, per side.
	const slaps: readonly (readonly [number, number, number])[] = [
		[0.031, 0.05, 0.03], [0.058, 0.03, 0.05], [0.097, 0.04, 0.025], [0.15, 0.025, 0.035],
		[0.22, 0.02, 0.015],
	];
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel);
		// The tail: noise with an exponential decay, smoothed more as it ages (one-pole low-pass
		// whose cutoff falls with time).
		let smooth = 0;
		for (let i = 0; i < length; i++) {
			const t = i / rate;
			const decay = Math.exp(-t * 3.1) * Math.min(1, t / 0.06);
			const darkening = 0.55 * Math.exp(-t * 1.6) + 0.04;
			smooth += (random() - smooth) * darkening;
			data[i] = smooth * decay * 0.22;
		}
		for (const [at, left, right] of slaps) {
			const level = channel === 0 ? left : right;
			const start = Math.floor(at * rate);
			// Each slap a short, dulled burst rather than a single click.
			let burst = 0;
			for (let k = 0; k < Math.floor(rate * 0.03); k++) {
				burst += (random() - burst) * 0.2;
				const i = start + k;
				if (i < length) data[i] += burst * level * Math.exp(-k / (rate * 0.008));
			}
		}
	}
	let energy = 0;
	for (let channel = 0; channel < 2; channel++) for (const sample of buffer.getChannelData(channel)) energy += sample * sample;
	const scale = 1 / Math.sqrt(energy / 2 || 1);
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel);
		for (let i = 0; i < length; i++) data[i] *= scale;
	}
	return buffer;
}

let bus: AudioBus | null = null;

export function audioBus(): AudioBus {
	bus ??= new AudioBus();
	return bus;
}
