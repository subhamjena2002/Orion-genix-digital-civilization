import type { DamageType } from "./Damage";

/**
 * Where on a body a hit landed, from its height up the capsule. Bullets know exactly where they
 * struck (HitTests gives the surface point), so a shot to the legs, the chest or the head can
 * each do what it would really do, instead of every hit anywhere taking the same bite out of a
 * health bar.
 */
export type BodyZone = "head" | "torso" | "legs";

/** Share of body height below which a hit is in the legs (hips are about half way up). */
const LEGS_TOP = 0.47;
/** Share of body height above which a hit is in the head (chin at about 86%). */
const HEAD_BOTTOM = 0.84;

export function bodyZone(hitY: number, baseY: number, height: number): BodyZone {
	const share = (hitY - baseY) / Math.max(height, 0.01);
	if (share >= HEAD_BOTTOM) return "head";
	if (share < LEGS_TOP) return "legs";
	return "torso";
}

/**
 * How much more or less a hit does by where it lands. A head shot kills outright; the chest is
 * where the vital organs are; a leg wound rarely kills on its own, but it takes the leg away
 * (see the pedestrian's wounded state).
 */
const ZONE_DAMAGE: Readonly<Record<BodyZone, number>> = { head: 4, torso: 1.25, legs: 0.55 };

/** Hits that strike one point of the body. Blasts, fire and car impacts hit the whole body. */
const AIMED: ReadonlySet<DamageType> = new Set<DamageType>(["bullet", "rifle", "buckshot", "blade", "melee"]);

export function isAimed(type: DamageType): boolean {
	return AIMED.has(type);
}

export function zoneDamage(amount: number, type: DamageType, zone: BodyZone): number {
	return isAimed(type) ? amount * ZONE_DAMAGE[zone] : amount;
}

/** Gunshots are what take a leg out from under someone; a punch to the shin doesn't. */
export function dropsOnLegHit(type: DamageType): boolean {
	return type === "bullet" || type === "rifle" || type === "buckshot";
}
