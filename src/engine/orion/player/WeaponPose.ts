import { Mat4, Quat, Vec3, type Entity, type GraphNode } from "playcanvas";

import type { GripSpec, HoldStyle } from "../combat/HoldStyles";
import { TwoBoneArm } from "./ArmIK";
import { HandRig, type FingerCurl } from "./HandRig";
import { findBone, rotationBetween } from "./Retarget";

/**
 * Holds a weapon the way a person would.
 *
 * The animation clips have no gun poses, so this builds one on top of them each frame: the chest
 * turns and leans into the aim, the weapon is placed against the shoulder (or carried low at the
 * ready), both hands are reached onto its grips with the elbows on the right sides, the fingers
 * close round what they hold, and the head looks where the weapon points. The legs keep playing
 * the walk or run clip underneath.
 */

export interface HoldRequest {
	style: HoldStyle;
	/**
	 * The held weapon: grip at its origin, muzzle along -Z; where its own model wants the hands
	 * (weapon space), if it says; and how far it reaches behind the grip, which is what rests
	 * against the shoulder.
	 */
	weapon: { root: Entity; hands: { main: Vec3 | null; off: Vec3 | null }; stock: number };
	/** Unit direction the weapon is aimed, world space. */
	aim: Vec3;
	/** 0 carried at the ready .. 1 raised and aimed. */
	raise: number;
	/** 0 hands left to the clips .. 1 hands on the weapon. */
	weight: number;
	/** Just switched to it: 1 as it starts coming up, 0 once it's there. */
	equip: number;
	/** Reload progress 0..1, or -1 when not reloading. */
	reload: number;
	/** While the hand carries the weapon (a blade mid-swing), where that puts it; blended in as `weight` drops. */
	attached: ((position: Vec3, rotation: Quat) => void) | null;
}

/** A hand that holds nothing: loosely curled, not the flat board a T-pose leaves. */
export const RELAXED_HAND: FingerCurl = { thumb: 0.15, index: 0.25, middle: 0.32, ring: 0.38, pinky: 0.45 };
/** The palm centre's distance from the wrist along the fingers, and its depth from the held object's centre. */
const PALM_ALONG = 0.06;
const PALM_DEPTH = 0.035;
/** How much of its full stretch the arm is asked for; nearer than this and the elbow reads locked. */
const REACH_MARGIN = 0.94;
/**
 * Spine bones and their share of the chest's turn and lean. `driven` says whether the retarget
 * sets the bone afresh every frame (see CITIZEN_TO_CHARACTER_CREATOR): one it doesn't drive keeps
 * whatever was last done to it, so it's put back to its rest pose before each turn is added on top.
 */
const SPINE_SHARES: readonly (readonly [string, number, boolean])[] = [
	["CC_Base_Waist", 0.2, true],
	["CC_Base_Spine01", 0.35, true],
	["CC_Base_Spine02", 0.45, false],
];
/** How much of the aim's pitch the chest takes, and the most it leans either way (degrees). */
const LEAN_SHARE = 0.4;
const MAX_LEAN_UP = 24;
const MAX_LEAN_DOWN = 26;
/** The head can turn this far from the body's facing (degrees). */
const MAX_LOOK_YAW = 75;
const MAX_LOOK_PITCH = 40;
/** Seconds to bring the arms onto a newly held weapon. */
const RAMP_SECONDS = 0.18;
/**
 * How far a weapon drops and tips its muzzle down when it's just been switched to. The hands
 * stay on it, so it can only drop as far as the arms allow; the tip is what reads as "coming up".
 */
const EQUIP_DROP = 0.16;
const EQUIP_TIP = 60;
/** A weapon reaching back at least this far is rested against the shoulder by that end. */
const MIN_STOCK = 0.1;
/**
 * The body nothing may be held inside: an oval column through the chest, turning with it. Sized
 * from the shoulders so it fits whatever body wears the rig — a chest is a little narrower than
 * the shoulder span, and shallower still.
 */
