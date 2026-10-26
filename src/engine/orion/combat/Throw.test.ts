import { describe, expect, it } from "vitest";

import { bounce, THROW_GRAVITY, throwVelocity } from "./Throw";

/** Where a throw comes down at the height it was aimed at, flying without drag. */
function landing(v: number[], rise: number): { x: number; z: number } {
	// Solve y(t) = rise on the way down: vy t - g t² / 2 = rise.
	const disc = v[1] * v[1] - 2 * THROW_GRAVITY * rise;
	const t = (v[1] + Math.sqrt(disc)) / THROW_GRAVITY;
	return { x: v[0] * t, z: v[2] * t };
}

describe("throwVelocity", () => {
	it("lands on a target in reach, at the speed it was thrown", () => {
		const v = throwVelocity(0, 1.5, 0, 12, 0, 9, 19, THROW_GRAVITY);
		expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(19, 5);
		const hit = landing(v, -1.5);
		expect(hit.x).toBeCloseTo(12, 3);
		expect(hit.z).toBeCloseTo(9, 3);
	});

	it("takes the flatter arc", () => {
		const v = throwVelocity(0, 0, 0, 0, 0, 10, 19, THROW_GRAVITY);
		expect(Math.atan2(v[1], v[2]) * (180 / Math.PI)).toBeLessThan(45);
	});

	it("throws as far as it can at what's out of reach", () => {
		const v = throwVelocity(0, 0, 0, 200, 0, 0, 19, THROW_GRAVITY);
		expect(v[0]).toBeGreaterThan(0);
		expect(v[1]).toBeGreaterThan(0);
		expect(Math.atan2(v[1], v[0]) * (180 / Math.PI)).toBeCloseTo(42, 5);
	});
});

describe("bounce", () => {
	it("comes off the ground slower, keeping some of its roll", () => {
		const v = [4, -6, 0];
		bounce(v, 0, 1, 0, 0.3, 0.7);
		expect(v[0]).toBeCloseTo(2.8);
		expect(v[1]).toBeCloseTo(1.8);
	});

	it("leaves something already moving away alone", () => {
		const v = [1, 2, 3];
		bounce(v, 0, 1, 0, 0.3, 0.7);
		expect(v).toEqual([1, 2, 3]);
	});
});
