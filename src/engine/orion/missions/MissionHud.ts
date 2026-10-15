import type { MissionChapter, MissionPhase, MissionReward } from "./MissionDirector";

/** An optional objective, as it stands. */
export interface HudBonus {
	label: string;
	state: "open" | "met" | "failed";
}

/** A choice on offer, by its place in the objective's options. */
export interface HudChoice {
	index: number;
	label: string;
	detail: string;
}

/**
 * What the mission HUD shows: the briefing, the objective line, counters and clocks, and the
 * passed or failed banner. Written by the director, sampled by React on a timer, like CombatHud.
 */
export interface MissionHudState {
	phase: MissionPhase;
	missionId: string;
	title: string;
	giver: string;
	/** Who the giver is: "Fixer · Kasper Motors". */
	role: string;
	/** Story, side, race or street job. */
	chapter: MissionChapter;
	briefing: string;
	reward: MissionReward;
	/** Paid on top for the choices made this run. */
	extras: readonly MissionReward[];
	objective: string;
	/** Which objective it is, so a change of objective can be told from a change of wording. */
	objectiveIndex: number;
	/** "2/4" for targets, checkpoints; "2nd of 4 · Lap 1/2" in a race. */
	counter: string | null;
	/** A race's start: "3", "2", "1", then "GO". */
	countdown: string | null;
	/** Seconds left on the objective's clock, if it has one. */
	timeLeft: number | null;
	/** Seconds left to get back into the mission area, while outside it. */
	outsideArea: number | null;
	/** Seconds since the mission started. */
	missionTime: number;
	failReason: string;
	/** The line of dialogue up now. */
	subtitle: { who: string; text: string } | null;
	/** A brief line across the HUD: "Checkpoint", "You've been made". */
	notice: string | null;
	/** The decision on offer, if the objective is one. */
	choices: HudChoice[] | null;
	/** Optional objectives: live while playing, judged once passed. */
	bonuses: HudBonus[];
	/** Out of three, once passed (missions with optional objectives). */
	rating: number | null;
	/** Failed past a checkpoint: a retry can start there. */
	canResume: boolean;
	/** Bumped on every publish, so a sampler can tell nothing has changed. */
	version: number;
}

const state: MissionHudState = {
	phase: "idle",
	missionId: "",
	title: "",
	giver: "",
	role: "",
	chapter: "story",
	briefing: "",
	reward: {},
	extras: [],
	objective: "",
	objectiveIndex: 0,
	counter: null,
	countdown: null,
	timeLeft: null,
	outsideArea: null,
	missionTime: 0,
	failReason: "",
	subtitle: null,
	notice: null,
	choices: null,
	bonuses: [],
	rating: null,
	canResume: false,
	version: 0,
};

export function publishMissionHud(update: Omit<MissionHudState, "version">): void {
	Object.assign(state, update);
	state.version++;
}

export function readMissionHud(): Readonly<MissionHudState> {
	return state;
}
