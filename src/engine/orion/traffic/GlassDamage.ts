import type { DamageType } from "../combat/Damage";

/**
 * Glass that takes hits: a car's windows, a shop's plate glass. Each pane keeps its own damage,
 * so a window goes through the steps real glass does — whole, a star where the round went in,
 * cracks spreading with each further hit, and finally out — and stays broken until the car is
 * repaired or recycled. Pure state, so the rules are testable; what it looks like (crack decals,
 * the pane taken out, the shards) is BodyDamage's and ShopfrontGlass's business.
 *
 * Kinds, after what the glass really is:
 * - laminated: a windscreen. Two sheets bonded to plastic: it stars and crazes but holds together
 *   until it has been shot through many times.
 * - tempered: side and rear windows. Toughened, so the first hit only stars it, but the next
 *   one releases the stress and the whole pane drops out in small cubes.
 * - plate: shop windows. Big annealed sheets: long cracks run from each hit; the third or so
 *   brings it down in big shards.
 * - reinforced: an armoured pane; the odd shot only marks it.
 */
export type PaneKind = "laminated" | "tempered" | "plate" | "reinforced";

export type PaneStage = "intact" | "cracked" | "crazed" | "shattered";

/** What a hit did, for the visuals and the sound. */
export type PaneOutcome = "none" | "crack" | "spread" | "craze" | "shatter";

export interface PaneState {
	stage: PaneStage;
	/** Damage soaked up so far, in pistol-round units of 30. */
	damage: number;
	hits: number;
}

/** Damage a pane can take before it goes. A pistol round does 30 to glass. */
export const PANE_STRENGTH: Readonly<Record<PaneKind, number>> = {
	laminated: 150,
	tempered: 50,
	plate: 75,
	reinforced: 600,
};

/** A laminated pane crazes all over past this share of its strength. */
const CRAZE_SHARE = 0.5;

/** How hard each kind of hit is on glass, per point of the weapon's damage. */
const GLASS_FACTOR: Readonly<Record<DamageType, number>> = {
	bullet: 1,
	rifle: 1.4,
	buckshot: 0.8,
	melee: 0.6,
	blade: 0.3,
	explosive: 4,
	impact: 1,
	fire: 0,
};

export function newPane(): PaneState {
	return { stage: "intact", damage: 0, hits: 0 };
}

export function glassDamage(type: DamageType, amount: number): number {
	return Math.max(0, amount) * GLASS_FACTOR[type];
}

/**
 * Applies `damage` (from glassDamage) to a pane. A shattered pane takes nothing more: shooting
 * the empty frame doesn't break it again.
 */
export function hitPane(pane: PaneState, kind: PaneKind, damage: number): PaneOutcome {
	if (pane.stage === "shattered" || !(damage > 0)) return "none";
	pane.damage += damage;
	pane.hits++;
	const strength = PANE_STRENGTH[kind];
	if (pane.damage >= strength) {
		pane.stage = "shattered";
		return "shatter";
	}
	if (pane.stage === "intact") {
		pane.stage = "cracked";
		return "crack";
	}
	if (kind === "laminated" && pane.stage === "cracked" && pane.damage >= strength * CRAZE_SHARE) {
		pane.stage = "crazed";
		return "craze";
	}
	return "spread";
}

/** Forces a pane to a stage it hasn't reached yet (a crash crazing or knocking out the glass). */
export function worsenPane(pane: PaneState, kind: PaneKind, stage: PaneStage): PaneOutcome {
	const order: readonly PaneStage[] = ["intact", "cracked", "crazed", "shattered"];
	if (order.indexOf(stage) <= order.indexOf(pane.stage)) return "none";
	const strength = PANE_STRENGTH[kind];
	pane.stage = stage;
	if (stage === "shattered") {
		pane.damage = Math.max(pane.damage, strength);
		return "shatter";
	}
	pane.damage = Math.max(pane.damage, stage === "crazed" ? strength * CRAZE_SHARE : 1);
	return stage === "crazed" ? "craze" : "crack";
}

/** How big a crack star a hit leaves (metres across), growing a little as the pane weakens. */
export function crackSize(kind: PaneKind, pane: Readonly<PaneState>): number {
	const base = kind === "plate" ? 0.42 : kind === "laminated" ? 0.2 : 0.24;
	const weakness = Math.min(1, pane.damage / PANE_STRENGTH[kind]);
	return base * (0.8 + weakness * 0.7);
}

/** Car glass by the pane's name: the windscreen is laminated, the rest toughened. */
export function carPaneKind(name: string): PaneKind {
	return /windscreen|windshield/i.test(name) ? "laminated" : "tempered";
}