const TORSO_WIDTH_OF_SHOULDERS = 0.8;
const TORSO_DEPTH_OF_SHOULDERS = 0.6;
const DEGREES = 180 / Math.PI;
const UP = new Vec3(0, 1, 0);
const IDENTITY = new Quat();

interface Joint {
	bone: GraphNode;
	share: number;
	/** Its rest rotation (local), for a bone nothing else resets. */
	rest: Quat | null;
}

export class WeaponPose {
	private readonly armRight: TwoBoneArm;
	private readonly armLeft: TwoBoneArm;
	private readonly handRight: HandRig;
	private readonly handLeft: HandRig;
	private readonly spine: Joint[] = [];
	private readonly chest: GraphNode | null;
	private readonly neck: GraphNode | null;
	private readonly head: GraphNode | null;
	/** Half the oval the chest fills, across and front to back. */
	private readonly torsoHalfWidth: number;
	private readonly torsoHalfDepth: number;
	/** How far the chest is turned from the body's facing this frame (degrees), for that oval. */
	private chestTwist = 0;
	/** The head's straight-ahead direction, in its own space. */
	private readonly headForward = new Vec3();
	private ramp = 0;
	private styleId = "";

	// The weapon's frame this frame, and the body's.
	private readonly grip = new Vec3();
	private readonly weaponRotation = new Quat();
	private readonly bodyForward = new Vec3();
	private readonly bodyRight = new Vec3();

	private readonly aimRight = new Vec3();
	private readonly aimUp = new Vec3();
	private readonly aimBack = new Vec3();
	private readonly gripReady = new Vec3();
	private readonly rotationReady = new Quat();
	private readonly wristRight = new Vec3();
	private readonly wristLeft = new Vec3();
	private readonly poleRight = new Vec3();
	private readonly poleLeft = new Vec3();
	private readonly handRotationRight = new Quat();
	private readonly handRotationLeft = new Quat();
	private readonly attachedPosition = new Vec3();
	private readonly attachedRotation = new Quat();
	/** Where the weapon's back end rests against the shoulder, when it has one. */
	private readonly buttRest = new Vec3();
	private readonly pushOut = new Vec3();
	private readonly tempA = new Vec3();
	private readonly tempB = new Vec3();
	private readonly tempC = new Vec3();
	private readonly tempD = new Vec3();
	private readonly quatA = new Quat();
	private readonly quatB = new Quat();
	private readonly quatC = new Quat();

	/** Null when the rig lacks a bone this needs. */
	public static create(root: GraphNode, frame: GraphNode): WeaponPose | null {
		try {
			return new WeaponPose(root, frame);
		} catch (error) {
			console.warn("Weapon holds unavailable for this body:", error);
			return null;
		}
	}

	private constructor(root: GraphNode, private readonly frame: GraphNode) {
		const bone = (name: string): GraphNode => {
			const found = findBone(root, name);
			if (!found) throw new Error(`No bone ${name}`);
			return found;
		};
		const frameRotation = frame.getRotation().clone();
		// A T-pose turns each elbow about the vertical; flexing brings the hand forward.
		const hinge = (side: 1 | -1) => frameRotation.transformVector(new Vec3(0, side, 0), new Vec3());
		this.armRight = new TwoBoneArm({ upper: bone("CC_Base_R_Upperarm"), lower: bone("CC_Base_R_Forearm"), hand: bone("CC_Base_R_Hand") }, hinge(1));
		this.armLeft = new TwoBoneArm({ upper: bone("CC_Base_L_Upperarm"), lower: bone("CC_Base_L_Forearm"), hand: bone("CC_Base_L_Hand") }, hinge(-1));
		this.handRight = new HandRig(root, "R", frameRotation);
		this.handLeft = new HandRig(root, "L", frameRotation);
		for (const [name, share, driven] of SPINE_SHARES) {
			const found = findBone(root, name);
			if (found) this.spine.push({ bone: found, share, rest: driven ? null : found.getLocalRotation().clone() });
		}
		// Measured in the rest pose, so the chest's size follows the body rather than this file.
		const shoulders = this.armRight.bones.upper.getPosition().distance(this.armLeft.bones.upper.getPosition()) / 2;
		this.torsoHalfWidth = shoulders * TORSO_WIDTH_OF_SHOULDERS;
		this.torsoHalfDepth = shoulders * TORSO_DEPTH_OF_SHOULDERS;
		this.chest = findBone(root, "CC_Base_Spine02") ?? findBone(root, "CC_Base_Spine01");
		this.neck = findBone(root, "CC_Base_NeckTwist01");
		this.head = findBone(root, "CC_Base_Head");
		if (this.head) {
			const ahead = frameRotation.transformVector(new Vec3(0, 0, 1), new Vec3());
			this.head.getRotation().clone().invert().transformVector(ahead, this.headForward);
		}
	}

