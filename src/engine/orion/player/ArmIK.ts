import { Quat, Vec3, type GraphNode } from "playcanvas";

import { rotationBetween } from "./Retarget";

/**
 * Two-bone arm IK: puts the wrist on a target and the elbow on a chosen side.
 *
 * The animation clips have no gun poses, so the hands are placed by solving the arm instead:
 * given the wrist target and an elbow hint ("pole"), the law of cosines gives the elbow's
 * position, and both bones are turned to match. The upper arm is rolled so the elbow bends about
 * its own hinge (fixed in the rig's rest pose), not about whatever axis a plain swing would leave.
 */

export interface ArmBones {
	/** Shoulder joint (the upper-arm bone). */
	upper: GraphNode;
	/** Elbow (the forearm bone). */
	lower: GraphNode;
	/** Wrist (the hand bone). */
	hand: GraphNode;
}

const DEGREES = 180 / Math.PI;
const EPSILON = 1e-5;

/**
 * The rotation taking direction `fromA` onto `toA` and, about that direction, the part of `fromB`
 * across it onto the part of `toB` across it. Both pairs should be roughly perpendicular.
 */
export function alignFrames(fromA: Vec3, fromB: Vec3, toA: Vec3, toB: Vec3, out = new Quat()): Quat {
	const swing = rotationBetween(fromA, toA);
	const rotatedB = swing.transformVector(fromB, new Vec3());
	// Only what's across the axis matters for the twist.
	const across = (vector: Vec3) => vector.clone().sub(toA.clone().mulScalar(vector.dot(toA)));
	const a = across(rotatedB);
	const b = across(toB);
	if (a.lengthSq() < EPSILON || b.lengthSq() < EPSILON) return out.copy(swing);
	a.normalize();
	b.normalize();
	const angle = Math.atan2(toA.dot(new Vec3().cross(a, b)), a.dot(b)) * DEGREES;
	return out.mul2(new Quat().setFromAxisAngle(toA, angle), swing);
}

export class TwoBoneArm {
	/** Length of the upper arm and forearm, in world units. */
	public readonly upperLength: number;
	public readonly lowerLength: number;

	/** Upper arm's direction to the elbow, in the upper arm's own space. */
	private readonly axisLocal = new Vec3();
	/** The elbow's hinge, in the upper arm's own space, perpendicular to `axisLocal`. */
	private readonly hingeLocal = new Vec3();
	/** The forearm's rest rotation relative to the upper arm. */
	private readonly restLower = new Quat();
	/** The elbow angle at rest (interior, radians); pi is a straight arm. */
	private readonly restAngle: number;

	private readonly shoulder = new Vec3();
	private readonly elbow = new Vec3();
	private readonly wrist = new Vec3();
	private readonly toTarget = new Vec3();
	private readonly perpendicular = new Vec3();
	private readonly upperDirection = new Vec3();
	private readonly lowerDirection = new Vec3();
	private readonly planeNormal = new Vec3();
	private readonly upperRotation = new Quat();
	private readonly flexion = new Quat();

	/**
	 * Built while the rig is at rest (a T-pose with palms down). `hingeWorld` is the elbow's hinge
	 * at rest in world space, signed so a positive turn about it flexes the elbow.
	 */
	public constructor(public readonly bones: ArmBones, hingeWorld: Vec3) {
		const { upper, lower, hand } = bones;
		const shoulder = upper.getPosition();
		const elbow = lower.getPosition();
		const wrist = hand.getPosition();
		this.upperLength = elbow.distance(shoulder);
		this.lowerLength = wrist.distance(elbow);

		const inverse = upper.getRotation().clone().invert();
		inverse.transformVector(elbow.clone().sub(shoulder).normalize(), this.axisLocal);
		inverse.transformVector(hingeWorld.clone().normalize(), this.hingeLocal);
		// Perpendicular to the arm, whatever the rest pose's exact angle.
		this.hingeLocal.sub(this.axisLocal.clone().mulScalar(this.hingeLocal.dot(this.axisLocal))).normalize();
		this.restLower.copy(inverse).mul(lower.getRotation());

		const upperDirection = elbow.clone().sub(shoulder).normalize();
		const lowerDirection = wrist.clone().sub(elbow).normalize();
		this.restAngle = Math.PI - Math.acos(Math.max(-1, Math.min(1, upperDirection.dot(lowerDirection))));
	}

	/** Furthest the wrist can be from the shoulder. */
	public get reach(): number {
		return this.upperLength + this.lowerLength;
	}

	/**
	 * Turns the arm so the wrist reaches `target` (world space) with the elbow toward `pole`
	 * (a direction, world space). A target out of reach leaves the arm straight, pointing at it.
	 * Returns how far short of the target the wrist ends up (0 when reached).
	 */
	public solve(target: Vec3, pole: Vec3): number {
		const { upper, lower } = this.bones;
		this.shoulder.copy(upper.getPosition());
		this.toTarget.sub2(target, this.shoulder);
		const distance = this.toTarget.length();
		if (distance < EPSILON) return 0;
		const axis = this.toTarget.clone().mulScalar(1 / distance);
		const reachable = Math.max(Math.abs(this.upperLength - this.lowerLength) + 1e-3, Math.min(distance, this.reach * 0.9995));

		// Elbow: on the circle around the shoulder-to-wrist line, on the pole's side.
		const cosShoulder = (this.upperLength * this.upperLength + reachable * reachable - this.lowerLength * this.lowerLength) / (2 * this.upperLength * reachable);
		const shoulderAngle = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
		this.perpendicular.copy(pole).sub(axis.clone().mulScalar(pole.dot(axis)));
		if (this.perpendicular.lengthSq() < EPSILON) {
			// Pole along the line: any side will do; take the arm's current elbow direction.
			this.perpendicular.copy(lower.getPosition()).sub(this.shoulder);
			this.perpendicular.sub(axis.clone().mulScalar(this.perpendicular.dot(axis)));
			if (this.perpendicular.lengthSq() < EPSILON) this.perpendicular.set(0, -1, 0).sub(axis.clone().mulScalar(-axis.y));
		}
		this.perpendicular.normalize();
		this.elbow.copy(this.shoulder)
			.add(axis.clone().mulScalar(this.upperLength * Math.cos(shoulderAngle)))
			.add(this.perpendicular.clone().mulScalar(this.upperLength * Math.sin(shoulderAngle)));
		this.wrist.copy(this.shoulder).add(axis.clone().mulScalar(reachable));

		this.upperDirection.sub2(this.elbow, this.shoulder).normalize();
		this.lowerDirection.sub2(this.wrist, this.elbow).normalize();
		// The elbow bends in the plane of the two bones; its hinge is that plane's normal.
		this.planeNormal.cross(this.upperDirection, this.lowerDirection);
		if (this.planeNormal.lengthSq() < EPSILON) this.planeNormal.cross(this.perpendicular, axis);
		this.planeNormal.normalize();

		alignFrames(this.axisLocal, this.hingeLocal, this.upperDirection, this.planeNormal, this.upperRotation);
		upper.setRotation(this.upperRotation);

		const cosElbow = (this.upperLength * this.upperLength + this.lowerLength * this.lowerLength - reachable * reachable) / (2 * this.upperLength * this.lowerLength);
		const elbowAngle = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
		this.flexion.setFromAxisAngle(this.hingeLocal, (this.restAngle - elbowAngle) * DEGREES);
		// Local to the upper arm, then out to world space.
		this.upperRotation.mul(this.flexion).mul(this.restLower);
		lower.setRotation(this.upperRotation);

		return Math.max(0, distance - reachable);
	}
}
