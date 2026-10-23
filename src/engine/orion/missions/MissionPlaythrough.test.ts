import { afterEach, describe, expect, it } from "vitest";

import { clearWaypoint, setObjective } from "../navigation/Navigation";
import { emitGameEvent } from "./GameEvents";
import { ALL_MISSIONS, JOBS, MISSIONS } from "./MissionCatalog";
import type { VehicleStyle } from "../traffic/Vehicles";
import { MissionDirector, RACE_COUNTDOWN, type ActorState, type MissionDefinition, type MissionEvent, type MissionSpawn, type MissionStage, type PlayerView } from "./MissionDirector";

/**
 * Every mission in the catalog, played through the real director against a stand-in stage:
 * each objective done the way a player would do it, down every branch the choices open. Proves
 * each one can be finished, finishes exactly once, and leaves nothing behind.
 */

/** A stage that remembers what it was asked, and lets the test move its cars and people. */
class FakeStage implements MissionStage {
	public readonly actors = new Map<string, ActorState>();
	public readonly spawned: string[] = [];
	public readonly following = new Set<string>();
	public cleared = 0;
	public alerts = 0;
	public alarms: number[] = [];
	public reroutes: string[] = [];

	public spawn(spawns: readonly MissionSpawn[]): void {
		for (const spawn of spawns) {
			this.spawned.push(spawn.id);
			this.actors.set(spawn.id, { x: spawn.x, z: spawn.z, integrity: 100 });
		}
	}

	public clear(): void {
		this.cleared++;
		this.actors.clear();
		this.following.clear();
	}

	public startRace(): void {}
	public racerProgress(): null {
		return null;
	}
	public alarm(stars: number): void {
		this.alarms.push(stars);
	}
	public actor(id: string): ActorState | null {
		return this.actors.get(id) ?? null;
	}
	public follow(id: string, following: boolean): void {
		if (following) this.following.add(id);
		else this.following.delete(id);
	}
	public alertAll(): void {
		this.alerts++;
	}
	public reroute(id: string): void {
		this.reroutes.push(id);
	}
	public pace(): void {}
}

interface Run {
	events: MissionEvent[];
	choices: string[];
	stage: FakeStage;
	director: MissionDirector;
}

let directors: MissionDirector[] = [];

afterEach(() => {
	for (const director of directors) director.dispose();
	directors = [];
	emitGameEvent({ type: "vehicleExited", id: "sim-car", kind: "car" });
	clearWaypoint();
	setObjective(null);
});

/**
 * Plays `mission` to the end, taking option `picks[n]` at the n-th choice (0 when there are no
 * more picks), with these story flags saved from before.
 */