	/** Poses the body for `request`; with none, the hands just relax. Call after the clips and legs are posed. */
	public apply(request: HoldRequest | null, dt: number): void {
		// Before anything is added on top, whether or not a weapon is held.
		for (const { bone, rest } of this.spine) if (rest) bone.setLocalRotation(rest);
		if (!request || !request.style.right) {
			this.ramp = 0;
			this.styleId = "";
			this.handRight.curl(RELAXED_HAND);
			this.handLeft.curl(RELAXED_HAND);
			return;
		}
		const style = request.style;
		if (request.weight <= 0.001) {
			// The arms belong to the clip (a swing): the weapon rides the hand, whose fingers stay closed round it.
			this.handRight.curl(style.right!.curl);
			this.handLeft.curl(style.left ? style.left.curl : RELAXED_HAND);
			if (request.attached) this.placeRoot(request, 0);
			return;
		}
		if (style.id !== this.styleId) {
			this.styleId = style.id;
			this.ramp = 0;
		}
		this.ramp = Math.min(1, this.ramp + dt / RAMP_SECONDS);
		const weight = request.weight * this.ramp * this.ramp * (3 - 2 * this.ramp);

		const facing = this.frame.getRotation();
		facing.transformVector(this.tempA.set(0, 0, 1), this.bodyForward);
		facing.transformVector(this.tempA.set(-1, 0, 0), this.bodyRight);
		const raise = request.raise;
		const reloadBump = request.reload >= 0 ? Math.sin(Math.PI * Math.min(1, request.reload)) : 0;

		this.turnBody(style, request.aim, raise, weight);
		this.placeWeapon(style, request, this.armRight.bones.upper.getPosition(), raise * (1 - 0.55 * reloadBump), reloadBump);
		this.reachHands(style, request, weight, reloadBump);
		this.lookAt(style, request.aim, raise, weight);
		this.placeRoot(request, weight);
	}

	/** Chest turned and leant into the aim. */
	private turnBody(style: HoldStyle, aim: Vec3, raise: number, weight: number): void {
		const yawToRight = Math.atan2(aim.dot(this.bodyRight), aim.dot(this.bodyForward)) * DEGREES;
		const pitchUp = Math.asin(Math.max(-1, Math.min(1, aim.y))) * DEGREES;
		const bladed = style.ready.twist + (style.aimed.twist - style.ready.twist) * raise;
		// The chest helps the aim round a little while the body catches up to the camera; the head takes the rest.
		const twist = (bladed + Math.max(-30, Math.min(30, yawToRight * 0.5)) * raise) * weight;
		const lean = Math.max(-MAX_LEAN_DOWN, Math.min(MAX_LEAN_UP, pitchUp * LEAN_SHARE)) * raise * weight;
		this.chestTwist = twist;
		for (const { bone, share } of this.spine) {
			// Leaning up tips the chest back (a turn about the body's right side); twisting to the right is clockwise from above.
			this.quatA.setFromAxisAngle(this.bodyRight, lean * share);
			this.quatB.setFromAxisAngle(UP, -twist * share).mul(this.quatA).mul(bone.getRotation());
			bone.setRotation(this.quatB);
		}
	}

