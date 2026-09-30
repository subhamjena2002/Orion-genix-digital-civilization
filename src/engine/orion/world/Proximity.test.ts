import { describe, expect, it } from "vitest";

import { limitNewcomers, nearbyWithHysteresis, sameMembers, streamingFocus } from "./Proximity";

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

describe("streamingFocus", () => {
	it("leaves the set alone walking about at street level", () => {
		const focus = streamingFocus(10, 0, 20, 1.5, 0);
		expect(focus.grow).toBeLessThan(3);
		expect(Math.hypot(focus.x - 10, focus.z - 20)).toBeLessThan(3);
	});

	it("reaches ahead along the track and wider at gunship speed", () => {
		const focus = streamingFocus(0, 80, 0, 0, 80);
		expect(focus.z).toBeGreaterThan(100);
		expect(Math.abs(focus.x)).toBeLessThan(1e-9);
		expect(focus.grow).toBeGreaterThan(140);
	});

	it("reaches further from height, and ignores a teleport", () => {
		expect(streamingFocus(0, 300, 0, 0, 0).grow).toBeGreaterThan(100);
		const jump = streamingFocus(0, 0, 0, 5000, 0);
		expect(jump.x).toBe(0);
		expect(jump.grow).toBe(0);
	});
});

describe("limitNewcomers", () => {
	const row: Item[] = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, at: [i * 10, 0] }));

	it("lets everything through when few are new", () => {
		expect(limitNewcomers(row.slice(0, 3), new Set([row[0]]), at, 0, 0, 3)).toEqual(row.slice(0, 3));
	});

	it("admits only the nearest few new items, keeping everything already in", () => {
		const current = new Set([row[5]]);
		const next = limitNewcomers(row, current, at, 0, 0, 2);
		expect(next).toEqual([row[0], row[1], row[5]]);
		// The next sample takes the next nearest.
		const later = limitNewcomers(row, new Set(next), at, 0, 0, 2);
		expect(later).toEqual([row[0], row[1], row[2], row[3], row[5]]);
	});
});
