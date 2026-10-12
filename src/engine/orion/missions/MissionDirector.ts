import type { WeaponId } from "../combat/WeaponData";
import { setObjective } from "../navigation/Navigation";
import type { VehicleStyle } from "../traffic/Vehicles";
import { onGameEvent, type GameEvent, type GameVehicleKind } from "./GameEvents";
import { publishMissionHud } from "./MissionHud";

/**
 * Missions: a story told as a run of objectives. The director walks the player through one
 * mission at a time — offered at its giver (the briefing), then each objective in turn, put on
 * the map and the GPS (see Navigation), until it's passed or failed.
 *
 * It judges objectives from two things: where the player is each frame (`update`), and the game
 * events the rest of the game fires (GameEvents) — a vehicle entered, someone killed, a car
 * destroyed, the player dead or arrested. Whatever a mission puts into the world (its cars, its
 * targets) is asked of the stage, and cleared away again when the mission ends however it ends.
 */

export interface Checkpoint {
	x: number;
	z: number;
	/** Height to fly through (jets): without one, any height counts. */
	y?: number;
	radius: number;
}

interface ObjectiveBase {
	/** The line shown to the player: "Get in the car", "Lose the cops". */
	label: string;
	/** Seconds to do it in; the mission fails when they run out. */
	timeLimit?: number;
	/** Put into the world as this objective begins (a convoy that sets off only once you're airborne). */
	spawns?: readonly MissionSpawn[];
	/** The alarm goes off as this objective begins: the police come after the player with this many stars. */
	wanted?: number;
}

/** Which vehicle will do: a named one, or any that fits (any police car, any jet). */
export interface VehicleMatch {
	vehicle?: string;
	police?: boolean;
	vehicleKind?: GameVehicleKind;
}

export type Objective = ObjectiveBase & (
	| { kind: "goto"; x: number; z: number; radius: number }
	| ({ kind: "enterVehicle"; x: number; z: number } & VehicleMatch)
	/**
	 * Drive somewhere in a vehicle that fits, and arrive in good enough shape (0..100) — and with
	 * no police on your tail, if `clean`.
	 */
	| ({ kind: "deliver"; x: number; z: number; radius: number; minIntegrity?: number; clean?: boolean } & VehicleMatch)
	| { kind: "eliminate"; x: number; z: number; targets: readonly string[] }
	| { kind: "destroyVehicles"; x: number; z: number; ids: readonly string[] }
	| { kind: "survive"; x: number; z: number; seconds: number }
	/** Get the police after you, to at least this many stars. */
	| { kind: "wanted"; stars: number }
	/** Shake them off. */
	| { kind: "loseWanted" }
	/** Through each in order. */
	| { kind: "checkpoints"; points: readonly Checkpoint[] }
	/**
	 * A race against other drivers: a countdown on the grid, then through the checkpoints (round
	 * `laps` times) in a vehicle, finishing in the first `place` (1 = must win).
	 */
	| { kind: "race"; points: readonly Checkpoint[]; laps?: number; racers: readonly string[]; place?: number; countdown?: number }
);

export type ObjectiveKind = Objective["kind"];

/** Something a mission puts into the world: its cars and the people it's after. */
export type MissionSpawn =
	| {
		type: "vehicle";
		id: string;
		style: VehicleStyle;
		colour: string;
		x: number;
		z: number;
		/** Degrees about Y. */
		yaw: number;
		/** Driven along these points by its own driver, rather than left parked. */
		route?: readonly (readonly [number, number])[];
		/** How fast it drives its route, m/s (it slows for corners on its own). */
		cruise?: number;
		/** A race opponent: held on the grid until the race starts; its route is the race. */
		racer?: boolean;
	}
	/** Someone to take out: `toughness` divides the damage they take (2 = twice the shots). */
	| { type: "hostile"; id: string; x: number; z: number; armed: boolean; toughness?: number };

export interface RewardVehicle {
	id: string;
	style: VehicleStyle;
	colour: string;
	/** What the player calls it: "Red Phoenix". */
	name?: string;
}

export interface MissionReward {
	cash?: number;
	weapons?: readonly WeaponId[];
	vehicles?: readonly RewardVehicle[];
}

export interface MissionDefinition {
	id: string;
	title: string;
	/** Who gives it and where: a mission blip on the map, and a marker to step into. */
	giver: { name: string; x: number; z: number };
	/** What the giver says when you step into the marker. */
	briefing: string;
	/** Missions that must have been passed first. */
	requires?: readonly string[];
	reward: MissionReward;
	objectives: readonly Objective[];
	/** Put into the world as the mission starts. */
	spawns?: readonly MissionSpawn[];
	/** People or vehicles that must come through it: losing one fails the mission. */
	protect?: readonly string[];
	/** Stray further than this from the centre for long and the mission's off. */
	area?: { x: number; z: number; radius: number };
	/** A race against the clock: the time it took is kept as a best. */
	timed?: boolean;
}