	/** Works out where the weapon's grip goes, into `grip` and `weaponRotation`. */
	private placeWeapon(style: HoldStyle, request: HoldRequest, shoulder: Vec3, raise: number, reloadBump: number): void {
		const aim = request.aim;
		const facing = this.frame.getRotation();
		// A long gun is held by the end that rests in the shoulder, so its length can't shove it
		// backwards through the chest; a pistol or blade is held by the grip, at the offsets.
		const stock = style.butt && request.weapon.stock >= MIN_STOCK ? request.weapon.stock : 0;
		if (stock > 0) {
			facing.transformVector(this.tempA.set(-style.butt![0], style.butt![1], style.butt![2]), this.tempA);
			this.buttRest.copy(shoulder).add(this.tempA);
		}

		// Aimed: a frame following the aim exactly.
		this.aimRight.cross(aim, UP);
		if (this.aimRight.lengthSq() < 1e-6) this.aimRight.copy(this.bodyRight);
		this.aimRight.normalize();
		this.aimUp.cross(this.aimRight, aim).normalize();
		this.aimBack.copy(aim).mulScalar(-1);
		basis(this.aimRight, this.aimUp, this.aimBack, this.weaponRotation);
		const roll = style.aimed.roll + 22 * reloadBump;
		if (roll !== 0) this.weaponRotation.mul(this.quatA.setFromAxisAngle(Vec3.BACK, roll));
		if (stock > 0) {
			this.fromButt(this.buttRest, this.weaponRotation, stock, this.grip);
		} else {
			const [offsetRight, offsetUp, offsetForward] = style.aimed.offset;
			this.grip.copy(shoulder)
				.add(this.tempA.copy(this.aimRight).mulScalar(offsetRight))
				.add(this.tempA.copy(this.aimUp).mulScalar(offsetUp))
				.add(this.tempA.copy(aim).mulScalar(offsetForward));
		}
		if (raise >= 0.999) return;

		// Carried at the ready: fixed to the body, muzzle down (or up, for a blade).
		const ready = style.ready;
		const equip = request.equip;
		// A frame whose forward is the body's, turned by the ready yaw and pitch.
		this.rotationReady.copy(facing);
		this.rotationReady.mul(this.quatA.setFromEulerAngles(0, 180 + ready.yaw, 0));
		this.rotationReady.mul(this.quatA.setFromEulerAngles(-(ready.pitch + EQUIP_TIP * equip), 0, 0));
		if (stock > 0) {
			// The butt stays in the shoulder while the muzzle drops: the weapon turns about it.
			this.tempA.set(this.buttRest.x, this.buttRest.y - EQUIP_DROP * equip, this.buttRest.z);
			this.fromButt(this.tempA, this.rotationReady, stock, this.gripReady);
		} else {
			this.tempA.set(-ready.offset[0], ready.offset[1] - EQUIP_DROP * equip, ready.offset[2]);
			facing.transformVector(this.tempA, this.tempA);
			this.gripReady.copy(shoulder).add(this.tempA);
		}
		this.grip.lerp(this.gripReady, this.grip, raise);
		this.weaponRotation.slerp(this.rotationReady, this.weaponRotation, raise);
	}

	/** The grip of a weapon turned `rotation` whose back end, `stock` behind it, sits at `butt`. */
	private fromButt(butt: Vec3, rotation: Quat, stock: number, out: Vec3): void {
		rotation.transformVector(this.tempB.set(0, 0, stock), this.tempB);
		out.sub2(butt, this.tempB);
	}

