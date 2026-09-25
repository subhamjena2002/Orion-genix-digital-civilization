import { Quat, Vec3, type GraphNode } from "playcanvas";

import { findBone } from "./Retarget";

/**
 * Keeps the feet on the ground.
 *
 * The body's legs are posed by rotations copied from another rig, so how high the feet end up
 * depends on the two rigs' proportions and on any pose correction layered on top (a straightened
 * leg reaches lower than a bent one). Left alone, a foot ends up hovering or sunk into the floor.
 * Each frame the lowest sole is found and the hips are raised or lowered until it just touches
 * the ground, so whichever foot is planted rests on it.
 */

interface Contact {
	bone: GraphNode;
	/** From the bone to the sole beneath it, in the bone's own space. */
	offset: Vec3;
}

/** Furthest the hips are moved to plant a foot, so a stray pose can't fling the body. */
const MAX_ADJUST = 0.2;

export class FootPlant {
	private readonly contacts: Contact[] = [];
	private readonly hips: GraphNode | null;
	private readonly point = new Vec3();
	private readonly rotated = new Vec3();
	private readonly position = new Vec3();
	private lastAdjust = 0;

	/**
	 * Built at rest, when both feet stand flat on the ground (y = 0 in `frame`, an upright entity
	 * standing on it): each foot and toe bone's height there is how far its sole lies below it.
	 */
	public constructor(root: GraphNode, private readonly frame: GraphNode) {
		this.hips = findBone(root, "CC_Base_Hip");
		const base = frame.getPosition().y;
		for (const side of ["L", "R"]) {
			for (const name of ["Foot", "ToeBase"]) {
				const bone = findBone(root, `CC_Base_${side}_${name}`);
				if (!bone) continue;
				const position = bone.getPosition();
				// Straight down to the ground at rest; kept in the bone's space so it follows the foot's tilt.
				const down = new Vec3(0, base - position.y, 0);
				this.contacts.push({ bone, offset: bone.getRotation().clone().invert().transformVector(down, new Vec3()) });
			}
		}
	}

	public get contactCount(): number {
		return this.contacts.length;
	}

	/** How far the hips were moved last time. */
	public get adjustment(): number {
		return this.lastAdjust;
	}

	/** Height of the lowest sole above the ground, before any adjustment. */
	public lowestSole(): number {
		const ground = this.frame.getPosition().y;
		let lowest = Infinity;
		for (const { bone, offset } of this.contacts) {
			const rotation: Quat = bone.getRotation();
			rotation.transformVector(offset, this.rotated);
			this.point.copy(bone.getPosition()).add(this.rotated);
			lowest = Math.min(lowest, this.point.y - ground);
		}
		return lowest;
	}

	/** Moves the hips so the lowest sole is on the ground. `weight` 0 leaves the pose alone. */
	public apply(weight = 1): void {
		this.lastAdjust = 0;
		if (!this.hips || this.contacts.length === 0 || weight <= 0) return;
		const lowest = this.lowestSole();
		if (!Number.isFinite(lowest)) return;
		const adjust = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, -lowest)) * Math.min(1, weight);
		this.position.copy(this.hips.getPosition());
		this.position.y += adjust;
		this.hips.setPosition(this.position);
		this.lastAdjust = adjust;
	}
}
