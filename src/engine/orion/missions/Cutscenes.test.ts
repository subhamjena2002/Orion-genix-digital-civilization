import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearWaypoint, setObjective } from "../navigation/Navigation";
import { briefingLines, briefingScene, shotView, type Cutscene, type ShotContext, type ShotPlace, type ShotSubject } from "./Cutscenes";
import { emitGameEvent } from "./GameEvents";
import { ALL_MISSIONS } from "./MissionCatalog";
import { giverPersonId, missionGivers, MissionDirector, type MissionDefinition, type Objective, type PlayerView } from "./MissionDirector";
import { readMissionHud } from "./MissionHud";

const at = (x: number, z: number): PlayerView => ({ x, y: 0, z, vehicleIntegrity: 100, wantedStars: 0 });

/** A giver at the origin, the player 3 m south of them, the game's camera behind the player. */
function context(places: Record<string, ShotPlace> = {}): ShotContext {
	const all: Record<string, ShotPlace> = { player: { x: 0, z: -3, height: 1.6 }, giver: { x: 0, z: 0, height: 1.6 }, ...places };
	return {
		locate: (subject: ShotSubject) => (typeof subject === "string" ? all[subject] ?? null : { ...subject, height: 1.5 }),
		player: { x: 0, z: -3 },
		camera: { x: 0, z: -8 },
	};
}

describe("where a shot puts the camera", () => {
	it("stands over the near one's shoulder, looking at the far one", () => {
		const view = shotView({ on: "giver", over: "player" }, 0, context());
		expect(view).not.toBeNull();
		// Behind the player (further south than them), a little to one side, at about head height.
		expect(view!.fromZ).toBeLessThan(-3);
		expect(Math.abs(view!.fromX)).toBeGreaterThan(0.3);
		expect(view!.fromHeight).toBeGreaterThan(1.6);
		expect([view!.atX, view!.atZ]).toEqual([0, 0]);
	});

	it("stands between the subject and the player at angle 0, and beyond the subject at 180", () => {
		const near = shotView({ on: "giver", angle: 0, distance: 2 }, 0, context())!;
		expect(near.fromZ).toBeCloseTo(-2);
		const beyond = shotView({ on: "giver", angle: 180, distance: 2 }, 0, context())!;
		expect(beyond.fromZ).toBeCloseTo(2);
	});

	it("frames the player from where the game's camera was", () => {
		const view = shotView({ on: "player", angle: 0, distance: 4 }, 0, { ...context(), locate: () => ({ x: 0, z: -3, height: 1.6 }) })!;
		expect(view.fromZ).toBeCloseTo(-7);
	});

	it("orbits and pushes in over the shot, easing at both ends", () => {
		const shot = { on: "giver", angle: 0, distance: 5, orbit: 90, push: 2 };
		const start = shotView(shot, 0, context())!;
		const end = shotView(shot, 1, context())!;
		expect(Math.hypot(start.fromX, start.fromZ)).toBeCloseTo(5);
		expect(Math.hypot(end.fromX, end.fromZ)).toBeCloseTo(3);
		// A quarter turn round: from the south side to the east or west.
		expect(Math.abs(end.fromX)).toBeCloseTo(3);
		const early = shotView(shot, 0.05, context())!;
		expect(Math.abs(early.fromX)).toBeLessThan(0.1);
	});

	it("has nothing to show when its subject isn't in the world", () => {
		expect(shotView({ on: "convoy-van" }, 0, context())).toBeNull();
	});
});

describe("briefings as conversations", () => {
	it("breaks a briefing into lines of a sentence or two", () => {
		const lines = briefingLines("Benny", "Kid — you're the new driver? Good timing. Somebody just drove my client's silver Vesper off my lot. Take my car, catch him, and bring it back. Bent is fine. Gone is not.");
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => line.who === "Benny" && line.text.length <= 150)).toBe(true);
		expect(lines.map((line) => line.text).join(" ")).toContain("Gone is not.");
	});

	it("opens wide, cuts between the shoulder and the side, and holds until it's answered", () => {
		const scene = briefingScene("Benny", "One. Two. Three. Four.".replace(/\./g, " is a sentence long enough to need its own line, probably, at this length."));
		expect(scene.hold).toBe(true);
		expect(scene.shots[0].over).toBeUndefined();
		expect(scene.shots[scene.shots.length - 1].over).toBe("player");
		expect(scene.shots.some((shot) => shot.over === undefined && shot.angle !== undefined && shot !== scene.shots[0])).toBe(true);
	});

	it("casts every story giver in person, each with one voice", () => {
		const story = ALL_MISSIONS.filter((mission) => mission.chapter !== "job");
		for (const mission of story) {
			expect(mission.giver.look, mission.id).toBeDefined();
			expect(mission.giver.speaker, mission.id).toBeDefined();
		}
		// One person per giver, however many missions they give.
		const givers = missionGivers(ALL_MISSIONS);
		expect(new Set(givers.map((giver) => giver.id)).size).toBe(givers.length);
		expect(givers.length).toBe(new Set(story.map((mission) => giverPersonId(mission.giver))).size);
	});
});