	/** Reaches both wrists to the grips (moving the weapon a little if they can't) and shapes the hands. */
	private reachHands(style: HoldStyle, request: HoldRequest, weight: number, reloadBump: number): void {
		const right = style.right!;
		const left = style.left;
		const shoulderRight = this.armRight.bones.upper.getPosition();
		const shoulderLeft = this.armLeft.bones.upper.getPosition();
		const q = this.weaponRotation;
		const reachRight = this.armRight.reach * REACH_MARGIN;
		// Carried, the off arm keeps its elbow bent; aimed, it stretches as far as it must.
		const reachLeft = this.armLeft.reach * (style.readyReach + (REACH_MARGIN - style.readyReach) * Math.max(0, Math.min(1, request.raise)));

		// Where each wrist sits relative to the grip origin: the held point, less the hand's reach into it.
		this.orient(this.handRight, right, this.handRotationRight);
		const heldRight = request.weapon.hands.main;
		const offsetRight = q.transformVector(heldRight ? this.tempA.copy(heldRight) : this.tempA.set(...right.point), new Vec3())
			.sub(this.handRight.gripOffset(this.handRotationRight, new Vec3(), PALM_ALONG, PALM_DEPTH));
		const forward = q.transformVector(this.tempB.set(0, 0, -1), new Vec3());
		let offsetLeft: Vec3 | null = null;
		let desired = 0;
		let nearest = 0;
		if (left) {
			this.orient(this.handLeft, left, this.handRotationLeft);
			const point = request.weapon.hands.off ?? this.tempA.set(...left.point);
			desired = Math.max(-point.z, 0);
			// The wrist with the hand level with the grip; it slides ahead along the weapon from here.
			offsetLeft = q.transformVector(this.tempA.set(point.x, point.y, 0), new Vec3())
				.sub(this.handLeft.gripOffset(this.handRotationLeft, new Vec3(), PALM_ALONG, PALM_DEPTH));
			nearest = style.slide > 0 ? Math.min(style.slide, desired) : desired;
		}

		// A weapon the arms can't reach is drawn towards the shoulder that's too far from it — but
		// never into the body, which is what left a rifle's stock buried in the chest.
		for (let pass = 0; pass < 4; pass++) {
			this.wristRight.copy(this.grip).add(offsetRight);
			const excessRight = this.wristRight.distance(shoulderRight) - reachRight;
			if (excessRight > 0) this.grip.add(this.tempC.sub2(shoulderRight, this.wristRight).normalize().mulScalar(excessRight));
			let excessLeft = 0;
			if (offsetLeft) {
				this.wristLeft.copy(this.grip).add(offsetLeft).add(this.tempC.copy(forward).mulScalar(nearest));
				excessLeft = this.wristLeft.distance(shoulderLeft) - reachLeft;
				if (excessLeft > 0) this.grip.add(this.tempC.sub2(shoulderLeft, this.wristLeft).normalize().mulScalar(excessLeft));
			}
			const buried = this.clearOfBody(offsetRight, offsetLeft, forward, nearest);
			if (excessRight <= 0 && excessLeft <= 0 && buried <= 0) break;
		}
		this.wristRight.copy(this.grip).add(offsetRight);

		if (left && offsetLeft) {
			let slide = desired;
			if (style.slide > 0) {
				// As far ahead as the arm can hold, between the weapon's own spot and the nearest.
				const base = this.tempC.copy(this.grip).add(offsetLeft);
				const from = base.sub(shoulderLeft);
				const b = from.dot(forward);
				const discriminant = b * b - (from.lengthSq() - reachLeft * reachLeft);
				const furthest = discriminant >= 0 ? -b + Math.sqrt(discriminant) : -Infinity;
				slide = Math.max(nearest, Math.min(desired, furthest));
			}
			this.wristLeft.copy(this.grip).add(offsetLeft).add(this.tempC.copy(forward).mulScalar(slide));
			if (reloadBump > 0) {
				// The off hand goes to the magazine and back.
				const magazine = q.transformVector(this.tempA.set(...style.reload), new Vec3()).add(this.grip);
				magazine.add(offsetLeft).sub(q.transformVector(this.tempB.set(left.point[0], left.point[1], 0), new Vec3()));
				this.wristLeft.lerp(this.wristLeft, magazine, reloadBump);
			}
		}

		this.poleFor(style.elbows.right, this.poleRight);
		this.poleFor(style.elbows.left, this.poleLeft);
		this.reach(this.armRight, this.wristRight, this.poleRight, this.handRotationRight, right, this.handRight, weight);
		if (left) this.reach(this.armLeft, this.wristLeft, this.poleLeft, this.handRotationLeft, left, this.handLeft, weight);
		else this.handLeft.curl(RELAXED_HAND);
	}

