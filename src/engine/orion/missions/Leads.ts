import { JOBS } from "./MissionCatalog";
import type { MissionDefinition } from "./MissionDirector";

/**
 * Street leads: between missions, now and then a small job turns up somewhere on the map — one
 * at a time, announced once, and there until the player takes it. Walk or drive up to it and
 * the job starts (see JOBS). Nothing chases the player: a lead ignored just waits.
 *
 * Which job comes next goes round the list in order (skipping any whose flags don't hold), so
 * the same play brings the same leads. Pure bookkeeping: the runtime says what's going on each
 * frame and starts whatever this hands back.
 */

/** The first lead turns up this long into free roam; later ones this long after a job ends. */
export const FIRST_LEAD_SECONDS = 45;
export const LEAD_COOLDOWN_SECONDS = 150;
/** Step this close to a lead (on foot), or drive this close, and it starts. */
export const LEAD_RADIUS_ON_FOOT = 3;
export const LEAD_RADIUS_IN_VEHICLE = 9;

export interface LeadContext {
	/** Nothing being briefed or played, the player alive and not wanted. */
	free: boolean;
	/** Far enough into the story for leads to come in. */
	unlocked: boolean;
	x: number;
	z: number;
	inVehicle: boolean;
	/** Whether a job's flags hold. */
	open(job: MissionDefinition): boolean;
}

export class Leads {
	private wait = FIRST_LEAD_SECONDS;
	private next = 0;
	private offered: MissionDefinition | null = null;
	private running: MissionDefinition | null = null;
	/** Bumped when a new lead turns up, for the one-off announcement. */
	public announced = 0;

	public constructor(private readonly jobs: readonly MissionDefinition[]) {}

	/** The lead on the map, if there is one. */
	public get lead(): MissionDefinition | null {
		return this.offered;
	}

	/** The job being played, if one is. */
	public get job(): MissionDefinition | null {
		return this.running;
	}

	/** Moves time on; returns a job to start now, if the player has just walked into its lead. */
	public update(dt: number, context: Readonly<LeadContext>): MissionDefinition | null {
		if (this.running || !context.unlocked) return null;
		if (!this.offered) {
			if (!context.free) return null;
			this.wait -= dt;
			if (this.wait > 0) return null;
			this.offered = this.pick(context);
			if (this.offered) this.announced++;
			else this.wait = LEAD_COOLDOWN_SECONDS;
			return null;
		}
		const lead = this.offered;
		if (!context.free || !context.open(lead)) return null;
		const reach = context.inVehicle ? LEAD_RADIUS_IN_VEHICLE : LEAD_RADIUS_ON_FOOT;
		if (Math.hypot(lead.giver.x - context.x, lead.giver.z - context.z) > reach) return null;
		this.offered = null;
		this.running = lead;
		return lead;
	}

	/** The job's over, however it went: the next lead after a while. */
	public finished(): void {
		this.running = null;
		this.wait = LEAD_COOLDOWN_SECONDS;
	}

	private pick(context: Readonly<LeadContext>): MissionDefinition | null {
		for (let tried = 0; tried < this.jobs.length; tried++) {
			const job = this.jobs[this.next % this.jobs.length];
			this.next++;
			if (context.open(job)) return job;
		}
		return null;
	}
}

/** The one set of leads the game runs, over the street jobs. */
export const streetLeads = new Leads(JOBS);
