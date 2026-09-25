import {
	BoundingBox,
	Mesh,
	MeshInstance,
	PRIMITIVE_TRIANGLES,
	SEMANTIC_COLOR,
	StandardMaterial,
	TYPE_UINT8,
	typedArrayIndexFormats,
	typedArrayTypes,
	type Entity,
	type GraphicsDevice,
	type RenderComponent,
	type SkinInstance,
} from "playcanvas";

/**
 * Draws a character in one call instead of one per material.
 *
 * The character packs split each body into a part per material — skin, hair, shirt, trousers,
 * eyes, trim — around seven to nine per person, all deformed by the same skeleton. Every part
 * is its own draw call in the main pass and again in each shadow cascade, and with a crowd,
 * drivers and police that was the largest share of the frame's draw calls.
 *
 * The materials are flat colours (no textures), so each part's colour is baked into its vertices
 * and the parts are joined into one skinned mesh sharing the original skin. The look is
 * unchanged: same colours, same shape, same animation; only per-part gloss is unified.
 *
 * Call after the character has been tinted and its bounds fixed. Parts that can't be joined (a
 * textured material, a different skin or vertex layout) are left as they are.
 *
 * The merged mesh keeps the parts' own skin, so it survives the entity being disabled and
 * enabled again (see mergeSkinnedParts).
 */
export function mergeCharacterMaterials(root: Entity, device: GraphicsDevice): void {
	for (const render of root.findComponents("render") as RenderComponent[]) {
		const instances = render.meshInstances;
		if (instances.length < 2) continue;
		const skin = instances[0].skinInstance;
		const hash = instances[0].mesh.vertexBuffer?.format.batchingHash;
		const joinable = instances.filter((instance) => (
			instance.skinInstance === skin
			&& instance.mesh.vertexBuffer?.format.batchingHash === hash
			&& instance.mesh.primitive[0].indexed
			&& instance.material instanceof StandardMaterial
			&& !(instance.material as StandardMaterial).diffuseMap
			&& (instance.material as StandardMaterial).opacity >= 1
		));
		if (!skin || joinable.length < 2) continue;
		const merged = mergeSkinnedParts(device, joinable, skin);
		if (!merged) continue;
		const custom = (joinable[0] as unknown as { _customAabb: BoundingBox | null })._customAabb;
		// Replacing the list destroys the old parts, and destroying a part destroys its skin —
		// the skin the merged mesh now uses. Detach it from them first.
		for (const part of joinable) part.skinInstance = null;
		const rest = instances.filter((instance) => !joinable.includes(instance));
		render.meshInstances = [merged, ...rest];
		// The component applies its own (unset) custom bounds to new instances; restore the fixed box.
		if (custom) merged.setCustomAabb(custom);
	}
}

function mergeSkinnedParts(device: GraphicsDevice, parts: readonly MeshInstance[], skin: SkinInstance): MeshInstance | null {
	const format = parts[0].mesh.vertexBuffer.format;
	let vertexCount = 0;
	let indexCount = 0;
	for (const part of parts) {
		vertexCount += part.mesh.vertexBuffer.numVertices;
		indexCount += part.mesh.primitive[0].count;
	}
	const streams = format.elements.map((element) => {
		const ArrayType = typedArrayTypes[element.dataType] as unknown as new (length: number) => Float32Array;
		return { element, data: new ArrayType(vertexCount * element.numComponents) };
	});
	const colours = new Uint8Array(vertexCount * 4);
	const indices = new Uint32Array(indexCount);

	let vertexBase = 0;
	let indexOffset = 0;
	for (const part of parts) {
		const mesh = part.mesh;
		const count = mesh.vertexBuffer.numVertices;
		// Skinned vertices are in bind space: copied as they are, the skeleton does the rest.
		for (const stream of streams) {
			const components = stream.element.numComponents;
			mesh.getVertexStream(stream.element.name, stream.data.subarray(vertexBase * components, (vertexBase + count) * components));
		}
		const diffuse = (part.material as StandardMaterial).diffuse;
		const r = Math.round(Math.min(1, diffuse.r) * 255);
		const g = Math.round(Math.min(1, diffuse.g) * 255);
		const b = Math.round(Math.min(1, diffuse.b) * 255);
		for (let i = vertexBase; i < vertexBase + count; i++) {
			colours[i * 4] = r;
			colours[i * 4 + 1] = g;
			colours[i * 4 + 2] = b;
			colours[i * 4 + 3] = 255;
		}
		const primitive = mesh.primitive[0];
		const indexBuffer = mesh.indexBuffer[0];
		const source = new typedArrayIndexFormats[indexBuffer.getFormat()](indexBuffer.storage);
		const baseVertex = primitive.baseVertex ?? 0;
		for (let i = 0; i < primitive.count; i++) indices[indexOffset + i] = source[primitive.base + i] + baseVertex + vertexBase;
		indexOffset += primitive.count;
		vertexBase += count;
	}

	const mesh = new Mesh(device);
	for (const { element, data } of streams) {
		mesh.setVertexStream(element.name, data, element.numComponents, vertexCount, element.dataType, element.normalize);
	}
	mesh.setVertexStream(SEMANTIC_COLOR, colours, 4, vertexCount, TYPE_UINT8, true);
	mesh.setIndices(vertexCount > 65535 ? indices : new Uint16Array(indices));
	mesh.update(PRIMITIVE_TRIANGLES, true);
	// The merged mesh has to carry the skin itself, not just be handed a skin instance. When an
	// entity is disabled — a driver going out of range — the render component clears the skin
	// instance off every mesh instance, and on re-enable it only builds a new one for a mesh
	// that has `skin`. Without this line a driver that had been out of view once came back
	// rendering its bind pose: a standing T-pose sunk into the seat, head through the roof and
	// arms straight out through the doors.
	mesh.skin = parts[0].mesh.skin;

	const first = parts[0];
	const material = (first.material as StandardMaterial).clone();
	material.name = "character-merged";
	material.diffuse.set(1, 1, 1);
	material.diffuseVertexColor = true;
	material.update();

	const instance = new MeshInstance(mesh, material, first.node);
	instance.skinInstance = skin;
	return instance;
}
