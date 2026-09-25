/**
 * One damage model for everything that can be hurt: people, vehicles, the player. Weapons,
 * fists, explosions and car crashes all describe what they do as a DamageEvent, and whatever is
 * hit decides what that means for it through `takeDamage`.
 */

export type DamageType = "melee" | "blade" | "bullet" | "buckshot" | "rifle" | "explosive" | "impact" | "fire";

export interface DamageEvent {
	amount: number;
	type: DamageType;
	/** Who caused it; the damaged side uses it to react (flee from, fight back at). */
	source: DamageSourceRef | null;
	/** Where it landed, in world space. */
	x: number;
	y: number;
	z: number;
	/** Direction the damage travelled (unit, horizontal plane is enough for knockback). */
	directionX: number;
	directionZ: number;
	/** Knockback speed, in m/s, applied along the direction by bodies that react physically. */
	impulse: number;
}

/** Enough about an attacker for a victim to react to. */
export interface DamageSourceRef {
	readonly id: number;
	readonly kind: "player" | "npc" | "vehicle" | "explosion";
	x: number;
	z: number;
}

export type DamageableKind = "person" | "vehicle" | "player";

/**
 * Something that can be hit. Shapes are simple on purpose: people are vertical capsules,
 * vehicles oriented boxes. Positions are kept current by their owners, in place.
 */
export interface Damageable {
	readonly id: number;
	readonly kind: DamageableKind;
	/** Centre of the base (feet / wheels on the road). */
	x: number;
	y: number;
	z: number;
	/** Capsule radius (people) or half-width (vehicles). */
	radius: number;
	/** Height of the capsule / box. */
	height: number;
	/** Vehicles: half-length along the heading and the heading itself (unit). */
	halfLength: number;
	headingX: number;
	headingZ: number;
	readonly alive: boolean;
	takeDamage(event: DamageEvent): void;
}

/** Damage multipliers by what's being hit — a pistol round barely scratches a car. */
const RESISTANCE: Readonly<Record<DamageableKind, Partial<Record<DamageType, number>>>> = {
	person: {},
	player: { explosive: 0.8 },
	vehicle: { melee: 0, blade: 0.05, bullet: 0.18, buckshot: 0.12, rifle: 0.25, explosive: 1, impact: 1, fire: 1 },
};

export function damageFor(kind: DamageableKind, event: Readonly<DamageEvent>): number {
	return event.amount * (RESISTANCE[kind][event.type] ?? 1);
}

/** Health with death as a one-way door. */
export class Health {
	private value: number;

	public constructor(public readonly max: number) {
		this.value = max;
	}

	public get current(): number {
		return this.value;
	}

	public get alive(): boolean {
		return this.value > 0;
	}

	public get fraction(): number {
		return this.value / this.max;
	}

	/** Applies damage; returns true if this blow killed. Damage to the dead does nothing. */
	public damage(amount: number): boolean {
		if (!this.alive || !(amount > 0)) return false;
		this.value = Math.max(0, this.value - amount);
		return this.value === 0;
	}

	public heal(amount: number): void {
		if (!this.alive || !(amount > 0)) return;
		this.value = Math.min(this.max, this.value + amount);
	}

	public reset(): void {
		this.value = this.max;
	}
}

let nextId = 1;

/** Ids shared by damageables and damage sources, unique across both. */
export function nextCombatId(): number {
	return nextId++;
}

/** A reusable event: the combat code fills one in place instead of allocating per hit. */
export function makeDamageEvent(): DamageEvent {
	return { amount: 0, type: "melee", source: null, x: 0, y: 0, z: 0, directionX: 0, directionZ: 1, impulse: 0 };
}
