import type { FingerCurl } from "../player/HandRig";

/**
 * How each kind of weapon is held, as data: where it sits against the body, where each hand goes
 * on it, and which way the elbows point. Weapons pick a style by name (WeaponData), so a new gun
 * that's held like a rifle needs no new numbers.
 *
 * Weapon space: the grip is the origin, +x is the weapon's right, +y its top, and -z its muzzle
 * (or blade tip). Body space: +x is the character's right, +y up, +z forward.
 */

export type HoldStyleId = "unarmed" | "blade" | "pistol" | "rifle" | "shotgun" | "launcher";

export type Vec3Tuple = readonly [number, number, number];

export interface GripSpec {
	/** Where the hand holds the weapon (weapon space). The off hand's is replaced by the weapon's own `offhand` point when it has one. */
	point: Vec3Tuple;
	/** The way the fingers point when open (weapon space)... */
	fingers: Vec3Tuple;
	/** ...and towards where the thumb is (only picks which way the palm faces). */
	thumb: Vec3Tuple;
	curl: FingerCurl;
}

export interface HoldStyle {
	id: HoldStyleId;
	right: GripSpec | null;
	left: GripSpec | null;
	/**
	 * Aimed: the weapon's grip, relative to the right shoulder, in the aim's own frame (right, up,
	 * forward along the aim). `twist` turns the chest to the right, in degrees, the way a shooter
	 * blades their body — it also brings the far shoulder forward, within the off arm's reach.
	 */
	aimed: { offset: Vec3Tuple; roll: number; twist: number };
	/** Carried at the ready: the offset in body space, the muzzle's pitch (down) and yaw (to the left), degrees. */
	ready: { offset: Vec3Tuple; pitch: number; yaw: number; twist: number };
	/**
	 * Long guns: where the weapon's back end — the butt — rests against the body, from the firing
	 * shoulder's joint (body space). The grip then falls wherever the weapon's own length puts it,
	 * so a long stock tips the muzzle down rather than pushing itself back through the chest.
	 * Null holds the weapon by its grip instead, at the offsets above.
	 */
	butt: Vec3Tuple | null;
	/** Which way each elbow points (body space); it's only a hint, the arm still reaches the grips. */
	elbows: { right: Vec3Tuple; left: Vec3Tuple };
	/**
	 * How close to the grip the off hand may slide back, in metres ahead of it, to stay within
	 * reach of the weapon's own off-hand point. 0 leaves it fixed there.
	 */
	slide: number;
	/**
	 * How far the off arm may stretch at the ready, as a share of its full length. Aimed, it
	 * reaches out as far as it needs to; carrying the weapon it keeps the elbow bent.
	 */
	readyReach: number;
	/** Where the off hand goes to reload, relative to the grip (weapon space). */
	reload: Vec3Tuple;
	/** How much the head follows the aim, 0..1. */
	look: number;
}

const curl = (thumb: number, index: number, middle: number, ring: number, pinky: number): FingerCurl => ({ thumb, index, middle, ring, pinky });

const RIFLE_ELBOWS = { right: [0.45, -1, -0.45], left: [-0.2, -1, 0.05] } as const;

