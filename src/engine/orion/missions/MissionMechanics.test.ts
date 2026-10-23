import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { activeTarget, clearWaypoint, setObjective } from "../navigation/Navigation";
import { emitGameEvent } from "./GameEvents";
import { holds, lineSeconds, LOSE_SECONDS, MissionDirector, NOTICE_SECONDS, ratingFor, SPOT_SECONDS, type ActorState, type MissionDefinition, type MissionEvent, type MissionStage, type Objective, type PlayerView } from "./MissionDirector";
import { readMissionHud } from "./MissionHud";

/** The director's newer mechanics, one at a time: branches, triggers, tails, stops, searches, escorts, bonuses, checkpoints, dialogue. */

const at = (x: number, z: number, extra: Partial<PlayerView> = {}): PlayerView => ({ x, y: 0, z, vehicleIntegrity: 100, wantedStars: 0, ...extra });

function mission(objectives: Objective[], extra: Partial<MissionDefinition> = {}): MissionDefinition {
	return { id: "test", title: "Test", giver: { name: "Rico", x: 0, z: 0 }, briefing: "", reward: { cash: 100 }, objectives, ...extra };
}

let director: MissionDirector;
let events: MissionEvent[];
let actors: Map<string, ActorState>;
let calls: string[];
let cleared: number;

const stage: MissionStage = {
	spawn: (spawns) => {
		for (const spawn of spawns) {
			calls.push(`spawn ${spawn.id}`);
			actors.set(spawn.id, { x: spawn.x, z: spawn.z, integrity: 100 });
		}
	},
	clear: () => {
		cleared++;
		actors.clear();
	},
	actor: (id) => actors.get(id) ?? null,
	follow: (id, on) => calls.push(`follow ${id} ${on}`),
	alertAll: () => calls.push("alertAll"),
	alarm: (stars) => calls.push(`alarm ${stars}`),
	reroute: (id) => calls.push(`reroute ${id}`),
	pace: (id, cruise) => calls.push(`pace ${id} ${cruise}`),
	ignite: (id) => calls.push(`ignite ${id}`),
	letBurn: (id) => calls.push(`letBurn ${id}`),
};

beforeEach(() => {
	director = new MissionDirector();
	events = [];
	actors = new Map();
	calls = [];
	cleared = 0;
	director.setStage(stage);
	director.on((event) => events.push(event));
});

afterEach(() => {
	director.dispose();
	emitGameEvent({ type: "vehicleExited", id: "car", kind: "car" });
	clearWaypoint();
	setObjective(null);
});

const complete = () => events.find((event): event is Extract<MissionEvent, { type: "complete" }> => event.type === "complete");

describe("branching", () => {
	const branching = mission([
		{
			kind: "choice",
			label: "Which way?",
			options: [
				{ label: "Left", flags: ["went-left"], next: "left", reward: { cash: 50 } },
				{ label: "Right", next: "right" },
				{ label: "Secret", next: "left", onlyIf: ["knows-secret"] },
			],
		},
		{ step: "left", kind: "goto", label: "Go left", x: -100, z: 0, radius: 5, next: "pass" },
		{ step: "right", kind: "goto", label: "Go right", x: 100, z: 0, radius: 5 },
		{ kind: "goto", label: "Only if you went left", x: 0, z: 100, radius: 5, onlyIf: ["went-left"] },
	]);

	it("offers only the options whose flags hold, and jumps where the pick says", () => {
		director.start(branching);
		expect(director.choices.map((choice) => choice.option.label)).toEqual(["Left", "Right"]);
		expect(readMissionHud().choices?.map((choice) => choice.label)).toEqual(["Left", "Right"]);
		director.choose(2);
		expect(director.objective?.kind).toBe("choice");
		director.choose(0);
		expect(director.objective?.label).toBe("Go left");
		director.update(0.1, at(-100, 0));
		expect(director.phase).toBe("passed");
		expect(complete()?.flags).toEqual(["went-left"]);
		expect(complete()?.extras).toEqual([{ cash: 50 }]);
	});

	it("skips objectives whose flags don't hold", () => {
		director.start(branching);
		director.choose(1);
		director.update(0.1, at(100, 0));
		expect(director.phase).toBe("passed");
		expect(complete()?.extras).toEqual([]);
	});

	it("reads saved story flags as well as this run's", () => {
		director.setFlagSource((flag) => flag === "knows-secret");
		director.start(branching);
		expect(director.choices.map((choice) => choice.option.label)).toContain("Secret");
	});

	it("judges flag conditions, negated ones included", () => {
		const has = (flag: string) => flag === "a";
		expect(holds(["a"], has)).toBe(true);
		expect(holds(["!a"], has)).toBe(false);
		expect(holds(["!b", "a"], has)).toBe(true);
		expect(holds(undefined, has)).toBe(true);
	});
});

