/**
 * The shape of a saved game, checked strictly: shared by the game (Progress, CloudSave) and the
 * save API (worker/index.ts), so it imports nothing — the Worker bundles it on its own.
 *
 * `parseProgress` in Progress is forgiving (anything odd in local storage falls back to a new
 * game's value); this is the opposite: anything odd is refused outright, because it's what the
 * server accepts from the network and what the game accepts back from the server.
 */

/** Bumped when the saved shape changes in a way an older reader can't follow. */
export const SAVE_SCHEMA_VERSION = 1;

export const SAVE_WEAPONS = ["fists", "sword", "pistol", "ar", "shotgun", "rocketLauncher", "grenade"] as const;
export const SAVE_FACTIONS = ["street", "sunset", "law", "meridian"] as const;
/** What a new game starts with: fists, a blade and a pistol (Progress's STARTING_WEAPONS). */
export const SAVE_STARTING_WEAPONS = ["fists", "sword", "pistol"] as const;

export type SaveWeapon = (typeof SAVE_WEAPONS)[number];
export type SaveFaction = (typeof SAVE_FACTIONS)[number];

export interface SaveVehicle {
	id: string;
	style: string;
	colour: string;
	name?: string;
}

/** The same fields as Progress's ProgressState; see there for what each one means. */
export interface SaveData {
	cash: number;
	passed: string[];
	bestTimes: Record<string, number>;
	weapons: SaveWeapon[];
	garage: SaveVehicle[];
	flags: string[];
	rep: Record<SaveFaction, number>;
	ratings: Record<string, number>;
	collected: string[];
	jobs: number;
}

/** Far beyond anything the game hands out, and well inside a safe integer. */
export const MAX_CASH = 1_000_000_000_000;
export const MAX_JOBS = 10_000_000;
export const REP_RANGE = 10;
/** Per list or map: the catalog has a few dozen missions, flags and pages. */
export const MAX_ENTRIES = 512;
/** A save as JSON, in characters; a full game is a few kilobytes. */
export const MAX_SAVE_CHARS = 16_384;

const SAVE_KEYS = ["cash", "passed", "bestTimes", "weapons", "garage", "flags", "rep", "ratings", "collected", "jobs"] as const;
const VEHICLE_KEYS = ["id", "style", "colour", "name"] as const;
/** Ids, flags, colours and names: short, and no control characters. */
const TEXT = /^[^\u0000-\u001f\u007f]{1,64}$/u;

export type SaveCheck = { ok: true; save: SaveData } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && TEXT.test(value);
const isWhole = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function textList(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > MAX_ENTRIES || !value.every(isText)) return null;
	return new Set(value).size === value.length ? [...value] : null;
}

function numberMap(value: unknown, accept: (n: unknown) => n is number): Record<string, number> | null {
	if (!isRecord(value)) return null;
	const entries = Object.entries(value);
	if (entries.length > MAX_ENTRIES) return null;
	const out: Record<string, number> = {};
	for (const [key, n] of entries) {
		if (!isText(key) || !accept(n)) return null;
		out[key] = n;
	}
	return out;
}

const isSeconds = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 10_000_000;
const isRating = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 3;

/** A save exactly as the game writes it, or the first thing wrong with it. */
export function checkSave(value: unknown): SaveCheck {
	const fail = (error: string): SaveCheck => ({ ok: false, error });
	if (!isRecord(value)) return fail("save");
	if (!onlyKeys(value, SAVE_KEYS) || !SAVE_KEYS.every((key) => key in value)) return fail("fields");
	if (!isWhole(value.cash, MAX_CASH)) return fail("cash");
	if (!isWhole(value.jobs, MAX_JOBS)) return fail("jobs");
	const passed = textList(value.passed);
	if (!passed) return fail("passed");
	const flags = textList(value.flags);
	if (!flags) return fail("flags");
	const collected = textList(value.collected);
	if (!collected) return fail("collected");
	const bestTimes = numberMap(value.bestTimes, isSeconds);
	if (!bestTimes) return fail("bestTimes");
	const ratings = numberMap(value.ratings, isRating);
	if (!ratings) return fail("ratings");

	const weapons = Array.isArray(value.weapons) ? value.weapons : null;
	if (!weapons || weapons.length > SAVE_WEAPONS.length || new Set(weapons).size !== weapons.length) return fail("weapons");
	if (!weapons.every((id) => (SAVE_WEAPONS as readonly unknown[]).includes(id))) return fail("weapons");

	if (!Array.isArray(value.garage) || value.garage.length > MAX_ENTRIES) return fail("garage");
	const garage: SaveVehicle[] = [];
	for (const car of value.garage) {
		if (!isRecord(car) || !onlyKeys(car, VEHICLE_KEYS)) return fail("garage");
		if (!isText(car.id) || !isText(car.style) || !isText(car.colour)) return fail("garage");
		if (car.name !== undefined && !isText(car.name)) return fail("garage");
		if (garage.some((owned) => owned.id === car.id)) return fail("garage");
		garage.push(car.name === undefined ? { id: car.id, style: car.style, colour: car.colour } : { id: car.id, style: car.style, colour: car.colour, name: car.name });
	}

	if (!isRecord(value.rep) || !onlyKeys(value.rep, SAVE_FACTIONS)) return fail("rep");
	const rep = {} as Record<SaveFaction, number>;
	for (const faction of SAVE_FACTIONS) {
		const n = value.rep[faction];
		if (typeof n !== "number" || !Number.isInteger(n) || Math.abs(n) > REP_RANGE) return fail("rep");
		rep[faction] = n;
	}

	return {
		ok: true,
		save: {
			cash: value.cash, passed, bestTimes, weapons: weapons as SaveWeapon[], garage, flags, rep, ratings, collected, jobs: value.jobs,
		},
	};
}

/**
 * A save in a fixed order: map keys sorted, garage cars down to their own fields. Two saves
 * holding the same progress give the same JSON, so it's also how they're compared.
 */
export function canonicalSave(save: SaveData): SaveData {
	const sortedMap = (map: Record<string, number>) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
	return {
		cash: save.cash,
		passed: [...save.passed],
		bestTimes: sortedMap(save.bestTimes),
		weapons: SAVE_WEAPONS.filter((id) => save.weapons.includes(id)),
		garage: save.garage.map((car) => (car.name === undefined ? { id: car.id, style: car.style, colour: car.colour } : { id: car.id, style: car.style, colour: car.colour, name: car.name })),
		flags: [...save.flags],
		rep: { street: save.rep.street, sunset: save.rep.sunset, law: save.rep.law, meridian: save.rep.meridian },
		ratings: sortedMap(save.ratings),
		collected: [...save.collected],
		jobs: save.jobs,
	};
}

/** Whether two saves hold the same progress, whatever order their lists are in. */
export function sameSave(a: SaveData, b: SaveData): boolean {
	const key = (save: SaveData) => {
		const c = canonicalSave(save);
		return JSON.stringify({ ...c, passed: [...c.passed].sort(), flags: [...c.flags].sort(), collected: [...c.collected].sort(), garage: [...c.garage].sort((x, y) => (x.id < y.id ? -1 : 1)) });
	};
	return key(a) === key(b);
}
