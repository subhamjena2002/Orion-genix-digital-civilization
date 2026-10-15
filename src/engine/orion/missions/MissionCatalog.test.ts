import { describe, expect, it } from "vitest";

import { routeTo } from "../navigation/Navigation";
import { pavedHeightAt } from "../roads/RoadNetwork";
import { HIGHWAY_GEOMETRY, highwayGroundAt, HIGHWAYS } from "../world/Highways";
import { MANIFESTS } from "./Collectibles";
import { ALL_MISSIONS, CHOP_SHOP, JOBS, MISSIONS, SAFEHOUSE } from "./MissionCatalog";
import { courseOf, missionSpawns, type Conditions, type MissionDefinition, type MissionSpawn } from "./MissionDirector";

const ids = new Set(MISSIONS.map((mission) => mission.id));

/** Every flag condition anywhere in a mission: what it reads. */
function flagsRead(mission: MissionDefinition): string[] {
	const conditions: (Conditions | undefined)[] = [
		mission.onlyIf,
		...mission.objectives.flatMap((objective) => [
			objective.onlyIf,
			...[...(objective.say ?? []), ...(objective.done ?? [])].map((line) => line.onlyIf),
			...(objective.kind === "choice" ? objective.options.flatMap((option) => [option.onlyIf, ...(option.say ?? []).map((line) => line.onlyIf)]) : []),
		]),
		...(mission.triggers ?? []).flatMap((trigger) => [trigger.when.flags, ...(trigger.say ?? []).map((line) => line.onlyIf)]),
		...[...(mission.intro ?? []), ...(mission.outro ?? [])].map((line) => line.onlyIf),
		(mission.bonuses ?? []).flatMap((bonus) => (bonus.kind === "flag" ? [bonus.flag] : [])),
	];
	return conditions.flatMap((condition) => condition ?? []).map((flag) => flag.replace(/^!/, ""));
}

/** Every flag a mission can set: objectives, choices, triggers. */
function flagsWritten(mission: MissionDefinition): string[] {
	return [
		...mission.objectives.flatMap((objective) => [...(objective.flags ?? []), ...(objective.kind === "choice" ? objective.options.flatMap((option) => option.flags ?? []) : [])]),
		...(mission.triggers ?? []).flatMap((trigger) => trigger.flags ?? []),
		// Set by the director itself when a tail is blown.
		...(mission.objectives.some((objective) => objective.kind === "tail") ? ["spotted"] : []),
	];
}

