import { describe, expect, it } from "vitest";

import { ENGINE_GRAIN_SOURCE } from "./EngineGrainWorklet";

const RATE = 48000;

interface Processor {
	port: { onmessage: (event: { data: unknown }) => void };
	locate(ramp: { pitch: Float32Array; position: Float32Array }, hz: number): [number, number];
	process(inputs: unknown, outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

/** Builds the processor from its source text, as the audio thread would. */
function makeProcessor(): Processor {
	let Registered: (new () => Processor) | null = null;
	class AudioWorkletProcessor {
		public port = { onmessage: (() => undefined) as (event: { data: unknown }) => void };
	}
	const register = (_name: string, ctor: new () => Processor) => {
		Registered = ctor;
	};
	new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", ENGINE_GRAIN_SOURCE)(AudioWorkletProcessor, register, RATE);
	if (!Registered) throw new Error("not registered");
	return new (Registered as new () => Processor)();
}

/** A sine loop at `hz`, `seconds` long, a whole number of cycles so it loops cleanly. */
function sine(hz: number, seconds: number, level = 0.5): Float32Array {
	const cycles = Math.round(hz * seconds);
	const length = Math.round((cycles / hz) * RATE);
	return Float32Array.from({ length }, (_, i) => level * Math.sin((2 * Math.PI * hz * i) / RATE));
}

function render(processor: Processor, hz: number, blocks = 40): Float32Array {
	const out = new Float32Array(128 * blocks);
	const block = [new Float32Array(128)];
	const parameters = { hz: new Float32Array([hz]), load: new Float32Array([1]), shift: new Float32Array([1]) };
	for (let b = 0; b < blocks; b++) {
		processor.process([], [block], parameters);
		out.set(block[0], b * 128);
	}
	return out;
}

/** The strongest frequency in a signal, by a coarse scan of single-bin DFTs. */
function dominant(signal: Float32Array, from: number, to: number): number {
	let best = from;
	let bestPower = -1;
	for (let f = from; f <= to; f += 1) {
		let re = 0;
		let im = 0;
		for (let i = 0; i < signal.length; i++) {
			re += signal[i] * Math.cos((2 * Math.PI * f * i) / RATE);
			im += signal[i] * Math.sin((2 * Math.PI * f * i) / RATE);
		}
		const power = re * re + im * im;
		if (power > bestPower) {
			bestPower = power;
			best = f;
		}
	}
	return best;
}

describe("the engine processor", () => {
	const family = {
		idle: { samples: sine(40, 1), hz: 40 },
		ramps: [],
		layers: [{ samples: sine(100, 1), hz: 100 }, { samples: sine(200, 1), hz: 200 }],
	};

	function engine(): Processor {
		const processor = makeProcessor();
		processor.port.onmessage({ data: { register: "test", family } });
		processor.port.onmessage({ data: { use: "test", sleep: false } });
		return processor;
	}

	it("is silent asleep, and before it has an engine", () => {
		const processor = makeProcessor();
		expect(render(processor, 40).every((sample) => sample === 0)).toBe(true);
		processor.port.onmessage({ data: { register: "test", family } });
		processor.port.onmessage({ data: { use: "test" } });
		expect(render(processor, 40).every((sample) => sample === 0)).toBe(true);
	});

	it("plays the idle loop at idle, and nothing of the layers", () => {
		expect(dominant(render(engine(), 40), 20, 260)).toBeCloseTo(40, -1);
	});

	it("repitches the layers to the revs, between and beyond them", () => {
		expect(Math.abs(dominant(render(engine(), 150), 20, 260) - 150)).toBeLessThanOrEqual(2);
		expect(Math.abs(dominant(render(engine(), 220), 20, 260) - 220)).toBeLessThanOrEqual(2);
	});

	it("never puts out anything but finite samples within range", () => {
		for (const hz of [1, 40, 47, 60, 100, 140, 200, 2000]) {
			for (const sample of render(engine(), hz, 8)) {
				expect(Number.isFinite(sample)).toBe(true);
				expect(Math.abs(sample)).toBeLessThan(1.5);
			}
		}
	});

	it("never reads between two takes of a ramp far apart in the recording", () => {
		const processor = makeProcessor();
		// Two takes: 60-100 Hz over the first second (a slow rev-up), 120-200 Hz ten seconds later.
		const ramp = { pitch: Float32Array.from([60, 100, 120, 200]), position: Float32Array.from([0, RATE, RATE * 10, RATE * 11]) };
		const [at] = processor.locate(ramp, 105);
		expect(at === RATE || at === RATE * 10).toBe(true);
		const [inside] = processor.locate(ramp, 80);
		expect(inside).toBeCloseTo(RATE * 0.5, -1);
	});
});
