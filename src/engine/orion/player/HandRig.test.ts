import { GraphNode, Quat, Vec3 } from "playcanvas";
import { describe, expect, it } from "vitest";

import { HandRig } from "./HandRig";

const close = (a: Vec3, b: Vec3, digits = 4) => {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
	expect(a.z).toBeCloseTo(b.z, digits);
};

/** A right hand in a T-pose: palm down, fingers straight out along -X, thumb forward. */
function tPoseHand(side: "R" | "L" = "R") {
	const sign = side === "R" ? -1 : 1;
	const root = new GraphNode("root");
	const hand = new GraphNode(`CC_Base_${side}_Hand`);
	root.addChild(hand);
	hand.setLocalPosition(sign * 0.68, 1.4, 0);
	const fingers: GraphNode[] = [];
	for (const name of ["Index", "Mid", "Ring", "Pinky", "Thumb"]) {
		let parent: GraphNode = hand;
		for (let joint = 1; joint <= 3; joint++) {
			const bone = new GraphNode(`CC_Base_${side}_${name}${joint}`);
			parent.addChild(bone);
			bone.setLocalPosition(sign * (joint === 1 ? 0.08 : 0.03), 0, name === "Thumb" && joint === 1 ? 0.03 : 0);
			parent = bone;
			if (joint === 3) fingers.push(bone);
		}
	}
	return { root, hand, fingers, rig: new HandRig(root, side, new Quat()) };
}

describe("HandRig", () => {
	it("finds every finger joint", () => {
		expect(tPoseHand().rig.jointCount).toBe(15);
	});

	it("leaves the hand as it is when asked for its own rest pose", () => {
		const { rig } = tPoseHand("R");
		const q = rig.orientation(new Vec3(-1, 0, 0), new Vec3(0, 0, 1));
		close(q.transformVector(new Vec3(0, 0, 1), new Vec3()), new Vec3(0, 0, 1));
		expect(Math.abs(q.w)).toBeCloseTo(1, 3);
	});

	it("turns the right hand so the fingers and palm face where asked", () => {
		const { rig } = tPoseHand("R");
		// Handshake grip: fingers forward, thumb up, so the palm faces left.
		const q = rig.orientation(new Vec3(0, 0, -1), new Vec3(0, 1, 0));
		const fingers = q.transformVector(new Vec3(-1, 0, 0), new Vec3());
		expect(fingers.z).toBeLessThan(-0.95);
		// The palm faced down at rest; it now faces -X (left, for something on the weapon's left).
		const palm = q.transformVector(new Vec3(0, -1, 0), new Vec3());
		expect(palm.x).toBeLessThan(-0.95);
	});

	it("mirrors for the left hand", () => {
		const { rig } = tPoseHand("L");
		// Palm up under a handguard, fingers forward: thumb to the left.
		const q = rig.orientation(new Vec3(0, 0, -1), new Vec3(-1, 0, 0));
		const palm = q.transformVector(new Vec3(0, -1, 0), new Vec3());
		expect(palm.y).toBeGreaterThan(0.95);
	});

	it("closes the fingers towards the palm", () => {
		const { rig, fingers } = tPoseHand("R");
		const open = fingers[1].getPosition().clone();
		rig.curl({ thumb: 0, index: 0, middle: 1, ring: 0, pinky: 0 });
		const closed = fingers[1].getPosition();
		// Palm is down: a curled fingertip drops, and comes back towards the wrist.
		expect(closed.y).toBeLessThan(open.y - 0.03);
		expect(Math.abs(closed.x - 0.68)).toBeLessThan(Math.abs(open.x - 0.68) - 1e-3);
		// Other fingers weren't touched.
		expect(fingers[0].getPosition().y).toBeCloseTo(1.4, 6);
	});

	it("opens back to the rest pose", () => {
		const { rig, fingers } = tPoseHand("L");
		const open = fingers[2].getPosition().clone();
		rig.curl({ thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 });
		rig.curl({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
		close(fingers[2].getPosition(), open, 5);
	});
});
