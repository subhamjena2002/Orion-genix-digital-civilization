/**
 * Recorded engines, played on the audio thread from three kinds of recording:
 *
 * - **The idle**: a steady stretch of the engine idling, cut into a seamless loop and played
 *   straight through, a little faster or slower as the revs move about idle. Idling is where
 *   traffic spends half its time, and a real idle has a slow life to it — each cylinder a little
 *   different, the idle hunting — that only a long recording carries. (Scrubbing the bottom of a
 *   rev ramp, as this used to, froze one tenth of a second of it into a buzz.)
 * - **Rev ramps**: a recording of the engine revving from idle to high under load (and one
 *   easing off, for the overrun), with its firing frequency measured along it by
 *   scripts/prepare-vehicle-sounds.py. To sound the engine at some pitch, the processor finds
 *   where in the ramp the recording was at that pitch and plays short overlapping grains from
 *   there, each with a smooth window, nudged at random so nothing repeats. Four grains overlap at
 *   any moment (two fluttered at the grain rate). Sweeping the revs is seamless, unlike
 *   repitching a fixed loop.
 * - **RPM layers**: steady loops recorded at a few engine speeds, for engines recorded that way.
 *   The two either side of the wanted pitch play together, each repitched towards it and
 *   crossfaded by where the pitch lies between them (equal power, in log pitch).
 *
 * The idle hands over to the ramps or layers as the revs leave it, crossfaded over the first
 * third above idle. `load` blends the on-throttle ramp with the overrun ramp: a car coasting down
 * sounds different from one accelerating at the same revs.
 *
 * Each family's samples are sent to the audio thread once and kept in the worklet scope, which
 * every processor shares, so six voices on the same kind of engine hold one copy between them.
 * A voice with no car is put to sleep and costs nothing.
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

/** A seamless loop of the engine at one speed, and its firing frequency (Hz). */
export interface EngineLoop {
	samples: Float32Array;
	hz: number;
}

/** Everything the audio thread needs for one engine family. */
export interface EngineFamilyData {
	idle: EngineLoop | null;
	ramps: readonly EngineRamp[];
	layers: readonly EngineLoop[];
}

