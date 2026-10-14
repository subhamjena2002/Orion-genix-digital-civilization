import { deflateSync } from "node:zlib";

/**
 * The modelling kit the game's vehicles are built with (scripts/build-supercar.mjs,
 * scripts/build-vehicles.mjs): vector maths, a mesh builder, lofted skins, surface-following
 * details (ribbons, patches, small boxes, lamp bowls), panel thickening, and ambient occlusion
 * baked into vertex colours by tracing rays through a bounding volume hierarchy.
 *
 * Car space everywhere: metres, +Y up, nose towards +Z, +X the car's left.
 */

// ---- Smooth profiles ----------------------------------------------------------------------------

/** A smooth curve through (z, value) points (monotone cubic, so it never overshoots). */
export function profile(points) {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	const n = points.length;
	const d = [];
	for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
	const m = [d[0]];
	for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
	m.push(d[n - 2]);
	for (let i = 0; i < n - 1; i++) {
		if (d[i] === 0) {
			m[i] = 0;
			m[i + 1] = 0;
			continue;
		}
		const a = m[i] / d[i];
		const b = m[i + 1] / d[i];
		const s = a * a + b * b;
		if (s > 9) {
			const t = 3 / Math.sqrt(s);
			m[i] = t * a * d[i];
			m[i + 1] = t * b * d[i];
		}
	}
	return (x) => {
		if (x <= xs[0]) return ys[0];
		if (x >= xs[n - 1]) return ys[n - 1];
		let i = 0;
		while (x > xs[i + 1]) i++;
		const h = xs[i + 1] - xs[i];
		const t = (x - xs[i]) / h;
		const t2 = t * t;
		const t3 = t2 * t;
		return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
	};
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const smoothstep = (from, to, v) => {
	const t = clamp01((v - from) / (to - from));
	return t * t * (3 - 2 * t);
};

// ---- Geometry helpers -------------------------------------------------------------------------

export class Geo {
	positions = [];
	normals = [];
	indices = [];
	vertex(p, n) {
		this.positions.push(p[0], p[1], p[2]);
		const l = Math.hypot(n[0], n[1], n[2]) || 1;
		this.normals.push(n[0] / l, n[1] / l, n[2] / l);
		return this.positions.length / 3 - 1;
	}
	/** A triangle wound so it faces along `facing` (front faces counter-clockwise). */
	triangle(a, b, c, facing) {
		const P = this.positions;
		const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
		const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
		if (dot(cross(e1, e2), facing) >= 0) this.indices.push(a, b, c);
		else this.indices.push(a, c, b);
	}
	point(i) {
		return [this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]];
	}
	normal(i) {
		return [this.normals[i * 3], this.normals[i * 3 + 1], this.normals[i * 3 + 2]];
	}
	get empty() {
		return this.indices.length === 0;
	}
}

export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a) => scale(a, 1 / (Math.hypot(...a) || 1));
export const range = (from, to, steps) => Array.from({ length: steps + 1 }, (_, k) => from + ((to - from) * k) / steps);

/** Catmull-Rom point between b and c (a and d the neighbours), t in 0..1. */
export function catmull(a, b, c, d, t) {
	const t2 = t * t;
	const t3 = t2 * t;
	return b.map((_, k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3));
}

/**
 * A lofted skin: rings[j][i] of points, closed around i, `creases[i]` marking hard edges (the
 * normals on either side don't blend). `region(j, i)` says which part each quad belongs to, or
 * null for none.
 */
export function loft(rings, creases, region, parts, outwardOf) {
	const J = rings.length;
	const I = rings[0].length;
	const rawNormal = (j, i, side) => {
		const along = sub(rings[Math.min(J - 1, j + 1)][i], rings[Math.max(0, j - 1)][i]);
		const ring = rings[j];
		const before = ring[(i - 1 + I) % I];
		const after = ring[(i + 1) % I];
		const around = creases[i] ? (side < 0 ? sub(ring[i], before) : sub(after, ring[i])) : sub(after, before);
		return cross(around, along);
	};
	// The rings all run the same way round, so one orientation holds for the whole skin: decide
	// it once, by vote, rather than flipping each normal towards `outwardOf`. Per vertex, that
	// hint went wrong wherever it lay nearly along the surface (the rounded nose), turning
	// patches of triangles inside out - they showed as stair-stepped mirror patches on the paint.
	let vote = 0;
	for (let j = 0; j < J; j++) for (let i = 0; i < I; i++) vote += Math.sign(dot(rawNormal(j, i, 0), outwardOf(rings[j][i])));
	const orientation = vote < 0 ? -1 : 1;
	// Normals per vertex, and for a crease one each side of it.
	const normalOf = (j, i, side) => {
		let n = scale(rawNormal(j, i, side), orientation);
		if (Math.hypot(...n) < 1e-10) n = outwardOf(rings[j][i]);
		return norm(n);
	};
	const maps = new Map();
	for (let j = 0; j < J - 1; j++) {
		for (let i = 0; i < I; i++) {
			const name = region(j, i);
			if (!name) continue;
			const geo = parts.get(name);
			// Shared vertices are cached per call: a second loft into the same part is a separate skin.
			let map = maps.get(geo);
			if (!map) maps.set(geo, (map = new Map()));
			const index = (jj, ii, side) => {
				const s = creases[ii] ? side : 0;
				const key = (jj * I + ii) * 3 + s + 1;
				let v = map.get(key);
				if (v === undefined) {
					v = geo.vertex(rings[jj][ii], normalOf(jj, ii, s));
					map.set(key, v);
				}
				return v;
			};
			const i2 = (i + 1) % I;
			const pa = rings[j][i];
			const pb = rings[j + 1][i];
			const pc = rings[j + 1][i2];
			const pd = rings[j][i2];
			// Skip collapsed quads (the cabin's ends, where it sinks into the deck).
			if (Math.hypot(...sub(pa, pc)) < 1e-5 && Math.hypot(...sub(pb, pd)) < 1e-5) continue;
			// The quad lies after vertex i and before vertex i2 round the ring.
			const a = index(j, i, 1);
			const b = index(j + 1, i, 1);
			const c = index(j + 1, i2, -1);
			const d = index(j, i2, -1);
			const facing = add(add(geo.normal(a), geo.normal(c)), add(geo.normal(b), geo.normal(d)));
			geo.triangle(a, b, c, facing);
			geo.triangle(a, c, d, facing);
		}
	}
}

