import type { WeaponId } from "../combat/WeaponData";
import { setObjective } from "../navigation/Navigation";
import type { VehicleStyle } from "../traffic/Vehicles";
import { briefingScene, type Cutscene, type Shot } from "./Cutscenes";
import { onGameEvent, type GameEvent, type GameVehicleKind } from "./GameEvents";
import { publishMissionHud, type HudBonus, type HudChoice } from "./MissionHud";

/**
 * Missions: a story told as a run of objectives. The director walks the player through one
 * mission at a time — offered at its giver (the briefing), then each objective in turn, put on
 * the map and the GPS (see Navigation), until it's passed or failed.
 *
 * It judges objectives from two things: where the player is each frame (`update`), and the game
 * events the rest of the game fires (GameEvents) — a vehicle entered, someone killed, a car
 * destroyed, the player dead or arrested. Whatever a mission puts into the world (its cars, its
 * targets) is asked of the stage, and cleared away again when the mission ends however it ends.
 *
 * A mission needn't run straight through. Objectives can carry a `step` name and jump to another
 * (`next`), be skipped unless story flags hold (`onlyIf`), or offer the player a choice that
 * sets flags and picks the way on. Triggers react to what's going on — the police arriving, a
 * guard raising the alarm, a target getting near — with lines of dialogue, reinforcements or a
 * change of plan. Everything is judged from game state, so a run plays the same way every time
 * it's played the same way.
 */

export interface Checkpoint {
	x: number;
	z: number;
	/** Height to fly through (jets): without one, any height counts. */
	y?: number;
	radius: number;
}

/**
 * Story flags a thing depends on: each must be set, or — written "!flag" — must not be. Flags
 * come from the save (choices made in missions already passed) and from this run so far.
 */
export type Conditions = readonly string[];

/** A line of dialogue, shown as a subtitle. */
export interface Line {
	who: string;
	text: string;
	/** On screen this long; by default, long enough to read. */
	seconds?: number;
	/** Only said if these flags hold. */
	onlyIf?: Conditions;
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
	/** A name other objectives, choices and triggers can jump to. */
	step?: string;
	/** Where to go once this is done, instead of the next in the list; "pass" ends the mission. */
	next?: string;
	/** Skipped unless these flags hold when it comes round. */
	onlyIf?: Conditions;
	/** Said as it begins, and as it's done. */
	say?: readonly Line[];
	done?: readonly Line[];
	/** Set once it's done. */
	flags?: readonly string[];
	/** A restart point: failing after this, the player can retry from here instead of the top. */
	checkpoint?: { x: number; z: number; yaw?: number };
	/** Mission people who start following the player as this begins (a hostage freed). */
	followers?: readonly string[];
	/** A cutscene as it begins (the target looked over, the crew talking); its clock waits for it. */
	scene?: Cutscene;
}

/** Which vehicle will do: a named one, or any that fits (any police car, any jet, any ambulance). */
export interface VehicleMatch {
	vehicle?: string;
	police?: boolean;
	vehicleKind?: GameVehicleKind;
	style?: VehicleStyle;
}

/** The vehicle the player's in, as the director knows it. */
interface PlayerVehicle {
	id: string;
	kind: GameVehicleKind;
	police: boolean;
	style?: VehicleStyle;
}

export interface ChoiceOption {
	label: string;
	/** A few words on what it means. */
	detail?: string;
	flags?: readonly string[];
	/** The step this leads to; otherwise the objective's own `next`, or on down the list. */
	next?: string;
	say?: readonly Line[];
	/** Only offered if these flags hold. */
	onlyIf?: Conditions;
	/** Paid on top of the mission's reward, if the mission's passed having chosen this. */
	reward?: MissionReward;
}

export type Objective = ObjectiveBase & (
	| { kind: "goto"; x: number; z: number; radius: number }
	| ({ kind: "enterVehicle"; x: number; z: number } & VehicleMatch)
	/**
	 * Drive somewhere in a vehicle that fits, and arrive in good enough shape (0..100) — and with
	 * no police on your tail, if `clean`.
	 */
	| ({ kind: "deliver"; x: number; z: number; radius: number; minIntegrity?: number; clean?: boolean; person?: string } & VehicleMatch)
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
	/**
	 * Follow a mission car to wherever it's going without being made: closer than `near` for a
	 * few seconds and they've spotted you (on to the `spotted` step, or it's failed); further
	 * than `far` for a while and they're lost. Done when they get where they were going.
	 */
	| { kind: "tail"; target: string; near: number; far: number; spotted?: string }
	/** Stop mission cars: wreck them, or knock them below `below` integrity and their drivers give up. */
	| { kind: "disable"; x: number; z: number; targets: readonly string[]; below: number }
	/**
	 * Stand somewhere for a few seconds — searching a spot, talking to someone (`person`, marked
	 * where they are, or a mission car), cutting a hostage loose. On foot unless `on` says otherwise.
	 */
	| { kind: "inspect"; x: number; z: number; radius: number; seconds: number; person?: string; on?: "foot" | "vehicle" | "either" }
	/** The player decides: each option sets its flags and picks the way on. */
	| { kind: "choice"; options: readonly ChoiceOption[] }
	/** Get there with a mission person alongside — on foot nearby, or in the car with you. */
	| { kind: "escort"; person: string; x: number; z: number; radius: number }
	/** Get clear: further than `radius` from the spot — and with no police on you, if `clean`. */
	| { kind: "leave"; x: number; z: number; radius: number; clean?: boolean }
);

export type ObjectiveKind = Objective["kind"];