function play(mission: MissionDefinition, picks: readonly number[], saved: readonly string[] = []): Run {
	const director = new MissionDirector();
	directors.push(director);
	const stage = new FakeStage();
	director.setStage(stage);
	director.setFlagSource((flag) => saved.includes(flag));
	const events: MissionEvent[] = [];
	director.on((event) => events.push(event));
	const choices: string[] = [];
	const view: PlayerView = { x: 0, y: 0, z: 0, vehicleIntegrity: 100, wantedStars: 0 };
	// Read through a function so TypeScript doesn't narrow it across the event calls.
	let seat: { id: string; kind: "car" | "jet" | "gunship"; police: boolean; style?: VehicleStyle } | null = null;
	const seated = () => seat;
	const enter = (id: string, kind: "car" | "jet" | "gunship" = "car", police = false, style?: VehicleStyle) => {
		const current = seated();
		if (current) emitGameEvent({ type: "vehicleExited", id: current.id, kind: current.kind });
		seat = { id, kind, police, style };
		emitGameEvent({ type: "vehicleEntered", id, kind, police, style });
	};
	const leave = () => {
		const current = seated();
		if (!current) return;
		emitGameEvent({ type: "vehicleExited", id: current.id, kind: current.kind });
		seat = null;
	};
	const tick = (seconds = 0.1) => director.update(seconds, view);
	const at = (x: number, z: number, y = 0) => {
		view.x = x;
		view.z = z;
		view.y = y;
	};

	director.start(mission);
	let picked = 0;
	for (let guard = 0; guard < 400 && director.phase === "active"; guard++) {
		const objective = director.objective!;
		switch (objective.kind) {
			case "goto":
				at(objective.x, objective.z);
				tick();
				break;
			case "enterVehicle":
				enter(objective.vehicle ?? "sim-car", objective.vehicleKind ?? "car", objective.police ?? false, objective.style);
				break;
			case "deliver": {
				const current = seated();
				if (!current || (objective.vehicle && current.id !== objective.vehicle) || (objective.style && current.style !== objective.style)) {
					enter(objective.vehicle ?? "sim-car", objective.vehicleKind ?? "car", objective.police ?? false, objective.style);
				}
				if (objective.person) {
					expect(stage.following.has(objective.person), `${mission.id}: ${objective.person} follows`).toBe(true);
					stage.actors.get(objective.person)!.aboard = true;
				}
				view.wantedStars = 0;
				at(objective.x, objective.z);
				tick();
				break;
			}
			case "eliminate":
				for (const id of objective.targets) emitGameEvent({ type: "personKilled", id, byPlayer: true });
				break;
			case "destroyVehicles":
				for (const id of objective.ids) emitGameEvent({ type: "vehicleDestroyed", id, byPlayer: true });
				break;
			case "disable":
				// A chase takes a while before the hits tell: what's timed into one gets its turn.
				for (let chased = 0; chased < 12; chased += 0.5) tick(0.5);
				for (const id of objective.targets) {
					const car = stage.actors.get(id);
					expect(car, `${mission.id}: ${id} is out to be stopped`).toBeDefined();
					car!.integrity = objective.below - 5;
				}
				tick();
				break;
			case "tail": {
				const target = stage.actors.get(objective.target)!;
				expect(target, `${mission.id}: tail target out`).toBeDefined();
				at(target.x + (objective.near + objective.far) / 2, target.z);
				tick();
				emitGameEvent({ type: "actorEscaped", id: objective.target });
				break;
			}
			case "inspect": {
				const spot = objective.person ? stage.actors.get(objective.person) ?? objective : objective;
				if ((objective.on ?? "foot") === "foot") leave();
				else if (objective.on === "vehicle" && !seated()) enter("sim-car");
				at(spot.x, spot.z);
				tick(objective.seconds / 2);
				tick(objective.seconds / 2 + 0.05);
				break;
			}
			case "choice": {
				const offered = director.choices;
				expect(offered.length, `${mission.id}: choices on offer`).toBeGreaterThan(0);
				const pick = offered[Math.min(picks[picked++] ?? 0, offered.length - 1)];
				choices.push(pick.option.label);
				director.choose(pick.index);
				break;
			}
			case "escort": {
				expect(stage.following.has(objective.person), `${mission.id}: ${objective.person} follows`).toBe(true);
				const person = stage.actors.get(objective.person)!;
				person.aboard = true;
				view.wantedStars = 0;
				at(objective.x, objective.z);
				tick();
				break;
			}
			case "leave":
				view.wantedStars = 0;
				at(objective.x + objective.radius + 10, objective.z);
				tick();
				break;
			case "loseWanted":
				view.wantedStars = 0;
				tick();
				break;
			case "wanted":
				view.wantedStars = objective.stars;
				tick();
				break;
			case "survive":
				tick(objective.seconds + 0.1);
				break;
			case "checkpoints":
			case "race":
				if (objective.kind === "race") tick(RACE_COUNTDOWN + 0.1);
				for (const point of objective.kind === "race" ? Array.from({ length: objective.laps ?? 1 }, () => objective.points).flat() : objective.points) {
					at(point.x, point.z, point.y ?? 0);
					tick();
				}
				break;
		}
	}
	leave();
	return { events, choices, stage, director };
}

