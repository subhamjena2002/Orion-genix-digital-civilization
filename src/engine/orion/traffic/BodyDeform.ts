/**
 * Crumpling a car body: the vertex work behind dents and hanging panels, on plain arrays so it's
 * testable without a GPU (OrionVehicleModel owns the meshes and uploads the result).
 *
 * A dent pushes the skin in along the blow, most at the point of contact and fading to nothing at
 * its radius, with a little uneven "crumple" so it reads as bent metal rather than a smooth
 * dimple. Every vertex remembers where it started, and no vertex is ever pushed further than
 * `maxDisplacement` from there in total, so repeated hits in one place cave it in so far and no
 * further (a car never folds through itself).
 *
 * A sag drops the lowest band of the body at one end — the bumper and valance — down and out,
 * strongest at the very end and on the side that was hit, which is what a bumper torn off its
 * mountings on one side and hanging by the other looks like.
 */

export type Vec3 = readonly [number, number, number];

export interface Dent {
	/** Point of contact, in the mesh's own space. */
	point: Vec3;
	/** Unit direction the skin is pushed (into the body). */
	direction: Vec3;
	/** How far the centre goes in, in mesh units. */
	depth: number;
	/** Radius of the affected patch, in mesh units. */
	radius: number;
	/** 0..1: how uneven the crumple is. */
	crumple: number;
	/** Size of the folds the crumple makes, in mesh units (neighbouring vertices fold together). */
	wavelength: number;
	seed: number;
}

/**
 * Smooth noise in about -1..1 over space: crossed waves at a few angles and phases from the seed.
 * Smooth, so nearby vertices move together and the skin folds; per-vertex random offsets on a
 * detailed panel read as glitter, not bent metal.
 */
function folds(x: number, y: number, z: number, frequency: number, seed: number, channel: number): number {
	const a = seed * 0.37 + channel * 1.7;
	return (
		Math.sin(x * frequency + a) * Math.sin(y * frequency * 1.3 + a * 2.1)
		+ Math.sin(z * frequency * 0.9 + a * 3.3) * Math.sin((x + y) * frequency * 0.7 + a * 1.3)
	) * 0.5;
}

/** Keeps vertex `i` within `max` of where it started; returns whether it moved at all. */
function clampToRest(positions: Float32Array, rest: Float32Array, i: number, max: number): void {
	const o = i * 3;
	const dx = positions[o] - rest[o];
	const dy = positions[o + 1] - rest[o + 1];
	const dz = positions[o + 2] - rest[o + 2];
	const length = Math.hypot(dx, dy, dz);
	if (length <= max) return;
	const k = max / length;
	positions[o] = rest[o] + dx * k;
	positions[o + 1] = rest[o + 1] + dy * k;
	positions[o + 2] = rest[o + 2] + dz * k;
}

/** Pushes a dent in. Returns the indices of the vertices it moved. */
export function applyDent(positions: Float32Array, rest: Float32Array, dent: Dent, maxDisplacement: number): number[] {
	const moved: number[] = [];
	const [px, py, pz] = dent.point;
	const [dx, dy, dz] = dent.direction;
	const r2 = dent.radius * dent.radius;
	const frequency = (Math.PI * 2) / Math.max(1e-6, dent.wavelength);
	const count = positions.length / 3;
	for (let i = 0; i < count; i++) {
		const o = i * 3;
		const ox = positions[o] - px;
		const oy = positions[o + 1] - py;
		const oz = positions[o + 2] - pz;
		const d2 = ox * ox + oy * oy + oz * oz;
		if (d2 >= r2) continue;
		const t = 1 - Math.sqrt(d2) / dent.radius;
		// Smooth falloff (no crease at the rim), and the crumple: uneven depth, and a little
		// sideways buckling that grows towards the centre.
		const falloff = t * t * (3 - 2 * t);
		const x = rest[o];
		const y = rest[o + 1];
		const z = rest[o + 2];
		const wobble = 1 + folds(x, y, z, frequency, dent.seed, 0) * dent.crumple * 0.7;
		const push = dent.depth * falloff * wobble;
		const buckle = dent.depth * falloff * dent.crumple * 0.3;
		positions[o] += dx * push + folds(x, y, z, frequency, dent.seed, 1) * buckle;
		positions[o + 1] += dy * push + folds(x, y, z, frequency, dent.seed, 2) * buckle;
		positions[o + 2] += dz * push + folds(x, y, z, frequency, dent.seed, 3) * buckle;
		clampToRest(positions, rest, i, maxDisplacement);
		moved.push(i);
	}
	return moved;
}

