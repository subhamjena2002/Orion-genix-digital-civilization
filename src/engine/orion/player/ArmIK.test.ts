import { GraphNode, Quat, Vec3 } from "playcanvas";
import { describe, expect, it } from "vitest";

import { alignFrames, TwoBoneArm } from "./ArmIK";

const close = (a: Vec3, b: Vec3, digits = 4) => {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
	expect(a.z).toBeCloseTo(b.z, digits);
};

/** A right arm in a T-pose: straight out along -X from a shoulder at (-0.19, 1.4, 0). */
function tPoseArm() {
	const root = new GraphNode("root");
	const upper = new GraphNode("upper");
	const lower = new GraphNode("lower");
	const hand = new GraphNode("hand");
	root.addChild(upper);
	upper.addChild(lower);
	lower.addChild(hand);
	upper.setLocalPosition(-0.19, 1.4, 0);
	lower.setLocalPosition(-0.25, 0, 0);
	hand.setLocalPosition(-0.23, 0, 0);
	// Flexing the right elbow in a T-pose brings the hand forward: turning about +Y.
	const arm = new TwoBoneArm({ upper, lower, hand }, new Vec3(0, 1, 0));
	return { root, upper, lower, hand, arm };
}

describe("alignFrames", () => {
	it("takes one direction onto another and keeps the second axis's side", () => {
		const fromA = new Vec3(1, 0, 0);
		const fromB = new Vec3(0, 1, 0);
		const toA = new Vec3(0, 0, -1);
		const toB = new Vec3(1, 0, 0);
		const q = alignFrames(fromA, fromB, toA, toB);
		close(q.transformVector(fromA, new Vec3()), toA);
		close(q.transformVector(fromB, new Vec3()), toB);
	});
});

describe("TwoBoneArm", () => {
	it("puts the wrist on a reachable target", () => {
		const { arm, hand } = tPoseArm();
		const target = new Vec3(-0.1, 1.25, 0.3);
		expect(arm.solve(target, new Vec3(0, -1, 0))).toBe(0);
		close(hand.getPosition(), target);
	});

	it("keeps the bones the same length", () => {
		const { arm, upper, lower, hand } = tPoseArm();
		arm.solve(new Vec3(-0.05, 1.5, 0.35), new Vec3(1, -1, 0));
		expect(lower.getPosition().distance(upper.getPosition())).toBeCloseTo(arm.upperLength, 4);
		expect(hand.getPosition().distance(lower.getPosition())).toBeCloseTo(arm.lowerLength, 4);
	});

	it("bends the elbow towards the pole", () => {
		const { arm, lower } = tPoseArm();
		const target = new Vec3(-0.1, 1.4, 0.32);
		arm.solve(target, new Vec3(0, -1, 0));
		const below = lower.getPosition().y;
		arm.solve(target, new Vec3(0, 1, 0));
		const above = lower.getPosition().y;
		expect(below).toBeLessThan(1.4);
		expect(above).toBeGreaterThan(1.4);
	});

	it("stretches straight towards a target out of reach, and says how far short it fell", () => {
		const { arm, upper, hand } = tPoseArm();
		const target = new Vec3(-0.19, 1.4, 1.5);
		const short = arm.solve(target, new Vec3(0, -1, 0));
		expect(short).toBeCloseTo(1.5 - arm.reach * 0.9995, 3);
		const direction = hand.getPosition().clone().sub(upper.getPosition()).normalize();
		close(direction, new Vec3(0, 0, 1), 3);
	});

	it("gives the same result however many times it's solved", () => {
		const { arm, hand } = tPoseArm();
		const target = new Vec3(-0.2, 1.2, 0.25);
		arm.solve(target, new Vec3(0.4, -1, -0.3));
		const first = hand.getPosition().clone();
		arm.solve(new Vec3(0.2, 1.6, 0.2), new Vec3(0, -1, 0));
		arm.solve(target, new Vec3(0.4, -1, -0.3));
		close(hand.getPosition(), first);
	});

	it("bends the forearm the same way whichever way the upper arm was left", () => {
		const { arm, upper, lower } = tPoseArm();
		upper.setRotation(new Quat().setFromAxisAngle(new Vec3(1, 0, 0), 70));
		const target = new Vec3(-0.15, 1.3, 0.3);
		arm.solve(target, new Vec3(0.3, -1, -0.3));
		close(lower.getPosition().clone().sub(upper.getPosition()).normalize().mulScalar(arm.upperLength).add(upper.getPosition()), lower.getPosition());
		expect(arm.solve(target, new Vec3(0.3, -1, -0.3))).toBe(0);
	});
});
