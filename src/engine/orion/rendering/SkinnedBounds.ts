import { BoundingBox, Mat4, type Entity, type MeshInstance } from "playcanvas";

const union = new BoundingBox();
const reach = new BoundingBox();
const local = new BoundingBox();
const toLocal = new Mat4();
/** Skin update indices the renderer never uses, so each call really recomputes the pose. */
let freshPose = 0;

/**
 * Gives a character's skinned meshes fixed culling bounds.
 *
 * By default the engine works a skinned mesh's bounds out from every bone, every frame, before
 * culling — and to do that it has to compute the skin matrices of every character in the city,
 * on screen or not, once for the camera and again for the shadows. With a crowd, the drivers
 * and the police that's hundreds of meshes. A fixed box around the character makes culling a
 * single box test, and only the characters actually on screen get skinned.
 *
 * The box reaches the character's full height in every direction, so it still holds someone
 * mid-stride, sitting, or knocked flat in any direction. Call once the model is posed.
 */
export function fixSkinnedBounds(root: Entity): void {
	const renders = root.findComponents("render") as unknown as { meshInstances: MeshInstance[] }[];
	const skinned: MeshInstance[] = [];
	for (const render of renders) {
		for (const instance of render.meshInstances) if (instance.skinInstance) skinned.push(instance);
	}
	if (skinned.length === 0) return;

	// The skin matrices may not have been computed yet (the model can be set up before its first
	// frame is drawn), so pose them from the bones as they stand now.
	for (const instance of skinned) instance.skinInstance?.updateMatrixPalette(instance.node, --freshPose);

	// Every part (eyes, hair, shirt) gets the same box: the whole body, not the part.
	union.copy(skinned[0].aabb);
	for (let i = 1; i < skinned.length; i++) union.add(skinned[i].aabb);
	const height = union.halfExtents.y * 2;
	reach.center.copy(union.center);
	reach.halfExtents.set(height, height, height);

	for (const instance of skinned) {
		toLocal.copy(instance.node.getWorldTransform()).invert();
		local.setFromTransformedAabb(reach, toLocal);
		instance.setCustomAabb(local);
	}
}
