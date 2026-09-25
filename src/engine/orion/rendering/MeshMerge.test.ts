import { GraphNode, Mat4, Mesh, MeshInstance, NullGraphicsDevice, PRIMITIVE_TRIANGLES, SEMANTIC_POSITION, SEMANTIC_TANGENT, StandardMaterial, type GraphicsDevice } from "playcanvas";
import { describe, expect, it } from "vitest";

import { compactGeometry, isMergeable, mergeGeometry, mergeMeshInstances } from "./MeshMerge";

/** A headless device: buffers keep their data in memory, nothing is drawn. */
const device = new NullGraphicsDevice({} as HTMLCanvasElement) as unknown as GraphicsDevice;
const material = new StandardMaterial();

/** One triangle in the XY plane, facing +Z. */
function triangle(tangent?: readonly number[]): Mesh {
	const mesh = new Mesh(device);
	mesh.setPositions([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1]);
	if (tangent) mesh.setVertexStream(SEMANTIC_TANGENT, new Float32Array([...tangent, ...tangent, ...tangent]), 4);
	mesh.setIndices([0, 1, 2]);
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}

function placed(x: number, y: number, z: number, scale = [1, 1, 1], yaw = 0): MeshInstance {
	const node = new GraphNode();
	node.setLocalPosition(x, y, z);
	node.setLocalEulerAngles(0, yaw, 0);
	node.setLocalScale(scale[0], scale[1], scale[2]);
	return new MeshInstance(triangle(), material, node);
}

function read(mesh: Mesh) {
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	mesh.getPositions(positions);
	mesh.getNormals(normals);
	mesh.getIndices(indices);
	return { positions, normals, indices };
}

describe("mergeMeshInstances", () => {
	it("bakes each part's transform into one mesh", () => {
		const merged = mergeMeshInstances(device, [placed(0, 0, 0), placed(10, 0, 0)], new Mat4());
		const { positions, indices } = read(merged);
		expect(positions.length).toBe(18);
		expect(positions.slice(9, 12)).toEqual([10, 0, 0]);
		expect(positions.slice(12, 15)).toEqual([11, 0, 0]);
		// The second triangle's indices are offset past the first's vertices.
		expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("expresses the result relative to the frame it will hang under", () => {
		const frame = new Mat4().setTranslate(5, 0, 0);
		const { positions } = read(mergeMeshInstances(device, [placed(5, 2, 0)], frame));
		expect(positions.slice(0, 3)).toEqual([0, 2, 0]);
	});

	it("rotates normals with their part", () => {
		const { normals } = read(mergeMeshInstances(device, [placed(0, 0, 0, [1, 1, 1], 90)], new Mat4()));
		// Yawing +Z by 90 degrees points it along +X.
		expect(normals[0]).toBeCloseTo(1);
		expect(normals[2]).toBeCloseTo(0);
	});

	it("keeps normals unit length under scaling", () => {
		const { normals } = read(mergeMeshInstances(device, [placed(0, 0, 0, [3, 3, 3])], new Mat4()));
		expect(Math.hypot(normals[0], normals[1], normals[2])).toBeCloseTo(1);
	});

	it("flips the winding of mirrored parts so they still face outwards", () => {
		const { indices } = read(mergeMeshInstances(device, [placed(0, 0, 0, [-1, 1, 1])], new Mat4()));
		expect(indices).toEqual([0, 2, 1]);
	});

	it("bounds the merged geometry, not a default box at the origin", () => {
		// A stale box made merged car bodies cull away whenever their centre left the view.
		const merged = mergeMeshInstances(device, [placed(0, 0, 0), placed(10, 0, 0, [2, 2, 2])], new Mat4());
		expect(merged.aabb.getMin().x).toBeCloseTo(0);
		expect(merged.aabb.getMax().x).toBeCloseTo(12);
		expect(merged.aabb.getMax().y).toBeCloseTo(2);
	});

	it("moves tangents with the surface and flips their handedness when mirrored", () => {
		const mesh = triangle([1, 0, 0, 1]);
		const node = new GraphNode();
		// Squashing X must not tilt a tangent lying along X (the inverse-transpose would still
		// keep it on X here, so also mirror to check w).
		node.setLocalScale(-0.5, 3, 1);
		const { streams } = mergeGeometry([new MeshInstance(mesh, material, node)], new Mat4());
		const tangent = streams.find((stream) => stream.semantic === SEMANTIC_TANGENT)!.data;
		expect(tangent[0]).toBeCloseTo(-1);
		expect(tangent[3]).toBe(-1);
	});

	it("rotates tangents by the transform, not its inverse-transpose, under shear-free scale", () => {
		const mesh = triangle([Math.SQRT1_2, Math.SQRT1_2, 0, 1]);
		const node = new GraphNode();
		node.setLocalScale(4, 1, 1);
		const { streams } = mergeGeometry([new MeshInstance(mesh, material, node)], new Mat4());
		const tangent = streams.find((stream) => stream.semantic === SEMANTIC_TANGENT)!.data;
		// Stretching X by 4 leans a 45 degree tangent towards X (the inverse-transpose leaned it to Y).
		expect(tangent[0]).toBeGreaterThan(tangent[1]);
		expect(Math.hypot(tangent[0], tangent[1], tangent[2])).toBeCloseTo(1);
	});
});

describe("compactGeometry", () => {
	it("keeps only the vertices the indices use, in first-use order", () => {
		const geometry = mergeGeometry([placed(0, 0, 0), placed(10, 0, 0)], new Mat4());
		const compact = compactGeometry(geometry, new Uint32Array([3, 4, 5]));
		expect(compact.vertexCount).toBe(3);
		expect(Array.from(compact.indices)).toEqual([0, 1, 2]);
		const positions = compact.streams.find((stream) => stream.semantic === SEMANTIC_POSITION)!.data;
		expect(Array.from(positions.slice(0, 3))).toEqual([10, 0, 0]);
	});
});

describe("isMergeable", () => {
	it("accepts plain indexed triangles", () => {
		expect(isMergeable(placed(0, 0, 0))).toBe(true);
	});

	it("rejects geometry without indices", () => {
		const mesh = new Mesh(device);
		mesh.setPositions([0, 0, 0, 1, 0, 0, 0, 1, 0]);
		mesh.update(PRIMITIVE_TRIANGLES);
		expect(isMergeable(new MeshInstance(mesh, material, new GraphNode()))).toBe(false);
	});
});
