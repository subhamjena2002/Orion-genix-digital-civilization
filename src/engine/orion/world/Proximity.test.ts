import { describe, expect, it } from "vitest";

import { nearbyWithHysteresis, sameMembers } from "./Proximity";

type Item = { id: string; at: [number, number] };
const at = (item: Item) => item.at;
const near: Item = { id: "near", at: [10, 0] };
const edge: Item = { id: "edge", at: [120, 0] };
const far: Item = { id: "far", at: [500, 0] };
const items = [near, edge, far];

describe("nearbyWithHysteresis", () => {
	it("admits items inside the enter radius", () => {
		expect(nearbyWithHysteresis(items, at, 0, 0, 100, 130, new Set())).toEqual([near]);
	});

	it("keeps an item already in the set until it passes the exit radius", () => {
		const current = new Set([near, edge]);
		expect(nearbyWithHysteresis(items, at, 0, 0, 100, 130, current)).toEqual([near, edge]);
		// Walk away until it's beyond the exit radius.
		expect(nearbyWithHysteresis(items, at, -20, 0, 100, 130, current)).toEqual([near]);
	});

	it("doesn't admit an item between the radii that wasn't already in", () => {
		expect(nearbyWithHysteresis(items, at, 0, 0, 100, 130, new Set([near]))).toEqual([near]);
	});

	it("treats an exit radius smaller than the enter radius as the enter radius", () => {
		expect(nearbyWithHysteresis(items, at, 0, 0, 125, 50, new Set([edge]))).toEqual([near, edge]);
	});

	it("never thrashes an item walking back and forth over the enter boundary", () => {
		let current = new Set<Item>();
		let changes = 0;
		for (let step = 0; step < 50; step++) {
			const x = step % 2 === 0 ? 19 : 21;
			const next = nearbyWithHysteresis([edge], at, x, 0, 100, 130, current);
			if (!sameMembers(next, current)) changes++;
			current = new Set(next);
		}
		expect(changes).toBe(1);
	});
});

describe("sameMembers", () => {
	it("ignores order", () => {
		expect(sameMembers([near, edge], new Set([edge, near]))).toBe(true);
	});

	it("spots a missing or extra item", () => {
		expect(sameMembers([near], new Set([near, edge]))).toBe(false);
		expect(sameMembers([near, far], new Set([near, edge]))).toBe(false);
	});
});
