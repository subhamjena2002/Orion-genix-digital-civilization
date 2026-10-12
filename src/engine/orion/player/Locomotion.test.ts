import { describe, expect, it } from "vitest";

import { angleDelta, LEAN, stepLean, stepTurn, type LeanState, type TurnState } from "./Locomotion";

const TUNING = { smoothTime: 0.14, maxRate: 720 };

function turn(from: number, to: number, seconds: number, dt: number): TurnState & { peak: number; overshoot: number } {
	const state: TurnState = { yaw: from, rate: 0 };
	let peak = 0;
	let overshoot = 0;
	const total = angleDelta(from, to);
	for (let t = 0; t < seconds; t += dt) {
		stepTurn(state, to, dt, TUNING);
		peak = Math.max(peak, Math.abs(state.rate));
		const travelled = state.yaw - from;
		overshoot = Math.max(overshoot, Math.sign(total) * (travelled - total));
	}
	return { ...state, peak, overshoot };
}

describe("angleDelta", () => {
	it("takes the short way round", () => {
		expect(angleDelta(170, -170)).toBeCloseTo(20);
		expect(angleDelta(-170, 170)).toBeCloseTo(-20);
		expect(angleDelta(0, 90)).toBeCloseTo(90);
		expect(angleDelta(720, 0)).toBeCloseTo(0);
	});
});

describe("stepTurn", () => {
	it("settles on the target without overshooting", () => {
		const result = turn(0, 135, 1.5, 1 / 60);
		expect(angleDelta(result.yaw, 135)).toBeCloseTo(0, 1);
		expect(result.overshoot).toBeLessThan(0.01);
	});

	it("never swings faster than the top rate", () => {
		expect(turn(0, 179, 1, 1 / 144).peak).toBeLessThanOrEqual(TUNING.maxRate + 1e-6);
	});

	it("eases in instead of snapping on the first frame", () => {
		const state: TurnState = { yaw: 0, rate: 0 };
		stepTurn(state, 180 - 1, 1 / 60, TUNING);
		// The old per-frame fraction (12/s) jumped ~33 degrees in this one frame.
		expect(state.yaw).toBeLessThan(10);
		expect(state.yaw).toBeGreaterThan(0);
	});

	it("comes out the same at 30 fps and 144 fps", () => {
		const slow = turn(10, 100, 0.25, 1 / 30);
		const fast = turn(10, 100, 0.25, 1 / 144);
		expect(Math.abs(slow.yaw - fast.yaw)).toBeLessThan(6);
	});

	it("stays stable on a very long frame", () => {
		const state: TurnState = { yaw: 0, rate: 0 };
		stepTurn(state, 90, 0.5, TUNING);
		expect(state.yaw).toBeGreaterThan(0);
		expect(state.yaw).toBeLessThanOrEqual(90);
		expect(Number.isFinite(state.rate)).toBe(true);
	});

	it("turns across the ±180 seam the short way", () => {
		const result = turn(170, -170, 1, 1 / 60);
		expect(angleDelta(result.yaw, -170)).toBeCloseTo(0, 1);
		expect(result.yaw).toBeGreaterThan(170);
	});
});

describe("stepLean", () => {
	function settle(turnRate: number, speed: number, accel: number): LeanState {
		const state: LeanState = { roll: 0, pitch: 0 };
		for (let i = 0; i < 120; i++) stepLean(state, turnRate, speed, accel, 1 / 60);
		return state;
	}

	it("leans into a left turn (head to the left)", () => {
		expect(settle(200, 5, 0).roll).toBeLessThan(-1);
		expect(settle(-200, 5, 0).roll).toBeGreaterThan(1);
	});

	it("stands upright when not turning", () => {
		expect(Math.abs(settle(0, 5, 0).roll)).toBeLessThan(1e-6);
	});

	it("doesn't lean while standing still", () => {
		expect(Math.abs(settle(400, 0, 0).roll)).toBeLessThan(1e-6);
	});

	it("keeps within its limits", () => {
		const hard = settle(2000, 9, 60);
		expect(Math.abs(hard.roll)).toBeLessThanOrEqual(LEAN.maxRoll + 1e-6);
		expect(hard.pitch).toBeLessThanOrEqual(LEAN.maxPitchForward + 1e-6);
		expect(settle(0, 0, -60).pitch).toBeGreaterThanOrEqual(-LEAN.maxPitchBack - 1e-6);
	});

	it("tips forward pushing off and back pulling up", () => {
		expect(settle(0, 2, 8).pitch).toBeGreaterThan(1);
		expect(settle(0, 2, -8).pitch).toBeLessThan(-1);
	});
});
