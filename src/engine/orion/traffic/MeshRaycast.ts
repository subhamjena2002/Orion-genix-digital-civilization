import { Mat4, Vec3, type Mesh, type MeshInstance } from "playcanvas";

/**
 * Rays against real geometry, for working out exactly what a round struck on a car: which pane
 * of glass, the paint or the tyre, at what point and facing which way. Only run for a round that
 * has already hit the car's box, and only over the parts that box test says it could reach, so
 * it's a few thousand triangle tests per hit rather than per frame.
 *
 * Triangle data is read back from a mesh once and kept (keyed by the mesh, which every car of a
 * model shares).
 */

export interface TriangleData {
	positions: Float32Array;
	indices: Uint32Array;
}

const cache = new WeakMap<Mesh, TriangleData>();

export function triangleData(mesh: Mesh): TriangleData | null {
	let data = cache.get(mesh);
	if (data) return data;
	const positions: number[] = [];
	const indices: number[] = [];
	mesh.getPositions(positions);
	mesh.getIndices(indices);
	if (positions.length === 0) return null;
	if (indices.length === 0) for (let i = 0; i < positions.length / 3; i++) indices.push(i);
	data = { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
	cache.set(mesh, data);
	return data;
}

/** Forgets a mesh's triangles (its vertices were moved: a dent). */
export function forgetTriangles(mesh: Mesh): void {
	cache.delete(mesh);
}

export interface TriangleHit {
	/** Distance along the ray, in the ray's own units. */
	t: number;
	/** Index of the triangle (its first index is indices[tri * 3]). */
	tri: number;
}

/**
 * Nearest triangle the ray (o + t·d, 0 ≤ t ≤ maxT) passes through, either face. `skip` marks
 * triangles to ignore (a broken pane's), by triangle index. Möller–Trumbore.
 */
export function rayTriangles(
	ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number,
	data: TriangleData, out: TriangleHit, skip: Uint8Array | null = null,
): boolean {
	const p = data.positions;
	const idx = data.indices;
	let best = maxT;
	let found = -1;
	for (let tri = 0, i = 0; i < idx.length; tri++, i += 3) {
		if (skip && skip[tri]) continue;
		const a = idx[i] * 3;
		const b = idx[i + 1] * 3;
		const c = idx[i + 2] * 3;
		const e1x = p[b] - p[a];
		const e1y = p[b + 1] - p[a + 1];
		const e1z = p[b + 2] - p[a + 2];
		const e2x = p[c] - p[a];
		const e2y = p[c + 1] - p[a + 1];
		const e2z = p[c + 2] - p[a + 2];
		const px = dy * e2z - dz * e2y;
		const py = dz * e2x - dx * e2z;
		const pz = dx * e2y - dy * e2x;
		const det = e1x * px + e1y * py + e1z * pz;
		if (det > -1e-12 && det < 1e-12) continue;
		const inv = 1 / det;
		const tx = ox - p[a];
		const ty = oy - p[a + 1];
		const tz = oz - p[a + 2];
		const u = (tx * px + ty * py + tz * pz) * inv;
		if (u < 0 || u > 1) continue;
		const qx = ty * e1z - tz * e1y;
		const qy = tz * e1x - tx * e1z;
		const qz = tx * e1y - ty * e1x;
		const v = (dx * qx + dy * qy + dz * qz) * inv;
		if (v < 0 || u + v > 1) continue;
		const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
		if (t < 0 || t >= best) continue;
		best = t;
		found = tri;
	}
	if (found < 0) return false;
	out.t = best;
	out.tri = found;
	return true;
}

/** The unit normal of triangle `tri`, in the mesh's own space. */
export function triangleNormal(data: TriangleData, tri: number, out: Vec3): Vec3 {
	const p = data.positions;
	const a = data.indices[tri * 3] * 3;
	const b = data.indices[tri * 3 + 1] * 3;
	const c = data.indices[tri * 3 + 2] * 3;
	const e1x = p[b] - p[a];
	const e1y = p[b + 1] - p[a + 1];
	const e1z = p[b + 2] - p[a + 2];
	const e2x = p[c] - p[a];
	const e2y = p[c + 1] - p[a + 1];
	const e2z = p[c + 2] - p[a + 2];
	return out.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x).normalize();
}

export interface InstanceHit {
	/** World distance along the (unit) world ray. */
	distance: number;
	tri: number;
	/** World normal, turned to face back along the ray. */
	nx: number;
	ny: number;
	nz: number;
}