/** Rotation by yaw (about Y), pitch (about X) and roll (about Z), in degrees. */
export function rotation(yaw, pitch, roll) {
	const [cy, sy] = [Math.cos((yaw * Math.PI) / 180), Math.sin((yaw * Math.PI) / 180)];
	const [cp, sp] = [Math.cos((pitch * Math.PI) / 180), Math.sin((pitch * Math.PI) / 180)];
	const [cr, sr] = [Math.cos((roll * Math.PI) / 180), Math.sin((roll * Math.PI) / 180)];
	return (p) => {
		let [x, y, z] = p;
		[x, y] = [x * cr - y * sr, x * sr + y * cr];
		[y, z] = [y * cp - z * sp, y * sp + z * cp];
		[x, z] = [x * cy + z * sy, -x * sy + z * cy];
		return [x, y, z];
	};
}

/** A box, centred, sized, rotated by yaw, pitch and roll (degrees). */
export function box(geo, centre, size, yaw = 0, pitch = 0, roll = 0) {
	const [hx, hy, hz] = size.map((s) => s / 2);
	const rot = rotation(yaw, pitch, roll);
	const faces = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
	for (const [n, u, v] of faces) {
		const normal = rot(n);
		const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
			const local = [(n[0] + u[0] * su + v[0] * sv) * hx, (n[1] + u[1] * su + v[1] * sv) * hy, (n[2] + u[2] * su + v[2] * sv) * hz];
			return geo.vertex(add(centre, rot(local)), normal);
		});
		geo.triangle(ids[0], ids[1], ids[2], normal);
		geo.triangle(ids[0], ids[2], ids[3], normal);
	}
}

/**
 * A solid of revolution about the X axis (wheels): `outline` is [radius, x] points in order,
 * normals from the outline's slope (or `hard` to give each outline step its own flat normal).
 */
export function lathe(geo, outline, segments, centre = [0, 0, 0], hard = false) {
	const ringFor = (k, from, to) => {
		const [r, x] = outline[k];
		const dr = outline[to][0] - outline[from][0];
		const dx = outline[to][1] - outline[from][1];
		const ring = [];
		for (let s = 0; s <= segments; s++) {
			const a = (s / segments) * Math.PI * 2;
			const c = Math.cos(a);
			const sn = Math.sin(a);
			ring.push(geo.vertex([centre[0] + x, centre[1] + r * c, centre[2] + r * sn], [-dr, dx * c, dx * sn]));
		}
		return ring;
	};
	const strip = (ra, rb) => {
		for (let s = 0; s < segments; s++) {
			const a = ra[s];
			const b = rb[s];
			const c = rb[s + 1];
			const d = ra[s + 1];
			if (Math.hypot(...sub(geo.point(a), geo.point(c))) < 1e-7) continue;
			const facing = add(geo.normal(a), geo.normal(c));
			geo.triangle(a, b, c, facing);
			geo.triangle(a, c, d, facing);
		}
	};
	if (hard) {
		for (let k = 0; k < outline.length - 1; k++) strip(ringFor(k, k, k + 1), ringFor(k + 1, k, k + 1));
		return;
	}
	const rings = outline.map((_, k) => ringFor(k, Math.max(0, k - 1), Math.min(outline.length - 1, k + 1)));
	for (let k = 0; k < rings.length - 1; k++) strip(rings[k], rings[k + 1]);
}

