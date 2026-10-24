import type { WeaponId } from "./WeaponData";

/**
 * Weapons lying in the street: dropped by a police officer or an armed guard as they go down,
 * picked up by walking (or driving) over them. The gun and its rounds go to the player — the
 * rounds as spares if they already carry that weapon, the weapon itself if they don't.
 *
 * Plain state, like the HUD modules: the dead drop here (`dropWeapon`), the player's combat takes
 * what's in reach (`takePickupsNear`), and the world draws whatever's lying about (`pickups`).
 */

export interface Pickup {
	/** Unique for the session, so whoever draws them can tell one from another. */
	readonly id: number;
	readonly weapon: WeaponId;
	readonly rounds: number;
	readonly x: number;
	/** The ground under it. */
	readonly y: number;
	readonly z: number;
	/** Seconds it's been lying there. */
	age: number;
}

/** Lying about this long, then gone (cleared away like the bodies). */
export const PICKUP_LIFETIME = 60;
/** At most this many at once: a big fight's oldest drops go first. */
export const MAX_PICKUPS = 16;
/** Picked up from this close on foot, and in a car (the car's a couple of metres across). */
export const PICKUP_REACH = 1.4;
export const PICKUP_REACH_DRIVING = 2.6;

let items: Pickup[] = [];
let nextId = 1;
let version = 0;

/** A weapon on the ground at (x, y, z), with this many rounds. */
export function dropWeapon(weapon: WeaponId, rounds: number, x: number, y: number, z: number): Pickup {
	const pickup: Pickup = { id: nextId++, weapon, rounds: Math.max(0, Math.round(rounds)), x, y, z, age: 0 };
	items.push(pickup);
	if (items.length > MAX_PICKUPS) items = items.slice(items.length - MAX_PICKUPS);
	version++;
	return pickup;
}

/** Ages what's lying about; anything left too long is gone. */
export function updatePickups(dt: number): void {
	if (items.length === 0) return;
	let expired = false;
	for (const pickup of items) {
		pickup.age += dt;
		if (pickup.age >= PICKUP_LIFETIME) expired = true;
	}
	if (!expired) return;
	items = items.filter((pickup) => pickup.age < PICKUP_LIFETIME);
	version++;
}

/** Takes (removes and returns) every pickup within `reach` of (x, z) that `wanted` accepts. */
export function takePickupsNear(x: number, z: number, reach: number, wanted: (pickup: Pickup) => boolean = () => true): Pickup[] {
	if (items.length === 0) return [];
	const taken = items.filter((pickup) => Math.hypot(pickup.x - x, pickup.z - z) <= reach && wanted(pickup));
	if (taken.length === 0) return taken;
	items = items.filter((pickup) => !taken.includes(pickup));
	version++;
	return taken;
}

export function pickups(): readonly Pickup[] {
	return items;
}

/** Changes whenever a pickup is dropped, taken or gone. */
export function pickupsVersion(): number {
	return version;
}

/** Everything gone (a new game, a test). */
export function clearPickups(): void {
	items = [];
	version++;
}
