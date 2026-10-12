import type { VehicleStyle } from "./Vehicles";

/**
 * Vehicle condition: every vehicle starts at 100% and is worn down crash by crash. It shows on
 * the body long before the engine goes — scratched and dulled paint, dents, cracked then
 * shattered glass, a bumper hanging off (see OrionVehicleModel) — then the engine smokes, then
 * burns, and only after burning a while does it go up.
 *
 * Damage follows crash analysis rather than raw speed: what wrecks a car is its *change* of
 * velocity (delta-v), so a small car hitting a heavy one takes the worse end of it, and a
 * nudge at parking speed does nothing. But no single crash finishes a vehicle off: a flat-out hit
 * into a wall takes a car about a sixth of the way, so it takes five or six of those — or ten
 * or more ordinary prangs — before it catches fire. A bus or a lorry takes longer still.
 */

/** Delta-v (m/s) below which an impact is just a scrape. */
const DAMAGE_THRESHOLD = 2.5;
/** Delta-v at which a single hit does its build's worst (about a 100 km/h crash into a wall). */
const WORST_HIT_DELTA_V = 30;

/**
 * How each kind of vehicle takes a crash.
 *
 * - car: crumples readily, glass goes in a hard hit.
 * - van: a little tougher than a car.
 * - heavy (lorries, fire engines, bin lorries): steel frames, so smaller, shallower dents and a
 *   good many hits before anything gives; small cab windows hold out longest.
 * - bus: long, thin panels dent wide and shallow, and the big windows are the first thing to go.
 */
export type VehicleBuild = "car" | "van" | "heavy" | "bus";

export interface BuildSpec {
	/** Condition lost to the worst single hit. */
	maxHitDamage: number;
	/** Dent depth (m) per m/s of delta-v over the threshold, and the deepest any spot gets. */
	dentPerDeltaV: number;
	maxDent: number;
	/** Dent radius (m): base plus per m/s. */
	dentRadius: number;
	dentRadiusPerDeltaV: number;
	/** Glass cracks on a hit this hard (m/s), or once this much condition is gone... */
	crackDeltaV: number;
	crackDamage: number;
	/** ...and shatters on a hit this hard, or once this much is gone. */
	shatterDeltaV: number;
	shatterDamage: number;
	/** An end hit this hard tears the bumper down. */
	sagDeltaV: number;
}

/**
 * Sized to what crashes do to real cars: a car whose velocity changes by 30 km/h (a 60 km/h
 * rear-ending, both cars sharing it) is pushed in ~13 cm and its windscreen crazes; a
 * flat-out hit into a wall crushes half a metre. What this costs in condition (maxHitDamage) is
 * a game decision, kept apart: a car survives many crashes that look bad.
 */
export const BUILDS: Readonly<Record<VehicleBuild, BuildSpec>> = {
	car: { maxHitDamage: 16, dentPerDeltaV: 0.024, maxDent: 0.5, dentRadius: 0.55, dentRadiusPerDeltaV: 0.03, crackDeltaV: 9, crackDamage: 28, shatterDeltaV: 17, shatterDamage: 55, sagDeltaV: 10 },
	van: { maxHitDamage: 13, dentPerDeltaV: 0.022, maxDent: 0.48, dentRadius: 0.65, dentRadiusPerDeltaV: 0.032, crackDeltaV: 10, crackDamage: 32, shatterDeltaV: 18, shatterDamage: 58, sagDeltaV: 11 },
	heavy: { maxHitDamage: 8, dentPerDeltaV: 0.012, maxDent: 0.36, dentRadius: 0.7, dentRadiusPerDeltaV: 0.025, crackDeltaV: 13, crackDamage: 40, shatterDeltaV: 22, shatterDamage: 66, sagDeltaV: 14 },
	bus: { maxHitDamage: 9, dentPerDeltaV: 0.016, maxDent: 0.4, dentRadius: 0.9, dentRadiusPerDeltaV: 0.045, crackDeltaV: 8, crackDamage: 22, shatterDeltaV: 15, shatterDamage: 45, sagDeltaV: 12 },
};

export function buildOf(style: VehicleStyle): VehicleBuild {
	switch (style) {
		case "bus":
		case "schoolBus":
			return "bus";
		case "truck":
		case "serviceTruck":
		case "towTruck":
		case "garbageTruck":
		case "fireTruck":
			return "heavy";
		case "van":
		case "ambulance":
		case "militaryWagon":
		case "suv":
			return "van";
		default:
			return "car";
	}
}
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

/**
 * Condition lost by a vehicle whose own velocity changed by `deltaV` metres per second: rising
 * steeply with the hit, but never more than its build's worst in one go.
 */
export function crashDamage(deltaV: number, build: VehicleBuild = "car"): number {
	const over = deltaV - DAMAGE_THRESHOLD;
	if (over <= 0) return 0;
	const severity = Math.min(1, over / (WORST_HIT_DELTA_V - DAMAGE_THRESHOLD));
	return BUILDS[build].maxHitDamage * severity ** 1.3;
}

/** How a hit dents the body: depth and radius in metres, and how ragged (0..1). Null below a scrape. */
export function dentFor(deltaV: number, build: VehicleBuild = "car"): { depth: number; radius: number; crumple: number } | null {
	const over = deltaV - DAMAGE_THRESHOLD;
	if (over <= 0) return null;
	const spec = BUILDS[build];
	return {
		depth: Math.min(spec.maxDent, over * spec.dentPerDeltaV),
		radius: spec.dentRadius + over * spec.dentRadiusPerDeltaV,
		crumple: Math.min(1, 0.25 + over / 30),
	};
}

export type GlassState = "intact" | "cracked" | "shattered";

/** A hit this many times the shatter threshold takes whole glass straight out. */
const OUTRIGHT_SHATTER = 1.45;

/**
 * The glass after a hit of `deltaV` with `lost` condition gone in all. It only ever gets worse,
 * and goes in steps: a hard hit crazes whole glass, and it's the next hard hit (or the damage
 * mounting up) that knocks it out — only a truly violent crash shatters it at once.
 */
export function glassAfter(current: GlassState, deltaV: number, lost: number, build: VehicleBuild = "car"): GlassState {
	const spec = BUILDS[build];
	if (current === "shattered" || lost >= spec.shatterDamage) return "shattered";
	if (deltaV >= spec.shatterDeltaV * OUTRIGHT_SHATTER) return "shattered";
	if (current === "cracked" && deltaV >= spec.shatterDeltaV) return "shattered";
	if (current === "cracked" || deltaV >= spec.crackDeltaV || lost >= spec.crackDamage) return "cracked";
	return "intact";
}

/** How battered the paint looks (0 new, 1 wrecked): it dulls and darkens as damage builds. */
export function wear(lost: number): number {
	return Math.max(0, Math.min(1, lost / 80));
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
 * burning car always ends in an explosion, as in GTA — but slowly enough (about fifteen seconds
 * from the first flames) to get out and away. Without it a car could sit on fire forever.
 */
export const FIRE_DRAIN_PER_SECOND = 1.4;
/** After exploding, the wreck burns along its whole length for this long (time for a fire engine to reach it)... */
export const WRECK_FIRE_SECONDS = 45;
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
