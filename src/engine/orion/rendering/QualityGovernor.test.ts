import { describe, expect, it } from "vitest";

import { QUALITY_LEVELS, QualityGovernor, startingLevel } from "./QualityGovernor";

const LEVELS = QUALITY_LEVELS.length;

/** Feeds `seconds` of frames. `work` is the GPU/CPU time per frame, if the browser reports it. */
function feed(governor: QualityGovernor, seconds: number, interval: number | (() => number), work?: number) {
	const changes: number[] = [];
	for (let elapsed = 0; elapsed < seconds;) {
		const frame = typeof interval === "number" ? interval : interval();
		const changed = governor.sample(frame, work);
		if (changed !== null) changes.push(changed);
		elapsed += frame;
	}
	return changes;
}

describe("QualityGovernor", () => {
	it("steps down when frames take too long to make", () => {
		const governor = new QualityGovernor({ levelCount: LEVELS, startLevel: 0 });
		const changes = feed(governor, 3, 1 / 60, 0.03);
		expect(changes[0]).toBe(1);
		expect(governor.level).toBeGreaterThan(0);
	});

	it("keeps stepping down to the cheapest level under sustained overload, and no further", () => {
		const governor = new QualityGovernor({ levelCount: LEVELS, startLevel: 0 });
		feed(governor, 60, 1 / 20);
		expect(governor.level).toBe(LEVELS - 1);
	});

	it("climbs back to the best level when there is headroom", () => {
		const governor = new QualityGovernor({ levelCount: LEVELS, startLevel: LEVELS - 1 });
		feed(governor, 60, 1 / 60, 0.006);
		expect(governor.level).toBe(0);
	});

	it("does not oscillate: a level that proved too slow is not retried straight away", () => {
		const governor = new QualityGovernor({ levelCount: LEVELS, startLevel: 0 });
		feed(governor, 3, 1 / 60, 0.03);
		const settled = governor.level;
		expect(settled).toBe(1);
		// Plenty of headroom now, but not for long enough to trust level 0 again.
		expect(feed(governor, 10, 1 / 60, 0.008)).toEqual([]);
		// Given a long calm spell it tries again.
		feed(governor, 30, 1 / 60, 0.008);
		expect(governor.level).toBe(0);
	});

	it("ignores hitches such as a tab switch or an asset load", () => {
		const governor = new QualityGovernor({ levelCount: LEVELS, startLevel: 1 });
		for (let i = 0; i < 20; i++) {
			expect(governor.sample(0.6)).toBeNull();
			feed(governor, 0.3, 1 / 60, 0.008);
		}
		expect(governor.level).toBeLessThanOrEqual(1);
	});

	it("does not mistake a steady 30 Hz display cap for overload", () => {
		const governor = new QualityGovernor({ levelCount: LEVELS, startLevel: 1 });
		const changes = feed(governor, 20, 1 / 30);
		expect(changes.every((level) => level <= 1)).toBe(true);
		expect(governor.refreshInterval()).toBeCloseTo(1 / 30, 3);
	});

	it("does recognise an overloaded 60 Hz display that stutters between 30 and 20 fps", () => {
		const governor = new QualityGovernor({ levelCount: LEVELS, startLevel: 0 });
		let flip = false;
		feed(governor, 10, () => ((flip = !flip) ? 1 / 30 : 1 / 20));
		expect(governor.level).toBeGreaterThan(0);
	});

	it("prefers measured work time over the frame interval", () => {
		// Vsync holds frames at 60 Hz but each takes 25 ms of GPU time: that's overload.
		const governor = new QualityGovernor({ levelCount: LEVELS, startLevel: 0 });
		feed(governor, 3, 1 / 60, 0.025);
		expect(governor.level).toBeGreaterThan(0);
	});

	it("clamps the starting level into range", () => {
		expect(new QualityGovernor({ levelCount: LEVELS, startLevel: 99 }).level).toBe(LEVELS - 1);
		expect(new QualityGovernor({ levelCount: LEVELS, startLevel: -3 }).level).toBe(0);
	});
});

describe("startingLevel", () => {
	it("always starts at full quality, whatever the canvas size", () => {
		expect(startingLevel()).toBe(0);
	});
});

describe("QUALITY_LEVELS", () => {
	it("gets cheaper at every step", () => {
		for (let i = 1; i < QUALITY_LEVELS.length; i++) {
			const better = QUALITY_LEVELS[i - 1];
			const worse = QUALITY_LEVELS[i];
			expect(worse.renderScale).toBeLessThanOrEqual(better.renderScale);
			expect(worse.samples).toBeLessThanOrEqual(better.samples);
			expect(worse.shadowResolution).toBeLessThanOrEqual(better.shadowResolution);
			expect(worse.fireLights).toBeLessThanOrEqual(better.fireLights);
		}
	});

	it("keeps native resolution until the last resorts", () => {
		expect(QUALITY_LEVELS[0].renderScale).toBe(1);
		expect(QUALITY_LEVELS.filter((level) => level.renderScale < 1).length).toBeLessThanOrEqual(2);
		for (const level of QUALITY_LEVELS) expect(level.renderScale).toBeGreaterThanOrEqual(0.8);
	});
});
