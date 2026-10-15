import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MissionDefinition } from "./MissionDirector";
import { addCash, availableMissions, collect, hasCollected, hasFlag, hasPassed, ownsWeapon, parseProgress, readProgress, recordJob, recordPass, REP_LIMIT, resetProgress, setProgressStorage, STARTING_WEAPONS } from "./Progress";

class MemoryStorage {
	public readonly items = new Map<string, string>();
	public getItem(key: string) {
		return this.items.get(key) ?? null;
	}
	public setItem(key: string, value: string) {
		this.items.set(key, value);
	}
	public removeItem(key: string) {
		this.items.delete(key);
	}
}

const mission = (id: string, extra: Partial<MissionDefinition> = {}): MissionDefinition => ({
	id, title: id, giver: { name: "", x: 0, z: 0 }, briefing: "", reward: {}, objectives: [], ...extra,
});

let storage: MemoryStorage;

beforeEach(() => {
	storage = new MemoryStorage();
	setProgressStorage(storage);
});

afterEach(() => {
	setProgressStorage(undefined);
});

describe("progress", () => {
	it("starts a new game with the starting weapons and nothing else", () => {
		const progress = readProgress();
		expect(progress.cash).toBe(0);
		expect(progress.passed).toEqual([]);
		expect(progress.weapons).toEqual(STARTING_WEAPONS);
		expect(ownsWeapon("rocketLauncher")).toBe(false);
	});

	it("pays out a mission's reward and saves it", () => {
		recordPass(mission("m1", { reward: { cash: 500, weapons: ["shotgun"], vehicles: [{ id: "gt", style: "luxury", colour: "#b3121b" }] } }), 60);
		expect(readProgress().cash).toBe(500);
		expect(ownsWeapon("shotgun")).toBe(true);
		expect(readProgress().garage.map((car) => car.id)).toEqual(["gt"]);

		// A reload reads it all back.
		setProgressStorage(storage);
		expect(hasPassed("m1")).toBe(true);
		expect(readProgress().cash).toBe(500);
		expect(readProgress().weapons).toContain("shotgun");
		expect(readProgress().garage).toHaveLength(1);
	});

	it("keeps weapons in slot order, and pays nothing for a replay", () => {
		const run = mission("m", { reward: { cash: 100, weapons: ["rocketLauncher", "ar"], vehicles: [{ id: "gt", style: "luxury", colour: "#000" }] } });
		recordPass(run, 10);
		recordPass(run, 10);
		expect(readProgress().weapons).toEqual(["fists", "sword", "pistol", "ar", "rocketLauncher"]);
		expect(readProgress().garage).toHaveLength(1);
		expect(readProgress().cash).toBe(100);
	});

	it("keeps the best time on a timed mission", () => {
		const race = mission("race", { timed: true });
		recordPass(race, 90);
		recordPass(race, 120);
		expect(readProgress().bestTimes.race).toBe(90);
		recordPass(race, 75);
		expect(readProgress().bestTimes.race).toBe(75);
	});

	it("offers missions once their prerequisites are passed", () => {
		const catalog = [mission("a"), mission("b", { requires: ["a"] }), mission("c", { requires: ["a", "b"] })];
		expect(availableMissions(catalog).map((m) => m.id)).toEqual(["a"]);
		recordPass(catalog[0], 1);
		expect(availableMissions(catalog).map((m) => m.id)).toEqual(["b"]);
		recordPass(catalog[1], 1);
		expect(availableMissions(catalog).map((m) => m.id)).toEqual(["c"]);
	});

	it("never lets cash go negative", () => {
		addCash(100);
		addCash(-500);
		expect(readProgress().cash).toBe(0);
	});

	it("can be reset to a new game", () => {
		recordPass(mission("a", { reward: { cash: 10 } }), 1);
		resetProgress();
		expect(readProgress().cash).toBe(0);
		expect(storage.items.size).toBe(0);
	});

	it("plays on without storage", () => {
		setProgressStorage(null);
		recordPass(mission("a", { reward: { cash: 10 } }), 1);
		expect(readProgress().cash).toBe(10);
	});

	it("plays on when storage throws", () => {
		setProgressStorage({
			getItem: () => { throw new Error("denied"); },
			setItem: () => { throw new Error("denied"); },
			removeItem: () => { throw new Error("denied"); },
		});
		expect(readProgress().cash).toBe(0);
		addCash(5);
		expect(readProgress().cash).toBe(5);
	});
});

