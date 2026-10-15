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