export interface Sag {
	/** Unit axes of the body in mesh space. */
	forward: Vec3;
	up: Vec3;
	/** Which end: +1 the front, -1 the rear. */
	end: 1 | -1;
	/** Where along the body's width the hit was (mesh units along `side`), and that axis. */
	side: Vec3;
	hitAcross: number;
	/** How far the very end drops, in mesh units. */
	drop: number;
	/** How far back from the end the sag reaches, and how high from the bottom, in mesh units. */
	reach: number;
	band: number;
	/** The body's extent along `forward` and `up` (min, max), measured on the rest shape. */
	alongRange: readonly [number, number];
	upRange: readonly [number, number];
	acrossRange: readonly [number, number];
}

/** Drops the low band at one end. Returns the indices of the vertices it moved. */
export function applySag(positions: Float32Array, rest: Float32Array, sag: Sag, maxDisplacement: number): number[] {
	const moved: number[] = [];
	const count = positions.length / 3;
	const endAt = sag.end > 0 ? sag.alongRange[1] : sag.alongRange[0];
	const width = Math.max(1e-6, sag.acrossRange[1] - sag.acrossRange[0]);
	for (let i = 0; i < count; i++) {
		const o = i * 3;
		const x = rest[o];
		const y = rest[o + 1];
		const z = rest[o + 2];
		const along = x * sag.forward[0] + y * sag.forward[1] + z * sag.forward[2];
		const fromEnd = (endAt - along) * sag.end;
		if (fromEnd < 0 || fromEnd > sag.reach) continue;
		const height = x * sag.up[0] + y * sag.up[1] + z * sag.up[2] - sag.upRange[0];
		if (height > sag.band) continue;
		const across = x * sag.side[0] + y * sag.side[1] + z * sag.side[2];
		// Hangs lowest at the end and on the side that took the blow; the far side stays on.
		const atEnd = 1 - fromEnd / sag.reach;
		const onSide = 1 - Math.min(1, Math.abs(across - sag.hitAcross) / width);
		const k = atEnd * atEnd * (0.35 + 0.65 * onSide) * (1 - (height / sag.band) * 0.5);
		const drop = sag.drop * k;
		positions[o] += -sag.up[0] * drop + sag.forward[0] * sag.end * drop * 0.35;
		positions[o + 1] += -sag.up[1] * drop + sag.forward[1] * sag.end * drop * 0.35;
		positions[o + 2] += -sag.up[2] * drop + sag.forward[2] * sag.end * drop * 0.35;
		clampToRest(positions, rest, i, maxDisplacement);
		moved.push(i);
	}
	return moved;
}

/**
 * Rebuilds the normals of the vertices that moved, from the triangles they're part of (so the
 * dent catches the light). Vertices that didn't move keep their authored normals.
 */
export function refreshNormals(positions: Float32Array, normals: Float32Array, indices: ArrayLike<number>, moved: readonly number[]): void {
	if (moved.length === 0) return;
	const touched = new Uint8Array(positions.length / 3);
	for (const i of moved) touched[i] = 1;
	const sums = new Map<number, [number, number, number]>();
	for (const i of moved) sums.set(i, [0, 0, 0]);
	for (let t = 0; t < indices.length; t += 3) {
		const a = indices[t];
		const b = indices[t + 1];
		const c = indices[t + 2];
		if (!touched[a] && !touched[b] && !touched[c]) continue;
		const ax = positions[a * 3];
		const ay = positions[a * 3 + 1];
		const az = positions[a * 3 + 2];
		const e1x = positions[b * 3] - ax;
		const e1y = positions[b * 3 + 1] - ay;
		const e1z = positions[b * 3 + 2] - az;
		const e2x = positions[c * 3] - ax;
		const e2y = positions[c * 3 + 1] - ay;
		const e2z = positions[c * 3 + 2] - az;
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		for (const v of [a, b, c]) {
			const sum = sums.get(v);
			if (!sum) continue;
			sum[0] += nx;
			sum[1] += ny;
			sum[2] += nz;
		}
	}
	for (const [v, [x, y, z]] of sums) {
		const length = Math.hypot(x, y, z);
		if (length < 1e-12) continue;
		// Keep the authored side: a face wound the other way flips nothing here.
		const o = v * 3;
		const sign = x * normals[o] + y * normals[o + 1] + z * normals[o + 2] < 0 ? -1 : 1;
		normals[o] = (x / length) * sign;
		normals[o + 1] = (y / length) * sign;
		normals[o + 2] = (z / length) * sign;
	}
}
