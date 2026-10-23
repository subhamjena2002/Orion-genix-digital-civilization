import { describe, expect, it } from "vitest";

import { EMERGENCY_CYCLE, emergencyFlash, policeFlash } from "./EmergencyLights";

/** Lit spans of one side over a cycle, sampled finely. */
function bursts(blue: boolean): number {
	let count = 0;
	let was = emergencyFlash(EMERGENCY_CYCLE - 1e-6, blue);
	for (let t = 0; t < EMERGENCY_CYCLE; t += 0.001) {
		const on = emergencyFlash(t, blue);
		if (on && !was) count++;
		was = on;
	}
	return count;
}

describe("emergency beacons", () => {
	it("flash each side in a double burst, once a cycle", () => {
		expect(bursts(false)).toBe(2);
		expect(bursts(true)).toBe(2);
	});

	it("never light both sides at once, and go dark between bursts", () => {
		let dark = 0;
		for (let t = 0; t < EMERGENCY_CYCLE * 3; t += 0.002) {
			const red = emergencyFlash(t, false);
			const blue = emergencyFlash(t, true);
			expect(red && blue).toBe(false);
			if (!red && !blue) dark++;
		}
		expect(dark).toBeGreaterThan(0);
	});

	it("read differently from a police bar's plain swap", () => {
		// A police bar always has one half lit; the strobes have gaps.
		for (let t = 0; t < 2; t += 0.01) expect(policeFlash(t, false, 0.28) !== policeFlash(t, true, 0.28)).toBe(true);
		expect(emergencyFlash(0.18 * EMERGENCY_CYCLE, false) || emergencyFlash(0.18 * EMERGENCY_CYCLE, true)).toBe(false);
	});
});