export const ENGINE_GRAIN_SOURCE = String.raw`
const FAMILIES = new Map();
const OVERLAP_LEVEL = Math.SQRT1_2;
/** The idle hands over to the ramps or layers between these multiples of the idle's pitch. */
const IDLE_FROM = 1.04;
const IDLE_SPAN = 0.32;

class OrionEngineGrainProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{ name: "hz", defaultValue: 40, minValue: 1, maxValue: 2000, automationRate: "k-rate" },
			{ name: "load", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" },
			// Plays the engine higher or lower than recorded (a sibling model, and the Doppler shift).
			{ name: "shift", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" },
		];
	}

	constructor() {
		super();
		this.family = null;
		this.sleeping = true;
		// 110 ms grains: long enough to hold several firing cycles at idle, so the overlap smears
		// less of the engine's own rhythm into a grainy roughness.
		this.grain = Math.round(sampleRate * 0.11);
		this.hop = this.grain >> 2;
		this.untilNext = 0;
		this.slots = [this.makeSlot(), this.makeSlot(), this.makeSlot(), this.makeSlot()];
		this.next = 0;
		this.window = new Float32Array(this.grain);
		for (let i = 0; i < this.grain; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.grain - 1));
		// Read heads of the idle loop and of each layer, started at random so voices never line up.
		this.idleHead = 0;
		this.layerHeads = [];
		this.weights = [0, 0];
		this.port.onmessage = (event) => {
			const data = event.data;
			if (data.register) FAMILIES.set(data.register, data.family);
			if (data.use !== undefined) {
				this.family = data.use;
				const family = FAMILIES.get(data.use);
				this.idleHead = family && family.idle ? Math.random() * family.idle.samples.length : 0;
				this.layerHeads = family ? family.layers.map((layer) => Math.random() * layer.samples.length) : [];
			}
			if (data.sleep !== undefined) this.sleeping = data.sleep;
		};
	}

	makeSlot() {
		return { age: this.grain, heads: [0, 0], rates: [1, 1] };
	}

	/**
	 * Where in a ramp the recording was at pitch hz, and its pitch there. Between two marks far
	 * apart in the recording (a ramp put together from separate takes), the nearer one in pitch is
	 * used rather than a point between them, which would be some unrelated moment of the take.
	 */
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
		// A slow rev-up can put marks a second apart; a jump of more, or backwards, is another take.
		const step = ramp.position[hi] - ramp.position[lo];
		if (step < 0 || step > sampleRate * 1.5) {
			return hz / pitch[lo] < pitch[hi] / hz ? [ramp.position[lo], pitch[lo]] : [ramp.position[hi], pitch[hi]];
		}
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
			const jitter = (Math.random() * 2 - 1) * this.grain * 0.2;
			const rate = Math.max(0.3, Math.min(3, (hz / found) * shift));
			const limit = Math.max(0, ramp.samples.length - this.grain * rate - 4);
			slot.heads[r] = Math.max(0, Math.min(limit, at - this.grain * 0.5 * rate + jitter));
			slot.rates[r] = rate;
		}
	}

	/** One sample of the granular ramps. */
	grainSample(ramps, hz, shift) {
		if (this.untilNext <= 0) {
			this.startGrain(ramps, hz, shift);
			this.untilNext = this.hop;
		}
		this.untilNext--;
		const weights = this.weights;
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
		return sum * OVERLAP_LEVEL;
	}

	/** One sample of a looping recording, its read head advanced at rate. */
	loopSample(samples, head, rate) {
		const n = samples.length;
		const index = head | 0;
		const frac = head - index;
		const a = samples[index % n];
		const b = samples[(index + 1) % n];
		return a + (b - a) * frac;
	}

	process(inputs, outputs, parameters) {
		const out = outputs[0][0];
		const family = this.family !== null ? FAMILIES.get(this.family) : null;
		if (this.sleeping || !family) {
			out.fill(0);
			return true;
		}
		const hz = parameters.hz[0];
		const load = parameters.load[0];
		const shift = parameters.shift[0];
		const idle = family.idle;
		const ramps = family.ramps;
		const layers = family.layers;

		// How far the revs have left idle, 0..1, and the equal-power handover.
		const away = idle ? Math.max(0, Math.min(1, (hz / idle.hz - IDLE_FROM) / IDLE_SPAN)) : 1;
		const idleWeight = Math.cos((away * Math.PI) / 2);
		const mainWeight = Math.sin((away * Math.PI) / 2);
		const idleRate = idle ? Math.max(0.7, Math.min(1.6, (hz / idle.hz) * shift)) : 1;
		// On the throttle (0) against the overrun (1), equal power.
		this.weights[0] = ramps.length > 1 ? Math.sin((load * Math.PI) / 2) : 1;
		this.weights[1] = ramps.length > 1 ? Math.cos((load * Math.PI) / 2) : 0;

		// The two layers either side of hz, and their share (equal power in log pitch).
		let lower = 0;
		let upper = 0;
		let upperShare = 0;
		if (layers.length > 0) {
			while (upper < layers.length - 1 && layers[upper].hz < hz) upper++;
			lower = Math.max(0, upper - 1);
			if (hz <= layers[0].hz) upper = lower = 0;
			else if (hz >= layers[layers.length - 1].hz) upper = lower = layers.length - 1;
			else upperShare = Math.log(hz / layers[lower].hz) / Math.log(layers[upper].hz / layers[lower].hz);
		}
		const lowerWeight = Math.cos((upperShare * Math.PI) / 2);
		const upperWeight = lower === upper ? 0 : Math.sin((upperShare * Math.PI) / 2);
		const lowerRate = layers.length > 0 ? Math.max(0.5, Math.min(2, (hz / layers[lower].hz) * shift)) : 1;
		const upperRate = layers.length > 0 ? Math.max(0.5, Math.min(2, (hz / layers[upper].hz) * shift)) : 1;

		const useIdle = idle && idleWeight > 0.001;
		const useMain = mainWeight > 0.001;
		for (let i = 0; i < out.length; i++) {
			let sum = 0;
			if (useIdle) {
				sum += this.loopSample(idle.samples, this.idleHead, idleRate) * idleWeight;
				this.idleHead = (this.idleHead + idleRate) % idle.samples.length;
			}
			if (useMain) {
				if (ramps.length > 0) {
					sum += this.grainSample(ramps, hz, shift) * mainWeight;
				} else if (layers.length > 0) {
					const a = layers[lower].samples;
					sum += this.loopSample(a, this.layerHeads[lower], lowerRate) * lowerWeight * mainWeight;
					this.layerHeads[lower] = (this.layerHeads[lower] + lowerRate) % a.length;
					if (upperWeight > 0) {
						const b = layers[upper].samples;
						sum += this.loopSample(b, this.layerHeads[upper], upperRate) * upperWeight * mainWeight;
						this.layerHeads[upper] = (this.layerHeads[upper] + upperRate) % b.length;
					}
				}
			}
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
		const url = URL.createObjectURL(new Blob([ENGINE_GRAIN_SOURCE], { type: "application/javascript" }));
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
 * Points a grain node at an engine family, sending that family's recordings to the audio thread
 * the first time any node in this context asks for it. False until they have all loaded.
 */
export function setEngineFamily(node: AudioWorkletNode, family: string, data: () => EngineFamilyData | null): boolean {
	const context = node.context;
	let sent = registered.get(context);
	if (!sent) registered.set(context, (sent = new Set()));
	if (!sent.has(family)) {
		const loaded = data();
		if (!loaded) return false;
		node.port.postMessage({ register: family, family: loaded });
		sent.add(family);
	}
	node.port.postMessage({ use: family });
	return true;
}

/** Wakes a grain node, or puts it to sleep (silent, and costing nothing) while it has no car. */
export function setEngineAwake(node: AudioWorkletNode, awake: boolean): void {
	node.port.postMessage({ sleep: !awake });
}
