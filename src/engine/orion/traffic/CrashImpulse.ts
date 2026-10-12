/**
 * What a collision does to two cars' motion: the impulse at the point where they touch, for
 * two bodies that move AND turn (a wall is one that does neither).
 *
 * The push is along the contact normal, sized so the bodies part at `restitution` of the speed
 * they met at, measured at the contact point itself — so a car spinning into a wall hits it
 * harder than its centre's speed says. Friction acts across it (Coulomb, at most `friction`
 * times the push): a sideswipe drags the other car along instead of only shoving it away. Both
 * push and friction land off-centre, and that is what turns the cars: a nose clipped on its
 * corner swings round, a car struck behind its rear axle spins out the way real ones do.
 *
 * Plane only (x, z). Heading is the car's yaw with forward = (sin, cos); turning rates are
 * radians per second with the same sign as heading. A turning rate ω moves a point at offset
 * r from the centre at ω·(r.z, −r.x), and an impulse J at r turns the body by (r.z·J.x − r.x·J.z)/I.
 */

export interface CrashBody {
	/** kg; Infinity for a wall. */
	mass: number;
	/** Yaw inertia, kg·m²; Infinity for a wall. */
	inertia: number;
	velocityX: number;
	velocityZ: number;
	/** rad/s. */
	turnRate: number;
	/** Contact point relative to the body's centre, metres. */
	offsetX: number;
	offsetZ: number;
}

export interface CrashResponse {
	velocityX: number;
	velocityZ: number;
	turnRate: number;
}

export interface CrashResult {
	a: CrashResponse;
	b: CrashResponse;
	/** Size of the push along the normal, N·s (0 if they weren't closing). */
	normalImpulse: number;
	/** Change in A's velocity (at its centre), m/s: how hard the hit was for A. */
	deltaVA: number;
	deltaVB: number;
}

const unchanged = (body: CrashBody): CrashResponse => ({ velocityX: body.velocityX, velocityZ: body.velocityZ, turnRate: body.turnRate });

/** Velocity of the contact point on a body. */
function pointVelocity(body: CrashBody): [number, number] {
	return [body.velocityX + body.turnRate * body.offsetZ, body.velocityZ - body.turnRate * body.offsetX];
}

/** How a unit impulse along (dx, dz) at the contact turns the body: r × d. */
function lever(body: CrashBody, dx: number, dz: number): number {
	return body.offsetZ * dx - body.offsetX * dz;
}

/** 1 / effective mass of the pair along a direction at the contact. */
function compliance(a: CrashBody, b: CrashBody, dx: number, dz: number): number {
	const la = lever(a, dx, dz);
	const lb = lever(b, dx, dz);
	return 1 / a.mass + 1 / b.mass + (la * la) / a.inertia + (lb * lb) / b.inertia;
}

/**
 * The bodies' motion after touching. `normalX/Z` is the contact normal pointing from B into A
 * (out of whatever A ran into).
 */
export function crashImpulse(a: CrashBody, b: CrashBody, normalX: number, normalZ: number, restitution: number, friction: number): CrashResult {
	const length = Math.hypot(normalX, normalZ) || 1;
	const nx = normalX / length;
	const nz = normalZ / length;
	const [ax, az] = pointVelocity(a);
	const [bx, bz] = pointVelocity(b);
	const relX = ax - bx;
	const relZ = az - bz;
	const closing = relX * nx + relZ * nz;
	if (closing >= 0) return { a: unchanged(a), b: unchanged(b), normalImpulse: 0, deltaVA: 0, deltaVB: 0 };

	const jn = (-(1 + restitution) * closing) / compliance(a, b, nx, nz);

	// Friction against the sliding left over across the normal, once the push has stopped the
	// closing: enough to stop that sliding, never more than the push allows.
	let jt = 0;
	let tx = relX - closing * nx;
	let tz = relZ - closing * nz;
	const slide = Math.hypot(tx, tz);
	if (slide > 1e-6) {
		tx /= slide;
		tz /= slide;
		jt = Math.max(-friction * jn, Math.min(friction * jn, -slide / compliance(a, b, tx, tz)));
	}

	const impulseX = jn * nx + jt * tx;
	const impulseZ = jn * nz + jt * tz;
	const apply = (body: CrashBody, sign: 1 | -1): CrashResponse => ({
		velocityX: body.velocityX + (sign * impulseX) / body.mass,
		velocityZ: body.velocityZ + (sign * impulseZ) / body.mass,
		turnRate: body.turnRate + (sign * lever(body, impulseX, impulseZ)) / body.inertia,
	});
	const impulse = Math.hypot(impulseX, impulseZ);
	return { a: apply(a, 1), b: apply(b, -1), normalImpulse: jn, deltaVA: impulse / a.mass, deltaVB: impulse / b.mass };
}