const inverse = new Mat4();
const localOrigin = new Vec3();
const localDirection = new Vec3();
const scratch = new Vec3();
const triangleHit: TriangleHit = { t: 0, tri: 0 };

/**
 * A unit world-space ray against one mesh instance, where it is now. Returns false on a miss.
 * The local ray keeps the world ray's parameter, so `distance` is in world metres even with the
 * instance scaled.
 */
export function rayInstance(
	ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number,
	instance: MeshInstance, out: InstanceHit, skip: Uint8Array | null = null,
): boolean {
	const data = triangleData(instance.mesh);
	if (!data) return false;
	const world = instance.node.getWorldTransform();
	inverse.copy(world).invert();
	inverse.transformPoint(localOrigin.set(ox, oy, oz), localOrigin);
	inverse.transformVector(localDirection.set(dx, dy, dz), localDirection);
	if (!rayHitsBox(localOrigin, localDirection, maxDistance, instance.mesh)) return false;
	if (!rayTriangles(localOrigin.x, localOrigin.y, localOrigin.z, localDirection.x, localDirection.y, localDirection.z, maxDistance, data, triangleHit, skip)) return false;
	out.distance = triangleHit.t;
	out.tri = triangleHit.tri;
	triangleNormal(data, triangleHit.tri, scratch);
	// Normals go by the inverse transpose; for the rigid, uniformly scaled parts of a car the
	// plain transform is the same direction.
	world.transformVector(scratch, scratch).normalize();
	if (scratch.x * dx + scratch.y * dy + scratch.z * dz > 0) scratch.mulScalar(-1);
	out.nx = scratch.x;
	out.ny = scratch.y;
	out.nz = scratch.z;
	return true;
}

/** Slab test against the mesh's own bounds (a little padded). */
function rayHitsBox(origin: Vec3, direction: Vec3, maxT: number, mesh: Mesh): boolean {
	const { center, halfExtents } = mesh.aabb;
	let near = 0;
	let far = maxT;
	const o = [origin.x - center.x, origin.y - center.y, origin.z - center.z];
	const d = [direction.x, direction.y, direction.z];
	const h = [halfExtents.x + 0.01, halfExtents.y + 0.01, halfExtents.z + 0.01];
	for (let axis = 0; axis < 3; axis++) {
		if (Math.abs(d[axis]) < 1e-12) {
			if (Math.abs(o[axis]) > h[axis]) return false;
			continue;
		}
		let t0 = (-h[axis] - o[axis]) / d[axis];
		let t1 = (h[axis] - o[axis]) / d[axis];
		if (t0 > t1) [t0, t1] = [t1, t0];
		near = Math.max(near, t0);
		far = Math.min(far, t1);
		if (near > far) return false;
	}
	return true;
}

/**
 * Splits a mesh's triangles into connected patches (triangles sharing a vertex position): each
 * separate pane of glass in a part that holds several. Returns a patch number per triangle.
 */
export function connectedPatches(data: TriangleData): { patch: Uint16Array; count: number } {
	const vertexCount = data.positions.length / 3;
	// Vertices at the same place count as one (glass is split at seams for its normals).
	const key = new Map<string, number>();
	const weld = new Uint32Array(vertexCount);
	for (let v = 0; v < vertexCount; v++) {
		const p = data.positions;
		const k = `${Math.round(p[v * 3] * 1000)},${Math.round(p[v * 3 + 1] * 1000)},${Math.round(p[v * 3 + 2] * 1000)}`;
		let id = key.get(k);
		if (id === undefined) key.set(k, (id = key.size));
		weld[v] = id;
	}
	const parent = new Uint32Array(key.size);
	for (let i = 0; i < parent.length; i++) parent[i] = i;
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	const idx = data.indices;
	for (let i = 0; i < idx.length; i += 3) {
		const a = find(weld[idx[i]]);
		const b = find(weld[idx[i + 1]]);
		const c = find(weld[idx[i + 2]]);
		parent[b] = a;
		parent[find(c)] = a;
	}
	const ids = new Map<number, number>();
	const patch = new Uint16Array(idx.length / 3);
	for (let tri = 0; tri < patch.length; tri++) {
		const root = find(weld[idx[tri * 3]]);
		let id = ids.get(root);
		if (id === undefined) ids.set(root, (id = ids.size));
		patch[tri] = id;
	}
	return { patch, count: ids.size };
}
