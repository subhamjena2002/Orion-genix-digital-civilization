import { audioBus, AUDIBLE_DISTANCE, type Placement } from "../audio/AudioBus";
import type { SoundId } from "./WeaponData";

/**
 * Weapon and impact sounds.
 *
 * Weapons refer to sounds by id. An id plays the recorded file listed in SOUND_FILES if one is
 * given (drop files into public/audio/weapons/ and list them), otherwise a sound synthesised on
 * the spot with Web Audio. Everything ships synthesised: a recording of a real firearm belongs
 * to whoever made it, and these are built from noise and oscillators instead.
 *
 * A gunshot outdoors is not one sound, it is four, and the layers are what make it read as real
 * rather than as a click:
 *
 *   crack   a few milliseconds of bright noise — the supersonic snap off the muzzle
 *   blast   the body of the report, a noise burst whose top end falls away as it decays
 *   thump   the low end you feel, a sine dropping through the bottom two octaves
 *   tail    the quiet, slightly delayed wash of the sound coming back off the buildings
 *
 * Drop any of them and it stops sounding like a gun. The tail is the one usually missing, and
 * it is what places the shot in a street rather than in a void.
 *
 * Sounds are placed in the world: quieter with distance and panned left/right from the camera.
 */

/** Recorded replacements, by id, e.g. `rifle: "/audio/weapons/rifle.ogg"`. */
export const SOUND_FILES: Partial<Record<SoundId, string>> = {};

interface LayerBase {
	/** Seconds after the trigger that this layer starts. */
	at?: number;
	/** Seconds to fade out over. */
	decay: number;
	level: number;
	/** Seconds to reach full level; a crack is instant, a tail swells slightly. */
	attack?: number;
}

interface NoiseLayer extends LayerBase {
	kind: "noise";
	/** Low-pass cutoff (Hz), and where it sweeps to across the decay. */
	cutoff: number;
	cutoffTo?: number;
	highpass?: number;
	/** Above 1 narrows the band, for a ring rather than a hiss. */
	q?: number;
}

interface ToneLayer extends LayerBase {
	kind: "tone";
	/** Start and end frequency (Hz). */
	from: number;
	to: number;
	type?: OscillatorType;
}

type Layer = NoiseLayer | ToneLayer;

/** How much the level and pitch of each shot wander, so a burst isn't a loop. */
const VARIATION = 0.12;

