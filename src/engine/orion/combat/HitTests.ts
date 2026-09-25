/**
 * Exact shape tests for hits. Bullets are rays tested against simple shapes — a vertical capsule
 * per person, an oriented box per vehicle — rather than physics bodies: people don't carry
 * colliders at all, and an analytic test is a handful of multiplies. The physics world is still
 * asked once per shot, for walls and buildings between the gun and the target.
 *
 * Rays are (origin, unit direction); results are distances along the ray, or -1 for a miss.
 */

export interface Ray {
	ox: number;
	oy: number;
	oz: number;
	dx: number;
	dy: number;
	dz: number;
}

/**
 * Ray against a vertical capsule standing at (x, y, z) — y is its base — with the given radius
 * and total height. Returns the entry distance within `maxDistance`, or -1.
 */
export function rayCapsule(ray: Ray, maxDistance: number, x: number, y: number, z: number, radius: number, height: number): number {
	const bottom = y + radius;
	const top = y + Math.max(height - radius, radius);
	let best = -1;
	// The side: an infinite vertical cylinder, clipped to the straight part.
	const ox = ray.ox - x;
	const oz = ray.oz - z;
	const a = ray.dx * ray.dx + ray.dz * ray.dz;
	if (a > 1e-12) {
		const b = ox * ray.dx + oz * ray.dz;
		const c = ox * ox + oz * oz - radius * radius;
		const discriminant = b * b - a * c;
		if (discriminant >= 0) {
			const root = Math.sqrt(discriminant);
			let t = (-b - root) / a;
			// Starting inside the cylinder counts as touching at 0.
			if (t < 0 && (-b + root) / a >= 0) t = 0;
			if (t >= 0 && t <= maxDistance) {
				const hitY = ray.oy + ray.dy * t;
				if (hitY >= bottom && hitY <= top) best = t;
			}
		}
	}
	// The rounded ends.
	for (const capY of [bottom, top]) {
		const t = raySphere(ray, maxDistance, x, capY, z, radius);
		if (t >= 0 && (best < 0 || t < best)) best = t;
	}
	return best;
}

export function raySphere(ray: Ray, maxDistance: number, x: number, y: number, z: number, radius: number): number {
	const ox = ray.ox - x;
	const oy = ray.oy - y;
	const oz = ray.oz - z;
	const b = ox * ray.dx + oy * ray.dy + oz * ray.dz;
	const c = ox * ox + oy * oy + oz * oz - radius * radius;
	if (c <= 0) return 0;
	const discriminant = b * b - c;
	if (discriminant < 0) return -1;
	const t = -b - Math.sqrt(discriminant);
	return t >= 0 && t <= maxDistance ? t : -1;
}

/**
 * Ray against a box resting on the ground at (x, y, z), turned to face the unit heading
 * (headingX, headingZ), with half-width, full height and half-length. Returns the entry
 * distance within `maxDistance` (0 if the ray starts inside), or -1.
 */
export function rayOrientedBox(
	ray: Ray,
	maxDistance: number,
	x: number,
	y: number,
	z: number,
	headingX: number,
	headingZ: number,
	halfWidth: number,
	height: number,
	halfLength: number,
): number {
	// Into the box's frame: +Z along the heading, +X to its right, origin at the box centre.
	const rx = headingZ;
	const rz = -headingX;
	const px = ray.ox - x;
	const py = ray.oy - (y + height / 2);
	const pz = ray.oz - z;
	const origin = [px * rx + pz * rz, py, px * headingX + pz * headingZ];
	const direction = [ray.dx * rx + ray.dz * rz, ray.dy, ray.dx * headingX + ray.dz * headingZ];
	const half = [halfWidth, height / 2, halfLength];
	let near = 0;
	let far = maxDistance;
	for (let axis = 0; axis < 3; axis++) {
		if (Math.abs(direction[axis]) < 1e-12) {
			if (Math.abs(origin[axis]) > half[axis]) return -1;
			continue;
		}
		let t0 = (-half[axis] - origin[axis]) / direction[axis];
		let t1 = (half[axis] - origin[axis]) / direction[axis];
		if (t0 > t1) [t0, t1] = [t1, t0];
		near = Math.max(near, t0);
		far = Math.min(far, t1);
		if (near > far) return -1;
	}
	return near;
}

/**
 * Whether a target at (tx, tz) is in a melee swing from (x, z) facing (facingX, facingZ):
 * within `reach` (plus the target's radius) and inside the arc whose half-angle has cosine
 * `arcCos`. Anything overlapping the attacker counts regardless of angle.
 */
export function inMeleeArc(x: number, z: number, facingX: number, facingZ: number, tx: number, tz: number, targetRadius: number, reach: number, arcCos: number): boolean {
	const dx = tx - x;
	const dz = tz - z;
	const distance = Math.hypot(dx, dz);
	if (distance > reach + targetRadius) return false;
	if (distance < targetRadius + 0.05) return true;
	return (dx * facingX + dz * facingZ) / distance >= arcCos;
}

/**
 * Damage falloff from an explosion's centre: full within `innerRadius`, fading linearly to zero
 * at `radius`.
 */
export function explosionFalloff(distance: number, radius: number, innerRadius = radius * 0.25): number {
	if (distance >= radius) return 0;
	if (distance <= innerRadius) return 1;
	return 1 - (distance - innerRadius) / (radius - innerRadius);
}