/** Different looks for a mission's people: a crew's colours, a security firm's, someone's own. */
export interface PersonLook {
	model?: "man" | "manCasual" | "woman" | "womanSuit" | "womanWorker" | "womanCasual";
	palette?: { skin: string; shirt: string; pants: string; hair: string };
}

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
		/** Its driver pulls over and gives up once the car's knocked below this integrity. */
		disableBelow?: number;
		/** Placed already damaged (a crash), 0..100. */
		integrity?: number;
		/** Placed on fire, burning steadily until a trigger lets it burn (`letBurn`) or a crew puts it out. */
		burning?: boolean;
	}
	/**
	 * Someone in the mission. A `guard` fights the player on sight from any side; a `sentry`
	 * watches the way it faces (`yaw`) and can be crept up on; someone `passive` — a witness, a
	 * hostage — never fights. `toughness` divides the damage they take (2 = twice the shots).
	 */
	| ({ type: "hostile"; id: string; x: number; z: number; armed: boolean; toughness?: number; role?: "guard" | "sentry" | "passive"; yaw?: number } & PersonLook);

export interface RewardVehicle {
	id: string;
	style: VehicleStyle;
	colour: string;
	/** What the player calls it: "Red Vesper". */
	name?: string;
}

/** Who thinks what of the player. */
export type Faction = "street" | "sunset" | "law" | "meridian";

export interface MissionReward {
	cash?: number;
	weapons?: readonly WeaponId[];
	vehicles?: readonly RewardVehicle[];
	/** Standing gained (or lost) with each side. */
	rep?: Partial<Record<Faction, number>>;
}

/** Something to do along the way for a better rating; missing it doesn't fail the mission. */
export type Bonus = { id: string; label: string } & (
	/** No mission guard ever raises the alarm. */
	| { kind: "undetected" }
	/** No police stars at any point. */
	| { kind: "noWanted" }
	/** Done inside this many seconds. */
	| { kind: "time"; seconds: number }
	/** This flag set by the end (an optional detour taken); "!flag", never set. */
	| { kind: "flag"; flag: string }
	/** The vehicle (any, or a named one) never drops below this condition while you're in it. */
	| { kind: "intact"; min: number; vehicle?: string }
	/** Someone or something comes through it. */
	| { kind: "alive"; id: string }
);

export interface BonusResult {
	id: string;
	label: string;
	met: boolean;
}

/** Something to react to while a mission runs: every condition given must hold, and it fires once. */
export interface MissionTrigger {
	when: {
		/** On this step… */
		step?: string;
		/** …this many seconds into it (or into the mission, without a step). */
		after?: number;
		/** The police after the player with at least this many stars. */
		wanted?: number;
		/** A guard has raised the alarm. */
		alerted?: boolean;
		flags?: Conditions;
		/** The player within this circle. */
		near?: { x: number; z: number; radius: number };
		/** A mission car or person within this circle. */
		targetNear?: { id: string; x: number; z: number; radius: number };
		/** All of these killed or destroyed. */
		gone?: readonly string[];
		/** This mission car's fire is out (a crew put it out), and it's still in one piece. */
		putOut?: string;
	};
	say?: readonly Line[];
	spawns?: readonly MissionSpawn[];
	/** The police come after the player with this many stars. */
	alarm?: number;
	/** Every mission guard and sentry stops what they're doing and fights. */
	alertAll?: boolean;
	/** On to this step at once. */
	goto?: string;
	flags?: readonly string[];
	/** A mission car takes a new road (and speed). */
	reroute?: { id: string; route: readonly (readonly [number, number])[]; cruise?: number };
	/** A mission car keeps to its road at a new speed (a driver who's been spooked). */
	pace?: { id: string; cruise: number };
	/** A short line across the HUD: "The deal's moved". */
	notice?: string;
	/** A mission car catches fire, burning steadily (the fire spreading at a crash scene). */
	ignite?: string;
	/** A mission car's steady fire burns down: it goes up in about twenty seconds unless it's put out. */
	letBurn?: string;
	/** A cutscene: the moment shown (the play stops while it runs). */
	scene?: Cutscene;
}

export type MissionChapter = "story" | "side" | "race" | "job";

export interface MissionDefinition {
	id: string;
	title: string;
	/**
	 * Who gives it and where: a mission blip on the map, and a marker to step into. A giver with a
	 * `look` stands there in person and says the briefing to the player's face (a cutscene), as
	 * `speaker`: the name their lines go by, so they keep one voice.
	 */
	giver: { name: string; x: number; z: number; role?: string; speaker?: string; look?: PersonLook };
	/** What the giver says when you step into the marker. */
	briefing: string;
	/** Story, side job or race: how the mission list groups it. Story by default. */
	chapter?: MissionChapter;
	/** Missions that must have been passed first. */
	requires?: readonly string[];
	/** Only offered while these flags hold. */
	onlyIf?: Conditions;
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
	/** A cutscene as it starts, after the briefing (not again on a retry). */
	opening?: Cutscene;
	/** Said as it starts (after the briefing), and once it's passed. */
	intro?: readonly Line[];
	outro?: readonly Line[];
	triggers?: readonly MissionTrigger[];
	bonuses?: readonly Bonus[];
}

