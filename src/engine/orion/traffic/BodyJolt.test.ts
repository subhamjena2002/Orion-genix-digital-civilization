import { describe, expect, it } from "vitest";

import { BodyJolt } from "./BodyJolt";

function run(jolt: BodyJolt, seconds: number) {
	let peakPitch = 0;
	let peakRoll = 0;
	for (let t = 0; t < seconds; t += 1 / 60) {
		jolt.update(1 / 60);
		if (Math.abs(jolt.pitch) > Math.abs(peakPitch)) peakPitch = jolt.pitch;
		if (Math.abs(jolt.roll) > Math.abs(peakRoll)) peakRoll = jolt.roll;
	}
	return { peakPitch, peakRoll };
}

describe("body jolt", () => {
	it("dives the nose on a head-on hit, then settles", () => {
		const jolt = new BodyJolt();
		jolt.kick(-1, 0, 10);
		const { peakPitch } = run(jolt, 0.4);
		expect(peakPitch).toBeGreaterThan(4);
		run(jolt, 3);
		expect(jolt.pitch).toBe(0);
	});

	it("tips the body the way a side blow pushes it, within the springs' travel", () => {
		const jolt = new BodyJolt();
		jolt.kick(0, 1, 40);
		const { peakRoll } = run(jolt, 0.4);
		expect(peakRoll).toBeLessThan(0);
		expect(peakRoll).toBeGreaterThanOrEqual(-11);
	});

	it("settles in real time even when frames are long", () => {
		const jolt = new BodyJolt();
		jolt.kick(-1, 0.5, 12);
		for (let i = 0; i < 8; i++) jolt.update(0.25);
		expect(jolt.pitch).toBe(0);
		expect(jolt.roll).toBe(0);
	});

	it("squats the tail when shunted from behind", () => {
		const jolt = new BodyJolt();
		jolt.kick(1, 0, 6);
		expect(run(jolt, 0.4).peakPitch).toBeLessThan(0);
	});
});
