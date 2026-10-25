/**
 * The few sounds the recorded library (SoundManifest) doesn't have: a fire's roar and crackle, a
 * fire hose's jet, steam, and the hiss of a tyre going down. Rendered once into buffers when the
 * audio starts and then played through the same SoundBank paths as the recordings (one-shots,
 * loops, voice limits, channels and settings), so nothing about them is special downstream.
 *
 * They're built from noise the way the real things are: a fire is a low turbulent rumble with
 * sharp, sparse cracks of resin and plastic over it; a jet is broadband hiss with the spatter of
 * water landing; escaping air is a narrow, falling, high hiss. Each loop's ends are crossfaded so
 * it repeats without a click. Deterministic (seeded), so they sound the same every run.
 */

export type SynthSoundId = "fire-loop" | "water-loop" | "steam-loop" | "tyre-hiss";

interface Rendered {
	seconds: number;
	loop: boolean;
	render: (out: Float32Array, rate: number, random: () => number) => void;
}

function seeded(seed: number): () => number {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return ((state >>> 0) / 4294967296) * 2 - 1;
	};
}

/** One-pole low-pass coefficient for a cutoff (Hz). */
function pole(cutoff: number, rate: number): number {
	return 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
}

const SOUNDS: Readonly<Record<SynthSoundId, Rendered>> = {
	"fire-loop": {
		seconds: 4,
		loop: true,
		render(out, rate, random) {
			const roarPole = pole(320, rate);
			const bodyPole = pole(1400, rate);
			let roar = 0;
			let body = 0;
			let swell = 0;
			const swellPole = pole(1.6, rate);
			for (let i = 0; i < out.length; i++) {
				const white = random();
				roar += (white - roar) * roarPole;
				body += (white - body) * bodyPole;
				swell += (random() * 0.5 + 0.5 - swell) * swellPole;
				out[i] = roar * 1.6 * (0.55 + swell * 0.9) + (body - roar) * 0.18;
			}
			// Crackles: sharp, short bursts at random, some in quick clusters.
			const highPole = pole(5200, rate);
			let t = 0;
			while (t < out.length) {
				t += Math.floor((0.008 + Math.abs(random()) * 0.09) * rate);
				const start = t;
				const length = Math.floor((0.002 + Math.abs(random()) * 0.012) * rate);
				const level = 0.15 + Math.abs(random()) ** 3 * 0.85;
				let low = 0;
				for (let k = 0; k < length && start + k < out.length; k++) {
					const white = random();
					low += (white - low) * highPole;
					// Band-passed: the noise less its own low end.
					out[start + k] += (white - low) * level * Math.exp((-6 * k) / length) * 0.9;
				}
			}
		},
	},
	"water-loop": {
		seconds: 3,
		loop: true,
		render(out, rate, random) {
			const lowPole = pole(500, rate);
			const highPole = pole(6500, rate);
			const flutterPole = pole(9, rate);
			let low = 0;
			let high = 0;
			let flutter = 0;
			for (let i = 0; i < out.length; i++) {
				const white = random();
				low += (white - low) * lowPole;
				high += (white - high) * highPole;
				flutter += (random() - flutter) * flutterPole;
				// The jet itself: broadband hiss with its low end thinned, wavering a little.
				out[i] = (high - low) * (0.8 + flutter * 0.6) + low * 0.35;
			}
			// Spatter: drops and gouts landing.
			for (let t = 0; t < out.length; t += Math.floor((0.004 + Math.abs(random()) * 0.02) * rate)) {
				const length = Math.floor(0.004 * rate);
				const level = Math.abs(random()) * 0.35;
				for (let k = 0; k < length && t + k < out.length; k++) out[t + k] += random() * level * (1 - k / length);
			}
		},
	},
	"steam-loop": {
		seconds: 3,
		loop: true,
		render(out, rate, random) {
			const lowPole = pole(2400, rate);
			const highPole = pole(9000, rate);
			const swellPole = pole(3, rate);
			let low = 0;
			let high = 0;
			let swell = 0.5;
			for (let i = 0; i < out.length; i++) {
				const white = random();
				low += (white - low) * lowPole;
				high += (white - high) * highPole;
				swell += (Math.abs(random()) - swell) * swellPole;
				out[i] = (high - low) * (0.5 + swell);
			}
		},
	},
	"tyre-hiss": {
		seconds: 2.6,
		loop: false,
		render(out, rate, random) {
			const lowPole = pole(2600, rate);
			let low = 0;
			let highPoleHz = 9000;
			let high = 0;
			for (let i = 0; i < out.length; i++) {
				const time = i / rate;
				// Pressure falling: the hiss narrows and drops in pitch and level as the air goes.
				highPoleHz = 9000 - 4200 * Math.min(1, time / 2.4);
				const highPole = pole(highPoleHz, rate);
				const white = random();
				low += (white - low) * lowPole;
				high += (white - high) * highPole;
				const envelope = Math.min(1, time / 0.015) * Math.exp(-time * 1.1) * (1 - Math.max(0, time - 2.3) / 0.3);
				out[i] = (high - low) * envelope * 1.3;
			}
		},
	},
};

/** Peak level the rendered sounds are normalised to (the recordings sit at about the same). */
const PEAK = 0.7;
const CROSSFADE_SECONDS = 0.25;

function renderSound(context: BaseAudioContext, id: SynthSoundId): AudioBuffer {
	const spec = SOUNDS[id];
	const rate = context.sampleRate;
	const extra = spec.loop ? Math.floor(CROSSFADE_SECONDS * rate) : 0;
	const length = Math.floor(spec.seconds * rate);
	const raw = new Float32Array(length + extra);
	spec.render(raw, rate, seeded(id.length * 2654435761 + id.charCodeAt(0)));
	const samples = new Float32Array(length);
	if (spec.loop) {
		// The tail past the loop's length is faded in over its start, so the seam is smooth.
		for (let i = 0; i < length; i++) samples[i] = raw[i];
		for (let i = 0; i < extra; i++) {
			const k = i / extra;
			samples[i] = raw[i] * Math.sin((k * Math.PI) / 2) + raw[length + i] * Math.cos((k * Math.PI) / 2);
		}
	} else {
		samples.set(raw.subarray(0, length));
	}
	let peak = 0;
	for (let i = 0; i < length; i++) {
		if (!Number.isFinite(samples[i])) samples[i] = 0;
		peak = Math.max(peak, Math.abs(samples[i]));
	}
	const gain = peak > 0 ? PEAK / peak : 0;
	const buffer = context.createBuffer(1, length, rate);
	const channel = buffer.getChannelData(0);
	for (let i = 0; i < length; i++) channel[i] = samples[i] * gain;
	return buffer;
}

export function synthesizeSounds(context: BaseAudioContext): Map<SynthSoundId, AudioBuffer> {
	const result = new Map<SynthSoundId, AudioBuffer>();
	for (const id of Object.keys(SOUNDS) as SynthSoundId[]) result.set(id, renderSound(context, id));
	return result;
}