/** A tube between two points, capped. */
export function tube(geo, from, to, radius, segments = 12, radiusTo = radius) {
	const axis = norm(sub(to, from));
	const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const u = norm(cross(axis, helper));
	const v = cross(axis, u);
	const ring = (centre, r) => Array.from({ length: segments }, (_, s) => {
		const a = (s / segments) * Math.PI * 2;
		const n = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
		return [add(centre, scale(n, r)), n];
	});
	const r0 = ring(from, radius).map(([p, n]) => geo.vertex(p, n));
	const r1 = ring(to, radiusTo).map(([p, n]) => geo.vertex(p, n));
	for (let s = 0; s < segments; s++) {
		const t = (s + 1) % segments;
		const facing = add(geo.normal(r0[s]), geo.normal(r1[t]));
		geo.triangle(r0[s], r1[s], r1[t], facing);
		geo.triangle(r0[s], r1[t], r0[t], facing);
	}
	for (const [centre, r, sign] of [[from, radius, -1], [to, radiusTo, 1]]) {
		const n = scale(axis, sign);
		const middle = geo.vertex(centre, n);
		const rim = ring(centre, r).map(([p]) => geo.vertex(p, n));
		for (let s = 0; s < segments; s++) geo.triangle(middle, rim[s], rim[(s + 1) % segments], n);
	}
}

/** Point and outward normal of a surface `at(u, v)`, flipped to agree with `hint`. */
export function sample(at, u, v, hint) {
	const e = 0.002;
	const p = at(u, v);
	let n = norm(cross(sub(at(u + e, v), at(u - e, v)), sub(at(u, v + e), at(u, v - e))));
	if (dot(n, hint) < 0) n = scale(n, -1);
	return { p, n };
}
/** A strip `width` wide laid along a path of surface samples, `lift` off the skin. */
export function ribbon(geo, path, width, lift, mirror = false) {
	const flip = (v) => (mirror ? [-v[0], v[1], v[2]] : v);
	const ids = path.map(({ p, n }, k) => {
		const tangent = norm(sub(path[Math.min(path.length - 1, k + 1)].p, path[Math.max(0, k - 1)].p));
		const across = norm(cross(n, tangent));
		const base = add(p, scale(n, lift));
		return [geo.vertex(flip(add(base, scale(across, width / 2))), flip(n)), geo.vertex(flip(add(base, scale(across, -width / 2))), flip(n))];
	});
	for (let k = 0; k < ids.length - 1; k++) {
		const facing = flip(path[k].n);
		geo.triangle(ids[k][0], ids[k + 1][0], ids[k + 1][1], facing);
		geo.triangle(ids[k][0], ids[k + 1][1], ids[k][1], facing);
	}
}

/** A wall standing `depth` into the body from a path on its skin: door jambs, lid wells. */
export function wall(geo, path, depth, mirror = false) {
	const flip = (v) => (mirror ? [-v[0], v[1], v[2]] : v);
	const ids = path.map(({ p, n }) => [geo.vertex(flip(p), flip(n)), geo.vertex(flip(sub(p, scale(n, depth))), flip(n))]);
	for (let k = 0; k < ids.length - 1; k++) {
		const across = norm(cross(path[k].n, sub(path[k + 1].p, path[k].p)));
		const facing = flip(across);
		geo.triangle(ids[k][0], ids[k + 1][0], ids[k + 1][1], facing);
		geo.triangle(ids[k][0], ids[k + 1][1], ids[k][1], facing);
	}
}

/** A patch of surface between rows of samples, `lift` off the skin (a vent or an intake). */
export function patch(geo, rows, lift, mirror = false) {
	const flip = (v) => (mirror ? [-v[0], v[1], v[2]] : v);
	const ids = rows.map((row) => row.map(({ p, n }) => geo.vertex(flip(add(p, scale(n, lift))), flip(n))));
	for (let r = 0; r < rows.length - 1; r++) {
		for (let c = 0; c < rows[r].length - 1; c++) {
			const facing = flip(rows[r][c].n);
			geo.triangle(ids[r][c], ids[r + 1][c], ids[r + 1][c + 1], facing);
			geo.triangle(ids[r][c], ids[r + 1][c + 1], ids[r][c + 1], facing);
		}
	}
}

/**
 * A small box sitting on the skin: `u` its length direction, `n` the skin's normal (its height
 * direction), tilted `tilt` degrees about `u` - vent fins, intake slats, badges.
 */
export function skinBox(geo, centre, u, n, size, tilt = 0, mirror = false) {
	const flip = (v) => (mirror ? [-v[0], v[1], v[2]] : v);
	const along = norm(sub(u, scale(n, dot(u, n))));
	const v0 = norm(cross(n, along));
	const c = Math.cos((tilt * Math.PI) / 180);
	const sn = Math.sin((tilt * Math.PI) / 180);
	const axes = [along, add(scale(v0, c), scale(n, sn)), add(scale(n, c), scale(v0, -sn))];
	const half = size.map((x) => x / 2);
	for (let a = 0; a < 3; a++) {
		for (const sign of [-1, 1]) {
			const normal = scale(axes[a], sign);
			const b = (a + 1) % 3;
			const d = (a + 2) % 3;
			const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sb, sd]) => {
				const p = add(add(add(centre, scale(axes[a], sign * half[a])), scale(axes[b], sb * half[b])), scale(axes[d], sd * half[d]));
				return geo.vertex(flip(p), flip(normal));
			});
			geo.triangle(ids[0], ids[1], ids[2], flip(normal));
			geo.triangle(ids[0], ids[2], ids[3], flip(normal));
		}
	}
}

