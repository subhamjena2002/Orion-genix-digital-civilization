import { describe, expect, it } from "vitest";

import { LOD_PROFILES, lodErrorBudget, projectedPixels, selectLod } from "./LodPolicy";

const vehicle = LOD_PROFILES.vehicle;

describe("projectedPixels", () => {
	it("halves as distance doubles and scales with the viewport", () => {
		const near = projectedPixels(2.5, 20, 48, 1080);
		expect(projectedPixels(2.5, 40, 48, 1080)).toBeCloseTo(near / 2);
		expect(projectedPixels(2.5, 20, 48, 2160)).toBeCloseTo(near * 2);
	});
});

describe("selectLod", () => {
	it("picks the level whose threshold the size clears", () => {
		expect(selectLod(1000, 0, vehicle)).toBe(0);
		expect(selectLod(150, 1, vehicle)).toBe(1);
		expect(selectLod(60, 2, vehicle)).toBe(2);
		expect(selectLod(10, 3, vehicle)).toBe(3);
	});

	it("holds its level inside the hysteresis band instead of flickering", () => {
		const threshold = vehicle.thresholds[0];
		// Just under LOD0's threshold: stays at LOD0 until clearly smaller.
		expect(selectLod(threshold * 0.95, 0, vehicle)).toBe(0);
		expect(selectLod(threshold * 0.8, 0, vehicle)).toBe(1);
		// Just over it from LOD1: stays at LOD1 until clearly bigger.
		expect(selectLod(threshold * 1.05, 1, vehicle)).toBe(1);
		expect(selectLod(threshold * 1.2, 1, vehicle)).toBe(0);
	});

	it("jumps straight across several levels when the size changes a lot", () => {
		expect(selectLod(5, 0, vehicle)).toBe(3);
		expect(selectLod(5000, 3, vehicle)).toBe(0);
	});

	it("keeps the player's car at full detail at any size", () => {
		expect(selectLod(1, 0, LOD_PROFILES.playerVehicle)).toBe(0);
	});
});

describe("lodErrorBudget", () => {
	it("allows more error at coarser levels, and none at LOD0", () => {
		expect(lodErrorBudget(0, vehicle, 2.6)).toBe(0);
		const errors = [1, 2, 3].map((level) => lodErrorBudget(level, vehicle, 2.6));
		expect(errors[0]).toBeGreaterThan(0);
		expect(errors[1]).toBeGreaterThan(errors[0]);
		expect(errors[2]).toBeGreaterThan(errors[1]);
	});

	it("stays under a pixel at the size each level switches in", () => {
		for (let level = 1; level <= 3; level++) {
			const error = lodErrorBudget(level, vehicle, 2.6);
			const pixelsAtSwitch = vehicle.thresholds[level - 1];
			const metresPerPixel = (2 * 2.6) / pixelsAtSwitch;
			expect(error / metresPerPixel).toBeLessThan(1);
		}
	});
});