/** Puts a mission's cars and people into the world, and takes them away again. */
export interface MissionStage {
	spawn(spawns: readonly MissionSpawn[]): void;
	clear(): void;
	/** The lights go green: the opponents set off. */
	startRace?(racers: readonly string[]): void;
	/** How far round the course an opponent is: checkpoints passed, and where they are. */
	racerProgress?(id: string): { passed: number; x: number; z: number } | null;
	/** The police come after the player with at least this many stars. */
	alarm?(stars: number): void;
}

/** What the director needs to know about the player each frame. */
export interface PlayerView {
	x: number;
	y: number;
	z: number;
	/** Condition of the vehicle being driven, 0..100. */
	vehicleIntegrity: number;
	wantedStars: number;
}

export type MissionPhase = "idle" | "briefing" | "active" | "passed" | "failed";

export type MissionEvent =
	| { type: "briefing"; mission: MissionDefinition }
	| { type: "started"; mission: MissionDefinition }
	| { type: "objective"; mission: MissionDefinition; index: number; objective: Objective }
	| { type: "complete"; mission: MissionDefinition; seconds: number }
	| { type: "failed"; mission: MissionDefinition; reason: string };

/** How long "Mission passed" stays up. */
export const RESULT_SECONDS = 5;
/** "Mission failed" stays longer: it waits out the "wasted" screen, then offers a retry. */
export const FAILED_RESULT_SECONDS = 9;
/** Outside the mission area this long and it's failed. */
export const AREA_GRACE_SECONDS = 8;
/** Enter-vehicle and similar spots without their own radius are shown this big. */
const MARKER_RADIUS = 6;
/** Seconds of "3, 2, 1" on the grid, unless a race says otherwise; "GO" shows this long after. */
export const RACE_COUNTDOWN = 3;
const GO_SECONDS = 1;

export function ordinal(place: number): string {
	const tens = place % 100;
	const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][place % 10] ?? "th";
	return `${place}${suffix}`;
}

/** The checkpoints in the order they're driven: a race's points once per lap. */
export function courseOf(objective: Objective): readonly Checkpoint[] {
	if (objective.kind === "checkpoints") return objective.points;
	if (objective.kind !== "race") return [];
	const laps = Math.max(1, objective.laps ?? 1);
	return Array.from({ length: laps }, () => objective.points).flat();
}

function fits(match: VehicleMatch, vehicle: { id: string; kind: GameVehicleKind; police: boolean }): boolean {
	return (match.vehicle === undefined || match.vehicle === vehicle.id)
		&& (match.police === undefined || match.police === vehicle.police)
		&& (match.vehicleKind === undefined || match.vehicleKind === vehicle.kind);
}

const NO_STAGE: MissionStage = { spawn: () => undefined, clear: () => undefined };

export class MissionDirector {
	private phaseName: MissionPhase = "idle";
	private current: MissionDefinition | null = null;
	private index = 0;
	/** Time in the current objective, and in the whole mission. */
	private objectiveTime = 0;
	private missionTime = 0;
	private resultTime = 0;
	private outsideTime = 0;
	/** Checkpoints passed, in a checkpoints objective or a race, and the course being driven. */
	private checkpoint = 0;
	private course: readonly Checkpoint[] = [];
	/** A race's countdown still to run, its opponents home already, and where the player is placed. */
	private countdown = 0;
	private readonly finished = new Set<string>();
	private position = 1;
	/** Said instead of the objective for now: "Lose the cops first". */
	private hint = "";
	/** Targets or vehicles still to deal with, in an eliminate or destroy objective. */
	private readonly remaining = new Set<string>();
	/** Everyone killed and everything destroyed since the mission began (a convoy hit before the order came). */
	private readonly gone = new Set<string>();
	/** The vehicle the player is in, from the game events. */
	private vehicle: { id: string; kind: GameVehicleKind; police: boolean } | null = null;
	private stage: MissionStage = NO_STAGE;
	private failReason = "";
	private readonly listeners = new Set<(event: MissionEvent) => void>();
	private readonly unsubscribe: () => void;

	public constructor() {
		this.unsubscribe = onGameEvent((event) => this.onGame(event));
	}

	public get phase(): MissionPhase {
		return this.phaseName;
	}