/**
 * A wing mirror: a rounded shell bulging forward from a flat back, the glass set into the back.
 * `half` is its half-size (across, up, front-to-back), turned `yaw` degrees.
 */
export function mirrorPod(shell, glass, centre, half, yaw) {
	const turn = rotation(yaw, 0, 0);
	const [hx, hy, hz] = half;
	// Ends rounded off (a superellipse along its length), the shell's depth easing to the rim.
	const at = (v, a) => {
		const f = Math.cbrt(Math.max(0, 1 - Math.abs(v) ** 3));
		return [hx * v, hy * f * Math.sin(a), hz * f * Math.cos(a)];
	};
	const place = (q) => add(centre, turn(q));
	const rows = 14;
	const cols = 12;
	const grid = [];
	for (let r = 0; r <= rows; r++) {
		const v = -1 + (2 * r) / rows;
		const row = [];
		for (let c = 0; c <= cols; c++) {
			const a = -Math.PI / 2 + (Math.PI * c) / cols;
			const e = 0.01;
			let n = cross(sub(at(v, a + e), at(v, a - e)), sub(at(Math.min(1, v + e), a), at(Math.max(-1, v - e), a)));
			const q = at(v, a);
			if (dot(n, q) < 0) n = scale(n, -1);
			if (Math.hypot(...n) < 1e-9) n = [Math.sign(v), 0, 0];
			row.push(shell.vertex(place(q), turn(norm(n))));
		}
		grid.push(row);
	}
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const facing = add(shell.normal(grid[r][c]), shell.normal(grid[r + 1][c + 1]));
			shell.triangle(grid[r][c], grid[r + 1][c], grid[r + 1][c + 1], facing);
			shell.triangle(grid[r][c], grid[r + 1][c + 1], grid[r][c + 1], facing);
		}
	}
	// The back: a black bezel the full size of the rim, the glass a little inside it.
	const back = turn([0, 0, -1]);
	const disc = (geo, inset, offset) => {
		const middle = geo.vertex(place([0, 0, -offset]), back);
		const rim = [];
		for (let k = 0; k < 40; k++) {
			const a = (k / 40) * Math.PI * 2;
			const v = Math.cos(a);
			const f = Math.cbrt(Math.max(0, 1 - Math.abs(v) ** 3));
			rim.push(geo.vertex(place([hx * v * inset, hy * f * Math.sin(a) * inset, -offset]), back));
		}
		for (let k = 0; k < 40; k++) geo.triangle(middle, rim[k], rim[(k + 1) % 40], back);
	};
	disc(shell, 1, 0);
	disc(glass, 0.86, 0.002);
}