describe("triggers", () => {
	it("fire once each, when every condition holds", () => {
		director.start(mission([
			{ step: "wait", kind: "survive", label: "Hold", x: 0, z: 0, seconds: 100 },
			{ step: "run", kind: "goto", label: "Run", x: 500, z: 0, radius: 5 },
		], {
			triggers: [
				{ when: { step: "wait", after: 2 }, say: [{ who: "A", text: "Two seconds in." }] },
				{ when: { wanted: 2 }, alarm: 3, notice: "Heat" },
				{ when: { step: "wait", near: { x: 50, z: 0, radius: 5 } }, goto: "run", flags: ["moved"] },
			],
		}));
		director.update(1, at(0, 0));
		expect(readMissionHud().subtitle).toBeNull();
		director.update(1.5, at(0, 0));
		expect(readMissionHud().subtitle).toEqual({ who: "A", text: "Two seconds in." });
		director.update(0.1, at(0, 0, { wantedStars: 2 }));
		director.update(0.1, at(0, 0, { wantedStars: 2 }));
		expect(calls.filter((call) => call === "alarm 3")).toHaveLength(1);
		expect(readMissionHud().notice).toBe("Heat");
		director.update(0.1, at(50, 0));
		expect(director.objective?.label).toBe("Run");
		expect(director.has("moved")).toBe(true);
	});

	it("raise the alarm once a guard does, with everyone fighting", () => {
		director.start(mission([{ kind: "survive", label: "Sneak", x: 0, z: 0, seconds: 100 }], {
			triggers: [{ when: { alerted: true }, alertAll: true, spawns: [{ type: "hostile", id: "backup", x: 1, z: 1, armed: true }] }],
		}));
		director.update(0.1, at(0, 0));
		expect(calls).not.toContain("alertAll");
		emitGameEvent({ type: "hostileAlerted", id: "guard-1" });
		director.update(0.1, at(0, 0));
		expect(calls).toContain("alertAll");
		expect(calls).toContain("spawn backup");
	});

	it("react to where a mission car has got to, rerouting it", () => {
		actors.set("van", { x: 0, z: 0, integrity: 100 });
		director.start(mission([{ kind: "survive", label: "Watch", x: 0, z: 0, seconds: 100 }], {
			triggers: [{ when: { targetNear: { id: "van", x: 100, z: 0, radius: 10 } }, reroute: { id: "van", route: [[0, 0], [1, 1]] }, pace: { id: "van", cruise: 30 } }],
		}));
		actors.set("van", { x: 50, z: 0, integrity: 100 });
		director.update(0.1, at(0, 0));
		expect(calls).not.toContain("reroute van");
		actors.set("van", { x: 95, z: 0, integrity: 100 });
		director.update(0.1, at(0, 0));
		expect(calls).toEqual(expect.arrayContaining(["reroute van", "pace van 30"]));
	});

	it("put out whatever's due from the off before the first frame", () => {
		director.start(mission([{ kind: "enterVehicle", label: "Get in", vehicle: "car", x: 0, z: 0 }], {
			triggers: [{ when: {}, spawns: [{ type: "vehicle", id: "early-van", style: "van", colour: "#000", x: 0, z: 0, yaw: 0 }] }],
		}));
		expect(calls).toContain("spawn early-van");
	});
});

