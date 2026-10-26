import type { WeaponId } from "./WeaponData";

/**
 * What the player carries, for anything outside combat that hands them more: a shop counter
 * selling rounds and armour, a rest on the safehouse sofa. The player's combat registers itself here while it exists.
 */
export interface PlayerSupplies {
	/** Spare rounds carried for a weapon. */
	spareFor(weapon: WeaponId): number;
	/** Adds spare rounds, up to the weapon's limit; returns how many went in. */
	addAmmo(weapon: WeaponId, rounds: number): number;
	/** Body armour, 0..MAX_ARMOUR: it takes hits before health does. */
	readonly armour: number;
	/** Tops armour up, to MAX_ARMOUR at most; returns how much went on. */
	addArmour(amount: number): number;
	/** Heals up to full (a rest at the safehouse); returns how much health that gave back. */
	restoreHealth(): number;
}

/** A full vest. */
export const MAX_ARMOUR = 100;

let supplies: PlayerSupplies | null = null;

export function setPlayerSupplies(next: PlayerSupplies | null): void {
	supplies = next;
}

/** The player's, or null before they're in the world. */
export function playerSupplies(): PlayerSupplies | null {
	return supplies;
}