/** A shallow dish (a lamp's reflector bowl) at `base`, opening along `out`. */
export function bowl(geo, base, out, radius) {
	const helper = Math.abs(out[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const u = norm(cross(helper, out));
	const v = cross(out, u);
	const rings = [[radius, 0.009], [radius * 0.85, 0.004], [radius * 0.5, 0.001], [0.0001, 0]];
	const segments = 18;
	const ids = rings.map(([r, h]) => Array.from({ length: segments }, (_, k) => {
		const a = (k / segments) * Math.PI * 2;
		const radial = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
		const p = add(add(base, scale(radial, r)), scale(out, h));
		return geo.vertex(p, norm(add(out, scale(radial, -0.6))));
	}));
	for (let k = 0; k < rings.length - 1; k++) {
		for (let j = 0; j < segments; j++) {
			const j2 = (j + 1) % segments;
			geo.triangle(ids[k][j], ids[k + 1][j], ids[k + 1][j2], out);
			geo.triangle(ids[k][j], ids[k + 1][j2], ids[k][j2], out);
		}
	}
}

/** A full ring from a right half: down the right side, back up the left. */
export function ring(half, z) {
	const right = half.map(({ x, y }) => [x, y, z]);
	const left = half.slice(1, -1).reverse().map(({ x, y }) => [-x, y, z]);
	const creases = [...half.map((p) => p.crease), ...half.slice(1, -1).reverse().map((p) => p.crease)];
	return { points: [...right, ...left], creases };
}

/**
 * Gives a moving panel a back and an edge: an inner skin `thickness` behind it (into `inner`)
 * and a strip round every open edge joining the two (into the panel itself).
 */
export function thicken(geo, inner, thickness) {
	const count = geo.positions.length / 3;
	const twin = [];
	for (let v = 0; v < count; v++) twin.push(inner.vertex(sub(geo.point(v), scale(geo.normal(v), thickness)), scale(geo.normal(v), -1)));
	const triangles = geo.indices.length / 3;
	const edges = new Map();
	for (let f = 0; f < triangles; f++) {
		const [a, b, c] = geo.indices.slice(f * 3, f * 3 + 3);
		inner.indices.push(twin[a], twin[c], twin[b]);
		for (const [p, q] of [[a, b], [b, c], [c, a]]) {
			const key = Math.min(p, q) * count + Math.max(p, q);
			edges.set(key, edges.has(key) ? null : [p, q]);
		}
	}
	// Vertices on either side of a crease are separate, so match the boundary by position too.
	const at = (v) => geo.point(v).map((c) => Math.round(c * 1e5)).join(",");
	const seen = new Map();
	for (const edge of edges.values()) {
		if (!edge) continue;
		const key = [at(edge[0]), at(edge[1])].sort().join("|");
		seen.set(key, seen.has(key) ? null : edge);
	}
	for (const edge of seen.values()) {
		if (!edge) continue;
		const [p, q] = edge;
		const n = norm(add(geo.normal(p), geo.normal(q)));
		const out = norm(cross(sub(geo.point(q), geo.point(p)), n));
		const ids = [p, q, twin[q], twin[p]].map((v, k) => geo.vertex(k < 2 ? geo.point(v) : inner.point(v), out));
		geo.triangle(ids[0], ids[1], ids[2], out);
		geo.triangle(ids[0], ids[2], ids[3], out);
	}
}

// ---- Baked light ----------------------------------------------------------------------------------

/**
 * Ambient occlusion, baked into each vertex's colour: how much of the sky a point on the car can
 * see. Panel gaps, the insides of wheel arches and intakes, the sills near the ground and the
 * cabin under its roof come out darker, the way the eye expects a real object to - the biggest
 * single difference between a car that looks real and one that looks like a smooth toy.
 *
 * Rays are traced exactly against the car's triangles (through a bounding volume hierarchy) and
 * the ground: from every vertex a fixed fan over its hemisphere, closer hits counting more. A
 * voxel grid was tried first and its cells showed through as stair-steps on the paint. Glass
 * doesn't block light.
 */
export const AO_RAYS = 32;
export const AO_REACH = 0.55;
export const AO_STRENGTH = 0.85;
/** Start this far off the surface, so a ray can't hit the face it leaves from. */
export const AO_BIAS = 0.0015;
export const BVH_LEAF = 4;

/** Triangles of `geos` in a bounding volume hierarchy, for nearest-hit ray queries. */
export function buildBvh(geos) {
	const total = geos.reduce((n, geo) => n + geo.indices.length / 3, 0);
	const tri = new Float32Array(total * 9);
	// Vertex normals alongside, so a hit can report the smooth surface normal (see projector).
	const nrm = new Float32Array(total * 9);
	let f = 0;
	for (const geo of geos) {
		for (let k = 0; k < geo.indices.length; k++, f++) {
			const v = geo.indices[k] * 3;
			for (let a = 0; a < 3; a++) {
				tri[f * 3 + a] = geo.positions[v + a];
				nrm[f * 3 + a] = geo.normals[v + a];
			}
		}
	}
	const order = Int32Array.from({ length: total }, (_, k) => k);
	const centre = new Float32Array(total * 3);
	for (let t = 0; t < total; t++) {
		for (let a = 0; a < 3; a++) centre[t * 3 + a] = (tri[t * 9 + a] + tri[t * 9 + 3 + a] + tri[t * 9 + 6 + a]) / 3;
	}
	const bounds = [];
	const child = [];
	const span = [];
	const build = (from, to) => {
		const node = span.length / 2;
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (let k = from; k < to; k++) {
			for (let c = 0; c < 9; c++) {
				const x = tri[order[k] * 9 + c];
				lo[c % 3] = Math.min(lo[c % 3], x);
				hi[c % 3] = Math.max(hi[c % 3], x);
			}
		}
		bounds.push(...lo, ...hi);
		span.push(from, to - from);
		child.push(-1);
		if (to - from <= BVH_LEAF) return node;
		const extent = [0, 1, 2].map((a) => hi[a] - lo[a]);
		const axis = extent.indexOf(Math.max(...extent));
		const slice = Array.from(order.subarray(from, to)).sort((a, b) => centre[a * 3 + axis] - centre[b * 3 + axis]);
		order.set(slice, from);
		const middle = (from + to) >> 1;
		build(from, middle);
		child[node] = build(middle, to);
		span[node * 2 + 1] = 0;
		return node;
	};
	build(0, total);
	return { tri, nrm, order, bounds: Float32Array.from(bounds), child: Int32Array.from(child), span: Int32Array.from(span) };
}

/**
 * Distance to the nearest triangle along the ray, or Infinity within `reach`. With `out`, the
 * hit triangle and its barycentric (u, v) are written into it.
 */
export function traceBvh(bvh, o, d, reach, out) {
	const { tri, order, bounds, child, span } = bvh;
	const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
	const stack = [0];
	let best = reach;
	while (stack.length) {
		const node = stack.pop();
		let near = 0;
		let far = best;
		for (let a = 0; a < 3; a++) {
			let t0 = (bounds[node * 6 + a] - o[a]) * inv[a];
			let t1 = (bounds[node * 6 + 3 + a] - o[a]) * inv[a];
			if (t0 > t1) [t0, t1] = [t1, t0];
			near = Math.max(near, t0);
			far = Math.min(far, t1);
		}
		if (near > far) continue;
		const count = span[node * 2 + 1];
		if (count === 0) {
			stack.push(node + 1, child[node]);
			continue;
		}
		for (let k = span[node * 2]; k < span[node * 2] + count; k++) {
			const b = order[k] * 9;
			const e1 = [tri[b + 3] - tri[b], tri[b + 4] - tri[b + 1], tri[b + 5] - tri[b + 2]];
			const e2 = [tri[b + 6] - tri[b], tri[b + 7] - tri[b + 1], tri[b + 8] - tri[b + 2]];
			const q = cross(d, e2);
			const det = dot(e1, q);
			if (Math.abs(det) < 1e-12) continue;
			const s = [o[0] - tri[b], o[1] - tri[b + 1], o[2] - tri[b + 2]];
			const u = dot(s, q) / det;
			if (u < 0 || u > 1) continue;
			const r = cross(s, e1);
			const v = dot(d, r) / det;
			if (v < 0 || u + v > 1) continue;
			const t = dot(e2, r) / det;
			if (t > 0 && t < best) {
				best = t;
				if (out) {
					out.tri = order[k];
					out.u = u;
					out.v = v;
				}
			}
		}
	}
	return best < reach ? best : Infinity;
}

export function bakeOcclusion(targets, occluders, { ground = true, reach = AO_REACH, strength = AO_STRENGTH } = {}) {
	const bvh = buildBvh(occluders);
	// A fixed fan of directions over the hemisphere about +Z, cosine-weighted (golden spiral).
	const fan = Array.from({ length: AO_RAYS }, (_, k) => {
		const t = (k + 0.5) / AO_RAYS;
		const r = Math.sqrt(t);
		const a = k * 2.399963;
		return [r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - t)];
	});
	for (const geo of targets) {
		const count = geo.positions.length / 3;
		const colours = new Uint8Array(count * 4);
		for (let v = 0; v < count; v++) {
			const p = geo.point(v);
			const n = geo.normal(v);
			const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
			const tu = norm(cross(helper, n));
			const tv = cross(n, tu);
			const start = add(p, scale(n, AO_BIAS));
			let blocked = 0;
			for (const [x, y, z] of fan) {
				const d = add(add(scale(tu, x), scale(tv, y)), scale(n, z));
				let hit = traceBvh(bvh, start, d, reach);
				if (ground && d[1] < 0) hit = Math.min(hit, start[1] / -d[1]);
				if (hit < reach) blocked += 1 - (hit / reach) ** 2;
			}
			const light = Math.max(0.18, 1 - strength * (blocked / AO_RAYS));
			const value = Math.round(light * 255);
			colours.set([value, value, value, 255], v * 4);
		}
		geo.colours = colours;
	}
}


// ---- Placing details on a finished surface ------------------------------------------------------

/**
 * Casts rays at the given geometry: `at(origin, direction)` is the first point hit, with the
 * smooth (interpolated) surface normal turned to face back along the ray, or null on a miss.
 * Lamps, grilles, stripes and handles are laid on a body this way, wherever its skin really is.
 */
export function projector(geos, reach = 10) {
	const bvh = buildBvh(geos);
	const out = { tri: -1, u: 0, v: 0 };
	return (origin, direction) => {
		const d = norm(direction);
		const t = traceBvh(bvh, origin, d, reach, out);
		if (!Number.isFinite(t)) return null;
		const b = out.tri * 9;
		const w = 1 - out.u - out.v;
		let n = [0, 1, 2].map((a) => bvh.nrm[b + a] * w + bvh.nrm[b + 3 + a] * out.u + bvh.nrm[b + 6 + a] * out.v);
		n = norm(n);
		if (dot(n, d) > 0) n = scale(n, -1);
		return { p: add(origin, scale(d, t)), n };
	};
}

/**
 * A grid of surface samples for `patch`/`ribbon`: `point(u, v)` gives a point in space off the
 * body (u, v from 0 to 1), each projected along `direction` onto it. Rows that miss are dropped.
 */
export function projectGrid(at, point, direction, rows, cols) {
	const grid = [];
	for (let r = 0; r <= rows; r++) {
		const row = [];
		for (let c = 0; c <= cols; c++) {
			const hit = at(point(r / rows, c / cols), direction);
			if (!hit) break;
			row.push(hit);
		}
		if (row.length === cols + 1) grid.push(row);
	}
	return grid;
}

// ---- Rounded solids ------------------------------------------------------------------------------

/**
 * A box with its edges and corners rounded to `radius`, smooth-shaded: seats, cargo boxes,
 * bumpers, lamp pods. Built face by face on a grid that bunches into the rounded edges, the flat
 * middle divided every `step` metres.
 */
export function roundedBox(geo, centre, size, radius, { segments, yaw = 0, pitch = 0, roll = 0, step = 0.6 } = {}) {
	const half = size.map((v) => v / 2);
	const r = Math.min(radius, ...half.map((h) => h * 0.999));
	// Small radii don't need many steps round the edge: a lamp lens or a slat reads the same.
	segments ??= r <= 0.012 ? 1 : r <= 0.035 ? 2 : 3;
	const inner = half.map((h) => h - r);
	const turn = rotation(yaw, pitch, roll);
	// Coordinates along one axis: the flat face, then the rounding, end to end.
	const axis = (a) => {
		const list = [];
		for (let k = segments; k >= 1; k--) list.push(-inner[a] - r * Math.sin((k / segments) * Math.PI / 2));
		// The flat part in steps of at most `step`, so baked light has vertices to vary across it.
		const flat = Math.max(1, Math.ceil((2 * inner[a]) / step));
		for (let k = 0; k <= flat; k++) list.push(-inner[a] + (2 * inner[a] * k) / flat);
		for (let k = 1; k <= segments; k++) list.push(inner[a] + r * Math.sin((k / segments) * Math.PI / 2));
		return list;
	};
	for (let a = 0; a < 3; a++) {
		for (const sign of [-1, 1]) {
			const b = (a + 1) % 3;
			const c = (a + 2) % 3;
			const us = axis(b);
			const vs = axis(c);
			const ids = us.map((u) => vs.map((v) => {
				const q = [0, 0, 0];
				q[a] = sign * half[a];
				q[b] = u;
				q[c] = v;
				// Onto the rounded surface: nearest point of the inner box, out by the radius.
				const clamp = q.map((x, k) => Math.max(-inner[k], Math.min(inner[k], x)));
				let n = sub(q, clamp);
				if (Math.hypot(...n) < 1e-9) n = [0, 0, 0].map((_, k) => (k === a ? sign : 0));
				n = norm(n);
				const p = add(clamp, scale(n, r));
				return geo.vertex(add(centre, turn(p)), turn(n));
			}));
			for (let i = 0; i < us.length - 1; i++) {
				for (let j = 0; j < vs.length - 1; j++) {
					const facing = add(geo.normal(ids[i][j]), geo.normal(ids[i + 1][j + 1]));
					if (Math.hypot(...sub(geo.point(ids[i][j]), geo.point(ids[i + 1][j + 1]))) < 1e-7) continue;
					geo.triangle(ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], facing);
					geo.triangle(ids[i][j], ids[i + 1][j + 1], ids[i][j + 1], facing);
				}
			}
		}
	}
}

