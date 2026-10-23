import { Batch, MeshInstance, SkinBatchInstance, type AppBase, type GraphicsDevice, type GraphNode, type Material, type Mesh } from "playcanvas";

/**
 * Lets dynamic batches made of the same parts share one mesh.
 *
 * Every car batches its moving parts (wheels, doors, side windows) into a dynamic batch, and a
 * dynamic batch keeps each part in its own space with a bone per part, so cars of one model
 * produce byte-identical batch geometry. The engine still builds it afresh per car: it reads every
 * vertex back through `getVertexStream` (interleaved buffers, one vertex at a time), copies it
 * into new arrays and uploads it. Measured in Phase 2.5: 693 ms over the 90 batches built in the
 * first ~45 s after Ready, 74% of it reading vertices back, 15–58 ms per car as each comes into
 * play; the same part list was built 2–8 times over.
 *
 * Here the first batch of a part list is built by the engine as ever and its mesh kept; a later
 * batch of exactly the same parts (same meshes, in the same order, the same ones visible) gets the
 * kept mesh with its own material copy and its own bones, as the engine would have made them.
 * Only for the batch groups registered with `shareBatchGeometry`, and only dynamic ones.
 *
 * Leans on the batch manager's `create`, `_batchList`, `rootNode` and `device`, and on the mesh
 * instance's `_shaderDefs`/`_updateAabb` (copied the way the engine's own `create` does); without
 * them, nothing changes.
 */

interface MeshInstanceLike {
	mesh: Mesh;
	material: Material;
	visible: boolean;
	node: GraphNode;
	castShadow: boolean;
	shadowCascadeMask: number;
	parameters: unknown;
	layer: number;
	cull: boolean;
	drawOrder: number;
	stencilFront: unknown;
	stencilBack: unknown;
	_shaderDefs: number;
}

interface BatchLike {
	meshInstance: MeshInstanceLike | null;
	updateBoundingBox(): void;
}

type Create = (meshInstances: MeshInstanceLike[], dynamic: boolean, batchGroupId: number) => BatchLike | null;

interface BatcherLike {
	create: Create;
	_batchList: BatchLike[];
	rootNode: GraphNode;
	device: GraphicsDevice;
}

/** Per app: the registered groups and the kept meshes, by part list. */
const states = new WeakMap<AppBase, { groups: Map<number, number>; meshes: Map<string, Mesh> }>();

/**
 * Lets the batches of `groupId` share geometry with every other registered batch of the same
 * parts. Returns the registration back (a car being removed); the kept meshes stay for the page,
 * one per distinct part list.
 */
export function shareBatchGeometry(app: AppBase, groupId: number): () => void {
	const state = install(app);
	if (!state) return () => {};
	state.groups.set(groupId, (state.groups.get(groupId) ?? 0) + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const count = (state.groups.get(groupId) ?? 1) - 1;
		if (count > 0) state.groups.set(groupId, count);
		else state.groups.delete(groupId);
	};
}

function install(app: AppBase) {
	const existing = states.get(app);
	if (existing) return existing;
	const batcher = app.batcher as unknown as BatcherLike | null;
	if (!batcher || typeof batcher.create !== "function" || !Array.isArray(batcher._batchList) || !batcher.rootNode || !batcher.device) return null;

	const state = { groups: new Map<number, number>(), meshes: new Map<string, Mesh>() };
	states.set(app, state);
	const create = batcher.create;
	batcher.create = function (this: BatcherLike, meshInstances, dynamic, batchGroupId) {
		if (!dynamic || !state.groups.has(batchGroupId) || !meshInstances.some((instance) => instance.visible)) {
			return create.call(this, meshInstances, dynamic, batchGroupId);
		}
		const key = partsKey(meshInstances);
		const kept = state.meshes.get(key);
		if (kept && kept.vertexBuffer) return sharedBatch(this, meshInstances, batchGroupId, kept);
		const batch = create.call(this, meshInstances, dynamic, batchGroupId);
		const mesh = batch?.meshInstance?.mesh;
		if (mesh) {
			// Held for the page: no car's removal may free it while another uses (or will use) it.
			mesh.incRefCount();
			state.meshes.set(key, mesh);
		}
		return batch;
	};
	return state;
}

/**
 * What a dynamic batch's geometry is made from: each part's buffers and draw range, in order, and
 * whether it's drawn (hidden parts are left out but keep their bone slot).
 */
export function partsKey(meshInstances: readonly MeshInstanceLike[]): string {
	return meshInstances.map((instance) => {
		const { mesh } = instance;
		const primitive = mesh.primitive[0];
		return `${mesh.id}:${mesh.vertexBuffer?.id}:${mesh.indexBuffer[0]?.id ?? "-"}:${primitive?.base}:${primitive?.count}:${instance.visible ? 1 : 0}`;
	}).join(",");
}

/** The batch the engine's `create` would make for these parts, around an existing mesh. */
function sharedBatch(batcher: BatcherLike, meshInstances: MeshInstanceLike[], batchGroupId: number, mesh: Mesh): BatchLike {
	const first = meshInstances[0];
	const firstDrawn = meshInstances.find((instance) => instance.visible)!;
	const batch = new Batch(meshInstances as unknown as MeshInstance[], true, batchGroupId) as unknown as BatchLike;
	batcher._batchList.push(batch);
	// Its own copy, as the engine makes for every dynamic batch (each car has its own paint).
	const material = firstDrawn.material.clone();
	material.update();
	const instance = new MeshInstance(mesh, material, batcher.rootNode) as unknown as MeshInstanceLike & { batching: boolean; skinInstance: unknown; flipFacesFactor: number; _updateAabb: boolean };
	instance.castShadow = first.castShadow;
	instance.parameters = first.parameters;
	instance.layer = first.layer;
	instance._shaderDefs = first._shaderDefs;
	instance.batching = true;
	instance.cull = first.cull;
	instance.skinInstance = new SkinBatchInstance(batcher.device, meshInstances.map((part) => part.node), batcher.rootNode);
	instance._updateAabb = false;
	instance.drawOrder = first.drawOrder;
	instance.stencilFront = first.stencilFront;
	instance.stencilBack = first.stencilBack;
	instance.flipFacesFactor = (first.node as unknown as { worldTransform: { scaleSign: number } }).worldTransform.scaleSign;
	instance.shadowCascadeMask = first.shadowCascadeMask;
	batch.meshInstance = instance;
	batch.updateBoundingBox();
	return batch;
}
