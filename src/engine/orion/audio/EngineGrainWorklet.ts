/**
 * Recorded engines, played by granular scrubbing of a rev ramp.
 *
 * Each engine family is a studio recording of the engine revving from idle to high under load
 * (and one easing off, for the overrun), with its firing frequency measured along it by
 * scripts/prepare-sounds.py. To sound the engine at some pitch, the processor finds where in the
 * ramp the recording was at that pitch and plays short overlapping grains from there, each with
 * a smooth window, nudged in position at random so nothing repeats. Four grains overlap at any
 * moment: with only two, each new grain started out of phase with the one fading, and the engine
 * fluttered at the grain rate (a buzzy, grainy roughness); four average that out. The grains carry the real
 * engine's texture — the combustion, the intake, the exhaust note — and since a grain is only a
 * few tens of milliseconds, sweeping the revs up and down is seamless, unlike looping a fixed
 * recording (whose pitch-shifting gives the chipmunk sound and audible seams).
 *
 * `load` blends the on-throttle ramp with the overrun ramp: a car coasting down sounds different
 * from one accelerating at the same revs, and that difference is much of what sells it.
 *
 * Each family's samples are sent to the audio thread once and kept in the worklet scope, which
 * every processor shares, so six voices on the same kind of engine hold one copy between them.
 *
 * Kept as source text and loaded from a Blob, as EngineWorklet is; it must be plain JavaScript.
 */

export const ENGINE_GRAIN_PROCESSOR = "orion-engine-grains";

/** One recorded ramp: mono samples, and its firing frequency (Hz) at sample positions. */
export interface EngineRamp {
	samples: Float32Array;
	/** Non-decreasing firing frequency at each marked position. */
	pitch: Float32Array;
	/** Sample index of each marked position. */
	position: Float32Array;
}

const SOURCE = String.raw`
const RAMPS = new Map();
const OVERLAP_LEVEL = Math.SQRT1_2;

class OrionEngineGrainProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{ name: "hz", defaultValue: 40, minValue: 1, maxValue: 2000, automationRate: "k-rate" },
			{ name: "load", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" },
			// Plays the engine higher or lower than recorded: a van's diesel from a lorry's.
			{ name: "shift", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" },
		];
	}

	constructor() {
		super();
		this.family = null;
		this.grain = Math.round(sampleRate * 0.09);
		this.hop = this.grain >> 2;
		this.untilNext = 0;
		// Four grains overlap at any moment, each with a read head per ramp.
		this.slots = [this.makeSlot(), this.makeSlot(), this.makeSlot(), this.makeSlot()];
		this.next = 0;
		this.window = new Float32Array(this.grain);
		for (let i = 0; i < this.grain; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.grain - 1));
		this.port.onmessage = (event) => {
			const data = event.data;
			if (data.register) RAMPS.set(data.register, data.ramps);
			if (data.use !== undefined) this.family = data.use;
		};
	}

	makeSlot() {
		return { age: this.grain, heads: [0, 0], rates: [1, 1] };
	}

	/** Where in a ramp the recording was at pitch hz (interpolated), and its pitch there. */
	locate(ramp, hz) {
		const pitch = ramp.pitch;
		const n = pitch.length;
		if (hz <= pitch[0]) return [ramp.position[0], pitch[0]];
		if (hz >= pitch[n - 1]) return [ramp.position[n - 1], pitch[n - 1]];
		let lo = 0;
		let hi = n - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (pitch[mid] <= hz) lo = mid;
			else hi = mid;
		}
		const span = pitch[hi] - pitch[lo];
		const t = span > 0 ? (hz - pitch[lo]) / span : 0;
		return [ramp.position[lo] + (ramp.position[hi] - ramp.position[lo]) * t, hz];
	}

	startGrain(ramps, hz, shift) {
		const slot = this.slots[this.next];
		this.next = (this.next + 1) % this.slots.length;
		slot.age = 0;
		for (let r = 0; r < ramps.length; r++) {
			const ramp = ramps[r];
			const [at, found] = this.locate(ramp, hz);
			// A little either side, so successive grains never read the same stretch.
			const jitter = (Math.random() * 2 - 1) * this.grain * 0.3;
			const rate = Math.max(0.3, Math.min(3, (hz / found) * shift));
			// Room for the whole grain at its rate, so it never reads past the end.
			const limit = Math.max(0, ramp.samples.length - this.grain * rate - 4);
			slot.heads[r] = Math.max(0, Math.min(limit, at - this.grain * 0.5 * rate + jitter));
			slot.rates[r] = rate;
		}
	}

	process(inputs, outputs, parameters) {
		const out = outputs[0][0];
		const ramps = this.family !== null ? RAMPS.get(this.family) : null;
		if (!ramps || ramps.length === 0) {
			out.fill(0);
			return true;
		}
		const hz = parameters.hz[0];
		const load = parameters.load[0];
		const shift = parameters.shift[0];
		// Equal-power blend of the on-throttle ramp (0) and the overrun ramp (1).
		const weights = ramps.length > 1 ? [Math.sin(load * Math.PI / 2), Math.cos(load * Math.PI / 2)] : [1];
		for (let i = 0; i < out.length; i++) {
			if (this.untilNext <= 0) {
				this.startGrain(ramps, hz, shift);
				this.untilNext = this.hop;
			}
			this.untilNext--;
			let sum = 0;
			for (const slot of this.slots) {
				if (slot.age >= this.grain) continue;
				const w = this.window[slot.age];
				for (let r = 0; r < ramps.length; r++) {
					const samples = ramps[r].samples;
					const head = slot.heads[r];
					const index = head | 0;
					if (index + 1 < samples.length) {
						const frac = head - index;
						sum += (samples[index] + (samples[index + 1] - samples[index]) * frac) * w * weights[r];
					}
					slot.heads[r] = head + slot.rates[r];
				}
				slot.age++;
			}
			// Four unrelated grains add in power, twice what two did: back to the same loudness.
			sum *= OVERLAP_LEVEL;
			// One bad sample would silence every sound downstream of the mix.
			out[i] = Number.isFinite(sum) ? sum : 0;
		}
		return true;
	}
}

registerProcessor("${ENGINE_GRAIN_PROCESSOR}", OrionEngineGrainProcessor);
`;

const loading = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Loads the processor into a context, once; false where AudioWorklet isn't available. */
export function loadEngineGrainWorklet(context: BaseAudioContext): Promise<boolean> {
	const existing = loading.get(context);
	if (existing) return existing;
	const promise = (async () => {
		if (!context.audioWorklet) return false;
		const url = URL.createObjectURL(new Blob([SOURCE], { type: "application/javascript" }));
		try {
			await context.audioWorklet.addModule(url);
			return true;
		} catch {
			return false;
		} finally {
			URL.revokeObjectURL(url);
		}
	})();
	loading.set(context, promise);
	return promise;
}

const registered = new WeakMap<BaseAudioContext, Set<string>>();

/**
 * Points a grain node at an engine family, sending that family's ramps to the audio thread the
 * first time any node in this context asks for it.
 */
export function setEngineFamily(node: AudioWorkletNode, family: string, ramps: () => readonly EngineRamp[] | null): boolean {
	const context = node.context;
	let sent = registered.get(context);
	if (!sent) registered.set(context, (sent = new Set()));
	if (!sent.has(family)) {
		const data = ramps();
		if (!data) return false;
		node.port.postMessage({ register: family, ramps: data.map((ramp) => ({ samples: ramp.samples, pitch: ramp.pitch, position: ramp.position })) });
		sent.add(family);
	}
	node.port.postMessage({ use: family });
	return true;
}
