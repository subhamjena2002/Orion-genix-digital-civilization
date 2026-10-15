import type { WeaponId } from "../combat/WeaponData";
import { holds, type Faction, type MissionDefinition, type MissionReward, type RewardVehicle } from "./MissionDirector";

/**
 * How far the player has got: the cash in their pocket, the missions passed (and best times on
 * the timed ones, best ratings on the rest), the weapons they've earned and the cars waiting in
 * their garage — and the story so far: the choices made (as flags), where the player stands
 * with each side, and the story pieces found around the city.
 *
 * Kept in localStorage so a reload carries on where the player left off. Storage may be missing
 * or refuse (private mode, blocked site data), so every read and write is guarded and the game
 * plays on from memory without it.
 */

export interface ProgressState {
	cash: number;
	passed: string[];
	/** Seconds, for timed missions. */
	bestTimes: Record<string, number>;
	weapons: WeaponId[];
	garage: RewardVehicle[];
	/** Story flags: choices made and things done in missions passed. */
	flags: string[];
	/** Standing with each side. */
	rep: Record<Faction, number>;
	/** Best rating (1..3) per mission that has one. */
	ratings: Record<string, number>;
	/** Story pieces picked up around the city. */
	collected: string[];
	/** Side jobs done (they can be done again). */
	jobs: number;
}

export const FACTIONS: readonly Faction[] = ["street", "sunset", "law", "meridian"];

/** What a new game starts with: fists, a blade and a pistol. */
export const STARTING_WEAPONS: readonly WeaponId[] = ["fists", "sword", "pistol"];

const STORAGE_KEY = "orion.progress.v1";
/** Standing runs from this to its negative. */
export const REP_LIMIT = 10;
const WEAPON_IDS: readonly WeaponId[] = ["fists", "sword", "pistol", "ar", "shotgun", "rocketLauncher"];

type ProgressStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let storageOverride: ProgressStorage | null | undefined;
let state: ProgressState | null = null;
let version = 0;
const listeners = new Set<() => void>();

function fresh(): ProgressState {
	return { cash: 0, passed: [], bestTimes: {}, weapons: [...STARTING_WEAPONS], garage: [], flags: [], rep: { street: 0, sunset: 0, law: 0, meridian: 0 }, ratings: {}, collected: [], jobs: 0 };
}

function storage(): ProgressStorage | null {
	if (storageOverride !== undefined) return storageOverride;
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/** Whatever was saved, checked field by field: anything malformed falls back to a new game's. */
export function parseProgress(raw: string | null): ProgressState {
	const progress = fresh();
	if (!raw) return progress;
	let saved: Partial<Record<keyof ProgressState, unknown>>;
	try {
		saved = JSON.parse(raw) as typeof saved;
	} catch {
		return progress;
	}
	if (!saved || typeof saved !== "object") return progress;
	if (typeof saved.cash === "number" && Number.isFinite(saved.cash) && saved.cash >= 0) progress.cash = Math.floor(saved.cash);
	if (Array.isArray(saved.passed)) progress.passed = saved.passed.filter((id): id is string => typeof id === "string");
	if (saved.bestTimes && typeof saved.bestTimes === "object") {
		for (const [id, seconds] of Object.entries(saved.bestTimes as Record<string, unknown>)) {
			if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) progress.bestTimes[id] = seconds;
		}
	}
	if (Array.isArray(saved.weapons)) {
		const weapons = new Set<WeaponId>(STARTING_WEAPONS);
		for (const id of saved.weapons) if (WEAPON_IDS.includes(id as WeaponId)) weapons.add(id as WeaponId);
		progress.weapons = WEAPON_IDS.filter((id) => weapons.has(id));
	}
	if (Array.isArray(saved.garage)) {
		progress.garage = saved.garage.filter((car): car is RewardVehicle => (
			!!car && typeof car === "object" && typeof car.id === "string" && typeof car.style === "string" && typeof car.colour === "string"
		));
	}
	const strings = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : []);
	progress.flags = strings(saved.flags);
	progress.collected = strings(saved.collected);
	if (saved.rep && typeof saved.rep === "object") {
		for (const faction of FACTIONS) {
			const value = (saved.rep as Record<string, unknown>)[faction];
			if (typeof value === "number" && Number.isFinite(value)) progress.rep[faction] = clampRep(Math.round(value));
		}
	}
	if (saved.ratings && typeof saved.ratings === "object") {
		for (const [id, stars] of Object.entries(saved.ratings as Record<string, unknown>)) {
			if (typeof stars === "number" && stars >= 1 && stars <= 3) progress.ratings[id] = Math.round(stars);
		}
	}
	if (typeof saved.jobs === "number" && Number.isFinite(saved.jobs) && saved.jobs >= 0) progress.jobs = Math.floor(saved.jobs);
	return progress;
}

function clampRep(value: number): number {
	return Math.max(-REP_LIMIT, Math.min(REP_LIMIT, value));
}

