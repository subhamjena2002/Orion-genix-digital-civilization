import { BoundingBox, Entity, Mat4, Vec3, type RenderComponent } from "playcanvas";

/**
 * The box a model's meshes fill, in `root`'s own space (its position, rotation and scale
 * undone), or null if nothing under it renders yet. Measured from each mesh's own bounds, so a
 * rotated prop gets its true size rather than the larger world-aligned box around it.
 */
export function localBounds(root: Entity): BoundingBox | null {
	const toRoot = root.getWorldTransform().clone().invert();
	const relative = new Mat4();
	const corner = new Vec3();
	const min = new Vec3(Infinity, Infinity, Infinity);
	const max = new Vec3(-Infinity, -Infinity, -Infinity);
	let found = false;
	for (const render of root.findComponents("render") as RenderComponent[]) {
		for (const instance of render.meshInstances) {
			const aabb = instance.mesh.aabb;
			relative.mul2(toRoot, instance.node.getWorldTransform());
			const centre = aabb.center;
			const half = aabb.halfExtents;
			for (let i = 0; i < 8; i++) {
				corner.set(
					centre.x + (i & 1 ? half.x : -half.x),
					centre.y + (i & 2 ? half.y : -half.y),
					centre.z + (i & 4 ? half.z : -half.z),
				);
				relative.transformPoint(corner, corner);
				min.min(corner);
				max.max(corner);
				found = true;
			}
		}
	}
	if (!found) return null;
	const box = new BoundingBox();
	box.setMinMax(min, max);
	return box;
}

/** Trunk radius for a tree's collider: the crown overhangs, only the trunk stops you. */
const TRUNK_RADIUS = 0.2;

/**
 * Gives a loaded model a solid static body matching its size — a box, or for a tree just a
 * trunk-sized cylinder. Waits for the model's meshes if they aren't there yet. Returns the
 * cleanup that removes it.
 */
export function addSolidBody(root: Entity, trunkOnly: boolean): () => void {
	let collider: Entity | null = null;
	let frame = 0;
	let tries = 0;
	const build = () => {
		const bounds = localBounds(root);
		if (!bounds) {
			if (++tries < 120) frame = requestAnimationFrame(build);
			return;
		}
		const scale = root.getWorldTransform().getScale();
		const half = bounds.halfExtents;
		const holder = new Entity("solid-body");
		holder.setLocalPosition(bounds.center.x, bounds.center.y, bounds.center.z);
		if (trunkOnly) {
			holder.addComponent("collision", { type: "cylinder", radius: TRUNK_RADIUS, height: half.y * 2 * scale.y });
		} else {
			holder.addComponent("collision", { type: "box", halfExtents: new Vec3(half.x * scale.x, half.y * scale.y, half.z * scale.z) });
		}
		holder.addComponent("rigidbody", { type: "static" });
		root.addChild(holder);
		collider = holder;
	};
	build();
	return () => {
		cancelAnimationFrame(frame);
		collider?.destroy();
	};
}
