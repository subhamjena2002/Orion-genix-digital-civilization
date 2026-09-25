import { GraphNode, Quat, Vec3 } from "playcanvas";
import { describe, expect, it } from "vitest";

import { PlayerStance } from "./PlayerStance";

/** Hip with one bent leg: thigh angled forward, knee bent back. Faces +Z. */
function leg() {
	const frame = new GraphNode("frame");
	const hip = new GraphNode("CC_Base_Hip");
	const thigh = new GraphNode("CC_Base_L_Thigh");
	const calf = new GraphNode("CC_Base_L_Calf");
	const foot = new GraphNode("CC_Base_L_Foot");
	frame.addChild(hip);
	hip.addChild(thigh);
	thigh.addChild(calf);
	calf.addChild(foot);
	hip.setLocalPosition(0, 1, 0);
	thigh.setLocalPosition(0.1, 0, 0);
	calf.setLocalPosition(0, -0.45, 0);
	foot.setLocalPosition(0, -0.45, 0);
	thigh.setLocalRotation(new Quat().setFromAxisAngle(Vec3.RIGHT, -20));
	calf.setLocalRotation(new Quat().setFromAxisAngle(Vec3.RIGHT, 40));
	return { frame, hip, thigh, calf, foot };
}

const aims = [
	{ bone: "CC_Base_L_Thigh", child: "CC_Base_L_Calf", direction: [0, -1, 0] as const },
	{ bone: "CC_Base_L_Calf", child: "CC_Base_L_Foot", direction: [0, -1, 0] as const },
];

describe("PlayerStance", () => {
	it("straightens the leg", () => {
		const { frame, thigh, calf, foot } = leg();
		const stance = new PlayerStance(frame, frame, new Vec3(0, 0, 1), aims);
		expect(stance.aimCount).toBe(2);
		stance.apply(1);
		const shin = foot.getPosition().clone().sub(calf.getPosition()).normalize();
		const upper = calf.getPosition().clone().sub(thigh.getPosition()).normalize();
		expect(upper.y).toBeCloseTo(-1, 4);
		expect(shin.y).toBeCloseTo(-1, 4);
	});

	it("leaves the pose alone at weight 0", () => {
		const { frame, calf, foot } = leg();
		const before = foot.getPosition().clone();
		new PlayerStance(frame, frame, new Vec3(0, 0, 1), aims).apply(0);
		expect(foot.getPosition().distance(before)).toBeLessThan(1e-6);
		expect(calf.getLocalRotation().w).toBeLessThan(1);
	});
});
