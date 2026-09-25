import { RAIL_BED_WIDTH, RAIL_CROSSINGS, RAIL_LENGTH, railWrap, type LevelCrossing } from "./RailLine";

/**
 * The running train as the rest of the city sees it.
 *
 * The train itself lives in a PlayCanvas script (OrionTrain) which can only exist once the
 * world is up. Everything that has to react to it — the barriers at each crossing, the traffic
 * queueing behind them — reads its position from here instead of reaching for the entity, so
 * the rules are plain functions that can be reasoned about and tested on their own.
 */

/** Three carriages nose to tail, plus the gaps between them. */
export const CARRIAGE_LENGTH = 22;
export const CARRIAGE_COUNT = 3;
export const CARRIAGE_GAP = 0.6;
export const TRAIN_LENGTH = CARRIAGE_COUNT * CARRIAGE_LENGTH + (CARRIAGE_COUNT - 1) * CARRIAGE_GAP;

/** About 50 km/h — city running, not open line. */
export const TRAIN_SPEED = 14;

/**
 * How far in front of the train a crossing starts closing, and how far behind it reopens.
 *
 * The crossings on this loop are only 80 m apart (one per road on the grid), so a long warning
 * would leave the whole corridor shut for most of a lap. 90 m is about six seconds' notice,
 * which is enough for the booms to fall and a queue to stop.
 */
export const BARRIER_LEAD = 90;
export const BARRIER_TRAIL = 12;
/** Seconds a boom takes to fall or lift. */
export const BARRIER_SWING_SECONDS = 2.4;

/** Cars stop this far back from the track centreline — clear of the bed and the booms. */
export const RAIL_STOP_SETBACK = RAIL_BED_WIDTH / 2 + 3.5;

/** Half-width of the space a train sweeps. Anything inside it when the train arrives is hit. */
export const TRAIN_STRIKE_HALF_WIDTH = 1.9;

/** Distance round the loop of the front of the train, or null while no train is running. */
let frontDistance: number | null = null;

/** Called by the train each frame. `null` when it is unloaded, which opens every barrier. */
export function setTrainFront(distance: number | null): void {
	frontDistance = distance === null ? null : railWrap(distance);
}

export function trainFront(): number | null {
	return frontDistance;
}

/**
 * Whether this crossing is shut to road traffic: the train is inside its warning distance, or
 * it is still on the crossing, or its tail has not yet cleared.
 */
export function crossingClosed(crossing: LevelCrossing): boolean {
	const front = frontDistance;
	if (front === null) return false;
	// How much further the front of the train has to travel to reach this crossing.
	const ahead = railWrap(crossing.distance - front);
	if (ahead < BARRIER_LEAD) return true;
	// It has gone past: the whole train plus a margin has to clear before the road reopens.
	return RAIL_LENGTH - ahead < TRAIN_LENGTH + BARRIER_TRAIL;
}

/**
 * How far a vehicle still has before the stop line of the nearest shut crossing in front of it,
 * measured from its nose, or Infinity if the road ahead is clear.
 *
 * A vehicle whose nose is already over the line drives on: stopping there would leave it
 * standing on the rails, which is worse than crossing in front of the boom.
 *
 * A crossing counts as "ahead" only if the vehicle is on the road that crosses there, which the
 * lateral test does: the crossing point sits on the road centreline, so every lane of it is
 * within half the road's width.
 */
export function railStopAhead(x: number, z: number, headingX: number, headingZ: number, lookAhead: number, halfLength: number): number {
	if (frontDistance === null) return Infinity;
	let nearest = Infinity;
	for (const crossing of RAIL_CROSSINGS) {
		const relX = crossing.x - x;
		const relZ = crossing.z - z;
		const gap = relX * headingX + relZ * headingZ - RAIL_STOP_SETBACK - halfLength;
		// Committed, or too far off to matter yet.
		if (gap < -COMMIT_MARGIN || gap > lookAhead) continue;
		if (Math.abs(relX * -headingZ + relZ * headingX) > crossing.roadWidth / 2) continue;
		if (!crossingClosed(crossing)) continue;
		nearest = Math.min(nearest, gap);
	}
	return nearest;
}

/**
 * How far past the stop line a vehicle may be and still be held there. Without it a car stopped
 * a hair over the line would count as committed, pull away, and stop again.
 */
const COMMIT_MARGIN = 1;