// ---- Writing a vehicle --------------------------------------------------------------------------

/** Several geometries as one, vertex colours (white where a part has none) carried over. */
export function mergeGeos(geos) {
	if (geos.length === 1) return geos[0];
	const merged = new Geo();
	const colours = [];
	const uvs = [];
	for (const geo of geos) {
		const base = merged.positions.length / 3;
		const count = geo.positions.length / 3;
		merged.positions.push(...geo.positions);
		merged.normals.push(...geo.normals);
		for (const i of geo.indices) merged.indices.push(i + base);
		colours.push(geo.colours ?? new Uint8Array(count * 4).fill(255));
		uvs.push(geo.uvs ?? new Uint8Array(count * 2));
	}
	const join = (arrays, size) => {
		const out = new Uint8Array((merged.positions.length / 3) * size);
		let offset = 0;
		for (const a of arrays) {
			out.set(a, offset);
			offset += a.length;
		}
		return out;
	};
	merged.colours = join(colours, 4);
	if (geos.some((geo) => geo.uvs)) merged.uvs = join(uvs, 2);
	return merged;
}

/** Bounds centre of a geometry: a moving part's node sits there, so it turns about itself. */
export function centreOf(geo) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let k = 0; k < geo.positions.length; k += 3) {
		for (let a = 0; a < 3; a++) {
			min[a] = Math.min(min[a], geo.positions[k + a]);
			max[a] = Math.max(max[a], geo.positions[k + a]);
		}
	}
	return min.map((m, a) => (m + max[a]) / 2);
}

