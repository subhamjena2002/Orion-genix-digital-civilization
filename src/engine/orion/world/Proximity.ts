/**
 * Distance culling with hysteresis. An item joins the set once it's inside `enterRadius` and
 * only leaves once it's beyond `exitRadius`, so hovering around a boundary doesn't mount and
 * unmount the same building every time the player takes a step.
 */
export function nearbyWithHysteresis<T>(
	items: readonly T[],
	positionOf: (item: T) => readonly [number, number],
	x: number,
	z: number,
	enterRadius: number,
	exitRadius: number,
	current: ReadonlySet<T>,
): T[] {
	const enterSq = enterRadius * enterRadius;
	const exitSq = Math.max(exitRadius, enterRadius) ** 2;
	const result: T[] = [];
	for (const item of items) {
		const [ix, iz] = positionOf(item);
		const dx = ix - x;
		const dz = iz - z;
		const distanceSq = dx * dx + dz * dz;
		if (distanceSq <= enterSq || (current.has(item) && distanceSq <= exitSq)) result.push(item);
	}
	return result;
}

/** True when both hold exactly the same items (order ignored). */
export function sameMembers<T>(a: readonly T[], b: ReadonlySet<T>): boolean {
	if (a.length !== b.size) return false;
	for (const item of a) if (!b.has(item)) return false;
	return true;
}

/** Seconds of travel the nearby set is centred ahead by, so what's coming is mounted before it's reached. */
const LEAD_SECONDS = 1.5;
/** Faster than this between samples is a teleport (respawn, boarding), not travel. */
const TELEPORT_SPEED = 150;
/** Height above which the view reaches further, m, and the most the radius grows for speed and for height. */
const HIGH_ABOVE = 30;
const MAX_SPEED_GROWTH = 130;
const MAX_HEIGHT_GROWTH = 200;

/**
 * Where to centre the nearby set and how much wider to make it for a player moving fast or high
 * up. On foot or in city traffic it barely changes; at 300 km/h in the gunship the centre moves
 * ~120 m along the track and the radius grows ~120 m, so buildings are mounted well before they
 * come into view instead of popping in; from a few hundred metres up it grows again, since the
 * view reaches further. Velocity is on the ground plane, in m/s.
 */
export function streamingFocus(x: number, y: number, z: number, vx: number, vz: number): { x: number; z: number; grow: number } {
	let speed = Math.hypot(vx, vz);
	if (speed > TELEPORT_SPEED) {
		vx = vz = speed = 0;
	}
	const lead = Math.min(speed * LEAD_SECONDS, MAX_SPEED_GROWTH);
	const scale = speed > 0 ? lead / speed : 0;
	const grow = lead + Math.min(Math.max(0, y - HIGH_ABOVE) * 0.6, MAX_HEIGHT_GROWTH);
	return { x: x + vx * scale, z: z + vz * scale, grow };
}

/**
 * `next` with at most `maxNew` items that aren't already in `current` — the nearest ones to (x, z)
 * — so a burst of arrivals is spread over several samples. Everything already in stays (or goes)
 * as `next` says. Each arrival is a building instantiated with its collider in one frame: at
 * speed a dozen could arrive at once, and that frame took a tenth of a second.
 */
export function limitNewcomers<T>(
	next: readonly T[],
	current: ReadonlySet<T>,
	positionOf: (item: T) => readonly [number, number],
	x: number,
	z: number,
	maxNew: number,
): T[] {
	const newcomers = next.filter((item) => !current.has(item));
	if (newcomers.length <= maxNew) return [...next];
	const distanceSq = (item: T) => {
		const [ix, iz] = positionOf(item);
		return (ix - x) ** 2 + (iz - z) ** 2;
	};
	const admitted = new Set(newcomers.sort((a, b) => distanceSq(a) - distanceSq(b)).slice(0, maxNew));
	return next.filter((item) => current.has(item) || admitted.has(item));
}