/** Every combination of picks through a mission's choices (each up to three options). */
function allPaths(mission: MissionDefinition, saved: readonly string[]): number[][] {
	const choiceCount = mission.objectives.filter((objective) => objective.kind === "choice").length;
	let paths: number[][] = [[]];
	for (let n = 0; n < choiceCount; n++) paths = paths.flatMap((path) => [0, 1, 2].map((pick) => [...path, pick]));
	// Picks past the options on offer clamp to the last, so drop duplicates by the labels they choose.
	const seen = new Set<string>();
	return paths.filter((path) => {
		const key = play(mission, path, saved).choices.join(" | ");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Story flags someone might arrive with: none, and the ones the earlier choices could have set. */
const HISTORIES: readonly (readonly string[])[] = [
	[],
	["dez-owes", "ledger-police", "jax-spared", "marisol-saved"],
	["dez-exposed", "ledger-sold", "jax-arrested"],
];

describe("every mission, played through", () => {
	for (const mission of ALL_MISSIONS) {
		it(`${mission.id} can be finished down every branch, and pays out exactly once`, () => {
			for (const saved of HISTORIES) {
				for (const path of allPaths(mission, saved)) {
					const run = play(mission, path, saved);
					const label = `${mission.id} [${run.choices.join(" / ")}] with ${saved.join(",") || "a fresh save"}`;
					expect(run.director.phase, label).toBe("passed");
					expect(run.events.filter((event) => event.type === "complete"), label).toHaveLength(1);
					expect(run.events.filter((event) => event.type === "failed"), label).toHaveLength(0);
					// Everything it put out is taken away again.
					expect(run.stage.cleared, label).toBe(1);
					expect(run.stage.actors.size, label).toBe(0);
					// Events after the end change nothing.
					emitGameEvent({ type: "playerDied" });
					expect(run.events.filter((event) => event.type === "complete" || event.type === "failed"), label).toHaveLength(1);
				}
			}
		});
	}

	it("takes every story choice somewhere different", () => {
		for (const mission of MISSIONS) {
			const choiceCount = mission.objectives.filter((objective) => objective.kind === "choice").length;
			if (choiceCount === 0) continue;
			const outcomes = new Set(allPaths(mission, HISTORIES[1]).map((path) => {
				const run = play(mission, path, HISTORIES[1]);
				const complete = run.events.find((event) => event.type === "complete");
				return complete?.type === "complete" ? JSON.stringify([[...complete.flags].sort(), complete.extras]) : "";
			}));
			expect(outcomes.size, mission.id).toBeGreaterThan(1);
		}
	});
});

describe("the story's consequences", () => {
	const byId = (id: string) => ALL_MISSIONS.find((mission) => mission.id === id)!;

	it("lets Dez open the side door only for a player who kept his secret", () => {
		const labels = (saved: readonly string[]) => {
			const director = new MissionDirector();
			directors.push(director);
			director.setStage(new FakeStage());
			director.setFlagSource((flag) => saved.includes(flag));
			director.start(byId("meridian-job"));
			emitGameEvent({ type: "vehicleEntered", id: "benny-car", kind: "car", police: false });
			const offered = director.choices.map((choice) => choice.option.label);
			emitGameEvent({ type: "vehicleExited", id: "benny-car", kind: "car" });
			return offered;
		};
		expect(labels(["dez-owes"])).toContain("Dez's service door");
		expect(labels(["dez-exposed"])).not.toContain("Dez's service door");
	});

	it("puts Dez among Crane's guards if he was exposed", () => {
		const spawnedWith = (saved: readonly string[]) => play(byId("meridian-job"), [0, 0], saved).stage.spawned;
		expect(spawnedWith(["dez-exposed"])).toContain("dez");
		expect(spawnedWith(["dez-owes"])).not.toContain("dez");
	});

	it("sends one convoy van fewer if Kincaid has the ledger", () => {
		const vans = (saved: readonly string[]) => play(byId("convoy"), [], saved).stage.spawned.filter((id) => id.startsWith("m6-van"));
		expect(vans(["ledger-police"])).toHaveLength(3);
		expect(vans(["ledger-sold"])).toHaveLength(4);
	});

	it("calls the police on the finale's chase unless Kincaid is holding them back", () => {
		expect(play(byId("meridian-job"), [0, 0], ["ledger-sold"]).stage.alarms).toContain(2);
		expect(play(byId("meridian-job"), [0, 0], ["ledger-police"]).stage.alarms).not.toContain(2);
	});

	it("lets Sunset Park judge Crane only if Marisol was saved", () => {
		const finalChoices = (saved: readonly string[]) => new Set(allPaths(byId("meridian-job"), saved).map((path) => play(byId("meridian-job"), path, saved).choices.at(-1)));
		expect(finalChoices(["marisol-saved"]).has("Let Sunset Park decide")).toBe(true);
		expect(finalChoices([]).has("Let Sunset Park decide")).toBe(false);
	});

	it("pays for the choice taken, on top of the mission", () => {
		const run = play(byId("quiet-money"), [1]);
		const complete = run.events.find((event) => event.type === "complete");
		expect(complete?.type === "complete" && complete.extras).toEqual([{ cash: 6000, rep: { law: -2, street: 1 } }]);
		expect(complete?.type === "complete" && complete.flags).toContain("ledger-sold");
	});

	it("keeps street jobs repeatable and out of the story", () => {
		for (const job of JOBS) expect(MISSIONS.some((mission) => mission.requires?.includes(job.id))).toBe(false);
	});
});
