import type { DamageType } from "../combat/Damage";
import type { VehicleBuild } from "./VehicleDamage";

/**
 * Tyres, one by one. Each wheel keeps its own state: hits soak into the tyre until it is holed,
 * then it goes down over a couple of seconds as the air leaves, and a flat stays flat until the
 * car is repaired or recycled. What a flat does to the car is worked out here too, as a set of
 * changes to the handling model (see CarPhysics.tyres) rather than as a second physics.
 *
 * Tuning: an ordinary pistol puts a car tyre down with two or three direct hits — two into the
 * sidewall, three into the tread, more if the rounds only glance off. Rifles do it sooner, and
 * a lorry's or a bus's heavier tyres take longer. Rounds that only pass near do nothing: only a
 * hit on the tyre itself counts (the rim, the body and the arch don't).
 */

export interface TyreState {
	/** Damage soaked up so far. */
	damage: number;
	hits: number;
	punctured: boolean;
	/** 0 fully up .. 1 flat; climbs once punctured. */
	deflation: number;
}

/** Damage a tyre takes before it's holed. A pistol round does up to 30 (see tyreHitDamage). */
export const TYRE_STRENGTH: Readonly<Record<VehicleBuild, number>> = {
	car: 75,
	van: 85,
	heavy: 130,
	bus: 130,
};

/** Seconds from the puncture to a flat tyre. */
export const DEFLATE_SECONDS = 2.4;

const TYRE_FACTOR: Readonly<Record<DamageType, number>> = {
	bullet: 1,
	rifle: 1.35,
	buckshot: 0.85,
	blade: 0.6,
	melee: 0,
	explosive: 2.5,
	impact: 0,
	fire: 0,
};

/** The sidewall is thinner than the tread. */
const SIDEWALL_FACTOR = 1.3;

export function newTyre(): TyreState {
	return { damage: 0, hits: 0, punctured: false, deflation: 0 };
}

/**
 * Damage a round does to a tyre: by weapon, by where it struck (sidewall or tread), and by how
 * squarely — `incidence` is the cosine between the round's path and the surface normal (1 head
 * on, 0 grazing), and a grazing round mostly skips off the rubber.
 */
export function tyreHitDamage(type: DamageType, amount: number, incidence: number, sidewall: boolean): number {
	const square = 0.45 + 0.55 * Math.max(0, Math.min(1, incidence));
	return Math.max(0, amount) * TYRE_FACTOR[type] * square * (sidewall ? SIDEWALL_FACTOR : 1);
}

/** Applies a hit. Returns true if this one holed the tyre. */
export function hitTyre(tyre: TyreState, build: VehicleBuild, damage: number): boolean {
	if (tyre.punctured || !(damage > 0)) return false;
	tyre.damage += damage;
	tyre.hits++;
	if (tyre.damage < TYRE_STRENGTH[build]) return false;
	tyre.punctured = true;
	return true;
}

/** Lets the air out of a holed tyre: quickly at first, then the last of it more slowly. */
export function deflate(tyre: TyreState, dt: number): void {
	if (!tyre.punctured || tyre.deflation >= 1 || dt <= 0) return;
	const rate = (1.4 - tyre.deflation * 0.8) / DEFLATE_SECONDS;
	tyre.deflation = Math.min(1, tyre.deflation + rate * dt);
}

/** Back up to pressure (a repaired or recycled car). */
export function repairTyre(tyre: TyreState): void {
	tyre.damage = 0;
	tyre.hits = 0;
	tyre.punctured = false;
	tyre.deflation = 0;
}

/** How a flat changes the car, for CarPhysics. All neutral (1 or 0) with four good tyres. */
export interface TyreHandling {
	/** Grip and cornering stiffness left on each axle. */
	frontGrip: number;
	rearGrip: number;
	frontCornering: number;
	rearCornering: number;
	/** Extra rolling drag as a share of the car's weight (a flat drags like a brake). */
	drag: number;
	/** Yaw pull towards the flat side, as a share of the car's weight per m/s (+ pulls left). */
	pull: number;
	/** Shimmy at speed from a flat front: share of the weight at 30 m/s. */
	shimmy: number;
	/** Share of the brakes' grip left (a flat locks and slides). */
	brakeGrip: number;
}

export const NO_TYRE_EFFECT: Readonly<TyreHandling> = {
	frontGrip: 1, rearGrip: 1, frontCornering: 1, rearCornering: 1, drag: 0, pull: 0, shimmy: 0, brakeGrip: 1,
};

/** A wheel's place on the car: front or back, and which side (+X is the car's left). */
export interface TyreCorner {
	front: boolean;
	left: boolean;
}

/**
 * The handling with these tyres. A flat tyre has a fraction of its grip and much less cornering
 * stiffness, drags like a dragging brake, and pulls the car towards its side; a flat front also
 * shimmies through the steering as the speed rises. Several flats add up.
 */
export function tyreHandling(tyres: readonly Readonly<TyreState>[], corners: readonly TyreCorner[], out: TyreHandling): TyreHandling {
	let front = 0;
	let rear = 0;
	let frontCount = 0;
	let rearCount = 0;
	let left = 0;
	let right = 0;
	for (let i = 0; i < tyres.length && i < corners.length; i++) {
		const flat = tyres[i].deflation;
		const corner = corners[i];
		if (corner.front) {
			front += flat;
			frontCount++;
		} else {
			rear += flat;
			rearCount++;
		}
		if (corner.left) left += flat;
		else right += flat;
	}
	const frontFlat = frontCount ? front / frontCount : 0;
	const rearFlat = rearCount ? rear / rearCount : 0;
	out.frontGrip = 1 - 0.32 * frontFlat;
	out.rearGrip = 1 - 0.3 * rearFlat;
	out.frontCornering = 1 - 0.55 * frontFlat;
	out.rearCornering = 1 - 0.5 * rearFlat;
	const flats = front + rear;
	out.drag = 0.035 * flats;
	// The flat side drags: front flats pull harder, through the steering.
	out.pull = 0.012 * (left - right) * (1 + frontFlat);
	out.shimmy = 0.05 * frontFlat;
	out.brakeGrip = 1 - 0.2 * Math.min(1, flats / 2);
	return out;
}

/** How much a flat tyre's height drops (m) for a tyre of this radius and rim, fully down. */
export function flatDrop(radius: number, rimRadius: number): number {
	// The sidewall folds under the rim: about two thirds of it goes, never down to the rim.
	return Math.max(0, (radius - rimRadius) * 0.62);
}
