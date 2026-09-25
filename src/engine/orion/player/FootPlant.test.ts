import { GraphNode, Quat, Vec3 } from "playcanvas";
import { describe, expect, it } from "vitest";

import { FootPlant } from "./FootPlant";

/** A body standing on the ground: hips 0.957 up, ankles 0.085 up, toes 0.05 up. */
function standing() {
	const frame = new GraphNode("frame");
	const hips = new GraphNode("CC_Base_Hip");
	frame.addChild(hips);
	hips.setLocalPosition(0, 0.957, 0);
	const feet: GraphNode[] = [];
	for (const [side, x] of [["L", 0.09], ["R", -0.09]] as const) {
		const foot = new GraphNode(`CC_Base_${side}_Foot`);
		const toe = new GraphNode(`CC_Base_${side}_ToeBase`);
		hips.addChild(foot);
		foot.addChild(toe);
		foot.setLocalPosition(x, 0.085 - 0.957, 0);
		toe.setLocalPosition(0, -0.035, 0.12);
		feet.push(foot);
	}
	return { frame, hips, feet, plant: new FootPlant(frame, frame) };
}

describe("FootPlant", () => {
	it("finds the feet and toes", () => {
		expect(standing().plant.contactCount).toBe(4);
	});

	it("does nothing when the feet are already on the ground", () => {
		const { hips, plant } = standing();
		plant.apply();
		expect(hips.getPosition().y).toBeCloseTo(0.957, 6);
		expect(plant.lowestSole()).toBeCloseTo(0, 6);
	});

	it("lowers the body when the feet hover", () => {
		const { hips, plant } = standing();
		hips.setPosition(0, 1.01, 0);
		expect(plant.lowestSole()).toBeCloseTo(0.053, 5);
		plant.apply();
		expect(hips.getPosition().y).toBeCloseTo(0.957, 5);
		expect(plant.lowestSole()).toBeCloseTo(0, 5);
	});

	it("raises the body when a foot is sunk into the floor", () => {
		const { hips, plant } = standing();
		hips.setPosition(0, 0.92, 0);
		plant.apply();
		expect(hips.getPosition().y).toBeCloseTo(0.957, 5);
	});

	it("plants whichever foot is lowest", () => {
		const { hips, feet, plant } = standing();
		// One leg lifted, as in a stride.
		feet[0].setLocalPosition(0.09, 0.085 - 0.957 + 0.2, 0);
		plant.apply();
		expect(plant.lowestSole()).toBeCloseTo(0, 5);
		expect(feet[1].getPosition().y - 0.085).toBeCloseTo(0, 5);
		expect(hips.getPosition().y).toBeCloseTo(0.957, 5);
	});

	it("follows a tilted foot", () => {
		const { feet, plant } = standing();
		// Toe down: the toe's sole is now the lowest point.
		feet[1].setRotation(new Quat().setFromAxisAngle(new Vec3(1, 0, 0), 40));
		plant.apply();
		expect(plant.lowestSole()).toBeCloseTo(0, 5);
	});

	it("won't fling the body for a wild pose", () => {
		const { hips, plant } = standing();
		hips.setPosition(0, 3, 0);
		plant.apply();
		expect(3 - hips.getPosition().y).toBeCloseTo(0.2, 5);
	});

	it("leaves the pose alone at weight 0", () => {
		const { hips, plant } = standing();
		hips.setPosition(0, 1.2, 0);
		plant.apply(0);
		expect(hips.getPosition().y).toBeCloseTo(1.2, 6);
	});
});