/** Where a mission car or person is (and, a car, what shape it's in). */
export interface ActorState {
	x: number;
	z: number;
	integrity: number;
	/** A person riding in the player's vehicle. */
	aboard?: boolean;
	/** A car with flames showing. */
	onFire?: boolean;
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
	/** A mission car or person that's out in the world, or null. */
	actor?(id: string): ActorState | null;
	/** A mission person starts (or stops) following the player. */
	follow?(id: string, following: boolean): void;
	/** Every mission guard fights. */
	alertAll?(): void;
	/** A mission car takes a new road. */
	reroute?(id: string, route: readonly (readonly [number, number])[], cruise?: number): void;
	/** A mission car changes speed. */
	pace?(id: string, cruise: number): void;
	/** A mission car catches fire (held steady). */
	ignite?(id: string): void;
	/** A mission car's held fire burns down. */
	letBurn?(id: string): void;
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
	| { type: "complete"; mission: MissionDefinition; seconds: number; flags: readonly string[]; bonuses: readonly BonusResult[]; rating: number | null; extras: readonly MissionReward[] }
	| { type: "failed"; mission: MissionDefinition; reason: string };

/** Where a retry can pick up from: the objective, and the run as it stood then. */
export interface MissionCheckpoint {
	missionId: string;
	index: number;
	x: number;
	z: number;
	yaw: number;
	flags: readonly string[];
	gone: readonly string[];
	fired: readonly number[];
}

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
/** Tailing: this long too close and they've made you; this long too far and they're gone. */
export const SPOT_SECONDS = 2.5;
export const LOSE_SECONDS = 6;
/** Someone being escorted is with you this close (or riding along). */
export const ESCORT_RANGE = 8;
/** A notice ("Checkpoint") stays up this long. */
export const NOTICE_SECONDS = 2.6;
/** Moving markers (a car being tailed) are re-placed on the map at most this often. */
const TRACK_INTERVAL = 0.75;

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

/**
 * Something that says lines out loud (see audio/MissionVoice). The director hands it each line as
 * it comes up and holds the subtitle while it's still speaking, so the two stay together.
 */
export interface LineVoice {
	speak(line: Line): void;
	/** Still saying the last line given. */
	speaking(): boolean;
	/** Stop at once: the mission's over, or what was waiting to be said is overtaken. */
	stop(): void;
}

const NO_VOICE: LineVoice = { speak: () => undefined, speaking: () => false, stop: () => undefined };

/** However long a voice takes, a line moves on after this much longer than its reading time. */
const VOICE_OVERRUN_SECONDS = 6;

/** Seconds a line stays up: about a reading pace, within reason. */
export function lineSeconds(line: Line): number {
	if (line.seconds !== undefined) return line.seconds;
	const words = line.text.split(/\s+/).filter(Boolean).length;
	return Math.min(7, Math.max(2.2, 1.2 + words * 0.32));
}

/** Whether the flags hold: each named must be set, each "!named" must not. */
export function holds(conditions: Conditions | undefined, has: (flag: string) => boolean): boolean {
	if (!conditions) return true;
	return conditions.every((condition) => (condition.startsWith("!") ? !has(condition.slice(1)) : has(condition)));
}

/** A rating out of three from the bonuses met; null for a mission without any. */
export function ratingFor(results: readonly BonusResult[]): number | null {
	if (results.length === 0) return null;
	const met = results.filter((result) => result.met).length;
	return 1 + Math.round((2 * met) / results.length);
}

function fits(match: VehicleMatch, vehicle: PlayerVehicle): boolean {
	return (match.vehicle === undefined || match.vehicle === vehicle.id)
		&& (match.police === undefined || match.police === vehicle.police)
		&& (match.vehicleKind === undefined || match.vehicleKind === vehicle.kind)
		&& (match.style === undefined || match.style === vehicle.style);
}

/** Every spawn in a mission, wherever it's listed. */
export function missionSpawns(mission: MissionDefinition): MissionSpawn[] {
	return [
		...(mission.spawns ?? []),
		...mission.objectives.flatMap((objective) => objective.spawns ?? []),
		...(mission.triggers ?? []).flatMap((trigger) => trigger.spawns ?? []),
	];
}

/** The person who stands at a giver's marker: one per giver, whichever missions they give. */
export function giverPersonId(giver: MissionDefinition["giver"]): string {
	return `giver-${giver.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** Everyone who gives missions in person, once each, dressed as they're first listed. */
export function missionGivers(list: readonly MissionDefinition[]): { id: string; look: PersonLook }[] {
	const givers = new Map<string, PersonLook>();
	for (const mission of list) {
		const id = giverPersonId(mission.giver);
		if (mission.giver.look && !givers.has(id)) givers.set(id, mission.giver.look);
	}
	return [...givers].map(([id, look]) => ({ id, look }));
}

/** A shot with nothing said and no time given stays up this long. */
const SHOT_SECONDS = 3;

/** How long a shot is expected to last: its own time, or its lines' (the voice may take longer). */
function shotSeconds(shot: Shot, lines: Iterable<Line>): number {
	let total = 0;
	for (const line of lines) total += lineSeconds(line);
	return Math.max(shot.seconds ?? 0, total) || SHOT_SECONDS;
}

const NO_STAGE: MissionStage = { spawn: () => undefined, clear: () => undefined };
const NO_FLAGS = () => false;

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
	/** Targets or vehicles still to deal with, in an eliminate, destroy or disable objective. */
	private readonly remaining = new Set<string>();
	/** Everyone killed and everything destroyed since the mission began (a convoy hit before the order came). */
	private readonly gone = new Set<string>();
	/** The vehicle the player is in, from the game events. */
	private vehicle: PlayerVehicle | null = null;
	private stage: MissionStage = NO_STAGE;
	private failReason = "";
	private readonly listeners = new Set<(event: MissionEvent) => void>();
	private readonly unsubscribe: () => void;

	/** Flags set this run, and the saved ones they sit on top of. */
	private readonly flags = new Set<string>();
	private savedFlag: (flag: string) => boolean = NO_FLAGS;
	/** Triggers already fired, by index. */
	private readonly fired = new Set<number>();
	/** A guard raised the alarm; the most stars the police had on the player; the worst state the car got in. */
	private alerted = false;
	private worstWanted = 0;
	private readonly lowestIntegrity = new Map<string, number>();
	private anyVehicleLowest = 100;
	/** Tailing: seconds too close, seconds too far, and the gap now. */
	private closeTime = 0;
	private farTime = 0;
	private gap: number | null = null;
	/** Seconds stood at an inspect spot. */
	private inspected = 0;
	private trackTime = 0;
	private lastCheckpoint: MissionCheckpoint | null = null;
	/** Subtitles waiting, the one up now, and how long it has left. */
	private lines: Line[] = [];
	private line: Line | null = null;
	private lineTime = 0;
	private voice: LineVoice = NO_VOICE;
	private noticeText = "";
	private noticeTime = 0;
	/**
	 * The cutscene playing and those waiting their turn; the shot it's on, for how long, a count
	 * bumped with every new shot (a cut), and the lines that shot is waiting to have said.
	 */
	private scene: Cutscene | null = null;
	private readonly scenes: Cutscene[] = [];
	private shotIndex = 0;
	private shotTime = 0;
	private shotSerial = 0;
	private shotLength = SHOT_SECONDS;
	private readonly shotLines = new Set<Line>();
	/** The mission last failed: starting it again skips its opening. */
	private failedId = "";
	private lastResult: { bonuses: readonly BonusResult[]; rating: number | null } = { bonuses: [], rating: null };
	/** What the choices made this run pay on top. */
	private extras: MissionReward[] = [];
	/** Where the player was last seen, for triggers judged between frames. */
	private readonly view: PlayerView = { x: 0, y: 0, z: 0, vehicleIntegrity: 100, wantedStars: 0 };

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

	/** The last restart point reached in the mission just failed (or being played). */
	public get restartPoint(): MissionCheckpoint | null {
		return this.lastCheckpoint;
	}

	/** A cutscene is playing: the player's held still, the HUD stands back and the camera follows the shot. */
	public get inScene(): boolean {
		return this.scene !== null;
	}

	/** The shot on screen, how far through it (0..1), and a number that changes with every new shot. */
	public get sceneShot(): { shot: Shot; progress: number; serial: number } | null {
		const shot = this.scene?.shots[this.shotIndex];
		if (!shot) return null;
		return { shot, progress: Math.min(1, this.shotTime / this.shotLength), serial: this.shotSerial };
	}

	/** Space: the rest of the cutscene skipped, and what was to be said in it. A briefing isn't skipped but answered. */
	public skipScene(): void {
		if (!this.scene || this.scene.hold) return;
		const saying = this.line !== null && this.shotLines.has(this.line);
		this.lines = this.lines.filter((line) => !this.shotLines.has(line));
		if (saying) {
			this.voice.stop();
			this.nextLine();
		}
		this.scenes.length = 0;
		this.endScene();
		this.publish();
	}

	/** The choices on offer now, with their place in the objective's list. */
	public get choices(): { index: number; option: ChoiceOption }[] {
		const objective = this.objective;
		if (objective?.kind !== "choice" || this.scene) return [];
		return objective.options.map((option, index) => ({ index, option })).filter(({ option }) => holds(option.onlyIf, this.has));
	}

	public setStage(stage: MissionStage | null): void {
		this.stage = stage ?? NO_STAGE;
	}

	/** What says the lines out loud; none by default (tests, and before the game has sound). */
	public setVoice(voice: LineVoice | null): void {
		this.voice.stop();
		this.voice = voice ?? NO_VOICE;
	}

	/** Where saved story flags are read from (the player's progress). */
	public setFlagSource(source: ((flag: string) => boolean) | null): void {
		this.savedFlag = source ?? NO_FLAGS;
	}

	/** Set this run or saved from before. */
	public readonly has = (flag: string): boolean => this.flags.has(flag) || this.savedFlag(flag);

	public on(listener: (event: MissionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Offer a mission: the giver's briefing, waiting on `accept` or `decline`. */
	public brief(mission: MissionDefinition): void {
		if (this.phaseName === "active") return;
		this.current = mission;
		this.phaseName = "briefing";
		this.clearScenes();
		this.dropLines();
		// Someone stood there tells it to the player's face.
		if (mission.giver.look && mission.briefing) this.playScene(briefingScene(mission.giver.speaker ?? mission.giver.name, mission.briefing));
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
		this.clearScenes();
		this.dropLines();
		this.publish();
	}

	/** Straight into a mission (a replay, a retry), skipping the briefing. */
	public start(mission: MissionDefinition): void {
		if (this.phaseName === "active") this.end();
		this.begin(mission);
		this.lastCheckpoint = null;
		if (mission.spawns?.length) this.stage.spawn(mission.spawns);
		this.emit({ type: "started", mission });
		// The opening plays the first time; trying again after failing, straight in.
		if (mission.opening && mission.id !== this.failedId) this.playScene(mission.opening);
		if (mission.intro?.length) this.say(mission.intro);
		this.index = 0;
		this.enter();
		// Whatever's due from the off (a van already on the road) is out before anything else happens.
		if (this.phaseName === "active") this.runTriggers(this.view);
	}

	/**
	 * Back into the mission at its last restart point, the run as it was then: the flags set,
	 * whoever was dealt with still dealt with, and everyone else put back.
	 */
	public resume(point: MissionCheckpoint, mission: MissionDefinition): void {
		if (this.phaseName === "active") this.end();
		this.begin(mission);
		this.lastCheckpoint = point;
		for (const flag of point.flags) this.flags.add(flag);
		for (const id of point.gone) this.gone.add(id);
		for (const index of point.fired) this.fired.add(index);
		const spawns = [
			...(mission.spawns ?? []),
			...mission.objectives.slice(0, point.index).filter((objective) => holds(objective.onlyIf, this.has)).flatMap((objective) => objective.spawns ?? []),
			...(mission.triggers ?? []).filter((_, index) => this.fired.has(index)).flatMap((trigger) => trigger.spawns ?? []),
		].filter((spawn) => !this.gone.has(spawn.id));
		if (spawns.length) this.stage.spawn(spawns);
		for (const objective of mission.objectives.slice(0, point.index)) {
			if (holds(objective.onlyIf, this.has)) for (const id of objective.followers ?? []) this.stage.follow?.(id, true);
		}
		this.emit({ type: "started", mission });
		this.index = point.index;
		this.enter();
		if (this.phaseName === "active") this.runTriggers(this.view);
	}

	private begin(mission: MissionDefinition): void {
		this.current = mission;
		this.phaseName = "active";
		this.missionTime = 0;
		this.outsideTime = 0;
		this.failReason = "";
		this.gone.clear();
		this.flags.clear();
		this.fired.clear();
		this.alerted = false;
		this.worstWanted = 0;
		this.lowestIntegrity.clear();
		this.anyVehicleLowest = 100;
		this.dropLines();
		this.clearScenes();
		this.noticeTime = 0;
		this.lastResult = { bonuses: [], rating: null };
		this.extras = [];
		// A new run starts with the police called off (see MissionRuntime).
		this.view.wantedStars = 0;
	}

	/** Lines to show as subtitles, after any already waiting. */
	public say(lines: readonly Line[]): void {
		for (const line of lines) if (holds(line.onlyIf, this.has)) this.lines.push(line);
		if (!this.line) this.nextLine();
	}

	/** A short line across the HUD for a moment. */
	public notice(text: string): void {
		this.noticeText = text;
		this.noticeTime = NOTICE_SECONDS;
	}

	private nextLine(): void {
		this.line = this.lines.shift() ?? null;
		this.lineTime = this.line ? lineSeconds(this.line) : 0;
		if (this.line) this.voice.speak(this.line);
	}

	/** A cutscene: straight away, or after the one playing. */
	private playScene(scene: Cutscene): void {
		if (scene.shots.length === 0) return;
		if (this.scene) {
			this.scenes.push(scene);
			return;
		}
		this.scene = scene;
		this.shotIndex = 0;
		this.startShot();
	}

	private startShot(): void {
		const shot = this.scene?.shots[this.shotIndex];
		if (!shot) return;
		this.shotTime = 0;
		this.shotSerial++;
		this.shotLines.clear();
		const lines = (shot.say ?? []).filter((line) => holds(line.onlyIf, this.has));
		for (const line of lines) this.shotLines.add(line);
		this.shotLength = shotSeconds(shot, lines);
		if (lines.length) this.say(lines);
	}

	/** On to the next shot once this one's had its time and its lines are said; the scene ends after the last. */
	private updateScene(dt: number): void {
		const scene = this.scene;
		const shot = scene?.shots[this.shotIndex];
		if (!scene || !shot) return;
		this.shotTime += dt;
		const minimum = shot.seconds ?? (shot.say?.length ? 0 : SHOT_SECONDS);
		const saying = (this.line !== null && this.shotLines.has(this.line)) || this.lines.some((line) => this.shotLines.has(line));
		if (this.shotTime < minimum || saying) return;
		if (this.shotIndex < scene.shots.length - 1) {
			this.shotIndex++;
			this.startShot();
		} else if (!scene.hold) {
			this.endScene();
		}
	}

	/** This cutscene's over: the next waiting, or back to play. */
	private endScene(): void {
		this.scene = null;
		this.shotLines.clear();
		const next = this.scenes.shift();
		if (next) this.playScene(next);
	}

	private clearScenes(): void {
		this.scene = null;
		this.scenes.length = 0;
		this.shotLines.clear();
	}

	/** Nothing more to say: whatever was waiting is dropped and the voice stops mid-line. */
	private dropLines(): void {
		this.lines = [];
		this.line = null;
		this.voice.stop();
	}

	/** Moves time and the player on; judges what can be seen from where the player is. */
	public update(dt: number, player: Readonly<PlayerView>): void {
		const talking = this.line !== null || this.noticeTime > 0;
		if (this.line) {
			this.lineTime -= dt;
			// Held while the voice is still saying it, within reason.
			const held = this.voice.speaking() && this.lineTime > -VOICE_OVERRUN_SECONDS;
			if (this.lineTime <= 0 && !held) this.nextLine();
		}
		if (this.noticeTime > 0) this.noticeTime -= dt;
		// A frame that was still in a cutscene as it began is the cutscene's, even if it ends now.
		const filming = this.scene !== null;
		this.updateScene(dt);
		if (this.phaseName === "passed" || this.phaseName === "failed") {
			this.resultTime += dt;
			if (this.resultTime >= (this.phaseName === "failed" ? FAILED_RESULT_SECONDS : RESULT_SECONDS)) {
				this.phaseName = "idle";
				this.current = null;
				this.publish();
			} else if (talking) {
				this.publish();
			}
			return;
		}
		const mission = this.current;
		const objective = this.objective;
		if (!mission || !objective) {
			if (talking || filming) this.publish();
			return;
		}
		Object.assign(this.view, player);
		// The play waits while a cutscene runs: no clocks, nothing judged.
		if (filming) {
			this.publish();
			return;
		}
		this.objectiveTime += dt;
		this.missionTime += dt;
		this.worstWanted = Math.max(this.worstWanted, player.wantedStars);
		if (this.vehicle) {
			const lowest = Math.min(this.lowestIntegrity.get(this.vehicle.id) ?? 100, player.vehicleIntegrity);
			this.lowestIntegrity.set(this.vehicle.id, lowest);
			this.anyVehicleLowest = Math.min(this.anyVehicleLowest, lowest);
		}

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
				// A passenger to bring: not without them aboard.
				if (objective.person && !this.stage.actor?.(objective.person)?.aboard) {
					this.hint = "Wait for them to get in";
					break;
				}
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
			case "tail":
				if (!this.judgeTail(dt, objective, player)) return;
				break;
			case "disable":
				this.judgeDisable(objective);
				break;
			case "inspect":
				this.judgeInspect(dt, objective, player);
				break;
			case "escort":
				this.judgeEscort(objective, player);
				break;
			case "leave": {
				const away = Math.hypot(objective.x - player.x, objective.z - player.z) > objective.radius;
				this.hint = away && objective.clean && player.wantedStars > 0 ? "Lose the cops" : "";
				if (away && !this.hint) this.advance();
				break;
			}
			default:
				// Entering, eliminating, destroying and choosing are judged from events and input.
				break;
		}
		if (this.phaseName !== "active") return;
		this.runTriggers(player);
		if (this.phaseName !== "active") return;
		this.track(dt);
		this.publish();
	}

	/** Following without being made. False if it failed. */
	private judgeTail(dt: number, objective: Extract<Objective, { kind: "tail" }>, player: Readonly<PlayerView>): boolean {
		const target = this.stage.actor?.(objective.target);
		if (!target) {
			this.gap = null;
			return true;
		}
		const gap = Math.hypot(target.x - player.x, target.z - player.z);
		this.gap = gap;
		this.closeTime = gap < objective.near ? this.closeTime + dt : 0;
		this.farTime = gap > objective.far ? this.farTime + dt : 0;
		this.hint = gap < objective.near ? "Too close — back off" : gap > objective.far ? "You're losing them" : "";
		if (this.closeTime >= SPOT_SECONDS) {
			this.flags.add("spotted");
			if (objective.spotted) {
				this.notice("You've been made");
				this.jump(objective.spotted);
				return this.phaseName === "active";
			}
			this.fail("They spotted you");
			return false;
		}
		if (this.farTime >= LOSE_SECONDS) {
			this.fail("You lost them");
			return false;
		}
		return true;
	}

	private judgeDisable(objective: Extract<Objective, { kind: "disable" }>): void {
		for (const id of [...this.remaining]) {
			const target = this.stage.actor?.(id);
			if (target && target.integrity < objective.below) this.remaining.delete(id);
		}
		if (this.remaining.size === 0) this.advance();
	}

	private judgeInspect(dt: number, objective: Extract<Objective, { kind: "inspect" }>, player: Readonly<PlayerView>): void {
		const spot = objective.person ? this.stage.actor?.(objective.person) ?? objective : objective;
		const there = Math.hypot(spot.x - player.x, spot.z - player.z) <= objective.radius;
		const on = objective.on ?? "foot";
		const footing = on === "either" || (on === "vehicle") === (this.vehicle !== null);
		this.hint = there && !footing ? (on === "vehicle" ? "Get in a vehicle" : "Get out and do it on foot") : "";
		if (there && footing) this.inspected += dt;
		if (this.inspected >= objective.seconds) this.advance();
	}

	private judgeEscort(objective: Extract<Objective, { kind: "escort" }>, player: Readonly<PlayerView>): void {
		const person = this.stage.actor?.(objective.person);
		const along = !person || person.aboard || Math.hypot(person.x - player.x, person.z - player.z) <= ESCORT_RANGE;
		this.hint = along ? "" : "Wait for them to catch up";
		if (along && Math.hypot(objective.x - player.x, objective.z - player.z) <= objective.radius) this.advance();
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

	/** Takes the choice at `index` (its place in the objective's options). */
	public choose(index: number): void {
		const objective = this.objective;
		if (objective?.kind !== "choice") return;
		const option = objective.options[index];
		if (!option || !holds(option.onlyIf, this.has) || this.scene) return;
		for (const flag of option.flags ?? []) this.flags.add(flag);
		if (option.reward) this.extras.push(option.reward);
		if (option.say?.length) this.say(option.say);
		this.advance(option.next);
	}

	public fail(reason: string): void {
		const mission = this.current;
		if (this.phaseName !== "active" || !mission) return;
		this.end();
		this.phaseName = "failed";
		this.failedId = mission.id;
		this.failReason = reason;
		this.resultTime = 0;
		this.dropLines();
		this.emit({ type: "failed", mission, reason });
		this.publish();
	}

	/** Walk away from the mission being played: failed, with a retry on offer. */
	public abandon(): void {
		this.fail("Mission abandoned");
	}

	/** Abandon whatever's going on, with no result. */
	public stop(): void {
		if (this.phaseName === "active") this.end();
		this.phaseName = "idle";
		this.current = null;
		this.clearScenes();
		this.dropLines();
		this.publish();
	}

	public dispose(): void {
		this.stop();
		this.unsubscribe();
		this.listeners.clear();
	}

	// ---- Judging --------------------------------------------------------------------------------

	private onGame(event: GameEvent): void {
		if (event.type === "vehicleEntered") this.vehicle = { id: event.id, kind: event.kind, police: event.police, style: event.style };
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
			case "hostileAlerted":
				this.alerted = true;
				break;
			case "personKilled":
			case "vehicleDestroyed":
				this.gone.add(event.id);
				if (mission.protect?.includes(event.id)) {
					this.fail(event.type === "personKilled" ? "They were killed" : "The vehicle was destroyed");
					return;
				}
				break;
			case "actorEscaped":
				// The car being tailed got where it was going: that's the job done.
				if (objective.kind === "tail" && objective.target === event.id) {
					this.advance();
					return;
				}
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
			|| ((objective.kind === "destroyVehicles" || objective.kind === "disable") && event.type === "vehicleDestroyed")
		) {
			if (!this.remaining.delete(event.id)) return;
			if (this.remaining.size === 0) this.advance();
			else this.publish();
		}
	}

	/** Every trigger whose moment has come, once each, in the order they're listed. */
	private runTriggers(player: Readonly<PlayerView>): void {
		const triggers = this.current?.triggers;
		if (!triggers) return;
		for (let index = 0; index < triggers.length; index++) {
			if (this.fired.has(index) || !this.triggerReady(triggers[index], player)) continue;
			this.fired.add(index);
			const trigger = triggers[index];
			for (const flag of trigger.flags ?? []) this.flags.add(flag);
			if (trigger.scene) this.playScene(trigger.scene);
			if (trigger.say?.length) this.say(trigger.say);
			if (trigger.notice) this.notice(trigger.notice);
			if (trigger.spawns?.length) this.stage.spawn(trigger.spawns);
			if (trigger.alarm) this.stage.alarm?.(trigger.alarm);
			if (trigger.alertAll) this.stage.alertAll?.();
			if (trigger.reroute) this.stage.reroute?.(trigger.reroute.id, trigger.reroute.route, trigger.reroute.cruise);
			if (trigger.pace) this.stage.pace?.(trigger.pace.id, trigger.pace.cruise);
			if (trigger.ignite) this.stage.ignite?.(trigger.ignite);
			if (trigger.letBurn) this.stage.letBurn?.(trigger.letBurn);
			if (trigger.goto) {
				this.jump(trigger.goto);
				return;
			}
		}
	}

	private triggerReady(trigger: MissionTrigger, player: Readonly<PlayerView>): boolean {
		const when = trigger.when;
		const objective = this.objective;
		if (when.step !== undefined && objective?.step !== when.step) return false;
		if (when.after !== undefined && (when.step !== undefined ? this.objectiveTime : this.missionTime) < when.after) return false;
		if (when.wanted !== undefined && player.wantedStars < when.wanted) return false;
		if (when.alerted !== undefined && this.alerted !== when.alerted) return false;
		if (!holds(when.flags, this.has)) return false;
		if (when.near && Math.hypot(when.near.x - player.x, when.near.z - player.z) > when.near.radius) return false;
		if (when.targetNear) {
			const target = this.stage.actor?.(when.targetNear.id);
			if (!target || Math.hypot(when.targetNear.x - target.x, when.targetNear.z - target.z) > when.targetNear.radius) return false;
		}
		if (when.gone && !when.gone.every((id) => this.gone.has(id))) return false;
		if (when.putOut !== undefined) {
			const car = this.stage.actor?.(when.putOut);
			if (!car || car.onFire || car.integrity <= 0) return false;
		}
		return true;
	}

	/** This objective's done: its lines said and flags set, then on to the next (or `next`). */
	private advance(next?: string): void {
		const mission = this.current;
		const objective = this.objective;
		if (!mission || !objective || this.phaseName !== "active") return;
		for (const flag of objective.flags ?? []) this.flags.add(flag);
		if (objective.done?.length) this.say(objective.done);
		const target = next ?? objective.next;
		if (target === "pass") {
			this.complete();
			return;
		}
		if (target !== undefined) {
			this.jump(target);
			return;
		}
		this.index++;
		this.enter();
	}

	/** Straight on to the named step. */
	private jump(step: string): void {
		const mission = this.current;
		if (!mission) return;
		if (step === "pass") {
			this.complete();
			return;
		}
		const found = mission.objectives.findIndex((objective) => objective.step === step);
		if (found < 0) throw new Error(`${mission.id}: no step "${step}"`);
		this.index = found;
		this.enter();
	}

	private complete(): void {
		const mission = this.current;
		if (!mission) return;
		this.end();
		const bonuses = (mission.bonuses ?? []).map((bonus): BonusResult => ({ id: bonus.id, label: bonus.label, met: this.bonusState(bonus, true) === "met" }));
		const rating = ratingFor(bonuses);
		this.lastResult = { bonuses, rating };
		this.phaseName = "passed";
		this.resultTime = 0;
		this.lastCheckpoint = null;
		this.failedId = "";
		// Whatever was still waiting to be said is overtaken by events: straight on to the outro.
		this.lines = [];
		if (mission.outro?.length) this.say(mission.outro);
		this.emit({ type: "complete", mission, seconds: this.missionTime, flags: [...this.flags], bonuses, rating, extras: [...this.extras] });
		this.publish();
	}

	/** How an optional objective stands: still open, done, or missed. `final` judges it at the end. */
	private bonusState(bonus: Bonus, final = false): HudBonus["state"] {
		switch (bonus.kind) {
			case "undetected":
				return this.alerted ? "failed" : final ? "met" : "open";
			case "noWanted":
				return this.worstWanted > 0 ? "failed" : final ? "met" : "open";
			case "time":
				return this.missionTime > bonus.seconds ? "failed" : final ? "met" : "open";
			case "flag":
				// "!flag": met as long as it never gets set.
				if (bonus.flag.startsWith("!")) return this.flags.has(bonus.flag.slice(1)) ? "failed" : final ? "met" : "open";
				return this.flags.has(bonus.flag) ? "met" : final ? "failed" : "open";
			case "intact": {
				const lowest = bonus.vehicle ? this.lowestIntegrity.get(bonus.vehicle) ?? 100 : this.anyVehicleLowest;
				return lowest < bonus.min ? "failed" : final ? "met" : "open";
			}
			case "alive":
				return this.gone.has(bonus.id) ? "failed" : final ? "met" : "open";
		}
	}

	private enter(): void {
		const mission = this.current;
		if (!mission) return;
		// Past anything whose flags don't hold.
		while (mission.objectives[this.index] && !holds(mission.objectives[this.index].onlyIf, this.has)) this.index++;
		const objective = this.objective;
		if (!objective) {
			this.complete();
			return;
		}
		this.objectiveTime = 0;
		this.checkpoint = 0;
		this.course = courseOf(objective);
		this.countdown = objective.kind === "race" ? objective.countdown ?? RACE_COUNTDOWN : 0;
		this.finished.clear();
		this.position = 1;
		this.hint = "";
		this.closeTime = 0;
		this.farTime = 0;
		this.gap = null;
		this.inspected = 0;
		this.trackTime = 0;
		this.remaining.clear();
		const quarry = this.quarryOf(objective);
		for (const id of quarry) if (!this.gone.has(id)) this.remaining.add(id);
		if (objective.checkpoint) {
			if (this.lastCheckpoint?.index !== this.index) this.notice("Checkpoint");
			this.lastCheckpoint = {
				missionId: mission.id,
				index: this.index,
				x: objective.checkpoint.x,
				z: objective.checkpoint.z,
				yaw: objective.checkpoint.yaw ?? 0,
				flags: [...this.flags],
				gone: [...this.gone],
				fired: [...this.fired],
			};
		}
		if (objective.spawns?.length) this.stage.spawn(objective.spawns);
		for (const id of objective.followers ?? []) this.stage.follow?.(id, true);
		if (objective.wanted) this.stage.alarm?.(objective.wanted);
		if (objective.kind === "race" && this.countdown <= 0) this.stage.startRace?.(objective.racers);
		if (objective.scene) this.playScene(objective.scene);
		if (objective.say?.length) this.say(objective.say);
		this.steer();
		this.emit({ type: "objective", mission, index: this.index, objective });
		// Already done: sat in the car it asks for, or every target dealt with on the way.
		const vehicle = this.vehicle;
		if (objective.kind === "enterVehicle" && vehicle) this.onGame({ type: "vehicleEntered", ...vehicle });
		else if (quarry.length > 0 && this.remaining.size === 0) this.advance();
		else this.publish();
	}

	private quarryOf(objective: Objective): readonly string[] {
		if (objective.kind === "eliminate") return objective.targets;
		if (objective.kind === "destroyVehicles") return objective.ids;
		if (objective.kind === "disable") return objective.targets;
		return [];
	}

	/** Everyone and everything the mission still wants dealt with, from this objective on. */
	private quarryFromHere(mission: MissionDefinition): Set<string> {
		const ids = new Set<string>();
		for (const objective of mission.objectives.slice(this.index)) {
			if (!holds(objective.onlyIf, this.has)) continue;
			for (const id of this.quarryOf(objective)) ids.add(id);
		}
		return ids;
	}

	/** Moving markers: a car being tailed or stopped, a person to reach, kept up on the GPS. */
	private track(dt: number): void {
		const objective = this.objective;
		const moving = objective?.kind === "tail" || objective?.kind === "disable" || (objective?.kind === "inspect" && objective.person) || (objective?.kind === "enterVehicle" && objective.vehicle);
		if (!moving) return;
		this.trackTime += dt;
		if (this.trackTime < TRACK_INTERVAL) return;
		this.trackTime = 0;
		this.steer();
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
			case "choice":
			case "leave":
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
			case "escort":
				setObjective({ x: objective.x, z: objective.z, label: objective.label, radius: objective.radius });
				break;
			case "survive":
				setObjective({ x: objective.x, z: objective.z, label: objective.label, radius: MARKER_RADIUS });
				break;
			case "inspect": {
				const person = objective.person ? this.stage.actor?.(objective.person) : null;
				setObjective({ x: person?.x ?? objective.x, z: person?.z ?? objective.z, label: objective.label, radius: objective.radius, beacon: !objective.person });
				break;
			}
			case "tail": {
				const target = this.stage.actor?.(objective.target);
				setObjective(target ? { x: target.x, z: target.z, label: objective.label, radius: MARKER_RADIUS, beacon: false } : null);
				break;
			}
			case "disable": {
				const id = this.remaining.values().next().value;
				const target = id ? this.stage.actor?.(id) : null;
				setObjective({ x: target?.x ?? objective.x, z: target?.z ?? objective.z, label: objective.label, radius: MARKER_RADIUS, beacon: false });
				break;
			}
			case "enterVehicle": {
				// A named car is wherever it's got to (a thief's car, stopped down the road).
				const car = objective.vehicle ? this.stage.actor?.(objective.vehicle) : null;
				setObjective({ x: car?.x ?? objective.x, z: car?.z ?? objective.z, label: objective.label, radius: MARKER_RADIUS, beacon: false });
				break;
			}
			default:
				// People or vehicles to deal with: they carry their own markers.
				setObjective({ x: objective.x, z: objective.z, label: objective.label, radius: MARKER_RADIUS, beacon: false });
				break;
		}
	}

	/** Out of the active mission: its things cleared away and the GPS stood down. */
	private end(): void {
		this.remaining.clear();
		this.clearScenes();
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
		else if (objective?.kind === "disable" && objective.targets.length > 1) counter = `${objective.targets.length - this.remaining.size}/${objective.targets.length}`;
		else if (objective?.kind === "checkpoints") counter = `${this.checkpoint}/${objective.points.length}`;
		else if (objective?.kind === "tail" && this.gap !== null) counter = `${Math.round(this.gap)} m`;
		else if (objective?.kind === "inspect" && this.inspected > 0) counter = `${Math.min(100, Math.floor((this.inspected / objective.seconds) * 100))}%`;
		let countdown: string | null = null;
		if (objective?.kind === "race") {
			const laps = Math.max(1, objective.laps ?? 1);
			const lap = Math.min(laps, Math.floor(this.checkpoint / objective.points.length) + 1);
			counter = `${ordinal(this.position)} of ${objective.racers.length + 1}${laps > 1 ? ` · Lap ${lap}/${laps}` : ""}`;
			const length = objective.countdown ?? RACE_COUNTDOWN;
			if (this.countdown > 0) countdown = String(Math.ceil(this.countdown));
			else if (this.objectiveTime - length < GO_SECONDS) countdown = "GO";
		}
		const choices: HudChoice[] | null = objective?.kind === "choice" ? this.choices.map(({ index, option }) => ({ index, label: option.label, detail: option.detail ?? "" })) : null;
		const passed = this.phaseName === "passed";
		const bonuses: HudBonus[] = passed
			? this.lastResult.bonuses.map((bonus) => ({ label: bonus.label, state: bonus.met ? "met" : "failed" }))
			: this.phaseName === "active" ? (mission?.bonuses ?? []).map((bonus) => ({ label: bonus.label, state: this.bonusState(bonus) }))
				// In the briefing, what there is to go for.
				: this.phaseName === "briefing" ? (mission?.bonuses ?? []).map((bonus): HudBonus => ({ label: bonus.label, state: "open" })) : [];
		publishMissionHud({
			phase: this.phaseName,
			missionId: mission?.id ?? "",
			title: mission?.title ?? "",
			giver: mission?.giver.name ?? "",
			role: mission?.giver.role ?? "",
			chapter: mission?.chapter ?? "story",
			briefing: mission?.briefing ?? "",
			reward: mission?.reward ?? {},
			extras: this.extras,
			objective: this.hint || (objective?.label ?? ""),
			objectiveIndex: this.index,
			counter,
			countdown,
			timeLeft: objective?.timeLimit !== undefined ? Math.max(0, objective.timeLimit - this.objectiveTime) : null,
			outsideArea: this.outsideTime > 0 ? Math.max(0, AREA_GRACE_SECONDS - this.outsideTime) : null,
			missionTime: this.missionTime,
			failReason: this.failReason,
			subtitle: this.line ? { who: this.line.who, text: this.line.text } : null,
			notice: this.noticeTime > 0 ? this.noticeText : null,
			choices,
			bonuses,
			rating: passed ? this.lastResult.rating : null,
			canResume: this.phaseName === "failed" && this.lastCheckpoint !== null,
			cutscene: this.scene !== null,
			skippable: this.scene !== null && !this.scene.hold,
		});
	}
}

/** The one director the game runs. */
export const missions = new MissionDirector();