function current(): ProgressState {
	if (!state) {
		let raw: string | null = null;
		try {
			raw = storage()?.getItem(STORAGE_KEY) ?? null;
		} catch {
			// A new game it is.
		}
		state = parseProgress(raw);
	}
	return state;
}

function changed(): void {
	try {
		storage()?.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Not saved; still holds for this session.
	}
	version++;
	for (const listener of [...listeners]) listener();
}

export function readProgress(): Readonly<ProgressState> {
	return current();
}

/** Bumps whenever progress changes (for useSyncExternalStore). */
export function progressVersion(): number {
	return version;
}

export function onProgressChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function hasPassed(id: string): boolean {
	return current().passed.includes(id);
}

export function ownsWeapon(id: WeaponId): boolean {
	return current().weapons.includes(id);
}

export function hasFlag(flag: string): boolean {
	return current().flags.includes(flag);
}

export function hasCollected(id: string): boolean {
	return current().collected.includes(id);
}

/** Whether a mission is in the story at all for this player: its flags hold. */
export function missionOpen(mission: MissionDefinition): boolean {
	return holds(mission.onlyIf, hasFlag);
}

/** Missions whose prerequisites are all passed (and flags hold), and that haven't been passed themselves. */
export function availableMissions(catalog: readonly MissionDefinition[]): MissionDefinition[] {
	return catalog.filter((mission) => !hasPassed(mission.id) && (mission.requires ?? []).every(hasPassed) && missionOpen(mission));
}

/** How a run went, beyond the time: the flags it set, its rating, and what its choices pay. */
export interface PassOutcome {
	flags?: readonly string[];
	rating?: number | null;
	extras?: readonly MissionReward[];
}

/**
 * A mission passed: its reward paid and its choices kept the first time (a replay pays nothing
 * and doesn't rewrite the story), its time kept if it was the quickest yet, and its rating if
 * it was the best yet.
 */
export function recordPass(mission: MissionDefinition, seconds: number, outcome: PassOutcome = {}): void {
	const progress = current();
	if (!progress.passed.includes(mission.id)) {
		progress.passed.push(mission.id);
		grant(progress, mission.reward);
		for (const extra of outcome.extras ?? []) grant(progress, extra);
		for (const flag of outcome.flags ?? []) if (!progress.flags.includes(flag)) progress.flags.push(flag);
	}
	if (mission.timed) {
		const best = progress.bestTimes[mission.id];
		if (best === undefined || seconds < best) progress.bestTimes[mission.id] = seconds;
	}
	if (outcome.rating) progress.ratings[mission.id] = Math.max(progress.ratings[mission.id] ?? 0, outcome.rating);
	changed();
}

function applyRep(progress: ProgressState, rep: Partial<Record<Faction, number>>): void {
	for (const faction of FACTIONS) progress.rep[faction] = clampRep(progress.rep[faction] + (rep[faction] ?? 0));
}

/** A story piece picked up: false if it already had been. */
export function collect(id: string, cash = 0): boolean {
	const progress = current();
	if (progress.collected.includes(id)) return false;
	progress.collected.push(id);
	progress.cash += Math.max(0, Math.floor(cash));
	changed();
	return true;
}

/** A side job done: paid, and standing shifted. */
export function recordJob(cash: number, rep: Partial<Record<Faction, number>> = {}): void {
	const progress = current();
	progress.cash += Math.max(0, Math.floor(cash));
	progress.jobs++;
	applyRep(progress, rep);
	changed();
}

function grant(progress: ProgressState, reward: MissionReward): void {
	progress.cash += reward.cash ?? 0;
	for (const weapon of reward.weapons ?? []) {
		if (!progress.weapons.includes(weapon)) progress.weapons = WEAPON_IDS.filter((id) => id === weapon || progress.weapons.includes(id));
	}
	for (const car of reward.vehicles ?? []) {
		if (!progress.garage.some((owned) => owned.id === car.id)) progress.garage.push({ ...car });
	}
	applyRep(progress, reward.rep ?? {});
}

/** Sets story flags outright: for trying branches out in development, not for play. */
export function setFlags(flags: readonly string[]): void {
	const progress = current();
	for (const flag of flags) if (!progress.flags.includes(flag)) progress.flags.push(flag);
	changed();
}

export function addCash(amount: number): void {
	const progress = current();
	progress.cash = Math.max(0, progress.cash + Math.floor(amount));
	changed();
}

/** Back to a new game. */
export function resetProgress(): void {
	state = fresh();
	try {
		storage()?.removeItem(STORAGE_KEY);
	} catch {
		// Nothing saved to forget.
	}
	version++;
	for (const listener of [...listeners]) listener();
}

/** For tests: read and write here instead of localStorage (null for none), starting afresh. */
export function setProgressStorage(next: ProgressStorage | null | undefined): void {
	storageOverride = next;
	state = null;
}
