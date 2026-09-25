/**
 * The one audio context the game uses, and the listener everything is placed against.
 *
 * Engines, gunfire and impacts all mix through here: a browser gives a page a limited number of
 * audio contexts, and two of them would need two listeners kept in step. Everything is
 * synthesised rather than played from files — see EngineVoices and CombatAudio for why.
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
	private noiseLoop: AudioBuffer | null = null;
	private sinceResume = 0;
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
		const master = context.createGain();
		master.gain.value = MASTER_LEVEL;
		this.masterGain = master;
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

	public get master(): GainNode | null {
		return this.masterGain;
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

let bus: AudioBus | null = null;

export function audioBus(): AudioBus {
	bus ??= new AudioBus();
	return bus;
}
