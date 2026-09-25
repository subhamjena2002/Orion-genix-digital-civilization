import { Quat, Vec3, type GraphNode } from "playcanvas";

import { findBone, rotationBetween } from "./Retarget";

/**
 * Straightens the player's body while standing still.
 *
 * The body plays the citizen rig's idle clip (see Retarget), which is authored for a stylised
 * figure: knees bent about 20 degrees, elbows drawn back behind the shoulders, chest tipped back.
 * On a realistic body that reads as a slouch. While idle, the legs and arms are turned onto a
 * natural standing pose instead — straight legs, arms hanging at the sides with a soft elbow.
 * (Straighter legs reach lower; FootPlant then lowers the body's hips to keep the feet on the
 * ground.) Walking, running and attacks keep the clip's pose (weight 0), and it blends in between.
 */

/** A bone to turn so it points from itself to `child` along `direction`. */
export interface StanceAim {
	bone: string;
	child: string;
	/** Character space, left side: x = outwards (to the left), y = up, z = forwards. */
	direction: readonly [number, number, number];
}

/** Parents first: each bone is aimed after the bones above it have moved. */
export const CHARACTER_CREATOR_STANCE: readonly StanceAim[] = (["L", "R"] as const).flatMap((side): StanceAim[] => [
	{ bone: `CC_Base_${side}_Thigh`, child: `CC_Base_${side}_Calf`, direction: [0.05, -1, 0.02] },
	{ bone: `CC_Base_${side}_Calf`, child: `CC_Base_${side}_Foot`, direction: [0.02, -1, -0.03] },
	{ bone: `CC_Base_${side}_Upperarm`, child: `CC_Base_${side}_Forearm`, direction: [0.14, -1, 0.02] },
	{ bone: `CC_Base_${side}_Forearm`, child: `CC_Base_${side}_Hand`, direction: [0.06, -1, 0.2] },
]);

interface Aim {
	bone: GraphNode;
	child: GraphNode;
	/** Direction in the frame, both sides resolved. */
	direction: Vec3;
}

export class PlayerStance {
	private readonly aims: Aim[] = [];
	private readonly current = new Vec3();
	private readonly desired = new Vec3();
	private readonly turn = new Quat();
	private readonly rotation = new Quat();

	/**
	 * @param root     the body's skeleton
	 * @param frame    the upright entity the body stands in
	 * @param forward  which way the body faces in `frame`
	 */
	public constructor(root: GraphNode, private readonly frame: GraphNode, forward: Vec3, aims: readonly StanceAim[]) {
		const up = Vec3.UP;
		const facing = new Vec3(forward.x, 0, forward.z).normalize();
		const left = new Vec3().cross(up, facing);
		for (const aim of aims) {
			const bone = findBone(root, aim.bone);
			const child = findBone(root, aim.child);
			if (!bone || !child) continue;
			// Right-side bones mirror the left-side direction.
			const side = /_R_|\.R\b|Right/.test(aim.bone) ? -1 : 1;
			const [x, y, z] = aim.direction;
			const direction = new Vec3()
				.add(left.clone().mulScalar(x * side))
				.add(up.clone().mulScalar(y))
				.add(facing.clone().mulScalar(z))
				.normalize();
			this.aims.push({ bone, child, direction });
		}
	}

	public get aimCount(): number {
		return this.aims.length;
	}

	/** Blends the standing pose over the current one; `weight` 0 leaves it untouched. */
	public apply(weight: number): void {
		if (weight <= 0.001 || this.aims.length === 0) return;
		const frameRotation = this.frame.getRotation();
		for (const aim of this.aims) {
			this.current.sub2(aim.child.getPosition(), aim.bone.getPosition()).normalize();
			frameRotation.transformVector(aim.direction, this.desired);
			this.turn.copy(rotationBetween(this.current, this.desired));
			if (weight < 1) this.turn.slerp(Quat.IDENTITY, this.turn, weight);
			this.rotation.mul2(this.turn, aim.bone.getRotation());
			aim.bone.setRotation(this.rotation);
		}
	}
}
