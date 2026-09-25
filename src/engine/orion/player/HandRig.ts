import { Quat, Vec3, type GraphNode } from "playcanvas";

import { alignFrames } from "./ArmIK";
import { findBone } from "./Retarget";

/**
 * One hand: turning it to a grip and curling the fingers around what it holds.
 *
 * Measured once, at rest (a T-pose with the palms down and the fingers pointing straight out), so
 * nothing here depends on which way the rig's bones happen to point.
 */

/** How far each finger is closed, 0 (open) to 1 (a full fist). */
export interface FingerCurl {
	thumb: number;
	index: number;
	middle: number;
	ring: number;
	pinky: number;
}

export const OPEN_HAND: FingerCurl = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };

const FINGERS = ["index", "middle", "ring", "pinky", "thumb"] as const;
const BONE_NAMES: Readonly<Record<(typeof FINGERS)[number], string>> = { index: "Index", middle: "Mid", ring: "Ring", pinky: "Pinky", thumb: "Thumb" };
/** How far each joint bends at a full curl, degrees: base knuckle, middle, tip. */
const MAX_BEND: Readonly<Record<(typeof FINGERS)[number], readonly [number, number, number]>> = {
	index: [70, 90, 55],
	middle: [75, 95, 55],
	ring: [78, 95, 55],
	pinky: [80, 95, 55],
	thumb: [30, 45, 40],
};

interface Joint {
	bone: GraphNode;
	restRotation: Quat;
	/** The bend's axis, in the bone's own space. */
	axis: Vec3;
	maxDegrees: number;
	finger: (typeof FINGERS)[number];
}

export class HandRig {
	public readonly hand: GraphNode;
	private readonly joints: Joint[] = [];
	/** The fingers' direction and the palm's facing at rest, in the hand's own space. */
	private readonly fingersLocal = new Vec3();
	private readonly palmLocal = new Vec3();
	private readonly bend = new Quat();
	private readonly scratch = new Quat();

	/**
	 * @param frameRotation the upright frame's world rotation (the palm faces down in it at rest)
	 */
	public constructor(root: GraphNode, private readonly side: "L" | "R", frameRotation: Quat) {
		const hand = findBone(root, `CC_Base_${side}_Hand`);
		if (!hand) throw new Error(`No ${side} hand bone`);
		this.hand = hand;
		const palmDown = frameRotation.transformVector(new Vec3(0, -1, 0), new Vec3());
		const handInverse = hand.getRotation().clone().invert();
		const middle = findBone(root, `CC_Base_${side}_Mid1`);
		const fingers = middle
			? middle.getPosition().clone().sub(hand.getPosition()).normalize()
			: frameRotation.transformVector(new Vec3(side === "R" ? -1 : 1, 0, 0), new Vec3());
		handInverse.transformVector(fingers, this.fingersLocal);
		handInverse.transformVector(palmDown, this.palmLocal);
		// Exactly across the fingers, whatever the rest pose's small forward angle.
		this.palmLocal.sub(this.fingersLocal.clone().mulScalar(this.palmLocal.dot(this.fingersLocal))).normalize();

		for (const finger of FINGERS) {
			for (let index = 1; index <= 3; index++) {
				const bone = findBone(root, `CC_Base_${side}_${BONE_NAMES[finger]}${index}`);
				if (!bone) continue;
				const next = findBone(root, `CC_Base_${side}_${BONE_NAMES[finger]}${index + 1}`);
				const previous = findBone(root, `CC_Base_${side}_${BONE_NAMES[finger]}${index - 1}`) ?? hand;
				// A joint's direction is towards the next one; the tip continues the one before.
				const direction = next
					? next.getPosition().clone().sub(bone.getPosition())
					: bone.getPosition().clone().sub(previous.getPosition());
				if (direction.lengthSq() < 1e-10) continue;
				direction.normalize();
				// Closing turns the finger towards the palm: about (direction x palm).
				const axisWorld = new Vec3().cross(direction, palmDown).normalize();
				const axis = bone.getRotation().clone().invert().transformVector(axisWorld, new Vec3());
				this.joints.push({
					bone,
					restRotation: bone.getLocalRotation().clone(),
					axis,
					maxDegrees: MAX_BEND[finger][index - 1],
					finger,
				});
			}
		}
	}

	/**
	 * The hand's world rotation with its fingers pointing along `fingers` and its thumb towards
	 * `thumb` (which only picks which way the palm faces). The pair needn't be exactly
	 * perpendicular.
	 */
	public orientation(fingers: Vec3, thumb: Vec3, out = new Quat()): Quat {
		const direction = fingers.clone().normalize();
		// The right hand's thumb is fingers x palm; the left hand's is palm x fingers.
		const palm = this.side === "R" ? new Vec3().cross(thumb, direction) : new Vec3().cross(direction, thumb);
		palm.sub(direction.clone().mulScalar(palm.dot(direction)));
		if (palm.lengthSq() < 1e-8) palm.set(0, -1, 0);
		palm.normalize();
		return alignFrames(this.fingersLocal, this.palmLocal, direction, palm, out);
	}

	/**
	 * From the wrist to the point the hand holds: `along` the fingers and `depth` out of the palm,
	 * for a hand turned to `rotation` (world space).
	 */
	public gripOffset(rotation: Quat, out: Vec3, along: number, depth: number): Vec3 {
		out.copy(this.fingersLocal).mulScalar(along).add(this.palmLocal.clone().mulScalar(depth));
		return rotation.transformVector(out, out);
	}

	/** Closes the fingers by `curl`, on top of their rest pose. */
	public curl(curl: FingerCurl): void {
		for (const joint of this.joints) {
			const amount = Math.max(0, Math.min(1, curl[joint.finger]));
			this.bend.setFromAxisAngle(joint.axis, joint.maxDegrees * amount);
			this.scratch.copy(joint.restRotation).mul(this.bend);
			joint.bone.setLocalRotation(this.scratch);
		}
	}

	public get jointCount(): number {
		return this.joints.length;
	}
}
