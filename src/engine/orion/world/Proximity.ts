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