	/** The mission being briefed, played, or just finished. */
	public get mission(): MissionDefinition | null {
		return this.current;
	}

	public get objective(): Objective | null {
		return this.phaseName === "active" && this.current ? this.current.objectives[this.index] ?? null : null;
	}

	public get objectiveIndex(): number {
		return this.index;
	}

	/** Seconds of the race countdown left: the player is held on the grid while it runs. */
	public get raceCountdown(): number {
		return this.objective?.kind === "race" ? Math.max(0, this.countdown) : 0;
	}

	/** Free to offer a mission: nothing being briefed or played. */
	public get idle(): boolean {
		return this.phaseName === "idle" || this.phaseName === "passed" || this.phaseName === "failed";
	}

	public setStage(stage: MissionStage | null): void {
		this.stage = stage ?? NO_STAGE;
	}

	public on(listener: (event: MissionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Offer a mission: the giver's briefing, waiting on `accept` or `decline`. */
	public brief(mission: MissionDefinition): void {
		if (this.phaseName === "active") return;
		this.current = mission;
		this.phaseName = "briefing";
		this.emit({ type: "briefing", mission });
		this.publish();
	}

	public accept(): void {
		if (this.phaseName === "briefing" && this.current) this.start(this.current);
	}

	public decline(): void {
		if (this.phaseName !== "briefing") return;
		this.phaseName = "idle";
		this.current = null;
		this.publish();
	}

	/** Straight into a mission (a replay, a retry), skipping the briefing. */
	public start(mission: MissionDefinition): void {
		if (this.phaseName === "active") this.end();
		this.current = mission;
		this.phaseName = "active";
		this.index = 0;
		this.missionTime = 0;
		this.outsideTime = 0;
		this.failReason = "";
		this.gone.clear();
		if (mission.spawns?.length) this.stage.spawn(mission.spawns);
		this.emit({ type: "started", mission });
		this.enter();
	}

	/** Moves time and the player on; judges what can be seen from where the player is. */
	public update(dt: number, player: Readonly<PlayerView>): void {
		if (this.phaseName === "passed" || this.phaseName === "failed") {
			this.resultTime += dt;
			if (this.resultTime >= (this.phaseName === "failed" ? FAILED_RESULT_SECONDS : RESULT_SECONDS)) {
				this.phaseName = "idle";
				this.current = null;
				this.publish();
			}
			return;
		}
		const mission = this.current;
		const objective = this.objective;
		if (!mission || !objective) return;
		this.objectiveTime += dt;
		this.missionTime += dt;

		if (mission.area) {
			const outside = Math.hypot(player.x - mission.area.x, player.z - mission.area.z) > mission.area.radius;
			this.outsideTime = outside ? this.outsideTime + dt : 0;
			if (this.outsideTime >= AREA_GRACE_SECONDS) {
				this.fail("You left the area");
				return;
			}
		}
		if (objective.timeLimit !== undefined && this.objectiveTime >= objective.timeLimit) {
			this.fail("Out of time");
			return;
		}

		switch (objective.kind) {
			case "goto":
				if (Math.hypot(objective.x - player.x, objective.z - player.z) <= objective.radius) this.advance();
				break;
			case "deliver": {
				this.hint = objective.clean && player.wantedStars > 0 ? "Lose the cops first" : "";
				if (Math.hypot(objective.x - player.x, objective.z - player.z) > objective.radius) break;
				if (!this.vehicle || !fits(objective, this.vehicle) || this.hint) break;
				if (objective.minIntegrity !== undefined && player.vehicleIntegrity < objective.minIntegrity) {
					this.fail("The car's too damaged");
					return;
				}
				this.advance();
				break;
			}
			case "survive":
				if (this.objectiveTime >= objective.seconds) this.advance();
				break;
			case "wanted":
				if (player.wantedStars >= objective.stars) this.advance();
				break;
			case "loseWanted":
				if (player.wantedStars === 0) this.advance();
				break;
			case "race":
				if (this.countdown > 0) {
					this.countdown -= dt;
					if (this.countdown <= 0) this.stage.startRace?.(objective.racers);
					break;
				}
				// Only behind the wheel: no running the course on foot.
				if (!this.vehicle) {
					this.hint = "Get back in a vehicle";
					break;
				}
				this.hint = "";
				this.passCheckpoint(player);
				if (this.objective === objective) this.position = this.placeOf(objective, player);
				break;
			case "checkpoints":
				this.passCheckpoint(player);
				break;
			default:
				// Entering, eliminating and destroying are judged from the game events.
				break;
		}
		this.publish();
	}

	/** Through the next checkpoint if the player's in it; the last one ends the objective. */
	private passCheckpoint(player: Readonly<PlayerView>): void {
		const point = this.course[this.checkpoint];
		if (!point) return;
		const flat = Math.hypot(point.x - player.x, point.z - player.z);
		const high = point.y === undefined ? 0 : Math.abs(point.y - player.y);
		if (flat > point.radius || high > point.radius) return;
		this.checkpoint++;
		if (this.checkpoint >= this.course.length) this.advance();
		else this.steer();
	}

	/** 1st, 2nd…: opponents home already, or further round, or nearer the next checkpoint. */
	private placeOf(objective: Extract<Objective, { kind: "race" }>, player: Readonly<PlayerView>): number {
		const next = this.course[this.checkpoint];
		const mine = next ? Math.hypot(next.x - player.x, next.z - player.z) : 0;
		let ahead = this.finished.size;
		for (const id of objective.racers) {
			if (this.finished.has(id)) continue;
			const racer = this.stage.racerProgress?.(id);
			if (!racer) continue;
			const theirs = next ? Math.hypot(next.x - racer.x, next.z - racer.z) : 0;
			if (racer.passed > this.checkpoint || (racer.passed === this.checkpoint && theirs < mine)) ahead++;
		}
		return ahead + 1;
	}

	public fail(reason: string): void {
		const mission = this.current;
		if (this.phaseName !== "active" || !mission) return;
		this.end();
		this.phaseName = "failed";
		this.failReason = reason;
		this.resultTime = 0;
		this.emit({ type: "failed", mission, reason });
		this.publish();
	}

	/** Abandon whatever's going on, with no result. */
	public stop(): void {
		if (this.phaseName === "active") this.end();
		this.phaseName = "idle";
		this.current = null;
		this.publish();
	}

	public dispose(): void {
		this.stop();
		this.unsubscribe();
		this.listeners.clear();
	}

	// ---- Judging --------------------------------------------------------------------------------

	private onGame(event: GameEvent): void {
		if (event.type === "vehicleEntered") this.vehicle = { id: event.id, kind: event.kind, police: event.police };
		else if (event.type === "vehicleExited" && this.vehicle?.id === event.id) this.vehicle = null;
		else if (event.type === "playerDied") this.vehicle = null;

		const mission = this.current;
		const objective = this.objective;
		if (!mission || !objective) return;
		switch (event.type) {
			case "playerDied":
				this.fail("Wasted");
				return;
			case "playerBusted":
				this.fail("Busted");
				return;
			case "personKilled":
			case "vehicleDestroyed":
				this.gone.add(event.id);
				if (mission.protect?.includes(event.id)) {
					this.fail(event.type === "personKilled" ? "They were killed" : "The vehicle was destroyed");
					return;
				}
				break;
			case "actorEscaped":
				// Away before they were dealt with — now, or by an objective still to come.
				if (!this.gone.has(event.id) && this.quarryFromHere(mission).has(event.id)) {
					this.fail("They got away");
					return;
				}
				break;
			case "racerFinished":
				if (objective.kind === "race" && objective.racers.includes(event.id) && !this.finished.has(event.id)) {
					this.finished.add(event.id);
					// Enough of them home before the player: the place wanted is gone.
					if (this.finished.size >= (objective.place ?? 1)) {
						this.fail(`Beaten to the line: ${ordinal(this.finished.size + 1)} at best`);
						return;
					}
					this.publish();
				}
				break;
			default:
				break;
		}

		if (objective.kind === "enterVehicle" && event.type === "vehicleEntered") {
			if (fits(objective, event)) this.advance();
		} else if (
			(objective.kind === "eliminate" && event.type === "personKilled")
			|| (objective.kind === "destroyVehicles" && event.type === "vehicleDestroyed")
		) {
			if (!this.remaining.delete(event.id)) return;
			if (this.remaining.size === 0) this.advance();
			else this.publish();
		}
	}

	private advance(): void {
		const mission = this.current;
		if (!mission) return;
		this.index++;
		if (this.index >= mission.objectives.length) {
			this.end();
			this.phaseName = "passed";
			this.resultTime = 0;
			this.emit({ type: "complete", mission, seconds: this.missionTime });
			this.publish();
			return;
		}
		this.enter();
	}

	private enter(): void {
		const mission = this.current;
		const objective = this.objective;
		if (!mission || !objective) return;
		this.objectiveTime = 0;
		this.checkpoint = 0;
		this.course = courseOf(objective);
		this.countdown = objective.kind === "race" ? objective.countdown ?? RACE_COUNTDOWN : 0;
		this.finished.clear();
		this.position = 1;
		this.hint = "";
		this.remaining.clear();
		const quarry = objective.kind === "eliminate" ? objective.targets : objective.kind === "destroyVehicles" ? objective.ids : [];
		for (const id of quarry) if (!this.gone.has(id)) this.remaining.add(id);
		if (objective.spawns?.length) this.stage.spawn(objective.spawns);
		if (objective.wanted) this.stage.alarm?.(objective.wanted);
		if (objective.kind === "race" && this.countdown <= 0) this.stage.startRace?.(objective.racers);
		this.steer();
		this.emit({ type: "objective", mission, index: this.index, objective });
		// Already done: sat in the car it asks for, or every target dealt with on the way.
		const vehicle = this.vehicle;
		if (objective.kind === "enterVehicle" && vehicle) this.onGame({ type: "vehicleEntered", ...vehicle });
		else if (quarry.length > 0 && this.remaining.size === 0) this.advance();
		else this.publish();
	}

	/** Everyone and everything the mission still wants dealt with, from this objective on. */
	private quarryFromHere(mission: MissionDefinition): Set<string> {
		const ids = new Set<string>();
		for (const objective of mission.objectives.slice(this.index)) {
			if (objective.kind === "eliminate") for (const id of objective.targets) ids.add(id);
			if (objective.kind === "destroyVehicles") for (const id of objective.ids) ids.add(id);
		}
		return ids;
	}

	/** The GPS and the map: where the objective is, if it's anywhere. */
	private steer(): void {
		const objective = this.objective;
		if (!objective) {
			setObjective(null);
			return;
		}
		switch (objective.kind) {
			case "wanted":
			case "loseWanted":
				setObjective(null);
				break;
			case "checkpoints":
			case "race": {
				const point = this.course[this.checkpoint];
				setObjective(point ? { x: point.x, z: point.z, y: point.y, label: objective.label, radius: point.radius } : null);
				break;
			}
			case "goto":
			case "deliver":
				setObjective({ x: objective.x, z: objective.z, label: objective.label, radius: objective.radius });
				break;
			case "survive":
				setObjective({ x: objective.x, z: objective.z, label: objective.label, radius: MARKER_RADIUS });
				break;
			default:
				// A car to get in, people or vehicles to deal with: they carry their own markers.
				setObjective({ x: objective.x, z: objective.z, label: objective.label, radius: MARKER_RADIUS, beacon: false });
				break;
		}
	}

	/** Out of the active mission: its things cleared away and the GPS stood down. */
	private end(): void {
		this.remaining.clear();
		this.countdown = 0;
		this.stage.clear();
		setObjective(null);
	}

	private emit(event: MissionEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}

	private publish(): void {
		const mission = this.current;
		const objective = this.objective;
		let counter: string | null = null;
		if (objective?.kind === "eliminate") counter = `${objective.targets.length - this.remaining.size}/${objective.targets.length}`;
		else if (objective?.kind === "destroyVehicles") counter = `${objective.ids.length - this.remaining.size}/${objective.ids.length}`;
		else if (objective?.kind === "checkpoints") counter = `${this.checkpoint}/${objective.points.length}`;
		let countdown: string | null = null;
		if (objective?.kind === "race") {
			const laps = Math.max(1, objective.laps ?? 1);
			const lap = Math.min(laps, Math.floor(this.checkpoint / objective.points.length) + 1);
			counter = `${ordinal(this.position)} of ${objective.racers.length + 1}${laps > 1 ? ` · Lap ${lap}/${laps}` : ""}`;
			const length = objective.countdown ?? RACE_COUNTDOWN;
			if (this.countdown > 0) countdown = String(Math.ceil(this.countdown));
			else if (this.objectiveTime - length < GO_SECONDS) countdown = "GO";
		}
		publishMissionHud({
			phase: this.phaseName,
			missionId: mission?.id ?? "",
			title: mission?.title ?? "",
			giver: mission?.giver.name ?? "",
			briefing: mission?.briefing ?? "",
			reward: mission?.reward ?? {},
			objective: this.hint || (objective?.label ?? ""),
			counter,
			countdown,
			timeLeft: objective?.timeLimit !== undefined ? Math.max(0, objective.timeLimit - this.objectiveTime) : null,
			outsideArea: this.outsideTime > 0 ? Math.max(0, AREA_GRACE_SECONDS - this.outsideTime) : null,
			missionTime: this.missionTime,
			failReason: this.failReason,
		});
	}
}

/** The one director the game runs. */
export const missions = new MissionDirector();
