import {
	Mat3,
	Mat4,
	Mesh,
	PRIMITIVE_TRIANGLES,
	SEMANTIC_NORMAL,
	SEMANTIC_POSITION,
	SEMANTIC_TANGENT,
	TYPE_FLOAT32,
	typedArrayIndexFormats,
	typedArrayTypes,
	type GraphicsDevice,
	type MeshInstance,
} from "playcanvas";

const relative = new Mat4();
const normalMatrix = new Mat3();

/** One vertex attribute of merged geometry, held on the CPU. */
export interface MergedStream {
	semantic: string;
	components: number;
	dataType: number;
	normalize: boolean;
	data: Float32Array;
}

/** Merged geometry before it becomes a GPU mesh: what LOD building works from. */
export interface MergedGeometry {
	streams: MergedStream[];
	indices: Uint32Array;
	vertexCount: number;
}

/** True if the instance's geometry can be baked into a merged mesh. */
export function isMergeable(instance: MeshInstance): boolean {
	const mesh = instance.mesh;
	const primitive = mesh?.primitive[0];
	if (!mesh?.vertexBuffer || !primitive || primitive.type !== PRIMITIVE_TRIANGLES || !primitive.indexed) return false;
	if (instance.skinInstance || instance.morphInstance) return false;
	// Positions and directions are transformed as floats; quantised streams would need decoding.
	for (const element of mesh.vertexBuffer.format.elements) {
		const directional = element.name === SEMANTIC_POSITION || element.name === SEMANTIC_NORMAL || element.name === SEMANTIC_TANGENT;
		if (directional && element.dataType !== TYPE_FLOAT32) return false;
	}
	return true;
}

/**
 * Bakes several mesh instances into one set of vertex streams, expressed in `frame`'s local
 * space (so a child of `frame` with an identity transform draws it exactly where the parts were).
 *
 * Every instance must share one vertex format (see `isMergeable` and group by
 * `format.batchingHash`). Mirrored parts have their winding flipped so they still face out.
 */
export function mergeGeometry(instances: readonly MeshInstance[], frameWorld: Mat4): MergedGeometry {
	const format = instances[0].mesh.vertexBuffer.format;
	let vertexCount = 0;
	let indexCount = 0;
	for (const instance of instances) {
		vertexCount += instance.mesh.vertexBuffer.numVertices;
		indexCount += instance.mesh.primitive[0].count;
	}

	const streams: MergedStream[] = format.elements.map((element) => {
		const ArrayType = typedArrayTypes[element.dataType] as unknown as new (length: number) => Float32Array;
		return {
			semantic: element.name,
			components: element.numComponents,
			dataType: element.dataType,
			normalize: element.normalize,
			data: new ArrayType(vertexCount * element.numComponents),
		};
	});
	const indices = new Uint32Array(indexCount);
	const toFrame = new Mat4().copy(frameWorld).invert();

	let vertexBase = 0;
	let indexOffset = 0;
	for (const instance of instances) {
		const mesh = instance.mesh;
		const count = mesh.vertexBuffer.numVertices;
		relative.mul2(toFrame, instance.node.getWorldTransform());
		normalMatrix.invertMat4(relative).transpose();
		const mirrored = determinant(relative) < 0;

		for (const stream of streams) {
			const target = stream.data.subarray(vertexBase * stream.components, (vertexBase + count) * stream.components);
			mesh.getVertexStream(stream.semantic, target);
			if (stream.semantic === SEMANTIC_POSITION) transformPoints(target, stream.components, relative);
			// Normals are covectors and go through the inverse-transpose; tangents lie in the surface
			// and move with it, so they take the transform itself.
			else if (stream.semantic === SEMANTIC_NORMAL) transformNormals(target, stream.components, normalMatrix);
			else if (stream.semantic === SEMANTIC_TANGENT) transformTangents(target, stream.components, relative, mirrored);
		}

		const primitive = mesh.primitive[0];
		const indexBuffer = mesh.indexBuffer[0];
		const source = new typedArrayIndexFormats[indexBuffer.getFormat()](indexBuffer.storage);
		const base = primitive.base;
		const baseVertex = primitive.baseVertex ?? 0;
		for (let i = 0; i < primitive.count; i += 3) {
			const a = source[base + i] + baseVertex + vertexBase;
			const b = source[base + i + 1] + baseVertex + vertexBase;
			const c = source[base + i + 2] + baseVertex + vertexBase;
			indices[indexOffset + i] = a;
			indices[indexOffset + i + 1] = mirrored ? c : b;
			indices[indexOffset + i + 2] = mirrored ? b : c;
		}
		indexOffset += primitive.count;
		vertexBase += count;
	}
	return { streams, indices, vertexCount };
}

