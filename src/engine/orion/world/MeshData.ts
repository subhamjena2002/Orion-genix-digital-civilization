/**
 * Raw triangle geometry in world space, built by pure code (and testable without a GPU), then
 * turned into a PlayCanvas mesh by the component that shows it.
 */
export interface MeshData {
	positions: number[];
	normals: number[];
	uvs: number[];
	/** RGBA per vertex, 0–1; optional. */
	colors?: number[];
	indices: number[];
}

export function emptyMesh(withColors = false): MeshData {
	return withColors ? { positions: [], normals: [], uvs: [], colors: [], indices: [] } : { positions: [], normals: [], uvs: [], indices: [] };
}

export function vertexCount(mesh: MeshData): number {
	return mesh.positions.length / 3;
}

export function addVertex(mesh: MeshData, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
	const index = vertexCount(mesh);
	mesh.positions.push(x, y, z);
	mesh.normals.push(nx, ny, nz);
	mesh.uvs.push(u, v);
	return index;
}

/** A quad a-b-c-d (counter-clockwise seen from the side it faces) as two triangles. */
export function addQuad(mesh: MeshData, a: number, b: number, c: number, d: number): void {
	mesh.indices.push(a, b, c, a, c, d);
}

/** Recomputes smooth normals from the triangles (area-weighted). */
export function computeNormals(mesh: MeshData): void {
	const normals = new Array<number>(mesh.positions.length).fill(0);
	const p = mesh.positions;
	for (let i = 0; i < mesh.indices.length; i += 3) {
		const a = mesh.indices[i] * 3;
		const b = mesh.indices[i + 1] * 3;
		const c = mesh.indices[i + 2] * 3;
		const e1x = p[b] - p[a];
		const e1y = p[b + 1] - p[a + 1];
		const e1z = p[b + 2] - p[a + 2];
		const e2x = p[c] - p[a];
		const e2y = p[c + 1] - p[a + 1];
		const e2z = p[c + 2] - p[a + 2];
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		for (const vertex of [a, b, c]) {
			normals[vertex] += nx;
			normals[vertex + 1] += ny;
			normals[vertex + 2] += nz;
		}
	}
	for (let i = 0; i < normals.length; i += 3) {
		const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
		normals[i] /= length;
		normals[i + 1] /= length;
		normals[i + 2] /= length;
	}
	mesh.normals = normals;
}

export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
	const out = emptyMesh(meshes.some((mesh) => mesh.colors));
	for (const mesh of meshes) {
		const offset = vertexCount(out);
		// Element by element: spreading arrays this size into push() overflows the call stack.
		for (const value of mesh.positions) out.positions.push(value);
		for (const value of mesh.normals) out.normals.push(value);
		for (const value of mesh.uvs) out.uvs.push(value);
		if (out.colors) {
			if (mesh.colors) for (const value of mesh.colors) out.colors.push(value);
			else for (let i = 0; i < vertexCount(mesh) * 4; i++) out.colors.push(1);
		}
		for (const index of mesh.indices) out.indices.push(index + offset);
	}
	return out;
}
