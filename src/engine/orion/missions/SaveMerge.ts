import { canonicalSave, MAX_CASH, MAX_JOBS, REP_RANGE, SAVE_FACTIONS, SAVE_STARTING_WEAPONS, SAVE_WEAPONS, type SaveData } from "./SaveSchema";

/**
 * Combining two copies of one player's progress: shared by the game (CloudSave, when another tab
 * saved first) and the save API (worker/auth.ts, when a guest's save joins their account). Like
 * SaveSchema it imports nothing from the game, so the Worker bundles it on its own.
 */

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** A new game's save, as Progress starts one. */
export function newGameSave(): SaveData {
	return canonicalSave({
		cash: 0,
		passed: [],
		bestTimes: {},
		weapons: [...SAVE_STARTING_WEAPONS],
		garage: [],
		flags: [],
		rep: { street: 0, sunset: 0, law: 0, meridian: 0 },
		ratings: {},
		collected: [],
		jobs: 0,
	});
}

/**
 * Both sides' progress since `base`, combined. With no base (nothing known in common) lists and
 * bests are combined, and counters take the larger side rather than adding — so a merge can
 * never pay anything out twice.
 */
export function mergeSaves(base: SaveData | null, local: SaveData, server: SaveData): SaveData {
	const list = <T>(key: (item: T) => string, was: readonly T[] | undefined, mine: readonly T[], theirs: readonly T[]): T[] => {
		const kept = new Set(mine.map(key));
		// Gone here since the base: only a new game removes anything, and that should hold.
		const dropped = new Set((was ?? []).map(key).filter((id) => !kept.has(id)));
		const out = theirs.filter((item) => !dropped.has(key(item)));
		const have = new Set(out.map(key));
		for (const item of mine) if (!have.has(key(item))) out.push(item);
		return out;
	};
	const best = (was: Record<string, number> | undefined, mine: Record<string, number>, theirs: Record<string, number>, pick: (a: number, b: number) => number) => {
		const out: Record<string, number> = {};
		for (const id of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
			if (was && id in was && !(id in mine)) continue;
			const values = [mine[id], theirs[id]].filter((n): n is number => n !== undefined);
			out[id] = values.reduce((a, b) => pick(a, b));
		}
		return out;
	};
	const counter = (was: number | undefined, mine: number, theirs: number) => (was === undefined ? Math.max(mine, theirs) : theirs + (mine - was));
	const text = (id: string) => id;

	const weapons = list(text, base?.weapons, local.weapons, server.weapons);
	for (const id of SAVE_STARTING_WEAPONS) if (!weapons.includes(id)) weapons.push(id);
	const rep = { ...server.rep };
	if (base) for (const faction of SAVE_FACTIONS) rep[faction] = clamp(server.rep[faction] + local.rep[faction] - base.rep[faction], -REP_RANGE, REP_RANGE);

	return canonicalSave({
		cash: clamp(counter(base?.cash, local.cash, server.cash), 0, MAX_CASH),
		jobs: clamp(counter(base?.jobs, local.jobs, server.jobs), 0, MAX_JOBS),
		passed: list(text, base?.passed, local.passed, server.passed),
		flags: list(text, base?.flags, local.flags, server.flags),
		collected: list(text, base?.collected, local.collected, server.collected),
		weapons: SAVE_WEAPONS.filter((id) => weapons.includes(id)),
		garage: list((car) => car.id, base?.garage, local.garage, server.garage),
		bestTimes: best(base?.bestTimes, local.bestTimes, server.bestTimes, Math.min),
		ratings: best(base?.ratings, local.ratings, server.ratings, Math.max),
		rep,
	});
}
