import { describe, expect, it } from "vitest";

import { ENGINE_VOICES, engineHarmonicTable, engineState, firingFrequency } from "./EngineVoices";
import { VEHICLE_SHAPES, type VehicleStyle } from "../traffic/Vehicles";

const STYLES = Object.keys(VEHICLE_SHAPES) as VehicleStyle[];

describe("engine voices", () => {
	it("gives every vehicle in the game a voice", () => {
		for (const style of STYLES) expect(ENGINE_VOICES[style], style).toBeDefined();
	});

	it("is a plausible engine in every case", () => {
		for (const style of STYLES) {
			const voice = ENGINE_VOICES[style];
			expect(voice.idleRpm, style).toBeGreaterThan(400);
			expect(voice.redlineRpm, style).toBeGreaterThan(voice.idleRpm * 2);
			expect(voice.harmonics.length, style).toBeGreaterThanOrEqual(6);
			expect(voice.brightness[1], style).toBeGreaterThan(voice.brightness[0]);
			// Gears have to climb, or the gearbox picks nonsense.
			for (let i = 1; i < voice.gearTops.length; i++) {
				expect(voice.gearTops[i], `${style} gear ${i}`).toBeGreaterThan(voice.gearTops[i - 1]);
			}
			// Top gear has to reach what the car can actually do.
			expect(voice.gearTops[voice.gearTops.length - 1], style).toBeGreaterThanOrEqual(VEHICLE_SHAPES[style].maxSpeed);
		}
	});

	it("carries half-order content between the firing harmonics", () => {
		for (const style of STYLES) {
			const voice = ENGINE_VOICES[style];
			const table = engineHarmonicTable(voice);
			// Index 0 is DC and must stay silent, or the waveform sits off-centre.
			expect(table[0], style).toBe(0);
			// The firing fundamental lands on index 2, not index 1.
			expect(table[2], style).toBeCloseTo(voice.harmonics[0], 6);
			// Index 1 is the half-order, and it has to be there but not dominate.
			expect(table[1], style).toBeGreaterThan(0);
			expect(table[1], style).toBeLessThan(table[2]);
		}
	});

	it("gives a lumpy single far more half-order than a V12", () => {
		const v12 = engineHarmonicTable(ENGINE_VOICES.luxury);
		const single = engineHarmonicTable(ENGINE_VOICES.auto);
		// Relative to each engine's own firing fundamental.
		expect(single[1] / single[2]).toBeGreaterThan((v12[1] / v12[2]) * 4);
	});

	it("sounds different for a supercar and a lorry, which is the whole point", () => {
		const luxury = ENGINE_VOICES.luxury;
		const truck = ENGINE_VOICES.truck;
		// At their own redlines the two are more than two octaves apart.
		const luxuryTop = firingFrequency(luxury, luxury.redlineRpm);
		const truckTop = firingFrequency(truck, truck.redlineRpm);
		expect(luxuryTop / truckTop).toBeGreaterThan(4);
		// And the lorry is mostly combustion noise where the supercar is mostly tone.
		expect(truck.noiseLevel).toBeGreaterThan(luxury.noiseLevel * 3);
	});
});

describe("the gearbox", () => {
	const voice = ENGINE_VOICES.luxury;

	it("idles when the car is stopped and off the throttle", () => {
		const state = engineState(voice, 0, 0, 0);
		expect(state.rpm).toBe(voice.idleRpm);
		expect(state.gear).toBe(0);
		expect(state.load).toBeLessThan(0.1);
	});

	it("revs against the clutch when stopped on the throttle", () => {
		const state = engineState(voice, 0, 1, 0);
		expect(state.rpm).toBeGreaterThan(voice.idleRpm * 1.5);
		expect(state.rpm).toBeLessThan(voice.redlineRpm);
	});

	it("climbs to the redline in gear, then drops on the shift", () => {
		const top = voice.gearTops[0];
		const beforeShift = engineState(voice, top - 0.2, 1, 0);
		const afterShift = engineState(voice, top + 0.2, 1, beforeShift.gear);
		expect(beforeShift.gear).toBe(0);
		expect(afterShift.gear).toBe(1);
		expect(beforeShift.rpm).toBeGreaterThan(voice.redlineRpm * 0.9);
		// The point of a gearbox: the revs fall away and start again.
		expect(afterShift.rpm).toBeLessThan(beforeShift.rpm * 0.75);
	});

	it("never exceeds the redline, at any speed", () => {
		let gear = 0;
		for (let speed = 0; speed < 120; speed += 0.5) {
			const state = engineState(voice, speed, 1, gear);
			gear = state.gear;
			expect(state.rpm, `at ${speed} m/s`).toBeLessThanOrEqual(voice.redlineRpm + 1e-6);
			expect(state.rpm, `at ${speed} m/s`).toBeGreaterThanOrEqual(voice.idleRpm - 1e-6);
		}
	});

	it("holds its gear rather than hunting on the boundary", () => {
		const top = voice.gearTops[0];
		// Drifting back and forth across a shift point must not flip gear every sample.
		let gear = engineState(voice, top + 1, 0.5, 0).gear;
		expect(gear).toBe(1);
		gear = engineState(voice, top - 0.5, 0.5, gear).gear;
		// Still in second: the speed is inside the margin below the shift point.
		expect(gear).toBe(1);
		gear = engineState(voice, top * 0.5, 0.5, gear).gear;
		expect(gear).toBe(0);
	});

	it("works its way up the box as the car accelerates", () => {
		let gear = 0;
		const seen = new Set<number>();
		for (let speed = 0; speed < voice.gearTops[voice.gearTops.length - 1]; speed += 0.5) {
			gear = engineState(voice, speed, 1, gear).gear;
			seen.add(gear);
		}
		expect(seen.size).toBe(voice.gearTops.length);
	});

	it("puts a four-stroke's firing frequency at half its cylinder count per revolution", () => {
		// A V12 at 6,000 rpm fires 600 times a second.
		expect(firingFrequency(ENGINE_VOICES.luxury, 6000)).toBeCloseTo(600, 6);
		// A six-cylinder diesel at 2,000 rpm, 100 Hz — two octaves and a half lower.
		expect(firingFrequency(ENGINE_VOICES.truck, 2000)).toBeCloseTo(100, 6);
	});
});