let director: MissionDirector;

function mission(objectives: Objective[], extra: Partial<MissionDefinition> = {}): MissionDefinition {
	return { id: "test", title: "Test", giver: { name: "Rico", x: 0, z: 0 }, briefing: "", reward: {}, objectives, ...extra };
}

const LOOK = { name: "Rico", x: 0, z: 0, speaker: "Rico", look: { model: "man" as const } };

beforeEach(() => {
	director = new MissionDirector();
	director.setStage({ spawn: () => undefined, clear: () => undefined, actor: () => null });
});

afterEach(() => {
	director.dispose();
	emitGameEvent({ type: "vehicleExited", id: "car", kind: "car" });
	clearWaypoint();
	setObjective(null);
});

describe("the director's cutscenes", () => {
	const scene: Cutscene = { shots: [{ on: "giver", say: [{ who: "Rico", text: "Look at that.", seconds: 2 }] }, { on: "player", seconds: 1 }] };

	it("plays an objective's scene before its clock starts, one shot after another", () => {
		director.start(mission([{ kind: "goto", label: "Go", x: 0, z: 0, radius: 5, timeLimit: 3, scene }]));
		expect(director.inScene).toBe(true);
		expect(readMissionHud().cutscene).toBe(true);
		expect(director.sceneShot?.shot.on).toBe("giver");
		// Stood on the spot, but nothing's judged while the scene runs, and the clock doesn't move.
		director.update(1, at(0, 0));
		expect(director.phase).toBe("active");
		expect(readMissionHud().subtitle?.text).toBe("Look at that.");
		director.update(1.1, at(50, 0));
		director.update(0.1, at(50, 0));
		expect(director.sceneShot?.shot.on).toBe("player");
		director.update(1.1, at(50, 0));
		director.update(0.1, at(50, 0));
		expect(director.inScene).toBe(false);
		expect(readMissionHud().timeLeft).toBeGreaterThan(2.5);
	});

	it("holds a shot while its lines are still being said", () => {
		let busy = false;
		director.setVoice({ speak: () => { busy = true; }, speaking: () => busy, stop: () => { busy = false; } });
		director.start(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5, scene }]));
		director.update(3, at(0, 0));
		director.update(0.1, at(0, 0));
		expect(director.sceneShot?.shot.on).toBe("giver");
		busy = false;
		director.update(0.1, at(0, 0));
		director.update(0.1, at(0, 0));
		expect(director.sceneShot?.shot.on).toBe("player");
		director.setVoice(null);
	});

	it("skips with what was to be said in it, but not what comes after", () => {
		director.start(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5, scene, say: [{ who: "Rico", text: "Now go." }] }]));
		director.update(0.1, at(0, 0));
		expect(readMissionHud().skippable).toBe(true);
		director.skipScene();
		expect(director.inScene).toBe(false);
		director.update(0.1, at(0, 0));
		expect(readMissionHud().subtitle?.text).toBe("Now go.");
	});

	it("plays a trigger's scene, and a mission's opening only the first time", () => {
		const opening: Cutscene = { shots: [{ on: "giver", seconds: 1 }] };
		const test = mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5 }], {
			opening,
			triggers: [{ when: { near: { x: 50, z: 0, radius: 5 } }, scene: { shots: [{ on: { x: 60, z: 0 }, seconds: 1 }] } }],
		});
		director.start(test);
		expect(director.inScene).toBe(true);
		director.update(1.1, at(0, 0));
		director.update(0.1, at(0, 0));
		expect(director.inScene).toBe(false);
		director.update(0.1, at(50, 0));
		expect(director.sceneShot?.shot.on).toEqual({ x: 60, z: 0 });
		director.skipScene();
		director.update(0.1, at(0, 0));
		director.fail("test");
		director.start(test);
		expect(director.inScene).toBe(false);
	});

	it("keeps choices back until the scene's done", () => {
		director.start(mission([{ kind: "choice", label: "Pick", options: [{ label: "A", next: "pass" }], scene }]));
		expect(director.choices).toEqual([]);
		director.choose(0);
		expect(director.phase).toBe("active");
		director.skipScene();
		expect(director.choices.length).toBe(1);
	});

	it("tells a briefing to the player's face when the giver's there in person, until it's answered", () => {
		director.brief(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5 }], { giver: LOOK, briefing: "First thing. Second thing." }));
		expect(director.inScene).toBe(true);
		expect(readMissionHud().skippable).toBe(false);
		director.skipScene();
		for (let step = 0; step < 40; step++) director.update(0.5, at(0, -3));
		// Every line said, and still held over the shoulder for the answer.
		expect(director.sceneShot?.shot.over).toBe("player");
		director.accept();
		expect(director.phase).toBe("active");
		expect(director.inScene).toBe(false);
	});

	it("briefs a giver who isn't there in person with no scene", () => {
		director.brief(mission([{ kind: "goto", label: "Go", x: 100, z: 0, radius: 5 }], { briefing: "First thing." }));
		expect(director.inScene).toBe(false);
		director.decline();
		expect(director.phase).toBe("idle");
	});
});
