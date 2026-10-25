/**
 * The shape of a flat tyre, as geometry. A wheel model is one mesh, rim and tyre together, so the
 * tyre is first told apart from the rim by how far out from the axle it is (the tyre is
 * everything beyond the rim's lip). A flat then sags where it meets the road: the tread drops
 * towards the rim and spreads into a flat patch on the ground, and the sidewalls bulge out
 * above it. The rim keeps spinning; the flat tyre doesn't (its sag stays at the bottom), so the
 * two are split into separate meshes (see FlatTyre).
 *
 * Coordinates here are a wheel frame: `a` along the axle, `y` up, `z` forward, origin at the
 * wheel's centre.
 */

/** Distance from the axle, in the wheel frame. */
export function radial(y: number, z: number): number {
	return Math.hypot(y, z);
}

/**
 * The rim's outer radius: the furthest out any rim vertex reaches. Rim vertices are told by
 * colour where the model has it (polished metal against black rubber); without, by a share of
 * the tyre's radius typical of road wheels.
 */
export function estimateRimRadius(radii: ArrayLike<number>, brightness: ArrayLike<number> | null, tyreRadius: number): number {
	if (brightness) {
		let rim = 0;
		for (let i = 0; i < radii.length; i++) if (brightness[i] > 0.22 && radii[i] < tyreRadius * 0.9) rim = Math.max(rim, radii[i]);
		if (rim > tyreRadius * 0.4) return rim;
	}
	return tyreRadius * 0.7;
}

/**
 * Which triangles are tyre: any with a vertex beyond the rim's lip. `radii` is per vertex,
 * `indices` the triangle list. Returns a flag per triangle.
 */
export function tyreTriangles(radii: ArrayLike<number>, indices: ArrayLike<number>, rimRadius: number): Uint8Array {
	const cut = rimRadius + 0.012;
	const flags = new Uint8Array(indices.length / 3);
	for (let t = 0; t < flags.length; t++) {
		const i = t * 3;
		if (radii[indices[i]] > cut || radii[indices[i + 1]] > cut || radii[indices[i + 2]] > cut) flags[t] = 1;
	}
	return flags;
}

/**
 * Sags a tyre point (a, y, z) for a flat of `amount` (0 up to pressure .. 1 flat), for a tyre of
 * radius `tyre` on a rim of radius `rim`. Writes the moved point into `out` [a, y, z].
 */
export function sagPoint(a: number, y: number, z: number, tyre: number, rim: number, amount: number, out: number[]): number[] {
	const r = radial(y, z);
	if (amount <= 0 || r <= rim + 0.004) {
		out[0] = a;
		out[1] = y;
		out[2] = z;
		return out;
	}
	const wall = Math.min(1, (r - rim) / Math.max(tyre - rim, 1e-3));
	// How near the bottom: 1 straight down, fading to 0 by the axle's height.
	const down = Math.max(0, -y / r);
	const weight = down * down;
	const drop = (tyre - rim) * 0.62 * amount;
	const shrunk = r - drop * weight * Math.pow(wall, 0.8);
	let ny = (y / r) * shrunk;
	const nz = (z / r) * shrunk;
	// The flat patch on the road: nothing lower than the sagged bottom.
	const floor = -(tyre - drop);
	if (ny < floor) ny = floor;
	// Sidewalls bulge out where the tyre is squashed, most at mid-wall.
	const bulge = 1 + 0.38 * amount * weight * Math.sin(Math.PI * wall);
	out[0] = a * bulge;
	out[1] = ny;
	out[2] = nz;
	return out;
}
