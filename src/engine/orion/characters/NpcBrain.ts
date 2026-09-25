/**
 * What a pedestrian is doing, and why. A state machine driven by events (hit, heard a gunshot,
 * target moved) and timers, rather than every NPC re-deciding everything every frame:
 *
 *   PATROL  roaming the pavements (the everyday state)
 *   IDLE    standing: waiting to cross, or catching breath
 *   WALK    walking on, still wary, after a scare
 *   ALERT   heard or saw trouble; freezes and looks before reacting
 *   FLEE    running away from the threat
 *   RUN     closing in on someone to fight
 *   ATTACK  in reach, swinging
 *   HIT     staggering from a blow
 *   DEAD    down for good (the body is recycled later)
 *
 * The brain only decides; the NPC's controller moves, animates and does damage.
 */

export type NpcState = "PATROL" | "IDLE" | "WALK" | "ALERT" | "FLEE" | "RUN" | "ATTACK" | "HIT" | "DEAD";

export interface NpcThreat {
	id: number;
	x: number;
	z: number;
	/** The player (a fight-back target) rather than an explosion or a stray shot. */
	attackable: boolean;
}

/** Tunables, shared by every NPC; per-person variety comes from `bravery`. */
export const NPC_TIMING = {
	/** Freeze-and-look before fleeing, seconds (random within). */
	alert: [0.35, 1.1] as const,
	/** Stagger after a hit. */
	hit: 0.5,
	/** Minimum flight, and how far from the threat counts as safe. */
	fleeMin: 6,
	fleeSafeDistance: 40,
	/** Give up the flight after this long regardless. */
	fleeMax: 20,
	/** Wary walk after calming down, before roaming normally again. */
	calmWalk: 6,
	/** Fighting: reach to swing, how far a fighter chases, and how long they keep at it. */
	attackReach: 1.25,
	chaseGiveUp: 22,
	fightMax: 25,
} as const;

export class NpcBrain {
	private stateName: NpcState = "PATROL";
	private timer = 0;
	/** Time in the current state. */
	private age = 0;
	private threatInfo: NpcThreat | null = null;
	/** What to do once a stagger ends. */
	private afterHit: NpcState = "FLEE";

	/**
	 * @param bravery 0..1: the chance of fighting back when hit by someone, instead of fleeing.
	 * @param random  source of randomness (seeded per NPC, so a given person behaves consistently).
	 */
	public constructor(private readonly bravery: number, private readonly random: () => number = Math.random) {}

	public get state(): NpcState {
		return this.stateName;
	}

	public get threat(): Readonly<NpcThreat> | null {
		return this.threatInfo;
	}

	/** Moving on its own route (the controller follows the pavement graph). */
	public get roaming(): boolean {
		return this.stateName === "PATROL" || this.stateName === "WALK" || this.stateName === "IDLE";
	}

	public get dead(): boolean {
		return this.stateName === "DEAD";
	}

	/** Took damage. `killed` when health reached zero. */
	public onDamaged(threat: NpcThreat | null, killed: boolean): void {
		if (this.stateName === "DEAD") return;
		if (killed) {
			this.enter("DEAD");
			return;
		}
		if (threat) this.threatInfo = { ...threat };
		// Fighters keep fighting; otherwise a blow from someone you can reach may make you fight.
		const fighting = this.stateName === "ATTACK" || this.stateName === "RUN";
		this.afterHit = fighting || (threat?.attackable && this.random() < this.bravery) ? "RUN" : "FLEE";
		this.enter("HIT", NPC_TIMING.hit);
	}

	/** Heard a gunshot or explosion, or saw violence nearby. */
	public onDisturbance(threat: NpcThreat): void {
		if (this.stateName === "DEAD" || this.stateName === "HIT") return;
		if (this.stateName === "FLEE") {
			// Already running: just run from the newest danger.
			this.threatInfo = { ...threat };
			this.timer = Math.max(this.timer, NPC_TIMING.fleeMin);
			return;
		}
		if (this.stateName === "ATTACK" || this.stateName === "RUN" || this.stateName === "ALERT") return;
		this.threatInfo = { ...threat };
		const [min, max] = NPC_TIMING.alert;
		this.enter("ALERT", min + this.random() * (max - min));
	}

	/** The threat moved (the controller reports where it is now). */
	public trackThreat(x: number, z: number): void {
		if (!this.threatInfo) return;
		this.threatInfo.x = x;
		this.threatInfo.z = z;
	}

	/** Waiting at a crossing (only while roaming). */
	public setWaiting(waiting: boolean): void {
		if (waiting && (this.stateName === "PATROL" || this.stateName === "WALK")) this.enter("IDLE");
		else if (!waiting && this.stateName === "IDLE") this.enter("PATROL");
	}

	/**
	 * Advances timers. `threatDistance` is how far the threat is now (Infinity if none).
	 * Returns the state after the step.
	 */
	public update(dt: number, threatDistance: number): NpcState {
		this.age += dt;
		this.timer -= dt;
		switch (this.stateName) {
			case "ALERT":
				if (this.timer <= 0) this.enter("FLEE", NPC_TIMING.fleeMin);
				break;
			case "HIT":
				if (this.timer <= 0) this.enter(this.afterHit, this.afterHit === "FLEE" ? NPC_TIMING.fleeMin : 0);
				break;
			case "FLEE":
				if ((this.timer <= 0 && threatDistance > NPC_TIMING.fleeSafeDistance) || this.age > NPC_TIMING.fleeMax) {
					this.enter("WALK", NPC_TIMING.calmWalk);
				}
				break;
			case "RUN":
				if (threatDistance > NPC_TIMING.chaseGiveUp || this.age > NPC_TIMING.fightMax) this.enter("WALK", NPC_TIMING.calmWalk);
				else if (threatDistance <= NPC_TIMING.attackReach) this.enter("ATTACK");
				break;
			case "ATTACK":
				// Stays in ATTACK while in reach; the controller runs the swings.
				if (threatDistance > NPC_TIMING.attackReach * 1.4) this.enter("RUN");
				break;
			case "WALK":
				if (this.timer <= 0) {
					this.threatInfo = null;
					this.enter("PATROL");
				}
				break;
			default:
				break;
		}
		return this.stateName;
	}

	/** Brought back as someone new (recycled). */
	public reset(): void {
		this.threatInfo = null;
		this.enter("PATROL");
	}

	private enter(state: NpcState, timer = 0) {
		this.stateName = state;
		this.timer = timer;
		this.age = 0;
	}
}

/** Pace multiplier over the NPC's stroll speed for each state. */
export function paceFor(state: NpcState): number {
	switch (state) {
		case "FLEE": return 3.4;
		case "RUN": return 3;
		case "WALK": return 1.25;
		case "PATROL": return 1;
		default: return 0;
	}
}

/**
 * How often an NPC's logic runs, by distance from the player: every frame up close (it can be
 * fought), every other frame at mid range, every fourth far off, and every eighth when neither
 * near nor on screen. Skipped frames' time is accumulated, so movement stays correct.
 */
export function updateInterval(distance: number, onScreen: boolean): number {
	if (distance < 35) return 1;
	if (distance < 90) return onScreen ? 1 : 2;
	if (distance < 160) return onScreen ? 2 : 4;
	return onScreen ? 4 : 8;
}

/** Whether an NPC in stagger `slot` runs this `frame` at `interval`. */
export function runsThisFrame(frame: number, slot: number, interval: number): boolean {
	return interval <= 1 || (frame + slot) % interval === 0;
}
