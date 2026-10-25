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
	/**
	 * Which part of the target a round struck, when the shooter worked it out (see HitDetail);
	 * null for anything that hits the whole target (a blast, a crash, a punch).
	 */
	detail: HitDetail | null;
}

/** The part of a vehicle a round hit. */
export type HitPart = "body" | "glass" | "tyre" | "rim" | "lamp";

/**
 * Exactly what a round struck, from the target's own geometry: the part, which one (a pane, a
 * wheel), and the surface there, so the damage lands on the right thing and the mark sits on the
 * surface rather than on a bounding box.
 */
export interface HitDetail {
	part: HitPart;
	/** Pane number for glass, wheel number for a tyre or rim; -1 otherwise. */
	index: number;
	/** Surface normal at the hit, facing back towards the shooter. */
	nx: number;
	ny: number;
	nz: number;
	/** Cosine between the round's path and the surface: 1 square on, 0 grazing. */
	incidence: number;
	/** A tyre hit on its sidewall rather than its tread. */
	sidewall: boolean;
}

export function makeHitDetail(): HitDetail {
	return { part: "body", index: -1, nx: 0, ny: 1, nz: 0, incidence: 1, sidewall: false };
}

export function copyHitDetail(from: Readonly<HitDetail>, to: HitDetail): HitDetail {
	to.part = from.part;
	to.index = from.index;
	to.nx = from.nx;
	to.ny = from.ny;
	to.nz = from.nz;
	to.incidence = from.incidence;
	to.sidewall = from.sidewall;
	return to;
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
	/**
	 * For a target with real geometry inside its box (a car): given a ray that enters the box at
	 * `entry`, the distance to what it actually strikes within `limit` — filling in `detail` — or
	 * -1 if it passes through (over the bonnet, through a broken window and out).
	 */
	refineHit?(ray: Readonly<RayLike>, entry: number, limit: number, detail: HitDetail): number;
}

/** A unit ray (see HitTests.Ray), repeated here to keep this module free of imports. */
export interface RayLike {
	ox: number;
	oy: number;
	oz: number;
	dx: number;
	dy: number;
	dz: number;
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

/**
 * The weapon's own damage before `kind` scaled it (see damageFor): what a part that takes hits
 * its own way — a car's glass, a tyre — is given to work from.
 */
export function unscaledDamage(kind: DamageableKind, event: Readonly<DamageEvent>): number {
	const share = RESISTANCE[kind][event.type] ?? 1;
	return share > 0 ? event.amount / share : 0;
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
	return { amount: 0, type: "melee", source: null, x: 0, y: 0, z: 0, directionX: 0, directionZ: 1, impulse: 0, detail: null };
}
