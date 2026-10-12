import type { MissionPhase, MissionReward } from "./MissionDirector";

/**
 * What the mission HUD shows: the briefing, the objective line, counters and clocks, and the
 * passed or failed banner. Written by the director, sampled by React on a timer, like CombatHud.
 */
export interface MissionHudState {
	phase: MissionPhase;
	missionId: string;
	title: string;
	giver: string;
	briefing: string;
	reward: MissionReward;
	objective: string;
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
	/** Bumped on every publish, so a sampler can tell nothing has changed. */
	version: number;
}

const state: MissionHudState = {
	phase: "idle",
	missionId: "",
	title: "",
	giver: "",
	briefing: "",
	reward: {},
	objective: "",
	counter: null,
	countdown: null,
	timeLeft: null,
	outsideArea: null,
	missionTime: 0,
	failReason: "",
	version: 0,
};

export function publishMissionHud(update: Omit<MissionHudState, "version">): void {
	Object.assign(state, update);
	state.version++;
}

export function readMissionHud(): Readonly<MissionHudState> {
	return state;
}