const SYNTHS: Readonly<Record<SoundId, readonly Layer[]>> = {
	pistol: [
		{ kind: "noise", decay: 0.012, level: 0.85, cutoff: 11000, highpass: 2600 },
		{ kind: "noise", decay: 0.12, level: 0.8, cutoff: 4200, cutoffTo: 700 },
		{ kind: "tone", decay: 0.1, level: 0.55, from: 190, to: 52 },
		{ kind: "noise", at: 0.022, decay: 0.42, level: 0.16, cutoff: 2200, cutoffTo: 500, attack: 0.03 },
		// The slide coming back and closing again.
		{ kind: "noise", at: 0.05, decay: 0.03, level: 0.12, cutoff: 7000, highpass: 2200 },
	],
	rifle: [
		{ kind: "noise", decay: 0.009, level: 1, cutoff: 14000, highpass: 3800 },
		{ kind: "noise", decay: 0.1, level: 0.85, cutoff: 5600, cutoffTo: 900 },
		{ kind: "tone", decay: 0.09, level: 0.5, from: 170, to: 46 },
		{ kind: "noise", at: 0.026, decay: 0.55, level: 0.2, cutoff: 2600, cutoffTo: 420, attack: 0.035 },
		{ kind: "noise", at: 0.04, decay: 0.025, level: 0.1, cutoff: 8000, highpass: 2800 },
	],
	shotgun: [
		{ kind: "noise", decay: 0.02, level: 0.7, cutoff: 8000, highpass: 1800 },
		{ kind: "noise", decay: 0.3, level: 1, cutoff: 2600, cutoffTo: 420 },
		{ kind: "tone", decay: 0.28, level: 0.9, from: 120, to: 34 },
		{ kind: "noise", at: 0.03, decay: 0.8, level: 0.26, cutoff: 1600, cutoffTo: 300, attack: 0.05 },
		// Pumping the action.
		{ kind: "noise", at: 0.26, decay: 0.05, level: 0.14, cutoff: 5000, highpass: 1400 },
	],
	rocket: [
		{ kind: "noise", decay: 0.06, level: 0.6, cutoff: 3000, highpass: 800 },
		{ kind: "noise", decay: 0.9, level: 0.7, cutoff: 1400, cutoffTo: 5200, attack: 0.04 },
		{ kind: "tone", decay: 0.25, level: 0.6, from: 95, to: 38 },
	],
	explosion: [
		{ kind: "noise", decay: 0.05, level: 0.9, cutoff: 9000, highpass: 1200 },
		{ kind: "noise", decay: 1.1, level: 1, cutoff: 1100, cutoffTo: 200 },
		{ kind: "tone", decay: 1.2, level: 1, from: 74, to: 22 },
		{ kind: "noise", at: 0.06, decay: 2, level: 0.34, cutoff: 900, cutoffTo: 180, attack: 0.09 },
	],
	punch: [
		// Body: the dull one you feel rather than hear.
		{ kind: "tone", decay: 0.085, level: 0.85, from: 155, to: 47 },
		// Skin on cloth, right at the front.
		{ kind: "noise", decay: 0.035, level: 0.4, cutoff: 2400, highpass: 600, q: 1.4 },
		{ kind: "noise", at: 0.01, decay: 0.09, level: 0.12, cutoff: 5200, highpass: 1800 },
	],
	swing: [{ kind: "noise", decay: 0.14, level: 0.16, cutoff: 1400, cutoffTo: 2800, highpass: 500, attack: 0.05 }],
	slash: [
		{ kind: "noise", decay: 0.18, level: 0.22, cutoff: 6000, cutoffTo: 9500, highpass: 1800, attack: 0.03 },
		{ kind: "noise", at: 0.09, decay: 0.12, level: 0.1, cutoff: 9000, highpass: 4000 },
	],
	empty: [{ kind: "noise", decay: 0.02, level: 0.28, cutoff: 7000, highpass: 2500, q: 2 }],
	reload: [
		{ kind: "noise", decay: 0.03, level: 0.3, cutoff: 6000, highpass: 1500 },
		{ kind: "noise", at: 0.28, decay: 0.04, level: 0.3, cutoff: 5200, highpass: 1300 },
	],
	equip: [{ kind: "noise", decay: 0.04, level: 0.2, cutoff: 5000, highpass: 1200 }],
	impact: [
		{ kind: "noise", decay: 0.05, level: 0.22, cutoff: 3000, q: 1.6 },
		{ kind: "tone", decay: 0.04, level: 0.18, from: 320, to: 120 },
	],
	// Two tonnes of bodywork: the crunch, the thud through the floor, the panels ringing
	// afterwards, and a scatter of glass and trim.
	crash: [
		{ kind: "noise", decay: 0.05, level: 0.8, cutoff: 5000, highpass: 300 },
		{ kind: "tone", decay: 0.13, level: 0.6, from: 145, to: 42 },
		{ kind: "noise", at: 0.02, decay: 0.35, level: 0.3, cutoff: 3200, cutoffTo: 800, q: 2.2 },
		{ kind: "noise", at: 0.05, decay: 0.5, level: 0.12, cutoff: 12000, highpass: 5000 },
	],
};