	/**
	 * Slides the whole weapon out of the chest if the grip or either wrist has ended up inside it,
	 * by however far the deepest of them is in. Moving all of it together keeps the hands on the
	 * weapon; it's the weapon that was in the wrong place. Returns that depth.
	 */
	private clearOfBody(offsetRight: Vec3, offsetLeft: Vec3 | null, forward: Vec3, nearest: number): number {
		this.wristRight.copy(this.grip).add(offsetRight);
		if (offsetLeft) this.wristLeft.copy(this.grip).add(offsetLeft).add(this.tempC.copy(forward).mulScalar(nearest));
		let deepest = 0;
		for (const point of offsetLeft ? [this.grip, this.wristRight, this.wristLeft] : [this.grip, this.wristRight]) {
			const depth = this.escapeBody(point, this.tempD);
			if (depth > deepest) {
				deepest = depth;
				this.pushOut.copy(this.tempD);
			}
		}
		if (deepest > 0) this.grip.add(this.pushOut);
		return deepest;
	}

	/**
	 * How far `point` is inside the chest, and which way out is nearest (into `out`). The chest is
	 * an oval column between the waist and the shoulders, turned with the blade of the body.
	 */
	private escapeBody(point: Vec3, out: Vec3): number {
		const chest = this.chest;
		if (!chest) return 0;
		const middle = chest.getPosition();
		const top = this.armRight.bones.upper.getPosition().y;
		const bottom = this.spine[0]?.bone.getPosition().y ?? middle.y;
		if (point.y > top || point.y < bottom) return 0;
		// Into the chest's own frame, where the oval lies along its axes.
		this.quatC.setFromAxisAngle(UP, -this.chestTwist).mul(this.frame.getRotation()).invert();
		this.quatC.transformVector(this.tempA.sub2(point, middle), this.tempA);
		const across = this.tempA.x / this.torsoHalfWidth;
		const through = this.tempA.z / this.torsoHalfDepth;
		const spread = Math.sqrt(across * across + through * through);
		if (spread >= 1) return 0;
		// Straight out along the same bearing; dead centre, forwards, which is where the hands are.
		if (spread < 1e-4) this.tempA.set(0, 0, this.torsoHalfDepth);
		else this.tempA.set(this.tempA.x * (1 / spread - 1), 0, this.tempA.z * (1 / spread - 1));
		this.quatC.invert().transformVector(this.tempA, out);
		return out.length();
	}

	/** The hand's rotation for a grip: the spec's finger and thumb directions (weapon space) turned to world space. */
	private orient(hand: HandRig, spec: GripSpec, out: Quat): void {
		const q = this.weaponRotation;
		const fingers = q.transformVector(this.tempA.set(...spec.fingers).normalize(), new Vec3());
		const thumb = q.transformVector(this.tempB.set(...spec.thumb).normalize(), new Vec3());
		hand.orientation(fingers, thumb, out);
	}

	/** An elbow hint given in body space, as a world direction. */
	private poleFor(hint: readonly [number, number, number], out: Vec3): void {
		this.frame.getRotation().transformVector(this.tempA.set(-hint[0], hint[1], hint[2]), out);
	}

	/** Solves one arm to its wrist target, blends it with the clip's pose by `weight`, and closes the hand. */
	private reach(arm: TwoBoneArm, wrist: Vec3, pole: Vec3, handRotation: Quat, spec: GripSpec, hand: HandRig, weight: number): void {
		const { upper, lower, hand: wristBone } = arm.bones;
		const before = weight < 1 ? [upper.getRotation().clone(), lower.getRotation().clone(), wristBone.getRotation().clone()] : null;
		arm.solve(wrist, pole);
		if (before) {
			upper.setRotation(this.quatA.slerp(before[0], upper.getRotation(), weight));
			lower.setRotation(this.quatA.slerp(before[1], lower.getRotation(), weight));
			wristBone.setRotation(this.quatA.slerp(before[2], handRotation, weight));
		} else {
			wristBone.setRotation(handRotation);
		}
		hand.curl(mixCurl(RELAXED_HAND, spec.curl, weight));
	}

