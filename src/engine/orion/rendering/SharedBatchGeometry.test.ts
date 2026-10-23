import { BatchManager, GraphNode, Mesh, MeshInstance, NullGraphicsDevice, PRIMITIVE_TRIANGLES, StandardMaterial, type AppBase, type BoundingBox, type Entity, type GraphicsDevice, type Material } from "playcanvas";
import { describe, expect, it } from "vitest";

import { shareBatchGeometry } from "./SharedBatchGeometry";

/** A headless device: buffers keep their data in memory, nothing is drawn. */
const device = new NullGraphicsDevice({} as HTMLCanvasElement) as unknown as GraphicsDevice;

function part(offset: number): Mesh {
	const mesh = new Mesh(device);
	mesh.setPositions([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]);
	mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1]);
	mesh.setUvs(0, [0, 0, 1, 0, 0, 1]);
	mesh.setIndices([0, 1, 2]);
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}

/** A model's moving parts (shared meshes), and a world with a batcher. */
const wheel = part(0);
const door = part(2);
const mirror = part(4);

function world() {
	const root = new GraphNode("root");
	const batcher = new BatchManager(device, root as Entity, null as never);
	const app = { batcher } as unknown as AppBase;
	return { app, batcher, root };
}

/** One car's parts: its own nodes and its own paint, the model's meshes. */
function car(root: GraphNode, paint: string, hidden: Mesh[] = []): MeshInstance[] {
	const material = new StandardMaterial();
	material.name = paint;
	return [wheel, door, mirror].map((mesh, index) => {
		const node = new GraphNode(`${paint}-${index}`);
		root.addChild(node);
		node.setLocalPosition(index, 0, 0);
		const instance = new MeshInstance(mesh, material, node);
		instance.visible = !hidden.includes(mesh);
		return instance;
	});
}

/** What the tests read of a batch and its mesh instance (some of it engine-internal). */
interface BuiltInstance {
	mesh: Mesh;
	material: Material;
	aabb: BoundingBox;
	castShadow: boolean;
	layer: number;
	drawOrder: number;
	cull: boolean;
	batching: boolean;
	shadowCascadeMask: number;
	_shaderDefs: number;
	flipFacesFactor: number;
	skinInstance: { bones: GraphNode[] } | null;
	destroy(): void;
}
interface BatchInternals {
	meshInstance: BuiltInstance;
}

function build(batcher: BatchManager, parts: MeshInstance[], groupId: number): BatchInternals {
	return (batcher as unknown as { create(parts: MeshInstance[], dynamic: boolean, id: number): BatchInternals }).create(parts, true, groupId);
}

function positions(mesh: Mesh): number[] {
	const out: number[] = [];
	mesh.getPositions(out);
	return out;
}

describe("shareBatchGeometry", () => {
	it("gives a second car of the same parts the first car's mesh, with its own paint and bones", () => {
		const { app, batcher, root } = world();
		const group = batcher.addGroup("cars", true, 100);
		shareBatchGeometry(app, group.id);
		const red = car(root, "red");
		const blue = car(root, "blue");
		const first = build(batcher, red, group.id);
		const second = build(batcher, blue, group.id);

		expect(second.meshInstance.mesh).toBe(first.meshInstance.mesh);
		expect(second.meshInstance.material).not.toBe(first.meshInstance.material);
		expect(second.meshInstance.material.name).toBe("blue");
		expect(second.meshInstance.skinInstance!.bones).toEqual(blue.map((instance) => instance.node));
		expect((batcher as unknown as { _batchList: unknown[] })._batchList).toContain(second);
	});

	it("makes the same batch the engine makes, apart from sharing the mesh", () => {
		const shared = world();
		const plain = world();
		const sharedGroup = shared.batcher.addGroup("cars", true, 100);
		const plainGroup = plain.batcher.addGroup("cars", true, 100);
		shareBatchGeometry(shared.app, sharedGroup.id);
		build(shared.batcher, car(shared.root, "red"), sharedGroup.id);
		const reused = build(shared.batcher, car(shared.root, "blue"), sharedGroup.id).meshInstance;
		const engine = build(plain.batcher, car(plain.root, "blue"), plainGroup.id).meshInstance;

		expect(positions(reused.mesh)).toEqual(positions(engine.mesh));
		expect(reused.mesh.primitive[0].count).toBe(engine.mesh.primitive[0].count);
		for (const field of ["castShadow", "layer", "drawOrder", "cull", "batching", "shadowCascadeMask", "_shaderDefs", "flipFacesFactor"] as const) {
			expect(reused[field]).toEqual(engine[field]);
		}
		expect(reused.skinInstance!.bones.length).toBe(engine.skinInstance!.bones.length);
		expect(reused.aabb.center).toEqual(engine.aabb.center);
		expect(reused.aabb.halfExtents).toEqual(engine.aabb.halfExtents);
	});

	it("keeps the mesh alive for other cars when one car's batch goes", () => {
		const { app, batcher, root } = world();
		const group = batcher.addGroup("cars", true, 100);
		shareBatchGeometry(app, group.id);
		const first = build(batcher, car(root, "red"), group.id);
		const second = build(batcher, car(root, "blue"), group.id);
		const mesh = first.meshInstance.mesh;
		first.meshInstance.destroy();
		second.meshInstance.destroy();

		expect(mesh.vertexBuffer).not.toBeNull();
		expect(build(batcher, car(root, "green"), group.id).meshInstance.mesh).toBe(mesh);
	});

	it("builds afresh for a different set of drawn parts", () => {
		const { app, batcher, root } = world();
		const group = batcher.addGroup("cars", true, 100);
		shareBatchGeometry(app, group.id);
		const whole = build(batcher, car(root, "red"), group.id);
		const noMirror = build(batcher, car(root, "blue", [mirror]), group.id);

		expect(noMirror.meshInstance.mesh).not.toBe(whole.meshInstance.mesh);
		expect(positions(noMirror.meshInstance.mesh).length).toBe(positions(whole.meshInstance.mesh).length - 9);
	});

	it("leaves groups that aren't registered, or are no longer, to the engine", () => {
		const { app, batcher, root } = world();
		const other = batcher.addGroup("other", true, 100);
		const group = batcher.addGroup("cars", true, 100);
		const release = shareBatchGeometry(app, group.id);
		const a = build(batcher, car(root, "a"), other.id);
		const b = build(batcher, car(root, "b"), other.id);
		expect(b.meshInstance.mesh).not.toBe(a.meshInstance.mesh);

		build(batcher, car(root, "c"), group.id);
		release();
		const d = build(batcher, car(root, "d"), group.id);
		const e = build(batcher, car(root, "e"), group.id);
		expect(e.meshInstance.mesh).not.toBe(d.meshInstance.mesh);
	});
});
