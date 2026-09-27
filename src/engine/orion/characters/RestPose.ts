import { Quat, Vec3, type Entity, type GraphNode } from "playcanvas";

/**
 * A character's skeleton as it was before any clip moved it, for starting its animation over.
 *
 * After the death clip, the anim component keeps writing that clip's last frame to every bone
 * the next clip has no keys for — on these rigs the torso root, spine, head and foot targets —
 * even once the clip itself is gone. A dead officer's replacement stood with his legs on the
 * ground and his body still lying flat. Neither changing clip nor resetting the component lets
 * go of those bones; only a new component does, on a skeleton put back to its rest pose.
 */
export class RestPose {
	private readonly nodes: GraphNode[] = [];
	private readonly positions: Vec3[] = [];
	private readonly rotations: Quat[] = [];

	/** Call before the anim component is added. */
	public constructor(root: GraphNode) {
		root.forEach((node) => {
			if (node === root) return;
			this.nodes.push(node);
			this.positions.push(node.getLocalPosition().clone());
			this.rotations.push(node.getLocalRotation().clone());
		});
	}

	/**
	 * Drops `model`'s anim component, puts the skeleton back to rest, and has `assignClips` add a
	 * fresh component with its clips.
	 */
	public restartAnimation(model: Entity, assignClips: (model: Entity) => void) {
		if (model.anim) model.removeComponent("anim");
		for (let i = 0; i < this.nodes.length; i++) {
			this.nodes[i].setLocalPosition(this.positions[i]);
			this.nodes[i].setLocalRotation(this.rotations[i]);
		}
		assignClips(model);
	}
}