describe("tailing", () => {
	const tail = (spotted?: string) => mission([
		{ kind: "tail", label: "Follow", target: "mark", near: 20, far: 100, spotted },
		{ kind: "goto", label: "Done", x: 0, z: 0, radius: 1000, next: "pass" },
		{ step: "chase", kind: "disable", label: "Stop them", targets: ["mark"], below: 50, x: 0, z: 0 },
	]);

	beforeEach(() => actors.set("mark", { x: 0, z: 0, integrity: 100 }));

	it("is done when the car gets where it's going, the gap shown on the way", () => {
		director.start(tail());
		director.update(0.1, at(50, 0));
		expect(readMissionHud().counter).toBe("50 m");
		emitGameEvent({ type: "actorEscaped", id: "mark" });
		expect(director.objective?.label).toBe("Done");
	});

	it("is blown by staying too close, on to the chase when there is one", () => {
		director.start(tail("chase"));
		director.update(SPOT_SECONDS - 0.5, at(10, 0));
		expect(readMissionHud().objective).toBe("Too close — back off");
		director.update(0.1, at(40, 0));
		director.update(SPOT_SECONDS - 0.1, at(10, 0));
		expect(director.objective?.kind).toBe("tail");
		director.update(0.2, at(10, 0));
		expect(director.objective?.label).toBe("Stop them");
		expect(director.has("spotted")).toBe(true);
		expect(readMissionHud().notice).toBe("You've been made");
	});

	it("fails if spotted with nowhere to go, or if they're lost", () => {
		director.start(tail());
		director.update(SPOT_SECONDS + 0.1, at(5, 0));
		expect(readMissionHud().failReason).toBe("They spotted you");
		actors.set("mark", { x: 0, z: 0, integrity: 100 });
		director.start(tail());
		director.update(LOSE_SECONDS + 0.1, at(500, 0));
		expect(readMissionHud().failReason).toBe("You lost them");
	});
});

describe("stopping a car", () => {
	it("is done once it's knocked below the line, or wrecked; fails if it gets away", () => {
		actors.set("a", { x: 0, z: 0, integrity: 100 });
		actors.set("b", { x: 0, z: 0, integrity: 100 });
		const stop = mission([{ kind: "disable", label: "Stop both", targets: ["a", "b"], below: 50, x: 0, z: 0 }]);
		director.start(stop);
		actors.get("a")!.integrity = 40;
		director.update(0.1, at(0, 0));
		expect(readMissionHud().counter).toBe("1/2");
		emitGameEvent({ type: "vehicleDestroyed", id: "b", byPlayer: true });
		expect(director.phase).toBe("passed");

		actors.set("a", { x: 0, z: 0, integrity: 100 });
		director.start(stop);
		emitGameEvent({ type: "actorEscaped", id: "b" });
		expect(readMissionHud().failReason).toBe("They got away");
	});
});

describe("searching and talking", () => {
	it("needs the player there, on foot, for long enough — progress kept if they step away", () => {
		director.start(mission([{ kind: "inspect", label: "Search", x: 10, z: 0, radius: 2, seconds: 3 }]));
		director.update(2, at(10, 0));
		expect(readMissionHud().counter).toBe("66%");
		director.update(5, at(50, 0));
		emitGameEvent({ type: "vehicleEntered", id: "car", kind: "car", police: false });
		director.update(5, at(10, 0));
		expect(readMissionHud().objective).toBe("Get out and do it on foot");
		emitGameEvent({ type: "vehicleExited", id: "car", kind: "car" });
		director.update(1.1, at(10, 0));
		expect(director.phase).toBe("passed");
	});

	it("follows the person being talked to", () => {
		actors.set("witness", { x: 30, z: 30, integrity: 100 });
		director.start(mission([{ kind: "inspect", label: "Talk", person: "witness", x: 0, z: 0, radius: 2, seconds: 1 }]));
		expect(activeTarget()?.x).toBe(30);
		director.update(1.1, at(30, 30));
		expect(director.phase).toBe("passed");
	});
});

