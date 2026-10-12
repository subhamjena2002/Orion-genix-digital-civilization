import type { WeaponId } from "../combat/WeaponData";
import type { MissionDefinition, MissionReward, RewardVehicle } from "./MissionDirector";

/**
 * How far the player has got: the cash in their pocket, the missions passed (and best times on
 * the timed ones), the weapons they've earned and the cars waiting in their garage.
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
}

/** What a new game starts with: fists, a blade and a pistol. */
export const STARTING_WEAPONS: readonly WeaponId[] = ["fists", "sword", "pistol"];

const STORAGE_KEY = "orion.progress.v1";
const WEAPON_IDS: readonly WeaponId[] = ["fists", "sword", "pistol", "ar", "shotgun", "rocketLauncher"];

type ProgressStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let storageOverride: ProgressStorage | null | undefined;
let state: ProgressState | null = null;
let version = 0;
const listeners = new Set<() => void>();

function fresh(): ProgressState {
	return { cash: 0, passed: [], bestTimes: {}, weapons: [...STARTING_WEAPONS], garage: [] };
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
	return progress;
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

/** Missions whose prerequisites are all passed, and that haven't been passed themselves. */
export function availableMissions(catalog: readonly MissionDefinition[]): MissionDefinition[] {
	return catalog.filter((mission) => !hasPassed(mission.id) && (mission.requires ?? []).every(hasPassed));
}

/**
 * A mission passed: its reward paid the first time (a replay pays nothing), and its time kept if
 * it was the quickest yet.
 */
export function recordPass(mission: MissionDefinition, seconds: number): void {
	const progress = current();
	if (!progress.passed.includes(mission.id)) {
		progress.passed.push(mission.id);
		grant(progress, mission.reward);
	}
	if (mission.timed) {
		const best = progress.bestTimes[mission.id];
		if (best === undefined || seconds < best) progress.bestTimes[mission.id] = seconds;
	}
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
