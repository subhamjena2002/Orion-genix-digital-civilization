/**
 * Vehicle condition: every car starts at 100% and is worn down by crashes. At 0% the engine
 * catches fire and the car explodes a few seconds later, as in GTA.
 *
 * Damage follows crash analysis rather than raw speed: what wrecks a car is its *change* of
 * velocity (delta-v), and the energy involved goes with the square of it. Because each car's
 * own delta-v already accounts for the mass it hit, a small car hitting a heavy one takes the
 * worse end of it for free, and a gentle nudge at parking speed does nothing at all.
 */

/** Delta-v (m/s) below which an impact is just a scrape. */
const DAMAGE_THRESHOLD = 2.5;
/**
 * Delta-v that writes a car off in one hit. Real crash data treats about 20 m/s of delta-v as
 * catastrophic; this sits a little above that, so a flat-out crash into a building destroys
 * the car while traffic can be shunted about all day.
 */
const WRITE_OFF_DELTA_V = 26;
/** Running someone over barely marks the car. */
export const PEDESTRIAN_DAMAGE = 1.5;

/** Condition at or below this smokes; the engine also starts losing power. */
export const SMOKING_BELOW = 60;
/** Below this the smoke turns black and flames start to show. */
export const BURNING_BELOW = 22;
/** Seconds a car burns at 0% before it goes up. */
export const BURN_SECONDS = 6;

/** Power left at 0% condition, before the fire finishes the job. */
const MIN_POWER_FACTOR = 0.45;

/** How far an explosion reaches. */
export const BLAST_RADIUS = 9;
/** Condition a car loses at the centre of a blast. */
export const BLAST_DAMAGE = 55;
/** Speed (m/s) a car at the centre of a blast is thrown at. */
export const BLAST_PUSH = 9;

export type VehicleCondition = "sound" | "smoking" | "burning" | "wrecked";

/** Condition lost by a car whose own velocity changed by `deltaV` metres per second. */
export function crashDamage(deltaV: number): number {
	const over = deltaV - DAMAGE_THRESHOLD;
	if (over <= 0) return 0;
	return Math.min(100, (over / WRITE_OFF_DELTA_V) ** 2 * 100);
}

/** How much of the engine's power is left at this condition. */
export function powerFactor(integrity: number): number {
	if (integrity >= SMOKING_BELOW) return 1;
	const failing = Math.max(0, integrity) / SMOKING_BELOW;
	return MIN_POWER_FACTOR + (1 - MIN_POWER_FACTOR) * failing;
}

export function conditionOf(integrity: number, burnedOut: boolean): VehicleCondition {
	if (burnedOut) return "wrecked";
	if (integrity <= 0) return "burning";
	if (integrity < BURNING_BELOW) return "burning";
	if (integrity < SMOKING_BELOW) return "smoking";
	return "sound";
}

/** Damage and push from a blast, falling off with distance (0 outside the radius). */
export function blastAt(distance: number): { damage: number; push: number } {
	if (distance >= BLAST_RADIUS) return { damage: 0, push: 0 };
	// Linear falloff reads better than an inverse square, which is all-or-nothing up close.
	const falloff = 1 - distance / BLAST_RADIUS;
	return { damage: BLAST_DAMAGE * falloff, push: BLAST_PUSH * falloff };
}

/**
 * Once the engine is alight the fire eats what's left of the car (percent per second), so a
 * burning car always ends in an explosion, as in GTA. Without it a car could sit on fire at a
 * few percent forever.
 */
export const FIRE_DRAIN_PER_SECOND = 2.4;
/** After exploding, the wreck burns along its whole length for this long... */
export const WRECK_FIRE_SECONDS = 14;
/** ...then smoulders, thinning out over this long. */
export const SMOULDER_SECONDS = 50;

/** Condition after `dt` seconds: unchanged unless the car is on fire. */
export function burnDown(integrity: number, dt: number): number {
	if (integrity <= 0 || integrity >= BURNING_BELOW || dt <= 0) return integrity;
	return Math.max(0, integrity - FIRE_DRAIN_PER_SECOND * dt);
}

/** What a damaged car gives off, from engine smoke to a smouldering shell. */
export type DamageStage = "smoking" | "burning" | "wreck-fire" | "smouldering";

export interface DamageEffect {
	stage: DamageStage;
	/** 0..1 within the stage. */
	severity: number;
}

/**
 * The effect for a car's state, or null when it gives off nothing. `burnedFor` is seconds since
 * it exploded. The returned object is reused between calls.
 */
export function damageEffect(integrity: number, burnedOut: boolean, burnedFor: number): DamageEffect | null {
	if (burnedOut) {
		if (burnedFor < WRECK_FIRE_SECONDS) return effect("wreck-fire", 1 - burnedFor / WRECK_FIRE_SECONDS);
		const smoulder = (burnedFor - WRECK_FIRE_SECONDS) / SMOULDER_SECONDS;
		return smoulder < 1 ? effect("smouldering", 1 - smoulder) : null;
	}
	switch (conditionOf(integrity, burnedOut)) {
		case "burning":
			return effect("burning", 1);
		case "smoking":
			return effect("smoking", 1 - (integrity - BURNING_BELOW) / (SMOKING_BELOW - BURNING_BELOW));
		default:
			return null;
	}
}

const shared: DamageEffect = { stage: "smoking", severity: 0 };

function effect(stage: DamageStage, severity: number): DamageEffect {
	shared.stage = stage;
	shared.severity = Math.max(0, Math.min(1, severity));
	return shared;
}
