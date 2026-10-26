/** Gravity on a thrown object, m/s². */
export const THROW_GRAVITY = 9.81;

/** Steepest and flattest a throw is ever aimed, degrees above level. */
const MAX_LOFT = 60;
const MIN_LOFT = -15;
/** A throw that can't reach goes out at this, as far as it'll carry. */
const FURTHEST_LOFT = 42;
const DEG = Math.PI / 180;

/**
 * The velocity to throw something at `speed` from (fromX, fromY, fromZ) so it lands at
 * (toX, toY, toZ) — the flatter of the two arcs that get there, as an arm throws. Out of reach,
 * it goes out at the angle that carries furthest. Written into `out` as [vx, vy, vz].
 */
export function throwVelocity(
	fromX: number, fromY: number, fromZ: number,
	toX: number, toY: number, toZ: number,
	speed: number, gravity: number, out: number[] = [0, 0, 0],
): number[] {
	const dx = toX - fromX;
	const dz = toZ - fromZ;
	const across = Math.hypot(dx, dz);
	const rise = toY - fromY;
	const v2 = speed * speed;
	let loft: number;
	if (across < 0.05) {
		loft = rise >= 0 ? MAX_LOFT * DEG : MIN_LOFT * DEG;
	} else {
		const discriminant = v2 * v2 - gravity * (gravity * across * across + 2 * rise * v2);
		loft = discriminant < 0 ? FURTHEST_LOFT * DEG : Math.atan((v2 - Math.sqrt(discriminant)) / (gravity * across));
	}
	loft = Math.max(MIN_LOFT * DEG, Math.min(MAX_LOFT * DEG, loft));
	const headingX = across > 0.05 ? dx / across : 0;
	const headingZ = across > 0.05 ? dz / across : 0;
	const flat = speed * Math.cos(loft);
	out[0] = headingX * flat;
	out[1] = speed * Math.sin(loft);
	out[2] = headingZ * flat;
	return out;
}

/**
 * A bounce off a surface with unit normal (nx, ny, nz): the part of `velocity` into the surface
 * comes back out at `restitution`, the part along it is kept at `grip`. Changes `velocity` in place.
 */
export function bounce(velocity: number[], nx: number, ny: number, nz: number, restitution: number, grip: number): void {
	const into = velocity[0] * nx + velocity[1] * ny + velocity[2] * nz;
	if (into >= 0) return;
	const alongX = velocity[0] - into * nx;
	const alongY = velocity[1] - into * ny;
	const alongZ = velocity[2] - into * nz;
	velocity[0] = alongX * grip - into * restitution * nx;
	velocity[1] = alongY * grip - into * restitution * ny;
	velocity[2] = alongZ * grip - into * restitution * nz;
}
