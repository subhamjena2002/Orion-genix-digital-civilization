import type { NpcThreat } from "../characters/NpcBrain";
import { damageFor, type Damageable, type DamageEvent } from "./Damage";
import { rayCapsule, rayOrientedBox, type Ray } from "./HitTests";
import { SpatialGrid } from "./SpatialGrid";

/**
 * Everything in the world that can be hurt, bucketed in a spatial grid so every combat question
 * — what's in this punch's reach, what does this bullet pass, who's caught in this blast, who
 * hears this shot — looks at a few nearby cells instead of every person and car in the city.
 *
 * Owners register their damageable once and call `moved` when it moves; reads allocate nothing.
 */

/** A damageable that can also react to trouble it didn't take damage from. */
export interface Listener extends Damageable {
	/** Heard a gunshot or explosion, or saw a fight, nearby. */
	disturb?(threat: NpcThreat): void;
}

const grid = new SpatialGrid<Listener>(8);
const scratch: Listener[] = [];

export function registerDamageable(item: Listener): void {
	grid.update(item);
}

/** Call after changing the item's x/z. Cheap unless it crossed into another cell. */
export function damageableMoved(item: Listener): void {
	grid.update(item);
}

export function unregisterDamageable(item: Listener): void {
	grid.remove(item);
}

/** Damageables within `radius` (by position) — the array is reused; copy it to keep it. */
export function damageablesNear(x: number, z: number, radius: number): readonly Listener[] {
	return grid.queryRadius(x, z, radius, scratch);
}

export interface RayHit {
	target: Listener;
	distance: number;
}

const segmentScratch: Listener[] = [];

/**
 * The first living damageable along a ray within `maxDistance`, skipping `ignoreId` (the
 * shooter). World geometry isn't considered here — the caller clips `maxDistance` to the first
 * wall first.
 */
export function raycastDamageables(ray: Ray, maxDistance: number, ignoreId: number): RayHit | null {
	const endX = ray.ox + ray.dx * maxDistance;
	const endZ = ray.oz + ray.dz * maxDistance;
	// Margin covers the longest thing registered (a bus-sized box's half-length).
	const candidates = grid.querySegment(ray.ox, ray.oz, endX, endZ, 4, segmentScratch);
	let best: RayHit | null = null;
	for (const target of candidates) {
		if (target.id === ignoreId || !target.alive) continue;
		const limit: number = best ? best.distance : maxDistance;
		const distance: number = target.kind === "vehicle"
			? rayOrientedBox(ray, limit, target.x, target.y, target.z, target.headingX, target.headingZ, target.radius, target.height, target.halfLength)
			: rayCapsule(ray, limit, target.x, target.y, target.z, target.radius, target.height);
		if (distance >= 0 && (!best || distance < best.distance)) best = { target, distance };
	}
	return best;
}

/** Tells everyone within `radius` of (x, z) about a threat — a gunshot, an explosion, a fight. */
export function broadcastDisturbance(x: number, z: number, radius: number, threat: NpcThreat, ignoreId = -1): void {
	for (const listener of grid.queryRadius(x, z, radius, scratch)) {
		if (listener.id !== ignoreId && listener.alive) listener.disturb?.(threat);
	}
}

/** Applies an event to a target, scaled by what the target is (see damageFor). */
export function applyDamage(target: Damageable, event: DamageEvent): void {
	if (!target.alive) return;
	const scaled = damageFor(target.kind, event);
	if (scaled <= 0) return;
	const original = event.amount;
	event.amount = scaled;
	target.takeDamage(event);
	event.amount = original;
}
