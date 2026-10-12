import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { activeTarget, clearWaypoint, setObjective, setWaypoint } from "../navigation/Navigation";
import { emitGameEvent } from "./GameEvents";
import { AREA_GRACE_SECONDS, FAILED_RESULT_SECONDS, MissionDirector, ordinal, RACE_COUNTDOWN, RESULT_SECONDS, type MissionDefinition, type MissionEvent, type MissionSpawn, type Objective, type PlayerView } from "./MissionDirector";
import { readMissionHud } from "./MissionHud";

const at = (x: number, z: number, extra: Partial<PlayerView> = {}): PlayerView => ({ x, y: 0, z, vehicleIntegrity: 100, wantedStars: 0, ...extra });

function mission(objectives: Objective[], extra: Partial<MissionDefinition> = {}): MissionDefinition {
	return { id: "test", title: "Test Run", giver: { name: "Rico", x: 0, z: 0 }, briefing: "", reward: { cash: 100 }, objectives, ...extra };
}

let director: MissionDirector;
let events: MissionEvent[];

beforeEach(() => {
	director = new MissionDirector();
	events = [];
	director.on((event) => events.push(event));
});

afterEach(() => {
	director.dispose();
	clearWaypoint();
	setObjective(null);
});

describe("MissionDirector", () => {
	it("briefs, then starts on accept", () => {
		const run = mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 10 }]);
		director.brief(run);
		expect(director.phase).toBe("briefing");
		expect(readMissionHud().phase).toBe("briefing");
		director.accept();
		expect(director.phase).toBe("active");
		expect(director.objective?.label).toBe("Go");
	});

	it("can be declined", () => {
		director.brief(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 10 }]));
		director.decline();
		expect(director.phase).toBe("idle");
		expect(director.mission).toBeNull();
	});

	it("walks through the objectives, steering the GPS ahead of the waypoint", () => {
		setWaypoint(-50, -50);
		director.start(mission([
			{ kind: "goto", label: "Get to the docks", x: 100, z: 0, radius: 10 },
			{ kind: "enterVehicle", label: "Take the boat", vehicle: "boat-1", x: 110, z: 0 },
			{ kind: "goto", label: "Back to Rico", x: 0, z: 0, radius: 10 },
		]));
		expect(activeTarget()?.label).toBe("Get to the docks");
		director.update(0.1, at(50, 0));
		expect(director.objective?.label).toBe("Get to the docks");
		director.update(0.1, at(95, 0));
		expect(activeTarget()?.label).toBe("Take the boat");
		emitGameEvent({ type: "vehicleEntered", id: "boat-2", kind: "car", police: false });
		expect(director.objective?.kind).toBe("enterVehicle");
		emitGameEvent({ type: "vehicleEntered", id: "boat-1", kind: "car", police: false });
		director.update(0.1, at(3, 0));
		expect(director.phase).toBe("passed");
		// The mission's done with the GPS: back to the player's own waypoint.
		expect(activeTarget()?.kind).toBe("waypoint");
		expect(events.map((event) => event.type)).toEqual(["started", "objective", "objective", "objective", "complete"]);
	});

	it("matches any vehicle of the asked-for kind", () => {
		director.start(mission([
			{ kind: "enterVehicle", label: "Steal a police car", police: true, x: 0, z: 0 },
			{ kind: "enterVehicle", label: "Get in a jet", vehicleKind: "jet", x: 0, z: 0 },
		]));
		emitGameEvent({ type: "vehicleEntered", id: "taxi-1", kind: "car", police: false });
		expect(director.objectiveIndex).toBe(0);
		emitGameEvent({ type: "vehicleEntered", id: "patrol-parked-1", kind: "car", police: true });
		expect(director.objectiveIndex).toBe(1);
		emitGameEvent({ type: "vehicleEntered", id: "jet-3", kind: "jet", police: false });
		expect(director.phase).toBe("passed");
	});

	it("counts an enter-vehicle objective done when already sat in the right one", () => {
		emitGameEvent({ type: "vehicleEntered", id: "mission-car", kind: "car", police: false });
		director.start(mission([
			{ kind: "enterVehicle", label: "Get in", vehicle: "mission-car", x: 0, z: 0 },
			{ kind: "goto", label: "Go", x: 100, z: 0, radius: 10 },
		]));
		expect(director.objective?.label).toBe("Go");
		emitGameEvent({ type: "vehicleExited", id: "mission-car", kind: "car" });
	});

	it("delivers only in the right vehicle, and in good enough shape", () => {
		const run = mission([{ kind: "deliver", label: "Drop it off", vehicle: "car-a", x: 100, z: 0, radius: 10, minIntegrity: 60 }]);
		director.start(run);
		director.update(0.1, at(100, 0));
		expect(director.phase).toBe("active");
		emitGameEvent({ type: "vehicleEntered", id: "car-b", kind: "car", police: false });
		director.update(0.1, at(100, 0));
		expect(director.phase).toBe("active");
		emitGameEvent({ type: "vehicleExited", id: "car-b", kind: "car" });
		emitGameEvent({ type: "vehicleEntered", id: "car-a", kind: "car", police: false });
		director.update(0.1, at(100, 0, { vehicleIntegrity: 80 }));
		expect(director.phase).toBe("passed");

		director.start(run);
		director.update(0.1, at(100, 0, { vehicleIntegrity: 30 }));
		expect(director.phase).toBe("failed");
		emitGameEvent({ type: "vehicleExited", id: "car-a", kind: "car" });
	});

	it("counts down targets and passes when the last goes down", () => {
		director.start(mission([{ kind: "eliminate", label: "Take them out", x: 0, z: 0, targets: ["a", "b", "c"] }]));
		emitGameEvent({ type: "personKilled", id: "a", byPlayer: true });
		emitGameEvent({ type: "personKilled", id: "a", byPlayer: true });
		emitGameEvent({ type: "personKilled", id: "someone-else", byPlayer: true });
		expect(readMissionHud().counter).toBe("1/3");
		emitGameEvent({ type: "personKilled", id: "b", byPlayer: false });
		emitGameEvent({ type: "personKilled", id: "c", byPlayer: true });
		expect(director.phase).toBe("passed");
	});

	it("destroys vehicles, and fails if one gets away", () => {
		const run = mission([{ kind: "destroyVehicles", label: "Stop the convoy", x: 0, z: 0, ids: ["van-1", "van-2"] }]);
		director.start(run);
		emitGameEvent({ type: "vehicleDestroyed", id: "van-1", byPlayer: true });
		emitGameEvent({ type: "actorEscaped", id: "van-1" });
		expect(director.phase).toBe("active");
		emitGameEvent({ type: "actorEscaped", id: "van-2" });
		expect(director.phase).toBe("failed");
		expect(readMissionHud().failReason).toBe("They got away");
	});

	it("goes through checkpoints in order, including their height", () => {
		director.start(mission([{
			kind: "checkpoints",
			label: "Fly the rings",
			points: [{ x: 0, z: 100, y: 50, radius: 10 }, { x: 0, z: 200, y: 80, radius: 10 }],
		}]));
		director.update(0.1, at(0, 200, { y: 80 }));
		expect(readMissionHud().counter).toBe("0/2");
		director.update(0.1, at(0, 100, { y: 0 }));
		expect(readMissionHud().counter).toBe("0/2");
		director.update(0.1, at(0, 100, { y: 52 }));
		expect(readMissionHud().counter).toBe("1/2");
		expect(activeTarget()?.z).toBe(200);
		director.update(0.1, at(0, 200, { y: 75 }));
		expect(director.phase).toBe("passed");
	});

	it("waits for the stars, then for them to be lost", () => {
		director.start(mission([
			{ kind: "wanted", label: "Get noticed", stars: 2 },
			{ kind: "loseWanted", label: "Lose the cops" },
		]));
		director.update(0.1, at(0, 0, { wantedStars: 1 }));
		expect(director.objectiveIndex).toBe(0);
		// No place to go: the GPS stands down while it's about the police.
		expect(activeTarget()).toBeNull();
		director.update(0.1, at(0, 0, { wantedStars: 2 }));
		director.update(0.1, at(0, 0, { wantedStars: 2 }));
		expect(director.objectiveIndex).toBe(1);
		director.update(0.1, at(0, 0, { wantedStars: 0 }));
		expect(director.phase).toBe("passed");
	});

	it("fails when the clock runs out", () => {
		director.start(mission([{ kind: "goto", label: "Hurry", x: 100, z: 0, radius: 5, timeLimit: 10 }]));
		director.update(6, at(0, 0));
		expect(readMissionHud().timeLeft).toBeCloseTo(4);
		director.update(5, at(0, 0));
		expect(director.phase).toBe("failed");
		expect(readMissionHud().failReason).toBe("Out of time");
	});

	it("survives for long enough", () => {
		director.start(mission([{ kind: "survive", label: "Hold out", x: 0, z: 0, seconds: 30 }]));
		director.update(20, at(0, 0));
		expect(director.phase).toBe("active");
		director.update(11, at(0, 0));
		expect(director.phase).toBe("passed");
	});

	it("fails on death or arrest, standing the GPS down", () => {
		const run = mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 10 }]);
		director.start(run);
		emitGameEvent({ type: "playerDied" });
		expect(director.phase).toBe("failed");
		expect(activeTarget()).toBeNull();
		director.start(run);
		emitGameEvent({ type: "playerBusted" });
		expect(readMissionHud().failReason).toBe("Busted");
	});

	it("fails when something it protects is lost", () => {
		director.start(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 10 }], { protect: ["the-car"] }));
		emitGameEvent({ type: "vehicleDestroyed", id: "another", byPlayer: true });
		expect(director.phase).toBe("active");
		emitGameEvent({ type: "vehicleDestroyed", id: "the-car", byPlayer: false });
		expect(director.phase).toBe("failed");
	});

	it("gives the player a while to get back into the area", () => {
		director.start(mission([{ kind: "survive", label: "Hold", x: 0, z: 0, seconds: 999 }], { area: { x: 0, z: 0, radius: 50 } }));
		director.update(AREA_GRACE_SECONDS - 1, at(100, 0));
		expect(readMissionHud().outsideArea).toBeCloseTo(1);
		director.update(0.5, at(10, 0));
		director.update(AREA_GRACE_SECONDS - 1, at(100, 0));
		expect(director.phase).toBe("active");
		director.update(1.5, at(100, 0));
		expect(director.phase).toBe("failed");
	});

	it("spawns and clears its actors however it ends", () => {
		const spawned: string[] = [];
		let cleared = 0;
		director.setStage({ spawn: (spawns: readonly MissionSpawn[]) => spawned.push(...spawns.map((spawn) => spawn.id)), clear: () => cleared++ });
		const car: MissionSpawn = { type: "vehicle", id: "car", style: "sedan", colour: "#fff", x: 0, z: 0, yaw: 0 };
		const goon: MissionSpawn = { type: "hostile", id: "goon", x: 0, z: 0, armed: true };
		const run = mission([
			{ kind: "goto", label: "Go", x: 100, z: 0, radius: 10 },
			{ kind: "eliminate", label: "Get him", x: 0, z: 0, targets: ["goon"], spawns: [goon] },
		], { spawns: [car] });
		director.start(run);
		expect(spawned).toEqual(["car"]);
		director.update(0.1, at(100, 0));
		expect(spawned).toEqual(["car", "goon"]);
		emitGameEvent({ type: "personKilled", id: "goon", byPlayer: true });
		expect(cleared).toBe(1);
		director.start(run);
		director.fail("test");
		expect(cleared).toBe(2);
		director.start(run);
		director.stop();
		expect(cleared).toBe(3);
	});

	it("shows the result for a while, then goes idle", () => {
		director.start(mission([{ kind: "goto", label: "Go", x: 0, z: 0, radius: 10 }]));
		director.update(0.1, at(0, 0));
		expect(director.phase).toBe("passed");
		const complete = events.find((event) => event.type === "complete");
		expect(complete?.type === "complete" && complete.seconds).toBeCloseTo(0.1);
		director.update(RESULT_SECONDS + 0.1, at(0, 0));
		expect(director.phase).toBe("idle");
		expect(readMissionHud().phase).toBe("idle");
	});

	it("keeps a failure up longer, to offer a retry", () => {
		director.start(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 10 }]));
		director.fail("test");
		director.update(RESULT_SECONDS + 0.1, at(0, 0));
		expect(director.phase).toBe("failed");
		director.update(FAILED_RESULT_SECONDS, at(0, 0));
		expect(director.phase).toBe("idle");
	});

	it("raises the alarm, and won't take a delivery with the police still on you", () => {
		const alarms: number[] = [];
		director.setStage({ spawn: () => undefined, clear: () => undefined, alarm: (stars) => alarms.push(stars) });
		director.start(mission([
			{ kind: "enterVehicle", label: "Get in", vehicle: "car", x: 0, z: 0 },
			{ kind: "deliver", label: "Drop it off", vehicle: "car", x: 100, z: 0, radius: 10, clean: true, wanted: 2 },
		]));
		expect(alarms).toEqual([]);
		emitGameEvent({ type: "vehicleEntered", id: "car", kind: "car", police: false });
		expect(alarms).toEqual([2]);
		director.update(0.1, at(100, 0, { wantedStars: 2 }));
		expect(director.phase).toBe("active");
		expect(readMissionHud().objective).toBe("Lose the cops first");
		director.update(0.1, at(100, 0, { wantedStars: 0 }));
		expect(director.phase).toBe("passed");
		emitGameEvent({ type: "vehicleExited", id: "car", kind: "car" });
	});

	it("counts targets dealt with before their objective, and fails on one that got away early", () => {
		const run = mission([
			{ kind: "enterVehicle", label: "Take the gunship", vehicleKind: "gunship", x: 0, z: 0 },
			{ kind: "destroyVehicles", label: "Stop them", x: 0, z: 0, ids: ["van-1", "van-2"] },
		]);
		director.start(run);
		emitGameEvent({ type: "vehicleDestroyed", id: "van-1", byPlayer: true });
		emitGameEvent({ type: "vehicleEntered", id: "gunship", kind: "gunship", police: false });
		expect(readMissionHud().counter).toBe("1/2");
		emitGameEvent({ type: "vehicleDestroyed", id: "van-2", byPlayer: true });
		expect(director.phase).toBe("passed");
		emitGameEvent({ type: "vehicleExited", id: "gunship", kind: "gunship" });

		director.start(run);
		emitGameEvent({ type: "actorEscaped", id: "van-2" });
		expect(director.phase).toBe("failed");
	});

	describe("races", () => {
		const course = [{ x: 100, z: 0, radius: 10 }, { x: 200, z: 0, radius: 10 }];
		const race = (extra: Partial<Extract<Objective, { kind: "race" }>> = {}) => mission([
			{ kind: "race", label: "Win", points: course, laps: 2, racers: ["r1", "r2"], ...extra },
		]);
		let started: string[];
		let progress: Record<string, { passed: number; x: number; z: number }>;

		beforeEach(() => {
			started = [];
			progress = {};
			director.setStage({
				spawn: () => undefined,
				clear: () => undefined,
				startRace: (ids) => started.push(...ids),
				racerProgress: (id) => progress[id] ?? null,
			});
			emitGameEvent({ type: "vehicleEntered", id: "coupe", kind: "car", police: false });
		});

		afterEach(() => {
			emitGameEvent({ type: "vehicleExited", id: "coupe", kind: "car" });
		});

		it("counts down on the grid, then lets the rivals go", () => {
			director.start(race());
			expect(director.raceCountdown).toBeCloseTo(RACE_COUNTDOWN);
			expect(readMissionHud().countdown).toBe("3");
			director.update(1.2, at(0, 0));
			expect(readMissionHud().countdown).toBe("2");
			// Through a checkpoint before the start doesn't count.
			director.update(0.1, at(100, 0));
			expect(readMissionHud().counter).toBe("1st of 3 · Lap 1/2");
			director.update(1.8, at(0, 0));
			expect(started).toEqual(["r1", "r2"]);
			expect(director.raceCountdown).toBe(0);
			expect(readMissionHud().countdown).toBe("GO");
		});

		it("goes round the laps, placed against the rivals, and wins at the line", () => {
			director.start(race({ countdown: 0 }));
			expect(started).toEqual(["r1", "r2"]);
			progress.r1 = { passed: 1, x: 150, z: 0 };
			progress.r2 = { passed: 0, x: 10, z: 0 };
			director.update(0.1, at(20, 0));
			expect(readMissionHud().counter).toBe("2nd of 3 · Lap 1/2");
			director.update(0.1, at(100, 0));
			director.update(0.1, at(200, 0));
			expect(readMissionHud().counter).toBe("1st of 3 · Lap 2/2");
			director.update(0.1, at(100, 0));
			director.update(0.1, at(200, 0));
			expect(director.phase).toBe("passed");
		});

		it("needs a vehicle: no running the course on foot", () => {
			director.start(race({ countdown: 0 }));
			emitGameEvent({ type: "vehicleExited", id: "coupe", kind: "car" });
			director.update(0.1, at(100, 0));
			expect(readMissionHud().objective).toBe("Get back in a vehicle");
			expect(readMissionHud().counter).toBe("1st of 3 · Lap 1/2");
			emitGameEvent({ type: "vehicleEntered", id: "coupe", kind: "car", police: false });
			director.update(0.1, at(100, 0));
			expect(readMissionHud().objective).toBe("Win");
		});

		it("is lost when a rival crosses the line first, unless a lower place will do", () => {
			director.start(race({ countdown: 0 }));
			emitGameEvent({ type: "racerFinished", id: "r1" });
			expect(director.phase).toBe("failed");
			expect(readMissionHud().failReason).toBe("Beaten to the line: 2nd at best");

			director.start(race({ countdown: 0, place: 2 }));
			emitGameEvent({ type: "racerFinished", id: "r1" });
			expect(director.phase).toBe("active");
			emitGameEvent({ type: "racerFinished", id: "someone-else" });
			emitGameEvent({ type: "racerFinished", id: "r2" });
			expect(director.phase).toBe("failed");
		});
	});

	it("names places in order", () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
	});

	it("ignores game events when no mission is running", () => {
		emitGameEvent({ type: "playerDied" });
		expect(director.phase).toBe("idle");
		expect(events).toEqual([]);
	});
});