	/** Head and neck turn to where the weapon points. */
	private lookAt(style: HoldStyle, aim: Vec3, raise: number, weight: number): void {
		if (!this.head) return;
		const amount = style.look * raise * weight;
		if (amount <= 0.001) return;
		const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
		const yaw = clamp(Math.atan2(aim.dot(this.bodyRight), aim.dot(this.bodyForward)) * DEGREES, MAX_LOOK_YAW) / DEGREES;
		const pitch = clamp(Math.asin(clamp(aim.y, 1)) * DEGREES, MAX_LOOK_PITCH) / DEGREES;
		const desired = this.tempC.set(0, Math.sin(pitch), 0)
			.add(this.tempA.copy(this.bodyRight).mulScalar(Math.sin(yaw) * Math.cos(pitch)))
			.add(this.tempA.copy(this.bodyForward).mulScalar(Math.cos(yaw) * Math.cos(pitch)))
			.normalize();
		const current = this.head.getRotation().transformVector(this.headForward, this.tempB);
		const delta = rotationBetween(current, desired);
		if (this.neck) this.neck.setRotation(this.quatB.slerp(IDENTITY, delta, amount * 0.4).mul(this.neck.getRotation()));
		this.head.setRotation(this.quatB.slerp(IDENTITY, delta, amount * 0.6).mul(this.head.getRotation()));
	}

	/**
	 * Puts the weapon in the firing hand — carried by the hand wherever it actually ended up, not
	 * left at the grip the hold asked for. The arms only blend onto a weapon over the moment it's
	 * drawn, and an arm can fall short of a target it can't reach; either way the weapon has to go
	 * with the hand, or it hangs in the air on its own while the hands are somewhere else.
	 *
	 * Mid-swing the hand belongs to the clip, and `attached` says where that puts it.
	 */
	private placeRoot(request: HoldRequest, weight: number): void {
		const root = request.weapon.root;
		if (!root.enabled) return;
		if (request.attached && weight < 0.999) {
			request.attached(this.attachedPosition, this.attachedRotation);
			this.attachedPosition.lerp(this.attachedPosition, this.grip, weight);
			this.attachedRotation.slerp(this.attachedRotation, this.weaponRotation, weight);
			root.setPosition(this.attachedPosition);
			root.setRotation(this.attachedRotation);
			return;
		}
		// However far the hand got, the weapon sits in it exactly as the hold meant it to.
		const wrist = this.armRight.bones.hand;
		this.quatA.copy(wrist.getRotation()).mul(this.quatB.copy(this.handRotationRight).invert());
		this.quatA.transformVector(this.tempA.sub2(this.grip, this.wristRight), this.tempA);
		root.setPosition(this.tempA.add(wrist.getPosition()));
		root.setRotation(this.quatA.mul(this.weaponRotation));
	}
}

function mixCurl(from: FingerCurl, to: FingerCurl, weight: number): FingerCurl {
	const mix = (a: number, b: number) => a + (b - a) * weight;
	return { thumb: mix(from.thumb, to.thumb), index: mix(from.index, to.index), middle: mix(from.middle, to.middle), ring: mix(from.ring, to.ring), pinky: mix(from.pinky, to.pinky) };
}

const BASIS = new Mat4();

/** The rotation whose axes are the given (orthonormal) x, y and z. */
export function basis(x: Vec3, y: Vec3, z: Vec3, out: Quat): Quat {
	const d = BASIS.data;
	d[0] = x.x; d[1] = x.y; d[2] = x.z; d[3] = 0;
	d[4] = y.x; d[5] = y.y; d[6] = y.z; d[7] = 0;
	d[8] = z.x; d[9] = z.y; d[10] = z.z; d[11] = 0;
	d[12] = 0; d[13] = 0; d[14] = 0; d[15] = 1;
	return out.setFromMat4(BASIS);
}