describe("escorting", () => {
	it("starts them following, and needs them along at the end", () => {
		actors.set("vip", { x: 0, z: 0, integrity: 100 });
		director.start(mission([{ kind: "escort", label: "Take her home", person: "vip", x: 100, z: 0, radius: 5, followers: ["vip"] }]));
		expect(calls).toContain("follow vip true");
		director.update(0.1, at(100, 0));
		expect(readMissionHud().objective).toBe("Wait for them to catch up");
		actors.get("vip")!.aboard = true;
		director.update(0.1, at(100, 0));
		expect(director.phase).toBe("passed");
	});
});

describe("getting clear", () => {
	it("needs distance, and no police if it says so", () => {
		director.start(mission([{ kind: "leave", label: "Go", x: 0, z: 0, radius: 50, clean: true }]));
		director.update(0.1, at(60, 0, { wantedStars: 1 }));
		expect(readMissionHud().objective).toBe("Lose the cops");
		director.update(0.1, at(60, 0));
		expect(director.phase).toBe("passed");
	});
});

describe("optional objectives and ratings", () => {
	const graded = mission([
		{ kind: "enterVehicle", label: "In", vehicle: "car", x: 0, z: 0 },
		{ kind: "survive", label: "Wait", x: 0, z: 0, seconds: 10 },
	], {
		bonuses: [
			{ id: "a", label: "Unseen", kind: "undetected" },
			{ id: "b", label: "Quick", kind: "time", seconds: 20 },
			{ id: "c", label: "Car intact", kind: "intact", min: 60, vehicle: "car" },
			{ id: "d", label: "Never made", kind: "flag", flag: "!spotted" },
		],
	});

	it("tracks each live, and judges them once at the end", () => {
		director.start(graded);
		emitGameEvent({ type: "vehicleEntered", id: "car", kind: "car", police: false });
		director.update(5, at(0, 0, { vehicleIntegrity: 80 }));
		expect(readMissionHud().bonuses.map((bonus) => bonus.state)).toEqual(["open", "open", "open", "open"]);
		emitGameEvent({ type: "hostileAlerted", id: "guard" });
		director.update(1, at(0, 0, { vehicleIntegrity: 50 }));
		expect(readMissionHud().bonuses.map((bonus) => bonus.state)).toEqual(["failed", "open", "failed", "open"]);
		director.update(5, at(0, 0, { vehicleIntegrity: 50 }));
		expect(director.phase).toBe("passed");
		expect(complete()?.bonuses.map((bonus) => bonus.met)).toEqual([false, true, false, true]);
		expect(complete()?.rating).toBe(2);
		expect(readMissionHud().rating).toBe(2);
	});

	it("rates out of three from the share met", () => {
		const results = (met: boolean[]) => met.map((value, index) => ({ id: String(index), label: "", met: value }));
		expect(ratingFor([])).toBeNull();
		expect(ratingFor(results([false, false]))).toBe(1);
		expect(ratingFor(results([true, false]))).toBe(2);
		expect(ratingFor(results([true, true]))).toBe(3);
		expect(ratingFor(results([true]))).toBe(3);
	});
});