class CombatAudio {
	private readonly files = new Map<SoundId, AudioBuffer | "loading" | "failed">();
	private readonly place: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };

	/** Where the camera is and which way its right-hand side points (flat, unit). */
	public setListener(x: number, y: number, z: number, rightX: number, rightZ: number): void {
		audioBus().setListener(x, y, z, rightX, rightZ);
	}

	public play(id: SoundId, x: number, y: number, z: number, volume = 1): void {
		const bus = audioBus();
		const placed = bus.place(x, y, z, this.place);
		if (placed.distance > AUDIBLE_DISTANCE) return;
		const context = bus.ensure();
		const master = bus.master;
		if (!context || !master) return;

		const output = context.createGain();
		output.gain.value = volume * placed.gain;
		const panner = context.createStereoPanner();
		panner.pan.value = placed.pan;
		const air = context.createBiquadFilter();
		air.type = "lowpass";
		air.frequency.value = placed.muffle;
		output.connect(air).connect(panner).connect(master);

		const file = this.fileFor(context, id);
		if (file) {
			const source = context.createBufferSource();
			source.buffer = file;
			source.connect(output);
			source.start();
			return;
		}
		// No two shots identical: a little level and pitch wander, and a fresh slice of noise.
		const wobble = 1 + (Math.random() * 2 - 1) * VARIATION;
		const at = context.currentTime;
		for (const layer of SYNTHS[id]) this.playLayer(context, layer, output, at, wobble);
	}

	private playLayer(context: AudioContext, layer: Layer, output: AudioNode, at: number, wobble: number) {
		const start = at + (layer.at ?? 0);
		const level = Math.max(0.0001, layer.level * wobble);
		const attack = layer.attack ?? 0.003;
		const envelope = context.createGain();
		envelope.gain.setValueAtTime(0.0001, start);
		envelope.gain.exponentialRampToValueAtTime(level, start + attack);
		envelope.gain.exponentialRampToValueAtTime(0.0001, start + attack + layer.decay);
		envelope.connect(output);

		if (layer.kind === "tone") {
			const oscillator = context.createOscillator();
			oscillator.type = layer.type ?? "sine";
			oscillator.frequency.setValueAtTime(layer.from * wobble, start);
			oscillator.frequency.exponentialRampToValueAtTime(layer.to * wobble, start + layer.decay);
			oscillator.connect(envelope);
			oscillator.start(start);
			oscillator.stop(start + layer.decay + 0.05);
			return;
		}

		const noise = audioBus().noise;
		if (!noise) return;
		const source = context.createBufferSource();
		source.buffer = noise;
		const lowpass = context.createBiquadFilter();
		lowpass.type = "lowpass";
		lowpass.frequency.setValueAtTime(layer.cutoff * wobble, start);
		if (layer.cutoffTo) lowpass.frequency.exponentialRampToValueAtTime(layer.cutoffTo, start + layer.decay);
		if (layer.q) lowpass.Q.value = layer.q;
		let chain: AudioNode = source.connect(lowpass);
		if (layer.highpass) {
			const filter = context.createBiquadFilter();
			filter.type = "highpass";
			filter.frequency.value = layer.highpass;
			chain = chain.connect(filter);
		}
		chain.connect(envelope);
		// Start somewhere random in the loop so repeated shots don't share a waveform.
		const span = layer.decay + attack + 0.05;
		source.start(start, Math.random() * Math.max(0.01, noise.duration - span), span);
	}

	private fileFor(context: AudioContext, id: SoundId): AudioBuffer | null {
		const url = SOUND_FILES[id];
		if (!url) return null;
		const cached = this.files.get(id);
		if (cached instanceof AudioBuffer) return cached;
		if (cached) return null;
		this.files.set(id, "loading");
		fetch(url)
			.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
			.then((data) => context.decodeAudioData(data))
			.then((buffer) => this.files.set(id, buffer))
			.catch(() => this.files.set(id, "failed"));
		return null;
	}
}

let audio: CombatAudio | null = null;

export function combatAudio(): CombatAudio {
	audio ??= new CombatAudio();
	return audio;
}
