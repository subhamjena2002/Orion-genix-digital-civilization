import { describe, expect, it } from "vitest";

import { ENGINE_PROCESSOR_SOURCE, type EnginePulseVoicing } from "./EngineWorklet";
import { ENGINE_VOICES, firingFrequency } from "./EngineVoices";

const SAMPLE_RATE = 48000;

interface Processor {
	configure(voicing: EnginePulseVoicing): void;
	process(inputs: unknown[], outputs: Float32Array[][], parameters: Record<string, number[]>): boolean;
}

/** Runs the processor source as the audio thread would, without an AudioContext. */
function createProcessor(): Processor {
	let Processor: (new () => Processor) | null = null;
	class AudioWorkletProcessor {
		public port = { onmessage: null };
	}
	new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", ENGINE_PROCESSOR_SOURCE)(
		AudioWorkletProcessor,
		(_name: string, cls: new () => Processor) => {
			Processor = cls;
		},
		SAMPLE_RATE,
	);
	if (!Processor) throw new Error("processor was not registered");
	return new (Processor as new () => Processor)();
}

function render(voicing: EnginePulseVoicing, firing: number, load: number, seconds: number): Float32Array {
	const processor = createProcessor();
	processor.configure(voicing);
	const out = new Float32Array(Math.floor(seconds * SAMPLE_RATE / 128) * 128);
	for (let i = 0; i < out.length; i += 128) {
		const block = new Float32Array(128);
		processor.process([], [[block]], { firing: [firing], load: [load] });
		out.set(block, i);
	}
	return out;
}

function rms(samples: Float32Array): number {
	let sum = 0;
	for (const value of samples) sum += value * value;
	return Math.sqrt(sum / samples.length);
}

describe("engine pulse source", () => {
	it("holds a steady, unclipped level from idle to the redline for every engine", () => {
		for (const voice of Object.values(ENGINE_VOICES)) {
			const levels: number[] = [];
			for (const rpm of [voice.idleRpm, (voice.idleRpm + voice.redlineRpm) / 2, voice.redlineRpm]) {
				const samples = render(voice.pulse, firingFrequency(voice, rpm), 1, 1).subarray(SAMPLE_RATE / 4);
				expect(samples.every(Number.isFinite)).toBe(true);
				expect(Math.max(...samples.map(Math.abs))).toBeLessThan(3.5);
				levels.push(rms(samples));
			}
			// Within ~8 dB across the whole rev range; how loud it is overall is the mixer's job.
			expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(2.5);
			expect(Math.min(...levels)).toBeGreaterThan(0.1);
		}
	});

	it("never repeats itself exactly, cycle to cycle", () => {
		const voice = ENGINE_VOICES.sedan;
		const firing = firingFrequency(voice, 2000);
		const samples = render(voice.pulse, firing, 0.5, 1);
		// One full engine cycle (every cylinder once), compared with the next.
		const cycle = Math.round((SAMPLE_RATE / firing) * voice.pulse.pattern.length);
		const start = SAMPLE_RATE / 2;
		let difference = 0;
		for (let i = 0; i < cycle; i++) difference += (samples[start + i] - samples[start + cycle + i]) ** 2;
		const energy = rms(samples.subarray(start, start + cycle)) ** 2 * cycle;
		expect(difference / energy).toBeGreaterThan(0.01);
	});

	it("is silent with the engine stopped", () => {
		const samples = render(ENGINE_VOICES.truck.pulse, 0, 0, 0.5);
		expect(rms(samples)).toBeLessThan(1e-6);
	});
});