describe("parseProgress", () => {
	it("falls back to a new game on junk", () => {
		expect(parseProgress("not json").cash).toBe(0);
		expect(parseProgress("null").weapons).toEqual(STARTING_WEAPONS);
		expect(parseProgress("[1,2]").passed).toEqual([]);
	});

	it("keeps only the well-formed parts", () => {
		const progress = parseProgress(JSON.stringify({
			cash: -50,
			passed: ["a", 3, null],
			bestTimes: { a: 12, b: "fast", c: -1 },
			weapons: ["ar", "laser"],
			garage: [{ id: "gt", style: "luxury", colour: "#000" }, { id: 1 }],
		}));
		expect(progress.cash).toBe(0);
		expect(progress.passed).toEqual(["a"]);
		expect(progress.bestTimes).toEqual({ a: 12 });
		expect(progress.weapons).toEqual(["fists", "sword", "pistol", "ar"]);
		expect(progress.garage).toHaveLength(1);
	});
});

describe("the story so far", () => {
	it("keeps a pass's choices, standing and extra pay the first time only", () => {
		const run = mission("m", { reward: { cash: 100, rep: { street: 1 } } });
		recordPass(run, 10, { flags: ["dez-owes"], rating: 2, extras: [{ cash: 50, rep: { law: -2 } }] });
		expect(readProgress().cash).toBe(150);
		expect(hasFlag("dez-owes")).toBe(true);
		expect(readProgress().rep).toEqual({ street: 1, sunset: 0, law: -2, meridian: 0 });
		// A replay choosing differently changes neither the story nor the purse; a better rating is kept.
		recordPass(run, 10, { flags: ["dez-exposed"], rating: 3, extras: [{ cash: 50 }] });
		expect(readProgress().cash).toBe(150);
		expect(hasFlag("dez-exposed")).toBe(false);
		expect(readProgress().ratings.m).toBe(3);
		recordPass(run, 10, { rating: 1 });
		expect(readProgress().ratings.m).toBe(3);
		// And it all survives a reload.
		setProgressStorage(storage);
		expect(hasFlag("dez-owes")).toBe(true);
		expect(readProgress().rep.law).toBe(-2);
		expect(readProgress().ratings.m).toBe(3);
	});

	it("holds back missions whose story flags don't hold", () => {
		const catalog = [mission("a"), mission("only-if-owed", { requires: ["a"], onlyIf: ["dez-owes"] })];
		recordPass(catalog[0], 1);
		expect(availableMissions(catalog).map((m) => m.id)).toEqual([]);
		recordPass(mission("x"), 1, { flags: ["dez-owes"] });
		expect(availableMissions(catalog).map((m) => m.id)).toEqual(["only-if-owed"]);
	});

	it("keeps standing within its limits", () => {
		for (let i = 0; i < 30; i++) recordJob(10, { sunset: 1, meridian: -1 });
		expect(readProgress().rep.sunset).toBe(REP_LIMIT);
		expect(readProgress().rep.meridian).toBe(-REP_LIMIT);
		expect(readProgress().jobs).toBe(30);
		expect(readProgress().cash).toBe(300);
	});

	it("pays for a story piece once", () => {
		expect(collect("manifest-1", 250)).toBe(true);
		expect(collect("manifest-1", 250)).toBe(false);
		expect(hasCollected("manifest-1")).toBe(true);
		expect(readProgress().cash).toBe(250);
	});

	it("reads back only well-formed story state", () => {
		const progress = parseProgress(JSON.stringify({
			flags: ["a", 1, "a"],
			rep: { street: 4.4, law: "high", meridian: -99 },
			ratings: { m: 2, n: 7, o: "three" },
			collected: ["manifest-2", null],
			jobs: -3,
		}));
		expect(progress.flags).toEqual(["a"]);
		expect(progress.rep).toEqual({ street: 4, sunset: 0, law: 0, meridian: -REP_LIMIT });
		expect(progress.ratings).toEqual({ m: 2 });
		expect(progress.collected).toEqual(["manifest-2"]);
		expect(progress.jobs).toBe(0);
		// A save from before any of this loads as a story not yet begun.
		expect(parseProgress(JSON.stringify({ cash: 10, passed: ["clean-wheels"] })).flags).toEqual([]);
	});
});
