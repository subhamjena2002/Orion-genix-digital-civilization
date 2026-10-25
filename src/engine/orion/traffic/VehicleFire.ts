/**
 * A vehicle fire as something that can be fought. It has a strength (intensity) that grows from
 * the first flames, is fed by what's left to burn, and is knocked back only by water actually
 * landing on it; out, it leaves a hot shell that smokes and steams while it cools, and it does
 * not light again without a fresh cause.
 *
 *   none → igniting → burning ⇄ suppressing → smouldering → cooled
 *
 * Intensity drives everything that shows: flame size and count, the colour and amount of smoke,
 * the light thrown, the crackle. Pure state, so the lifecycle is testable without the engine.
 */

export type FireStage = "none" | "igniting" | "burning" | "suppressing" | "smouldering" | "cooled";

/** Seconds from the first flame to a fire at full strength. */
const IGNITION_SECONDS = 3.5;
/** Intensity water takes off per second at the full flow of one engine's monitor. */
const SUPPRESSION_PER_SECOND = 0.2;
/** A big fire (a wreck burning along its length) needs more water for the same effect. */
const WRECK_SUPPRESSION_SHARE = 0.65;
/** Seconds after the water last landed during which the fire counts as being fought. */
const WATER_MEMORY = 0.4;
/** Once water stops, a fire not yet out comes back this fast (intensity per second). */
const REKINDLE_PER_SECOND = 0.06;
/** Seconds a put-out fire smokes and steams before the shell is cold. */
export const SMOULDER_SECONDS = 40;
/** Water on a smouldering shell cools it this many times faster. */
const COOLING_BOOST = 3;
/** Below this the last flames go out. */
const OUT_BELOW = 0.02;

export class VehicleFire {
	public stage: FireStage = "none";
	/** 0..1: how big the fire is. */
	public intensity = 0;
	/** 0..1: how much there is left to burn; the fire can't be bigger than this. */
	public fuel = 1;
	/** Seconds since the fire went out (smouldering), counting faster under water. */
	public cooling = 0;
	/** Water landing on it right now, 0..1 of a full jet. */
	public water = 0;
	/** A whole wreck alight, rather than an engine bay. */
	public wreck = false;
	private sinceWater = Infinity;

	/** Flames showing. */
	public get burning(): boolean {
		return this.stage === "igniting" || this.stage === "burning" || this.stage === "suppressing";
	}

	/** Out but still hot: smoke and steam, no flames. */
	public get smouldering(): boolean {
		return this.stage === "smouldering";
	}

	/** Has been put out (and not relit since). */
	public get out(): boolean {
		return this.stage === "smouldering" || this.stage === "cooled";
	}

	/** 0..1 through the smoulder: 1 just put out, 0 cold. */
	public get residue(): number {
		return this.stage === "smouldering" ? Math.max(0, 1 - this.cooling / SMOULDER_SECONDS) : 0;
	}

	/**
	 * Lights it (an engine catching, a car going up). A wreck starts at full strength; an engine
	 * fire builds. Lighting a fire that's already burning makes it a wreck fire if asked, nothing
	 * else.
	 */
	public ignite(wreck: boolean, fuel = 1): void {
		if (this.burning) {
			if (wreck && !this.wreck) {
				this.wreck = true;
				this.fuel = Math.max(this.fuel, fuel);
				this.intensity = Math.max(this.intensity, 0.85);
				this.stage = "burning";
			}
			return;
		}
		this.wreck = wreck;
		this.fuel = fuel;
		this.cooling = 0;
		this.sinceWater = Infinity;
		this.water = 0;
		this.intensity = wreck ? 0.9 : 0.08;
		this.stage = wreck ? "burning" : "igniting";
	}

	/** Water landing on the fire this frame: `flow` is the share of a full jet that reaches it. */
	public applyWater(flow: number, dt: number): void {
		if (!(flow > 0) || dt <= 0) return;
		this.water = Math.min(1, flow);
		this.sinceWater = 0;
		if (this.burning) {
			const rate = SUPPRESSION_PER_SECOND * (this.wreck ? WRECK_SUPPRESSION_SHARE : 1);
			this.intensity = Math.max(0, this.intensity - rate * this.water * dt);
			this.stage = "suppressing";
			if (this.intensity <= OUT_BELOW) this.putOut();
		} else if (this.stage === "smouldering") {
			this.cooling += this.water * COOLING_BOOST * dt;
		}
	}

	/**
	 * Advances the fire. `burnRate` is how fast the fuel goes at full strength (share per second):
	 * an engine fire eats the car, a wreck fire what's left of it.
	 */
	public update(dt: number, burnRate: number): void {
		if (dt <= 0) return;
		this.sinceWater += dt;
		if (this.sinceWater > WATER_MEMORY) this.water = 0;
		switch (this.stage) {
			case "igniting":
			case "burning":
			case "suppressing": {
				const fought = this.sinceWater <= WATER_MEMORY;
				if (!fought) {
					if (this.stage === "suppressing") this.stage = "burning";
					// Growing to what the fuel allows: fast as it catches, a slow creep back up after water.
					const growth = this.stage === "igniting" ? 1 / IGNITION_SECONDS : REKINDLE_PER_SECOND;
					this.intensity = Math.min(this.fuel, this.intensity + growth * dt);
					if (this.stage === "igniting" && this.intensity >= Math.min(this.fuel, 0.95)) this.stage = "burning";
				}
				this.fuel = Math.max(0, this.fuel - burnRate * this.intensity * dt);
				if (this.intensity > this.fuel) this.intensity = this.fuel;
				if (this.intensity <= OUT_BELOW && this.fuel <= OUT_BELOW) this.putOut();
				break;
			}
			case "smouldering":
				this.cooling += dt;
				if (this.cooling >= SMOULDER_SECONDS) this.stage = "cooled";
				break;
			default:
				break;
		}
	}

	/** Back to nothing (a recycled or repaired car). */
	public reset(): void {
		this.stage = "none";
		this.intensity = 0;
		this.fuel = 1;
		this.cooling = 0;
		this.water = 0;
		this.wreck = false;
		this.sinceWater = Infinity;
	}

	/** Puts the flames out at once, leaving the shell to smoulder (a fire crew's last word). */
	public putOut(): void {
		if (!this.burning) return;
		this.intensity = 0;
		this.stage = "smouldering";
		this.cooling = 0;
	}
}
