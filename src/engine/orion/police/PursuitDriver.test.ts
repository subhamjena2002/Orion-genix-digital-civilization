import { describe, expect, it } from "vitest";

import { stepToward, steerToward } from "./PursuitDriver";

describe("PursuitDriver", () => {
	it("walks the grid towards the target, closing the larger gap first", () => {
		expect(stepToward(2, 2, 6, 3)).toEqual([3, 2]);
		expect(stepToward(2, 2, 3, 6)).toEqual([2, 3]);
		expect(stepToward(4, 4, 4, 4)).toBeNull();
	});

	it("doesn't double back the way it came", () => {
		// Arrived here heading +x; the target is behind and to the side.
		expect(stepToward(5, 2, 1, 4, 1, 0)).toEqual([5, 3]);
	});

	it("always reaches the target", () => {
		let at: [number, number] = [0, 0];
		let from: [number, number] = [0, 0];
		for (let i = 0; i < 40; i++) {
			const next = stepToward(at[0], at[1], 8, 5, from[0], from[1]);
			if (!next) break;
			from = [next[0] - at[0], next[1] - at[1]];
			at = next;
		}
		expect(at).toEqual([8, 5]);
	});

	it("steers left for a target on the left, and brakes to stop at it", () => {
		// Facing +Z; +X is to the left (heading rises towards +X).
		const left = steerToward(0, 0, 0, 10, 10, 10, 20);
		expect(left.steer).toBeGreaterThan(0);
		const right = steerToward(0, 0, 0, 10, -10, 10, 20);
		expect(right.steer).toBeLessThan(0);
		const stop = steerToward(0, 0, 0, 8, 0, 5, 0);
		expect(stop.drive).toBeLessThan(0);
		const go = steerToward(0, 0, 0, 0, 0, 50, 30);
		expect(go.drive).toBe(1);
	});
});
