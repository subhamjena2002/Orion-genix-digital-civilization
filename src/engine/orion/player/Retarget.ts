import { Quat, Vec3, type GraphNode } from "playcanvas";

/**
 * Plays one skeleton's animation on another.
 *
 * The player's model (a detailed Character Creator rig) ships without animations, while the
 * citizen rig has the full set the game uses (idle, walk, run, punch, sword slash, sit, death).
 * So the citizen keeps animating, hidden, and every frame its bones' rotations are carried over
 * to the matching bones of the visible model.
 *
 * Rotations are copied as changes from each rig's rest pose, not as raw values: the two rigs
 * stand differently at rest (one T-posed, one A-posed), point their bones along different local
 * axes, and face different ways. At setup each limb bone gets an alignment that turns the
 * target bone onto the source bone's rest direction; at run time the source's rotation away
 * from its rest is applied on top of that aligned rest. The hips also carry the source's bob,
 * scaled to the target's leg length. Unmapped bones (fingers, twist, face) keep their rest pose.
 */

export interface BonePair {
	source: string;
	target: string;
	/** Bone whose direction from this one defines the bone's axis, for rest alignment. */
	sourceChild?: string;
	targetChild?: string;
}

/**
 * Citizen (Quaternius "HumanArmature") to Character Creator ("CC_Base_*"), parents first.
 *
 * Only limbs are direction-matched. The spine and clavicles keep the body's own rest shape and
 * take just the motion: the citizen's stylised spine is nearly straight and its clavicles point
 * 45 degrees up, and matching those flattened the body's natural S-curve — tipping the pelvis
 * back, sucking the belly in and pushing the chest out — and shrugged the shoulders.
 */
export const CITIZEN_TO_CHARACTER_CREATOR: readonly BonePair[] = [
	{ source: "Hips", target: "CC_Base_Hip" },
	{ source: "Abdomen", target: "CC_Base_Waist" },
	{ source: "Torso", target: "CC_Base_Spine01" },
	{ source: "Neck", target: "CC_Base_NeckTwist01" },
	{ source: "Head", target: "CC_Base_Head" },
	...(["L", "R"] as const).flatMap((side): BonePair[] => [
		{ source: `Shoulder.${side}`, target: `CC_Base_${side}_Clavicle` },
		{ source: `UpperArm.${side}`, target: `CC_Base_${side}_Upperarm`, sourceChild: `LowerArm.${side}`, targetChild: `CC_Base_${side}_Forearm` },
		{ source: `LowerArm.${side}`, target: `CC_Base_${side}_Forearm`, sourceChild: `Palm.${side}`, targetChild: `CC_Base_${side}_Hand` },
		{ source: `Palm.${side}`, target: `CC_Base_${side}_Hand`, sourceChild: `Fingers.${side}`, targetChild: `CC_Base_${side}_Mid1` },
		{ source: `UpperLeg.${side}`, target: `CC_Base_${side}_Thigh`, sourceChild: `LowerLeg.${side}`, targetChild: `CC_Base_${side}_Calf` },
		{ source: `LowerLeg.${side}`, target: `CC_Base_${side}_Calf`, sourceChild: `Foot.${side}`, targetChild: `CC_Base_${side}_Foot` },
		{ source: `Foot.${side}`, target: `CC_Base_${side}_Foot` },
	]),
];

/**
 * A rig to read or drive: `root` to find its bones under, `frame` the upright space its pose is
 * measured in (null for world space). Frames matter: exported model roots often carry a Z-up to
 * Y-up turn, so each rig is measured in the upright entity holding it, not its own root.
 */
export interface RigView {
	root: GraphNode;
	frame: GraphNode | null;
}

interface Link {
	source: GraphNode;
	target: GraphNode;
	/** Source bone's rest rotation in its frame, inverted. */
	sourceRestInverse: Quat;
	/** Target bone's rest rotation in its frame, pre-turned onto the source's rest direction. */
	alignedTargetRest: Quat;
}

/**
 * Finds a node by name, ignoring the numeric suffixes exporters add ("CC_Base_Hip_02") and
 * "Armature|" style prefixes.
 */
export function findBone(root: GraphNode, name: string): GraphNode | null {
	let found: GraphNode | null = null;
	const pattern = new RegExp(`(^|[|:])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(_\\d+)?$`);
	root.forEach((node) => {
		if (!found && pattern.test(node.name)) found = node;
	});
	return found;
}

/** A rig's facing: forward = up x right (right being the character's own right). */
export function rigForward(right: Vec3, up: Vec3): Vec3 {
	return new Vec3().cross(up, right).normalize();
}

/** A rig's facing in `frame`, from its spine and shoulders; null if a bone is missing. */
export function rigFacing(root: GraphNode, frame: GraphNode | null, hips: string, head: string, left: string, right: string): Vec3 | null {
	const nodes = [hips, head, left, right].map((name) => findBone(root, name));
	if (nodes.some((node) => !node)) return null;
	const [hipsNode, headNode, leftNode, rightNode] = nodes as GraphNode[];
	const up = framePoint(frame, headNode).sub(framePoint(frame, hipsNode)).normalize();
	const across = framePoint(frame, rightNode).sub(framePoint(frame, leftNode)).normalize();
	return rigForward(across, up);
}