/**
 * A glTF document for one vehicle. `material()` makes a PBR material; `write()` turns the parts
 * into nodes — parts sharing a node name share the node, moving parts get their own origin at
 * their centre (so they turn about themselves) — adds the wheels, and writes the GLB.
 */
export function vehicleDocument(name, Document) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene(name);
	const root = doc.createNode(name);
	scene.addChild(root);
	const material = (materialName, base, { metallic = 0, roughness = 0.5, emissive, alpha, doubleSided = false } = {}) => {
		const m = doc.createMaterial(materialName).setBaseColorFactor([...base, alpha ?? 1]).setMetallicFactor(metallic).setRoughnessFactor(roughness).setDoubleSided(doubleSided);
		if (emissive) m.setEmissiveFactor(emissive);
		if (alpha !== undefined) m.setAlphaMode("BLEND");
		return m;
	};
	const primitive = (geo, mat, origin = [0, 0, 0]) => {
		const positions = new Float32Array(geo.positions.length);
		for (let k = 0; k < geo.positions.length; k += 3) {
			positions[k] = geo.positions[k] - origin[0];
			positions[k + 1] = geo.positions[k + 1] - origin[1];
			positions[k + 2] = geo.positions[k + 2] - origin[2];
		}
		const count = geo.positions.length / 3;
		const colours = geo.colours ?? new Uint8Array(count * 4).fill(255);
		const prim = doc.createPrimitive()
			.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer))
			.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.normals)).setBuffer(buffer))
			.setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(colours).setNormalized(true).setBuffer(buffer))
			.setIndices(doc.createAccessor().setType("SCALAR").setArray(count > 65535 ? new Uint32Array(geo.indices) : new Uint16Array(geo.indices)).setBuffer(buffer))
			.setMaterial(mat);
		// Texture coordinates only where a part picks a texel out of a palette (see paletteTexture).
		if (geo.uvs) prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(geo.uvs).setNormalized(true).setBuffer(buffer));
		return prim;
	};
	/**
	 * `table`: part key → [node name, material, parent part key?]. `moving`: node names that turn
	 * or swing on their own. `wheels`: [{ name, primitives: [[geo, material]], translation,
	 * rotation, mesh? }] — wheels naming the same `mesh` share it.
	 */
	const write = async (target, parts, table, { moving, wheels = [] }, NodeIO, writeFile) => {
		const nodes = new Map();
		const nodeOrigin = new Map();
		// Parts that share a node and a material become one primitive: one draw, not several.
		const groups = new Map();
		for (const [key, [nodeName, mat, parentPart]] of Object.entries(table)) {
			const geo = parts.get(key);
			if (!geo || geo.empty) continue;
			let node = nodes.get(nodeName);
			if (!node) {
				node = doc.createNode(nodeName).setMesh(doc.createMesh(nodeName));
				const origin = moving.test(nodeName) ? centreOf(geo) : [0, 0, 0];
				nodeOrigin.set(nodeName, origin);
				const parent = parentPart ? nodes.get(table[parentPart][0]) : null;
				const parentOrigin = parentPart ? nodeOrigin.get(table[parentPart][0]) : [0, 0, 0];
				node.setTranslation(sub(origin, parentOrigin));
				(parent ?? root).addChild(node);
				nodes.set(nodeName, node);
			}
			const groupKey = `${nodeName}|${mat.getName()}`;
			if (!groups.has(groupKey)) groups.set(groupKey, { node, nodeName, mat, geos: [] });
			groups.get(groupKey).geos.push(geo);
		}
		for (const { node, nodeName, mat, geos } of groups.values()) node.getMesh().addPrimitive(primitive(mergeGeos(geos), mat, nodeOrigin.get(nodeName)));
		const meshes = new Map();
		for (const wheel of wheels) {
			let mesh = wheel.mesh ? meshes.get(wheel.mesh) : null;
			if (!mesh) {
				mesh = doc.createMesh(wheel.mesh ?? wheel.name);
				const byMaterial = new Map();
				for (const [geo, mat] of wheel.primitives) {
					if (geo.empty) continue;
					if (!byMaterial.has(mat)) byMaterial.set(mat, []);
					byMaterial.get(mat).push(geo);
				}
				for (const [mat, geos] of byMaterial) mesh.addPrimitive(primitive(mergeGeos(geos), mat));
				if (wheel.mesh) meshes.set(wheel.mesh, mesh);
			}
			root.addChild(doc.createNode(wheel.name).setMesh(mesh).setTranslation(wheel.translation).setRotation(wheel.rotation ?? [0, 0, 0, 1]));
		}
		// Materials no primitive uses (replaced by shared ones) stay out of the file.
		for (const m of doc.getRoot().listMaterials()) if (!m.listParents().some((parent) => parent !== doc.getRoot())) m.dispose();
		const glb = await new NodeIO().writeBinary(doc);
		await writeFile(target, glb);
		let vertices = 0;
		let triangles = 0;
		for (const mesh of doc.getRoot().listMeshes()) {
			for (const p of mesh.listPrimitives()) {
				vertices += p.getAttribute("POSITION").getCount();
				triangles += p.getIndices().getCount() / 3;
			}
		}
		return { bytes: glb.byteLength, vertices, triangles, nodes: doc.getRoot().listNodes().length };
	};
	/**
	 * A tiny palette texture, `pixels` RGBA bytes `width` × 1, sampled nearest (never blended
	 * between texels).
	 */
	const paletteTexture = (name, width, pixels) => doc.createTexture(name).setMimeType("image/png").setImage(png(width, 1, pixels));
	return { doc, material, write, paletteTexture };
}

// ---- A minimal PNG writer -------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes) {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** An RGBA PNG from raw pixels: enough for palettes, no dependency. */
export function png(width, height, pixels) {
	const chunk = (type, data) => {
		const head = new Uint8Array(8);
		new DataView(head.buffer).setUint32(0, data.length);
		head.set([...type].map((ch) => ch.charCodeAt(0)), 4);
		const crc = new Uint8Array(4);
		new DataView(crc.buffer).setUint32(0, crc32([...head.slice(4), ...data]));
		return [...head, ...data, ...crc];
	};
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8);
	const rows = [];
	for (let y = 0; y < height; y++) rows.push(0, ...pixels.slice(y * width * 4, (y + 1) * width * 4));
	const data = deflateSync(Uint8Array.from(rows));
	return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", header), ...chunk("IDAT", data), ...chunk("IEND", new Uint8Array(0))]);
}
