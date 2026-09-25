import { GraphNode, Quat, Vec3 } from "playcanvas";
import { describe, expect, it } from "vitest";

import { findBone, rigForward, rotationBetween, SkeletonRetarget } from "./Retarget";

const close = (a: Vec3, b: Vec3) => {
	expect(a.x).toBeCloseTo(b.x, 4);
	expect(a.y).toBeCloseTo(b.y, 4);
	expect(a.z).toBeCloseTo(b.z, 4);
};

describe("rotationBetween", () => {
	it("turns one direction onto another", () => {
		const from = new Vec3(1, 0, 0);
		const to = new Vec3(0, -1, 0);
		close(rotationBetween(from, to).transformVector(from, new Vec3()), to);
	});

	it("handles parallel and opposite directions", () => {
		const x = new Vec3(1, 0, 0);
		close(rotationBetween(x, x).transformVector(x, new Vec3()), x);
		const back = new Vec3(-1, 0, 0);
		close(rotationBetween(x, back).transformVector(x, new Vec3()), back);
	});
});

describe("findBone", () => {
	it("ignores exporter suffixes and prefixes, and doesn't match look-alikes", () => {
		const root = new GraphNode("root");
		for (const name of ["CC_Base_Hip_02", "CC_Base_Hip2_05", "HumanArmature|Palm.R"]) root.addChild(new GraphNode(name));
		expect(findBone(root, "CC_Base_Hip")?.name).toBe("CC_Base_Hip_02");
		expect(findBone(root, "Palm.R")?.name).toBe("HumanArmature|Palm.R");
		expect(findBone(root, "Palm.L")).toBeNull();
	});
});

describe("rigForward", () => {
	it("faces +Z when the character's right is -X and up is +Y", () => {
		close(rigForward(new Vec3(-1, 0, 0), new Vec3(0, 1, 0)), new Vec3(0, 0, 1));
	});
});

describe("SkeletonRetarget", () => {
	/** A two-bone arm: shoulder at the origin, elbow one unit along `direction`. */
	function arm(names: [string, string], direction: Vec3) {
		const root = new GraphNode(`${names[0]}-root`);
		const shoulder = new GraphNode(names[0]);
		const elbow = new GraphNode(names[1]);
		root.addChild(shoulder);
		shoulder.addChild(elbow);
		elbow.setLocalPosition(direction.x, direction.y, direction.z);
		return { root, shoulder, elbow };
	}

	it("copies a rotation from rest across rigs whose rest poses differ", () => {
		// Source rests in a T-pose (arm along +X), target in an A-pose (arm 45 degrees down).
		const source = arm(["UpperArm.L", "LowerArm.L"], new Vec3(1, 0, 0));
		const rest = arm(["UpperArm.L", "LowerArm.L"], new Vec3(1, 0, 0));
		const target = arm(["CC_Base_L_Upperarm", "CC_Base_L_Forearm"], new Vec3(Math.SQRT1_2, -Math.SQRT1_2, 0));
		const retarget = new SkeletonRetarget(
			{ root: source.root, frame: null },
			{ root: rest.root, frame: null },
			{ root: target.root, frame: null },
			[{ source: "UpperArm.L", target: "CC_Base_L_Upperarm", sourceChild: "LowerArm.L", targetChild: "CC_Base_L_Forearm" }],
		);
		// Source drops its arm to hang straight down.
		source.shoulder.setLocalRotation(new Quat().setFromAxisAngle(Vec3.BACK, -90));
		retarget.apply();
		const direction = target.elbow.getPosition().clone().sub(target.shoulder.getPosition()).normalize();
		// The target's arm hangs straight down too — not 45 degrees further, into the body.
		close(direction, new Vec3(0, -1, 0));
	});
});