/**
 * Uploads merged geometry as a mesh. The bounding box is computed from the positions: the
 * engine culls (and shadow-culls) against it, so a stale or default box makes the mesh vanish.
 */
export function buildMesh(device: GraphicsDevice, geometry: MergedGeometry): Mesh {
	const mesh = new Mesh(device);
	for (const stream of geometry.streams) {
		mesh.setVertexStream(stream.semantic, stream.data, stream.components, geometry.vertexCount, stream.dataType, stream.normalize);
	}
	mesh.setIndices(geometry.vertexCount > 65535 ? geometry.indices : new Uint16Array(geometry.indices));
	mesh.update(PRIMITIVE_TRIANGLES, true);
	return mesh;
}

/** Bakes several mesh instances into one mesh; see `mergeGeometry`. */
export function mergeMeshInstances(device: GraphicsDevice, instances: readonly MeshInstance[], frameWorld: Mat4): Mesh {
	return buildMesh(device, mergeGeometry(instances, frameWorld));
}

/**
 * A copy of `geometry` keeping only the vertices `indices` uses, renumbered. A simplified LOD
 * references a fraction of the original vertices; compacting stops it carrying the rest.
 */
export function compactGeometry(geometry: MergedGeometry, indices: Uint32Array): MergedGeometry {
	const remap = new Int32Array(geometry.vertexCount).fill(-1);
	let used = 0;
	const renumbered = new Uint32Array(indices.length);
	for (let i = 0; i < indices.length; i++) {
		const vertex = indices[i];
		if (remap[vertex] < 0) remap[vertex] = used++;
		renumbered[i] = remap[vertex];
	}
	const streams = geometry.streams.map((stream) => {
		const ArrayType = stream.data.constructor as new (length: number) => Float32Array;
		const data = new ArrayType(used * stream.components);
		for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
			const to = remap[vertex];
			if (to < 0) continue;
			for (let c = 0; c < stream.components; c++) data[to * stream.components + c] = stream.data[vertex * stream.components + c];
		}
		return { ...stream, data };
	});
	return { streams, indices: renumbered, vertexCount: used };
}

function determinant(m: Mat4): number {
	const d = m.data;
	return d[0] * (d[5] * d[10] - d[6] * d[9]) - d[4] * (d[1] * d[10] - d[2] * d[9]) + d[8] * (d[1] * d[6] - d[2] * d[5]);
}

function transformPoints(data: Float32Array, components: number, matrix: Mat4) {
	const m = matrix.data;
	for (let i = 0; i < data.length; i += components) {
		const x = data[i];
		const y = data[i + 1];
		const z = data[i + 2];
		data[i] = x * m[0] + y * m[4] + z * m[8] + m[12];
		data[i + 1] = x * m[1] + y * m[5] + z * m[9] + m[13];
		data[i + 2] = x * m[2] + y * m[6] + z * m[10] + m[14];
	}
}

/** Normals: rotated by the inverse-transpose and renormalised. */
function transformNormals(data: Float32Array, components: number, matrix: Mat3) {
	const m = matrix.data;
	for (let i = 0; i < data.length; i += components) {
		const x = data[i];
		const y = data[i + 1];
		const z = data[i + 2];
		const nx = x * m[0] + y * m[3] + z * m[6];
		const ny = x * m[1] + y * m[4] + z * m[7];
		const nz = x * m[2] + y * m[5] + z * m[8];
		const length = Math.hypot(nx, ny, nz) || 1;
		data[i] = nx / length;
		data[i + 1] = ny / length;
		data[i + 2] = nz / length;
	}
}

/**
 * Tangents: rotated by the transform's linear part and renormalised. A mirrored part also flips
 * the handedness in w, or its normal map's bitangent would point the wrong way.
 */
function transformTangents(data: Float32Array, components: number, matrix: Mat4, mirrored: boolean) {
	const m = matrix.data;
	for (let i = 0; i < data.length; i += components) {
		const x = data[i];
		const y = data[i + 1];
		const z = data[i + 2];
		const tx = x * m[0] + y * m[4] + z * m[8];
		const ty = x * m[1] + y * m[5] + z * m[9];
		const tz = x * m[2] + y * m[6] + z * m[10];
		const length = Math.hypot(tx, ty, tz) || 1;
		data[i] = tx / length;
		data[i + 1] = ty / length;
		data[i + 2] = tz / length;
		if (mirrored && components > 3) data[i + 3] = -data[i + 3];
	}
}
