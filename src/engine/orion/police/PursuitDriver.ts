import { ROAD_GRID } from "../roads/RoadNetwork";

/**
 * How a patrol car drives a pursuit: junction to junction along the road grid towards the
 * player, then straight at them once they're close and in sight.
 *
 * The city is a full grid (every junction exists and connects to its neighbours), so a route is
 * just a Manhattan walk: at each junction take the step that closes the larger gap, and don't
 * double back. Cutting straight across blocks would put the car into buildings; following the
 * roads is also what makes it look like a driver who knows the city.
 *
 * Pure functions: the car (OrionVehicle) keeps the state and feeds its physics the controls.
 */

export interface DriveControls {
	/** -1..1: forward throttle, or brake and then reverse when negative. */
	drive: number;
	/** -1..1, positive steers left. */
	steer: number;
	handbrake: boolean;
}

export function nearestJunction(x: number, z: number): [number, number] {
	return [nearestIndex(ROAD_GRID.xs, x), nearestIndex(ROAD_GRID.zs, z)];
}

export function junctionPosition(xIndex: number, zIndex: number): [number, number] {
	return [ROAD_GRID.xs[xIndex], ROAD_GRID.zs[zIndex]];
}

/**
 * The next junction from (xIndex, zIndex) towards (targetX, targetZ) — indices, one step along
 * one axis. Closes the larger gap first, and never goes straight back the way it came
 * (`fromDx`, `fromDz` is the step that arrived here). Null when already there.
 */
export function stepToward(xIndex: number, zIndex: number, targetX: number, targetZ: number, fromDx = 0, fromDz = 0): [number, number] | null {
	const gapX = targetX - xIndex;
	const gapZ = targetZ - zIndex;
	if (gapX === 0 && gapZ === 0) return null;
	const stepX: [number, number] = [xIndex + Math.sign(gapX), zIndex];
	const stepZ: [number, number] = [xIndex, zIndex + Math.sign(gapZ)];
	const reverses = (step: [number, number]) => step[0] - xIndex === -fromDx && step[1] - zIndex === -fromDz && (fromDx !== 0 || fromDz !== 0);
	const preferX = Math.abs(gapX) >= Math.abs(gapZ);
	const first = gapX !== 0 && (preferX || gapZ === 0) ? stepX : stepZ;
	const second = first === stepX ? (gapZ !== 0 ? stepZ : null) : (gapX !== 0 ? stepX : null);
	if (!reverses(first)) return first;
	return second ?? first;
}

/**
 * Throttle, brake and steering for a car at (x, z) facing `heading` (radians, 0 = +Z, rising to
 * the left) at `speed` m/s, to head for (aimX, aimZ) at about `wantedSpeed`.
 */
export function steerToward(x: number, z: number, heading: number, speed: number, aimX: number, aimZ: number, wantedSpeed: number): DriveControls {
	const desired = Math.atan2(aimX - x, aimZ - z);
	const error = wrapAngle(desired - heading);
	const steer = clamp(error * 2.2, -1, 1);
	// A sharp turn at speed: slow for it, and lean on the handbrake if it's very sharp.
	const sharp = Math.abs(error) > 1.1 && speed > 12;
	const target = Math.abs(error) > 0.6 ? Math.min(wantedSpeed, 12 + 20 * (1 - Math.min(1, Math.abs(error) / 1.6))) : wantedSpeed;
	let drive = 0.35;
	if (speed < target - 0.5) drive = 1;
	else if (speed > target + 1.5) drive = -1;
	else if (target < 0.3) drive = speed > 0.3 ? -1 : 0;
	return { drive, steer, handbrake: sharp };
}

/** How fast to take the approach to a junction, given how sharply the route turns there. */
export function approachSpeed(distanceToJunction: number, turning: boolean, cruise: number): number {
	if (!turning) return cruise;
	// Enough room to brake from cruise to a cornering speed.
	return Math.min(cruise, 11 + distanceToJunction * 0.55);
}

export function wrapAngle(angle: number): number {
	return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function nearestIndex(values: readonly number[], target: number): number {
	let best = 0;
	for (let i = 1; i < values.length; i++) {
		if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
	}
	return best;
}
