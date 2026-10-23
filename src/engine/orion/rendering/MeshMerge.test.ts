import { GraphNode, Mat4, Mesh, MeshInstance, NullGraphicsDevice, PRIMITIVE_TRIANGLES, SEMANTIC_COLOR, SEMANTIC_NORMAL, SEMANTIC_POSITION, SEMANTIC_TANGENT, SEMANTIC_TEXCOORD0, StandardMaterial, INDEXFORMAT_UINT16, IndexBuffer, TYPE_FLOAT32, TYPE_UINT8, Vec3, VertexBuffer, VertexFormat, type GraphicsDevice } from "playcanvas";
import { describe, expect, it } from "vitest";

import { compactGeometry, isMergeable, mergeGeometry, mergeMeshInstances, readVertexStream, type MergedGeometry } from "./MeshMerge";

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

	it("gives exactly what copying every source vertex gave, for any subset and stream layout", () => {
		// The way it was done before (every source vertex visited, per stream): the reference.
		const reference = (geometry: MergedGeometry, indices: Uint32Array) => {
			const remap = new Int32Array(geometry.vertexCount).fill(-1);
			let used = 0;
			const renumbered = indices.map((vertex) => (remap[vertex] < 0 ? (remap[vertex] = used++) : remap[vertex]));
			const streams = geometry.streams.map((stream) => {
				const data = new (stream.data.constructor as new (length: number) => Float32Array)(used * stream.components);
				for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
					if (remap[vertex] < 0) continue;
					for (let c = 0; c < stream.components; c++) data[remap[vertex] * stream.components + c] = stream.data[vertex * stream.components + c];
				}
				return data;
			});
			return { renumbered, streams, used };
		};
		let seed = 7;
		const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		for (let trial = 0; trial < 20; trial++) {
			const vertexCount = 50 + Math.floor(random() * 200);
			const streams = [
				{ components: 3, data: Float32Array.from({ length: vertexCount * 3 }, random) },
				{ components: 2, data: Float32Array.from({ length: vertexCount * 2 }, random) },
				{ components: 4, data: Uint8Array.from({ length: vertexCount * 4 }, () => Math.floor(random() * 256)) },
			];
			const geometry = { streams, indices: new Uint32Array(0), vertexCount } as unknown as MergedGeometry;
			// A simplified level: a few hundred indices over a random part of the vertices, repeats included.
			const indices = Uint32Array.from({ length: 3 * Math.floor(random() * 60) }, () => Math.floor(random() * vertexCount));
			const compact = compactGeometry(geometry, indices);
			const expected = reference(geometry, indices);
			expect(compact.vertexCount).toBe(expected.used);
			expect(Array.from(compact.indices)).toEqual(Array.from(expected.renumbered));
			compact.streams.forEach((stream, index) => expect(Array.from(stream.data)).toEqual(Array.from(expected.streams[index])));
		}
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

describe("readVertexStream", () => {
	/** A loaded-model style mesh: one interleaved buffer of mixed types, no source streams kept. */
	function interleaved(vertices: number, interleave = true): Mesh {
		const format = new VertexFormat(device, [
			{ semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
			{ semantic: SEMANTIC_NORMAL, components: 3, type: TYPE_FLOAT32 },
			{ semantic: SEMANTIC_COLOR, components: 4, type: TYPE_UINT8, normalize: true },
			{ semantic: SEMANTIC_TEXCOORD0, components: 2, type: TYPE_FLOAT32 },
		], interleave ? undefined : vertices);
		const buffer = new VertexBuffer(device, format, vertices);
		const bytes = new Uint8Array(buffer.lock() as ArrayBuffer);
		for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 251;
		// Floats from arbitrary bytes can be NaN, which compares unequal: write real numbers there.
		for (const element of format.elements) {
			if (element.dataType !== TYPE_FLOAT32) continue;
			const view = new Float32Array(buffer.lock() as ArrayBuffer);
			for (let v = 0; v < vertices; v++) {
				for (let c = 0; c < element.numComponents; c++) view[(element.offset + v * element.stride) / 4 + c] = Math.sin(v * 7 + c) * 50;
			}
		}
		buffer.unlock();
		const mesh = new Mesh(device);
		mesh.vertexBuffer = buffer;
		return mesh;
	}

	function viaEngine(mesh: Mesh, semantic: string, ArrayType: new (length: number) => Float32Array | Uint8Array, length: number) {
		const out = new ArrayType(length);
		const count = mesh.getVertexStream(semantic, out);
		return { count, values: Array.from(out) };
	}

	for (const interleave of [true, false]) {
		it(`reads every attribute exactly as the engine does (${interleave ? "interleaved" : "separate"} streams)`, () => {
			const mesh = interleaved(97, interleave);
			for (const [semantic, ArrayType, components] of [
				[SEMANTIC_POSITION, Float32Array, 3],
				[SEMANTIC_NORMAL, Float32Array, 3],
				[SEMANTIC_COLOR, Uint8Array, 4],
				[SEMANTIC_TEXCOORD0, Float32Array, 2],
			] as const) {
				const expected = viaEngine(mesh, semantic, ArrayType, 97 * components);
				const out = new ArrayType(97 * components);
				expect(readVertexStream(mesh, semantic, out)).toBe(expected.count);
				expect(Array.from(out)).toEqual(expected.values);
			}
		});
	}

	it("fills only what a shorter target holds, as the engine does", () => {
		const mesh = interleaved(20);
		const expected = viaEngine(mesh, SEMANTIC_POSITION, Float32Array, 30);
		const out = new Float32Array(30);
		expect(readVertexStream(mesh, SEMANTIC_POSITION, out)).toBe(expected.count);
		expect(Array.from(out)).toEqual(expected.values);
	});

	it("reads meshes built in code (source streams already uploaded) the same way", () => {
		const mesh = triangle([1, 0, 0, 1]);
		for (const [semantic, components] of [[SEMANTIC_POSITION, 3], [SEMANTIC_NORMAL, 3], [SEMANTIC_TANGENT, 4]] as const) {
			const expected = viaEngine(mesh, semantic, Float32Array, 3 * components);
			const out = new Float32Array(3 * components);
			expect(readVertexStream(mesh, semantic, out)).toBe(expected.count);
			expect(Array.from(out)).toEqual(expected.values);
		}
	});

	it("leaves an attribute the mesh doesn't have to the engine", () => {
		const mesh = interleaved(4);
		expect(readVertexStream(mesh, SEMANTIC_TANGENT, new Float32Array(16))).toBe(0);
	});

	it("merges a loaded-model style mesh exactly as reading through the engine did", () => {
		const mesh = interleaved(60);
		const indices = new Uint16Array(60);
		for (let i = 0; i < 60; i++) indices[i] = (i * 7) % 60;
		mesh.indexBuffer[0] = new IndexBuffer(device, INDEXFORMAT_UINT16, 60, undefined, indices.buffer);
		mesh.primitive[0] = { type: PRIMITIVE_TRIANGLES, base: 0, baseVertex: 0, count: 60, indexed: true };
		const node = new GraphNode();
		node.setLocalPosition(3, -1, 2);
		node.setLocalEulerAngles(10, 40, -5);
		const merged = mergeGeometry([new MeshInstance(mesh, material, node)], new Mat4());
		const position = merged.streams.find((stream) => stream.semantic === SEMANTIC_POSITION)!;
		const raw = viaEngine(mesh, SEMANTIC_POSITION, Float32Array, 180).values;
		const world = node.getWorldTransform();
		for (let v = 0; v < 60; v++) {
			const p = world.transformPoint(new Vec3(raw[v * 3], raw[v * 3 + 1], raw[v * 3 + 2]));
			expect(position.data[v * 3]).toBeCloseTo(p.x, 4);
			expect(position.data[v * 3 + 1]).toBeCloseTo(p.y, 4);
			expect(position.data[v * 3 + 2]).toBeCloseTo(p.z, 4);
		}
		const colour = merged.streams.find((stream) => stream.semantic === SEMANTIC_COLOR)!;
		expect(Array.from(colour.data)).toEqual(viaEngine(mesh, SEMANTIC_COLOR, Uint8Array, 240).values);
	});
});