export class SkeletonRetarget {
	private readonly links: Link[] = [];
	private readonly sourceHips: GraphNode | null;
	private readonly targetHips: GraphNode | null;
	private readonly sourceHipsRest = new Vec3();
	private readonly targetHipsRest = new Vec3();
	private readonly hipScale: number;
	private readonly sourceFrame: GraphNode | null;
	private readonly targetFrame: GraphNode | null;
	private readonly rotation = new Quat();
	private readonly frameInverse = new Quat();
	private readonly point = new Vec3();

	/**
	 * @param source      the animated rig
	 * @param sourceRest  an un-animated copy of the same model, at the same scale, for its rest pose
	 * @param target      the model to drive, already turned to face the same way as the source
	 */
	public constructor(source: RigView, sourceRest: RigView, target: RigView, pairs: readonly BonePair[]) {
		this.sourceFrame = source.frame;
		this.targetFrame = target.frame;
		for (const pair of pairs) {
			const sourceBone = findBone(source.root, pair.source);
			const restBone = findBone(sourceRest.root, pair.source);
			const targetBone = findBone(target.root, pair.target);
			if (!sourceBone || !restBone || !targetBone) continue;
			// Turn the target bone so it points where the source bone points at rest.
			let alignment = new Quat();
			const restChild = pair.sourceChild ? findBone(sourceRest.root, pair.sourceChild) : null;
			const targetChild = pair.targetChild ? findBone(target.root, pair.targetChild) : null;
			if (restChild && targetChild) {
				const sourceDirection = framePoint(sourceRest.frame, restChild).sub(framePoint(sourceRest.frame, restBone)).normalize();
				const targetDirection = framePoint(target.frame, targetChild).sub(framePoint(target.frame, targetBone)).normalize();
				alignment = rotationBetween(targetDirection, sourceDirection);
			}
			this.links.push({
				source: sourceBone,
				target: targetBone,
				sourceRestInverse: frameRotation(sourceRest.frame, restBone).invert(),
				alignedTargetRest: new Quat().mul2(alignment, frameRotation(target.frame, targetBone)),
			});
		}
		this.sourceHips = findBone(source.root, "Hips");
		this.targetHips = findBone(target.root, "CC_Base_Hip");
		const restHips = findBone(sourceRest.root, "Hips");
		if (restHips) this.sourceHipsRest.copy(framePoint(sourceRest.frame, restHips));
		if (this.targetHips) this.targetHipsRest.copy(framePoint(target.frame, this.targetHips));
		this.hipScale = this.sourceHipsRest.y > 1e-4 ? this.targetHipsRest.y / this.sourceHipsRest.y : 1;
	}

	public get boneCount(): number {
		return this.links.length;
	}

	/** Copies the source's current pose onto the target. Call after animation has run. */
	public apply(): void {
		this.frameInverse.copy(frameWorldRotation(this.sourceFrame)).invert();
		const targetFrameRotation = frameWorldRotation(this.targetFrame);
		// Parents come first in the list, so each bone's parent is already placed when it's set.
		for (const link of this.links) {
			// The source bone's rotation away from its rest, in its frame...
			this.rotation.mul2(this.frameInverse, link.source.getRotation()).mul(link.sourceRestInverse);
			// ...applied to the target's aligned rest, then back out to world space.
			this.rotation.mul(link.alignedTargetRest);
			this.rotation.mul2(targetFrameRotation, this.rotation);
			link.target.setRotation(this.rotation);
		}
		if (this.sourceHips && this.targetHips) {
			// The hips' bob and sway, scaled to the target's proportions.
			const offset = framePoint(this.sourceFrame, this.sourceHips).sub(this.sourceHipsRest).mulScalar(this.hipScale);
			this.point.copy(this.targetHipsRest).add(offset);
			toWorld(this.targetFrame, this.point);
			this.targetHips.setPosition(this.point);
		}
	}
}

const IDENTITY = new Quat();

function frameWorldRotation(frame: GraphNode | null): Quat {
	return frame ? frame.getRotation() : IDENTITY;
}

/** A node's rotation in a frame's space. */
function frameRotation(frame: GraphNode | null, node: GraphNode): Quat {
	return new Quat().copy(frameWorldRotation(frame)).invert().mul(node.getRotation());
}

/** A node's position in a frame's orientation, relative to its origin, in world units. */
function framePoint(frame: GraphNode | null, node: GraphNode): Vec3 {
	const position = node.getPosition().clone();
	if (!frame) return position;
	return new Quat().copy(frame.getRotation()).invert().transformVector(position.sub(frame.getPosition()));
}

/** Inverse of framePoint, in place. */
function toWorld(frame: GraphNode | null, point: Vec3): void {
	if (!frame) return;
	frame.getRotation().transformVector(point, point);
	point.add(frame.getPosition());
}

/** The shortest rotation taking unit vector `from` onto unit vector `to`. */
export function rotationBetween(from: Vec3, to: Vec3): Quat {
	const dot = Math.max(-1, Math.min(1, from.dot(to)));
	if (dot > 0.999999) return new Quat();
	if (dot < -0.999999) {
		// Opposite: turn half way round any axis perpendicular to `from`.
		const axis = Math.abs(from.x) < 0.9 ? new Vec3(1, 0, 0) : new Vec3(0, 1, 0);
		axis.cross(axis, from).normalize();
		return new Quat().setFromAxisAngle(axis, 180);
	}
	const axis = new Vec3().cross(from, to).normalize();
	return new Quat().setFromAxisAngle(axis, (Math.acos(dot) * 180) / Math.PI);
}