export const HOLD_STYLES: Readonly<Record<HoldStyleId, HoldStyle>> = {
	// Arms free: the clips pose them.
	unarmed: {
		id: "unarmed", right: null, left: null,
		aimed: { offset: [0, 0, 0], roll: 0, twist: 0 },
		ready: { offset: [0, 0, 0], pitch: 0, yaw: 0, twist: 0 },
		butt: null,
		elbows: { right: [0.4, -1, -0.3], left: [-0.4, -1, -0.3] },
		slide: 0, readyReach: 0.85, reload: [0, 0, 0], look: 0,
	},

	// One hand on the hilt, held forward at the hip with the point up; the slash clip takes over the swing.
	blade: {
		id: "blade",
		right: { point: [0, 0, 0], fingers: [0, -1, -0.35], thumb: [0, 0.3, -1], curl: curl(0.55, 0.9, 0.9, 0.9, 0.9) },
		left: null,
		aimed: { offset: [-0.1, -0.38, 0.3], roll: 0, twist: 0 },
		ready: { offset: [-0.1, -0.38, 0.3], pitch: -38, yaw: 0, twist: 0 },
		butt: null,
		elbows: { right: [0.5, -1, -0.6], left: [-0.4, -1, -0.3] },
		slide: 0, readyReach: 0.85, reload: [0, 0, 0], look: 0,
	},

	// Two hands, arms out: the off hand cups the firing hand's grip.
	pistol: {
		id: "pistol",
		right: { point: [0, 0, 0], fingers: [0, -0.25, -1], thumb: [0, 1, -0.1], curl: curl(0.35, 0.4, 0.85, 0.85, 0.85) },
		left: { point: [-0.03, -0.035, 0.005], fingers: [0.15, -0.55, -0.8], thumb: [0, 1, -0.2], curl: curl(0.4, 0.8, 0.8, 0.8, 0.8) },
		aimed: { offset: [-0.15, -0.03, 0.42], roll: 0, twist: 12 },
		// Compressed ready: drawn in towards the centre of the chest with both elbows bent, not
		// pushed out to where only a straight arm could follow it — but held at the sternum
		// rather than the belt. At -0.25 the hands sat on the buckle, and with both elbows winged
		// out and back the whole thing read from behind as hands cuffed behind the back.
		ready: { offset: [-0.14, -0.17, 0.29], pitch: 30, yaw: 0, twist: 0 },
		butt: null,
		// Elbows in against the ribs. Pointing them out to the sides is what put the forearms in
		// silhouette either side of the body; a compressed ready keeps them tucked.
		elbows: { right: [0.22, -1, -0.24], left: [-0.22, -1, -0.24] },
		slide: 0, readyReach: 0.85, reload: [-0.02, -0.14, 0.02], look: 0.9,
	},

	// Stock in the shoulder, off hand under the handguard.
	rifle: {
		id: "rifle",
		right: { point: [0, 0, 0], fingers: [0, -0.3, -1], thumb: [0, 1, 0], curl: curl(0.4, 0.35, 0.85, 0.85, 0.85) },
		left: { point: [0, -0.03, -0.34], fingers: [0, 0.1, -1], thumb: [-1, 0.2, 0], curl: curl(0.5, 0.65, 0.65, 0.65, 0.65) },
		aimed: { offset: [-0.06, -0.035, 0.32], roll: 0, twist: 32 },
		// Low ready: shouldered, muzzle tipped well down and across the body. The yaw is what lets
		// the support hand get out onto the handguard — swinging the muzzle across brings the
		// handguard towards the off shoulder, where pitching it down alone only drops it away.
		ready: { offset: [-0.06, -0.17, 0.3], pitch: 34, yaw: 30, twist: 24 },
		butt: [-0.03, -0.04, 0.11],
		elbows: RIFLE_ELBOWS,
		slide: 0.05, readyReach: 0.93, reload: [0, -0.15, -0.14], look: 0.9,
	},

	shotgun: {
		id: "shotgun",
		right: { point: [0, 0, 0], fingers: [0, -0.3, -1], thumb: [0, 1, 0], curl: curl(0.4, 0.35, 0.85, 0.85, 0.85) },
		left: { point: [0, -0.03, -0.3], fingers: [0, 0.1, -1], thumb: [-1, 0.2, 0], curl: curl(0.5, 0.7, 0.7, 0.7, 0.7) },
		aimed: { offset: [-0.06, -0.035, 0.34], roll: 0, twist: 32 },
		ready: { offset: [-0.06, -0.17, 0.32], pitch: 34, yaw: 30, twist: 24 },
		butt: [-0.03, -0.04, 0.11],
		elbows: RIFLE_ELBOWS,
		slide: 0.05, readyReach: 0.93, reload: [0, -0.1, -0.05], look: 0.9,
	},

	// Tube on the shoulder, one hand on the rear grip and one on the front.
	launcher: {
		id: "launcher",
		right: { point: [0, 0, 0], fingers: [0, -0.3, -1], thumb: [0, 1, 0], curl: curl(0.4, 0.4, 0.85, 0.85, 0.85) },
		left: { point: [0, -0.03, -0.28], fingers: [0, 0.1, -1], thumb: [-1, 0.2, 0], curl: curl(0.5, 0.7, 0.7, 0.7, 0.7) },
		aimed: { offset: [-0.04, -0.055, 0.26], roll: 0, twist: 26 },
		ready: { offset: [-0.06, -0.06, 0.24], pitch: -18, yaw: 0, twist: 12 },
		// The tube's back end rides over the shoulder rather than resting against it.
		butt: null,
		elbows: { right: [0.5, -1, -0.5], left: [-0.3, -1, 0.1] },
		slide: 0.08, readyReach: 0.85, reload: [0, -0.1, 0.1], look: 0.8,
	},
};
