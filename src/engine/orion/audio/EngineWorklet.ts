/**
 * The engine sound source: exhaust pulses, one per cylinder firing, generated sample by sample
 * on the audio thread.
 *
 * The first engines were one oscillator playing a fixed harmonic stack. However the harmonics
 * were weighted, a waveform that repeats exactly is heard as a synthesiser — a steady, buzzy
 * drone that grates after a minute of driving. What makes a real engine sound alive is that no
 * two combustion events are the same: each cylinder fires a little harder or softer than the
 * last, a little early or late, and each one carries its own burst of combustion noise. This
 * reproduces that directly:
 *
 *   - a pulse per firing, placed with sub-sample accuracy (so high revs stay clean, not gritty)
 *   - a fixed per-cylinder strength pattern, which is what gives an engine its lope and burble
 *   - random strength and timing on every firing, so it never repeats
 *   - a burst of noise at each firing that dies away before the next, rather than steady hiss
 *   - two gentle low-pass stages that turn each click into a pressure pulse
 *
 * The exhaust resonance and overall brightness are applied afterwards by ordinary filter nodes
 * (see EngineAudio). Nothing is sampled from any real engine.
 *
 * The processor is kept as source text and loaded from a Blob, so it needs no separate file
 * served beside the page and survives bundling untouched. It has to be plain JavaScript.
 */

/** What makes one kind of engine sound like itself, sent to the processor when a voice changes car. */
export interface EnginePulseVoicing {
	/** Relative strength of each cylinder in firing order; its unevenness is the engine's lope. */
	pattern: readonly number[];
	/** Random strength variation per firing, 0..1. */
	roughness: number;
	/** Random timing variation per firing, as a share of the firing interval. */
	jitter: number;
	/** Combustion noise carried by each firing, relative to its pulse. */
	noise: number;
	/** How long each firing's noise burst lasts, in seconds. */
	noiseDecay: number;
	/** Pulse-shaping cutoff (Hz): lower is a softer thump, higher a sharper crack. */
	pulseHz: number;
}

export const ENGINE_PROCESSOR_NAME = "orion-engine";

export const ENGINE_PROCESSOR_SOURCE = String.raw`
class OrionEngineProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{ name: "firing", defaultValue: 30, minValue: 0, maxValue: 4000, automationRate: "k-rate" },
			{ name: "load", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
		];
	}

	constructor() {
		super();
		this.phase = 0;
		this.interval = 1;
		this.cylinder = 0;
		this.carry = 0;
		this.burst = 0;
		this.low1 = 0;
		this.low2 = 0;
		this.dcIn = 0;
		this.dcOut = 0;
		this.configure({ pattern: [1, 1, 1, 1], roughness: 0.1, jitter: 0.01, noise: 0.3, noiseDecay: 0.004, pulseHz: 300 });
		this.port.onmessage = (event) => this.configure(event.data);
	}

	configure(voicing) {
		this.pattern = voicing.pattern.slice();
		this.roughness = voicing.roughness;
		this.jitter = voicing.jitter;
		this.noise = voicing.noise;
		this.burstFade = Math.exp(-1 / (Math.max(0.0005, voicing.noiseDecay) * sampleRate));
		this.pulseHz = voicing.pulseHz;
		this.cylinder = 0;
	}

	process(inputs, outputs, parameters) {
		const channel = outputs[0] && outputs[0][0];
		if (!channel) return true;
		const firing = parameters.firing[0];
		const load = parameters.load[0];
		const step = firing / sampleRate;
		// A pulse's size is scaled to the firing rate so the level holds steady across the rev
		// range; how loud the engine is belongs to the gain after this, not to the pulse count.
		// Isolated low-rev pulses carry more energy each than overlapping high-rev ones, so the
		// size also leans down with the rate (measured: each engine holds within ~3 dB, idle to redline).
		const size = firing > 0 ? (0.14 / Math.max(step, 1e-4)) * Math.pow(Math.min(firing, 900) / 200, 0.42) * Math.min(1, firing / 12) : 0;
		// Never shape the pulses so softly that the firing tone itself is filtered away.
		const cutoff = Math.max(this.pulseHz, firing * 1.4);
		const smooth = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
		const noiseLevel = this.noise * (0.45 + 0.55 * load);
		const pattern = this.pattern;
		for (let i = 0; i < channel.length; i++) {
			let x = this.carry;
			this.carry = 0;
			if (step > 0) {
				this.phase += step / this.interval;
				if (this.phase >= 1) {
					this.phase -= 1;
					// How far past the sample the firing fell; the pulse is shared between this
					// sample and the next so its timing isn't rounded to the sample grid.
					const late = Math.min(1, this.phase / (step / this.interval));
					this.cylinder = (this.cylinder + 1) % pattern.length;
					const strength = pattern[this.cylinder] * (1 + (Math.random() * 2 - 1) * this.roughness);
					x += size * strength * late;
					this.carry = size * strength * (1 - late);
					this.burst = strength;
					this.interval = 1 + (Math.random() * 2 - 1) * this.jitter;
				}
			}
			this.burst *= this.burstFade;
			x += (Math.random() * 2 - 1) * this.burst * noiseLevel * size * 0.08;
			this.low1 += (x - this.low1) * (1 - smooth);
			this.low2 += (this.low1 - this.low2) * (1 - smooth);
			// DC blocker: pulses are all positive pressure; only the swing is sound.
			const out = this.low2 - this.dcIn + 0.996 * this.dcOut;
			this.dcIn = this.low2;
			this.dcOut = out;
			// Brought up to the old oscillator's level, so the mix after it is unchanged.
			channel[i] = out * 2.2;
		}
		return true;
	}
}

registerProcessor("${ENGINE_PROCESSOR_NAME}", OrionEngineProcessor);
`;

const loading = new WeakMap<BaseAudioContext, Promise<boolean>>();

/**
 * Loads the processor into a context, once. Resolves false where AudioWorklet isn't available
 * (an insecure http:// page, or a very old browser); the caller falls back to the oscillator.
 */
export function loadEngineWorklet(context: BaseAudioContext): Promise<boolean> {
	const existing = loading.get(context);
	if (existing) return existing;
	const promise = (async () => {
		if (!context.audioWorklet) return false;
		const url = URL.createObjectURL(new Blob([ENGINE_PROCESSOR_SOURCE], { type: "application/javascript" }));
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
