import { SEMANTIC_NORMAL, VertexIterator, type Entity, type Mesh } from "playcanvas";

/** Meshes are shared by every instance of a container asset, so each is processed once. */
const smoothed = new WeakSet<Mesh>();

/** Positions closer than this are treated as the same point when welding normals. */
const WELD_PRECISION = 1e4;

/**
 * Converts flat-shaded meshes to smooth shading.
 *
 * The character packs are exported flat-shaded: every triangle has its own copies of its
 * vertices, each carrying that face's normal, which is what makes the models look faceted.
 * Averaging the normals of all vertices that share a position gives smooth lighting across
 * the surface without changing the geometry.
 *
 * Only the normal channel is rewritten, via a VertexIterator on the existing buffer. Going
 * through `mesh.setNormals()` instead would rebuild the buffer from geometry data that these
 * imported meshes don't keep, dropping positions and skin weights.
 */
export function applySmoothShading(root: Entity): void {
	const renders = root.findComponents("render") as unknown as { meshInstances: { mesh: Mesh }[] }[];
	for (const render of renders) {
		for (const { mesh } of render.meshInstances) {
			if (smoothed.has(mesh) || !mesh.vertexBuffer) continue;
			smoothed.add(mesh);
			smoothMesh(mesh);
		}
	}
}

function smoothMesh(mesh: Mesh) {
	const positions: number[] = [];
	const normals: number[] = [];
	const vertexCount = mesh.getPositions(positions);
	if (mesh.getNormals(normals) !== vertexCount || vertexCount === 0) return;

	const sums = new Map<string, [number, number, number]>();
	const keys: string[] = new Array(vertexCount);
	for (let i = 0; i < vertexCount; i++) {
		const key = `${Math.round(positions[i * 3] * WELD_PRECISION)},${Math.round(positions[i * 3 + 1] * WELD_PRECISION)},${Math.round(positions[i * 3 + 2] * WELD_PRECISION)}`;
		keys[i] = key;
		const sum = sums.get(key) ?? [0, 0, 0];
		sum[0] += normals[i * 3];
		sum[1] += normals[i * 3 + 1];
		sum[2] += normals[i * 3 + 2];
		sums.set(key, sum);
	}

	const iterator = new VertexIterator(mesh.vertexBuffer);
	for (let i = 0; i < vertexCount; i++) {
		const [x, y, z] = sums.get(keys[i])!;
		const length = Math.hypot(x, y, z) || 1;
		iterator.element[SEMANTIC_NORMAL].set(x / length, y / length, z / length);
		iterator.next();
	}
	iterator.end();
}