describe("checkpoints", () => {
	const long = mission([
		{ kind: "goto", label: "One", x: 100, z: 0, radius: 5, spawns: [{ type: "hostile", id: "g1", x: 0, z: 0, armed: true }, { type: "hostile", id: "g2", x: 0, z: 0, armed: true }] },
		{ kind: "choice", label: "Pick", options: [{ label: "A", flags: ["chose-a"] }, { label: "B" }] },
		{ kind: "goto", label: "Two", x: 200, z: 0, radius: 5, checkpoint: { x: 190, z: 0, yaw: 90 }, followers: ["friend"] },
		{ kind: "goto", label: "Three", x: 300, z: 0, radius: 5 },
	], { spawns: [{ type: "hostile", id: "friend", x: 0, z: 0, armed: false, role: "passive" }] });

	it("keeps the run as it stood, to retry from there", () => {
		director.start(long);
		emitGameEvent({ type: "personKilled", id: "g1", byPlayer: true });
		director.update(0.1, at(100, 0));
		director.choose(0);
		expect(readMissionHud().notice).toBe("Checkpoint");
		director.update(0.1, at(200, 0));
		director.fail("test");
		expect(readMissionHud().canResume).toBe(true);
		const point = director.restartPoint!;
		expect(point).toMatchObject({ missionId: "test", index: 2, x: 190, z: 0, yaw: 90, flags: ["chose-a"], gone: ["g1"] });

		calls = [];
		director.resume(point, long);
		expect(director.objective?.label).toBe("Two");
		expect(director.has("chose-a")).toBe(true);
		// The dead stay dead; everyone else is put back, and the friend follows again.
		expect(calls.filter((call) => call.startsWith("spawn"))).toEqual(["spawn friend", "spawn g2"]);
		expect(calls).toContain("follow friend true");
	});

	it("is forgotten when the mission's started over or passed", () => {
		director.start(long);
		director.update(0.1, at(100, 0));
		director.choose(1);
		expect(director.restartPoint).not.toBeNull();
		director.start(long);
		expect(director.restartPoint).toBeNull();
	});
});

describe("the mission's life", () => {
	it("abandons into a failure with a retry, clearing everything", () => {
		director.start(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5 }], { spawns: [{ type: "vehicle", id: "car", style: "sedan", colour: "#fff", x: 0, z: 0, yaw: 0 }] }));
		director.abandon();
		expect(director.phase).toBe("failed");
		expect(readMissionHud().failReason).toBe("Mission abandoned");
		expect(cleared).toBe(1);
		expect(activeTarget()).toBeNull();
		director.abandon();
		expect(events.filter((event) => event.type === "failed")).toHaveLength(1);
	});

	it("clears the last run before starting another over it", () => {
		const run = mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5 }]);
		director.start(run);
		director.start(run);
		expect(cleared).toBe(1);
		expect(events.filter((event) => event.type === "started")).toHaveLength(2);
	});

	it("won't brief over a mission being played", () => {
		const run = mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5 }]);
		director.start(run);
		director.brief(mission([], { id: "other" }));
		expect(director.phase).toBe("active");
		expect(director.mission?.id).toBe("test");
	});
});

describe("dialogue", () => {
	it("queues lines one after another, skipping those whose flags don't hold", () => {
		director.setFlagSource((flag) => flag === "known");
		director.say([
			{ who: "A", text: "First.", seconds: 1 },
			{ who: "B", text: "Never.", onlyIf: ["!known"] },
			{ who: "C", text: "Second.", seconds: 1 },
		]);
		director.update(0.1, at(0, 0));
		expect(readMissionHud().subtitle?.who).toBe("A");
		director.update(1, at(0, 0));
		expect(readMissionHud().subtitle?.who).toBe("C");
		director.update(1, at(0, 0));
		expect(readMissionHud().subtitle).toBeNull();
	});

	it("speaks a mission's intro and an objective's lines, and stops talking when it fails", () => {
		director.start(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5, say: [{ who: "B", text: "Then this." }] }], { intro: [{ who: "A", text: "First this." }] }));
		expect(readMissionHud().subtitle?.who).toBe("A");
		director.fail("test");
		expect(readMissionHud().subtitle).toBeNull();
	});

	it("gives each line long enough to read, within reason", () => {
		expect(lineSeconds({ who: "", text: "Hi." })).toBeCloseTo(2.2);
		expect(lineSeconds({ who: "", text: Array.from({ length: 40 }, () => "word").join(" ") })).toBe(7);
		expect(lineSeconds({ who: "", text: "x", seconds: 4 })).toBe(4);
	});

	it("shows a notice for a moment", () => {
		director.notice("Checkpoint");
		director.update(0.1, at(0, 0));
		expect(readMissionHud().notice).toBe("Checkpoint");
		director.update(NOTICE_SECONDS, at(0, 0));
		expect(readMissionHud().notice).toBeNull();
	});
});

