/**
 * The timeline of one melee swing (a punch, a sword slash):
 *
 *   start → windup → ACTIVE (the hit window) → recovery → cooldown → ready
 *
 * Hits only register during the active window, and each target at most once per swing, however
 * many frames it stays in reach. Nothing here knows about shapes or damage — the caller runs hit
 * detection while `active` is true and records hits with `markHit`.
 */

export interface MeleeTiming {
	/** From pressing attack to the start of the hit window (the arm drawing back). */
	windup: number;
	/** How long the swing can connect. */
	active: number;
	/** Follow-through after the hit window, before the next swing can start. */
	recovery: number;
	/** Extra wait after recovery; a pressed attack within it is ignored. */
	cooldown: number;
}

export type MeleePhase = "ready" | "windup" | "active" | "recovery" | "cooldown";

export class MeleeAttack {
	private phaseName: MeleePhase = "ready";
	private elapsed = 0;
	private readonly struck = new Set<number>();

	public constructor(private timing: MeleeTiming) {}

	public get phase(): MeleePhase {
		return this.phaseName;
	}

	/** In the hit window. */
	public get active(): boolean {
		return this.phaseName === "active";
	}

	/** Mid-swing (not ready and not merely cooling down): the attacker is committed. */
	public get swinging(): boolean {
		return this.phaseName === "windup" || this.phaseName === "active" || this.phaseName === "recovery";
	}

	/** Swaps the timing (a different weapon); only takes effect for the next swing. */
	public setTiming(timing: MeleeTiming): void {
		this.timing = timing;
	}

	/** Begins a swing if ready. Returns whether one started. */
	public start(): boolean {
		if (this.phaseName !== "ready") return false;
		this.phaseName = "windup";
		this.elapsed = 0;
		this.struck.clear();
		return true;
	}

	/** Advances the timeline; returns the phase after the step. */
	public update(dt: number): MeleePhase {
		if (this.phaseName === "ready") return this.phaseName;
		this.elapsed += dt;
		// Step through as many phases as dt covers, so a long frame can't skip the window's end.
		for (;;) {
			const length = this.phaseLength(this.phaseName);
			if (this.elapsed < length) break;
			this.elapsed -= length;
			this.phaseName = nextPhase(this.phaseName);
			if (this.phaseName === "ready") {
				this.elapsed = 0;
				break;
			}
		}
		return this.phaseName;
	}

	/** Whether `targetId` may still be hit by this swing. */
	public canHit(targetId: number): boolean {
		return this.active && !this.struck.has(targetId);
	}

	public markHit(targetId: number): void {
		this.struck.add(targetId);
	}

	/** Abandons the swing (switching weapon, getting into a car). */
	public cancel(): void {
		this.phaseName = "ready";
		this.elapsed = 0;
		this.struck.clear();
	}

	private phaseLength(phase: MeleePhase): number {
		switch (phase) {
			case "windup": return this.timing.windup;
			case "active": return this.timing.active;
			case "recovery": return this.timing.recovery;
			case "cooldown": return this.timing.cooldown;
			default: return Infinity;
		}
	}
}

function nextPhase(phase: MeleePhase): MeleePhase {
	switch (phase) {
		case "windup": return "active";
		case "active": return "recovery";
		case "recovery": return "cooldown";
		default: return "ready";
	}
}
