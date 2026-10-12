import { describe, expect, it } from "vitest";

import { routeTo } from "../navigation/Navigation";
import { HIGHWAY_GEOMETRY, HIGHWAYS } from "../world/Highways";
import { CHOP_SHOP, MISSIONS, SAFEHOUSE } from "./MissionCatalog";
import { courseOf, type MissionSpawn } from "./MissionDirector";

const ids = new Set(MISSIONS.map((mission) => mission.id));

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
		expect(MISSIONS.filter((mission) => !mission.requires?.length).map((mission) => mission.id)).toEqual(["clean-wheels"]);
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
		for (const mission of MISSIONS) {
			const spawns: MissionSpawn[] = [...(mission.spawns ?? []), ...mission.objectives.flatMap((objective) => objective.spawns ?? [])];
			const spawnIds = spawns.map((spawn) => spawn.id);
			expect(new Set(spawnIds).size, mission.id).toBe(spawnIds.length);
			const vehicles = new Set(spawns.filter((spawn) => spawn.type === "vehicle").map((spawn) => spawn.id));
			const people = new Set(spawns.filter((spawn) => spawn.type === "hostile").map((spawn) => spawn.id));
			for (const objective of mission.objectives) {
				if ((objective.kind === "enterVehicle" || objective.kind === "deliver") && objective.vehicle) expect(vehicles.has(objective.vehicle), objective.vehicle).toBe(true);
				if (objective.kind === "eliminate") for (const id of objective.targets) expect(people.has(id), id).toBe(true);
				if (objective.kind === "destroyVehicles") for (const id of objective.ids) expect(vehicles.has(id), id).toBe(true);
			}
			for (const id of mission.protect ?? []) expect(vehicles.has(id) || people.has(id), id).toBe(true);
		}
	});

	it("drives the convoy in a lane, clear of the expressway's median and edges", () => {
		const expressway = HIGHWAYS.find((road) => road.id === "ghats-expressway")!;
		const convoy = MISSIONS.find((mission) => mission.id === "convoy")!;
		const vans = (convoy.spawns ?? []).filter((spawn) => spawn.type === "vehicle");
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
		for (const mission of MISSIONS) {
			for (const spawn of [...(mission.spawns ?? []), ...mission.objectives.flatMap((objective) => objective.spawns ?? [])]) {
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
		const cars = MISSIONS.flatMap((mission) => mission.reward.vehicles ?? []);
		expect(cars.length).toBeLessThanOrEqual(SAFEHOUSE.bays.length);
	});
});