describe("emergency calls (Code Three's mechanics)", () => {
	it("takes any vehicle of the asked-for style, and nothing else", () => {
		director.start(mission([
			{ kind: "enterVehicle", label: "Take an ambulance", style: "ambulance", x: 0, z: 0 },
			{ kind: "goto", label: "Go", x: 50, z: 0, radius: 5 },
		]));
		emitGameEvent({ type: "vehicleEntered", id: "car", kind: "car", police: false, style: "taxi" });
		director.update(0.1, at(0, 0));
		expect(director.objective?.kind).toBe("enterVehicle");
		emitGameEvent({ type: "vehicleExited", id: "car", kind: "car" });
		emitGameEvent({ type: "vehicleEntered", id: "car", kind: "car", police: false, style: "ambulance" });
		director.update(0.1, at(0, 0));
		expect(director.objective?.kind).toBe("goto");
	});

	it("won't take a delivery with the passenger left behind", () => {
		director.start(mission([
			{ kind: "deliver", label: "Get her to hospital", style: "ambulance", person: "patient", x: 0, z: 0, radius: 10 },
		], { spawns: [{ type: "hostile", id: "patient", x: 30, z: 0, armed: false, role: "passive" }] }));
		emitGameEvent({ type: "vehicleEntered", id: "car", kind: "car", police: false, style: "ambulance" });
		director.update(0.1, at(0, 0));
		expect(director.phase).toBe("active");
		expect(readMissionHud().objective).toBe("Wait for them to get in");
		actors.get("patient")!.aboard = true;
		director.update(0.1, at(0, 0));
		expect(director.phase).toBe("passed");
	});

	it("sets a car alight and lets a held fire burn, from triggers", () => {
		director.start(mission([
			{ kind: "goto", step: "respond", label: "Go", x: 100, z: 0, radius: 5 },
			{ kind: "goto", step: "carry", label: "Go back", x: 0, z: 0, radius: 5 },
		], {
			triggers: [
				{ when: { step: "respond", after: 5 }, ignite: "crash-a" },
				{ when: { step: "carry" }, letBurn: "crash-b" },
			],
		}));
		director.update(3, at(0, 50));
		expect(calls).not.toContain("ignite crash-a");
		director.update(3, at(0, 50));
		expect(calls).toContain("ignite crash-a");
		director.update(0.1, at(100, 0));
		director.update(0.1, at(100, 0));
		expect(calls).toContain("letBurn crash-b");
	});

	it("moves on once a crew has put a mission car's fire out", () => {
		director.start(mission([
			{ kind: "goto", label: "Get there", x: 50, z: 0, radius: 5 },
			{ kind: "survive", step: "wait", label: "Wait for the crew", x: 50, z: 0, seconds: 75 },
			{ kind: "goto", step: "board", label: "Load up", x: 0, z: 0, radius: 5 },
		], {
			spawns: [{ type: "vehicle", id: "crash-b", style: "suv", colour: "#555555", x: 55, z: 0, yaw: 0, burning: true }],
			triggers: [{ when: { step: "wait", putOut: "crash-b" }, goto: "board" }],
		}));
		actors.set("crash-b", { x: 55, z: 0, integrity: 21, onFire: true });
		director.update(0.1, at(50, 0));
		director.update(5, at(50, 0));
		expect(director.objective?.step).toBe("wait");
		actors.set("crash-b", { x: 5, z: 0, integrity: 24, onFire: false });
		director.update(0.1, at(30, 30));
		expect(director.objective?.step).toBe("board");
	});
});