describe("the mission catalog", () => {
	it("has unique ids, and every prerequisite is a real mission listed before it", () => {
		expect(ids.size).toBe(MISSIONS.length);
		MISSIONS.forEach((mission, index) => {
			for (const required of mission.requires ?? []) {
				expect(ids.has(required), `${mission.id} requires ${required}`).toBe(true);
				expect(MISSIONS.findIndex((other) => other.id === required)).toBeLessThan(index);
			}
		});
	});

	it("opens with exactly one mission available", () => {
		expect(MISSIONS.filter((mission) => !mission.requires?.length).map((mission) => mission.id)).toEqual(["cold-open"]);
	});

	it("runs the story as one chain, each mission unlocking the next", () => {
		const story = MISSIONS.filter((mission) => (mission.chapter ?? "story") === "story");
		expect(story.length).toBeGreaterThanOrEqual(11);
		story.slice(1).forEach((mission, index) => expect(mission.requires, mission.id).toEqual([story[index].id]));
		expect(story[story.length - 1].id).toBe("meridian-job");
	});

	it("points every step jump at a step that exists", () => {
		for (const mission of ALL_MISSIONS) {
			const steps = new Set(["pass", ...mission.objectives.flatMap((objective) => (objective.step ? [objective.step] : []))]);
			expect(steps.size - 1, `${mission.id} step names are unique`).toBe(mission.objectives.filter((objective) => objective.step).length);
			const jumps = [
				...mission.objectives.flatMap((objective) => [
					objective.next,
					objective.kind === "tail" ? objective.spotted : undefined,
					...(objective.kind === "choice" ? objective.options.map((option) => option.next) : []),
				]),
				...(mission.triggers ?? []).flatMap((trigger) => [trigger.goto, trigger.when.step]),
			].filter((step): step is string => step !== undefined);
			for (const step of jumps) expect(steps.has(step), `${mission.id}: ${step}`).toBe(true);
		}
	});

	it("only offers choices that change something", () => {
		const read = new Set(MISSIONS.flatMap(flagsRead));
		for (const mission of ALL_MISSIONS) {
			for (const objective of mission.objectives) {
				if (objective.kind !== "choice") continue;
				expect(objective.options.length, mission.id).toBeGreaterThanOrEqual(2);
				// Each option leads somewhere of its own, or sets a flag something reads, or pays differently.
				const routes = new Set(objective.options.map((option) => option.next ?? objective.next ?? "on"));
				for (const option of objective.options) {
					const consequential = routes.size > 1 || (option.flags ?? []).some((flag) => read.has(flag)) || option.reward !== undefined;
					expect(consequential, `${mission.id}: "${option.label}"`).toBe(true);
				}
			}
		}
	});

	it("reads only flags that some mission before it (or itself) can set", () => {
		const written = new Set<string>();
		for (const mission of [...MISSIONS, ...JOBS]) {
			for (const flag of flagsWritten(mission)) written.add(flag);
			for (const flag of flagsRead(mission)) expect(written.has(flag), `${mission.id} reads ${flag}`).toBe(true);
		}
	});

	it("carries the big choices forward into later missions", () => {
		const laterReads = (from: string) => new Set(MISSIONS.slice(MISSIONS.findIndex((mission) => mission.id === from) + 1).flatMap(flagsRead));
		expect(laterReads("loose-lips").has("dez-owes")).toBe(true);
		expect(laterReads("loose-lips").has("dez-exposed")).toBe(true);
		expect(laterReads("quiet-money").has("ledger-police")).toBe(true);
		expect(laterReads("tailgate").has("jax-spared")).toBe(true);
		expect(laterReads("tailgate").has("jax-arrested")).toBe(true);
		expect(laterReads("extraction").has("marisol-saved")).toBe(true);
	});

	it("dresses a person shared between missions the same way", () => {
		const seen = new Map<string, string>();
		for (const spawn of ALL_MISSIONS.flatMap(missionSpawns)) {
			if (spawn.type !== "hostile") continue;
			const look = JSON.stringify([spawn.model ?? "manCasual", spawn.palette ?? null]);
			expect(seen.get(spawn.id) ?? look, spawn.id).toBe(look);
			seen.set(spawn.id, look);
		}
	});

	it("stands everyone on something: the streets, an expressway deck, or land above the sea", () => {
		for (const spawn of ALL_MISSIONS.flatMap(missionSpawns)) {
			if (spawn.type !== "hostile") continue;
			const outside = Math.abs(spawn.x) > 400 || Math.abs(spawn.z) > 240;
			if (!outside) continue;
			// Out past the grid, anyone near an expressway stands on its deck (not in the sea under it).
			const deck = highwayGroundAt(spawn.x, spawn.z);
			const nearHighway = HIGHWAYS.some((road) => road.samples.some((sample) => Math.hypot(sample.x - spawn.x, sample.z - spawn.z) < 40));
			if (nearHighway) expect(deck ?? pavedHeightAt(spawn.x, spawn.z), spawn.id).not.toBeNull();
		}
	});

	it("keeps the pools small: people and cars are shared between missions where they can be", () => {
		const people = new Set(ALL_MISSIONS.flatMap(missionSpawns).filter((spawn) => spawn.type === "hostile").map((spawn) => spawn.id));
		const cars = new Set(ALL_MISSIONS.flatMap(missionSpawns).filter((spawn) => spawn.type === "vehicle").map((spawn) => spawn.id));
		expect(people.size).toBeLessThanOrEqual(18);
		expect(cars.size).toBeLessThanOrEqual(24);
	});

	it("lists street jobs apart from the missions, ready to start from their lead", () => {
		for (const job of JOBS) {
			expect(job.chapter, job.id).toBe("job");
			expect(job.requires, job.id).toBeUndefined();
			expect(ids.has(job.id)).toBe(false);
			const route = routeTo(8, 16, job.giver.x, job.giver.z);
			expect(route, job.id).not.toBeNull();
		}
	});

	it("scatters the manifests apart, each somewhere distinct", () => {
		expect(new Set(MANIFESTS.map((manifest) => manifest.id)).size).toBe(MANIFESTS.length);
		for (let a = 0; a < MANIFESTS.length; a++) {
			for (let b = a + 1; b < MANIFESTS.length; b++) {
				expect(Math.hypot(MANIFESTS[a].x - MANIFESTS[b].x, MANIFESTS[a].z - MANIFESTS[b].z)).toBeGreaterThan(80);
			}
		}
	});

	it("puts every giver, safehouse and drop-off within reach of the roads", () => {
		const places = [
			...MISSIONS.map((mission) => ({ id: mission.id, x: mission.giver.x, z: mission.giver.z })),
			{ id: "safehouse", ...SAFEHOUSE.door },
			{ id: "chop-shop", x: CHOP_SHOP.x, z: CHOP_SHOP.z },
		];
		for (const place of places) {
			const route = routeTo(8, 16, place.x, place.z);
			expect(route, place.id).not.toBeNull();
			const end = route!.points[route!.points.length - 1];
			// The air base has no streets inside its walls: the GPS gets you to its road, the beam the rest.
			expect(Math.hypot(end[0] - place.x, end[1] - place.z), place.id).toBeLessThan(place.z > 300 && place.x > -50 && place.x < 250 ? 110 : 30);
		}
	});

	it("spawns everything its objectives name", () => {
		for (const mission of ALL_MISSIONS) {
			const spawns: MissionSpawn[] = missionSpawns(mission);
			const spawnIds = spawns.map((spawn) => spawn.id);
			expect(new Set(spawnIds).size, mission.id).toBe(spawnIds.length);
			const vehicles = new Set(spawns.filter((spawn) => spawn.type === "vehicle").map((spawn) => spawn.id));
			const people = new Set(spawns.filter((spawn) => spawn.type === "hostile").map((spawn) => spawn.id));
			for (const objective of mission.objectives) {
				if ((objective.kind === "enterVehicle" || objective.kind === "deliver") && objective.vehicle) expect(vehicles.has(objective.vehicle), objective.vehicle).toBe(true);
				if (objective.kind === "eliminate") for (const id of objective.targets) expect(people.has(id), id).toBe(true);
				if (objective.kind === "destroyVehicles" || objective.kind === "disable") for (const id of objective.kind === "disable" ? objective.targets : objective.ids) expect(vehicles.has(id), id).toBe(true);
				if (objective.kind === "tail") expect(vehicles.has(objective.target), objective.target).toBe(true);
				if (objective.kind === "inspect" && objective.person) expect(vehicles.has(objective.person) || people.has(objective.person), objective.person).toBe(true);
				if (objective.kind === "escort") expect(people.has(objective.person), objective.person).toBe(true);
				for (const id of objective.followers ?? []) expect(people.has(id), id).toBe(true);
			}
			for (const trigger of mission.triggers ?? []) {
				if (trigger.reroute) expect(vehicles.has(trigger.reroute.id), trigger.reroute.id).toBe(true);
				if (trigger.pace) expect(vehicles.has(trigger.pace.id), trigger.pace.id).toBe(true);
			}
			for (const id of mission.protect ?? []) expect(vehicles.has(id) || people.has(id), id).toBe(true);
		}
	});

	it("only stops cars whose drivers know to give up", () => {
		for (const mission of ALL_MISSIONS) {
			const cars = new Map(missionSpawns(mission).flatMap((spawn) => (spawn.type === "vehicle" ? [[spawn.id, spawn] as const] : [])));
			for (const objective of mission.objectives) {
				if (objective.kind !== "disable") continue;
				for (const id of objective.targets) expect(cars.get(id)?.disableBelow, id).toBe(objective.below);
			}
		}
	});

	it("drives the convoy in a lane, clear of the expressway's median and edges", () => {
		const expressway = HIGHWAYS.find((road) => road.id === "ghats-expressway")!;
		const convoy = MISSIONS.find((mission) => mission.id === "convoy")!;
		const vans = missionSpawns(convoy).filter((spawn) => spawn.type === "vehicle");
		expect(vans).toHaveLength(4);
		for (const van of vans) {
			const onHighway = (van.route ?? []).filter(([x]) => x < -420);
			expect(onHighway.length).toBeGreaterThan(10);
			for (const [x, z] of onHighway) {
				const fromCentre = Math.min(...expressway.samples.map((sample) => Math.hypot(sample.x - x, sample.z - z)));
				expect(fromCentre).toBeGreaterThan(HIGHWAY_GEOMETRY.median / 2 + 2);
				expect(fromCentre).toBeLessThan(HIGHWAY_GEOMETRY.halfWidth - 2);
			}
		}
	});

	it("gives every race rivals who drive its whole course, in lane, from the grid", () => {
		const races = MISSIONS.filter((mission) => mission.objectives.some((objective) => objective.kind === "race"));
		expect(races.length).toBeGreaterThanOrEqual(3);
		for (const mission of races) {
			const race = mission.objectives.find((objective) => objective.kind === "race")!;
			if (race.kind !== "race") continue;
			const course = courseOf(race);
			const rivals = (mission.spawns ?? []).filter((spawn) => spawn.type === "vehicle" && spawn.racer);
			expect(rivals.map((rival) => rival.id).sort(), mission.id).toEqual([...race.racers].sort());
			for (const rival of rivals) {
				if (rival.type !== "vehicle") continue;
				// The same checkpoints, one for one, each within reach of where the player must pass.
				expect(rival.route?.length, rival.id).toBe(course.length);
				rival.route!.forEach(([x, z], index) => {
					expect(Math.hypot(x - course[index].x, z - course[index].z)).toBeLessThan(course[index].radius);
				});
				expect(rival.cruise).toBeGreaterThan(20);
			}
			// Nobody starts on top of anyone else.
			const grid = (mission.spawns ?? []).map((spawn) => [spawn.x, spawn.z]);
			for (let a = 0; a < grid.length; a++) {
				for (let b = a + 1; b < grid.length; b++) expect(Math.hypot(grid[a][0] - grid[b][0], grid[a][1] - grid[b][1])).toBeGreaterThan(3);
			}
			expect(race.racers.every((id) => !mission.protect?.includes(id))).toBe(true);
		}
	});

	it("keeps a car shared between missions the same car", () => {
		const seen = new Map<string, string>();
		for (const mission of ALL_MISSIONS) {
			for (const spawn of missionSpawns(mission)) {
				if (spawn.type !== "vehicle") continue;
				const look = `${spawn.style} ${spawn.colour}`;
				expect(seen.get(spawn.id) ?? look, spawn.id).toBe(look);
				seen.set(spawn.id, look);
			}
		}
	});

	it("pays something for every mission", () => {
		for (const mission of MISSIONS) {
			const { cash = 0, weapons = [], vehicles = [] } = mission.reward;
			expect(cash + weapons.length + vehicles.length, mission.id).toBeGreaterThan(0);
		}
	});

	it("never asks for more garage space than there is", () => {
		const choiceCars = MISSIONS.flatMap((mission) => mission.objectives.flatMap((objective) => (objective.kind === "choice" ? objective.options.flatMap((option) => option.reward?.vehicles ?? []) : [])));
		const cars = [...MISSIONS.flatMap((mission) => mission.reward.vehicles ?? []), ...choiceCars];
		expect(cars.length).toBeLessThanOrEqual(SAFEHOUSE.bays.length);
	});
});
