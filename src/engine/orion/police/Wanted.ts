/**
 * How badly the police want the player: 0 to 5 stars.
 *
 * Crimes add heat and heat sets the stars — the first crime is always worth a star, and it takes
 * a run of killing to reach five. Stars never drop on their own while the police can see the
 * player; they only know where they last saw them. Out of sight long enough (longer the more
 * stars there are) and the search is called off and the stars clear at once. Dying or being
 * arrested clears them too.
 *
 * A plain module value, like PlayerPose: the game writes it, React samples it for the HUD.
 */

export type Crime =
	/** Shooting or beating a civilian who survives. */
	| "assault"
	/** Killing a civilian, including running them over. */
	| "murder"
	/** Destroying someone's car. */
	| "vehicleDestroyed"
	/** Killing a police officer. */
	| "copKilled"
	/** Destroying a police car. */
	| "policeCarDestroyed"
	/** Taking a police car. */
	| "policeCarStolen";

const HEAT: Readonly<Record<Crime, number>> = {
	assault: 0.35,
	murder: 1,
	vehicleDestroyed: 1,
	copKilled: 2.5,
	policeCarDestroyed: 2,
	policeCarStolen: 1,
};

/** Heat needed for each star, 1 to 5. */
export const STAR_HEAT: readonly number[] = [0.01, 2, 4.5, 8, 13];
export const MAX_STARS = 5;

/** Seconds out of police sight before they give up, at 1 star; each further star adds more. */
const EVADE_BASE_SECONDS = 9;
const EVADE_PER_STAR = 5;
/** Standing still next to a stopped patrol car this long at low stars is an arrest. */
export const ARREST_SECONDS = 2.5;
/** Arrests only happen while the police still mean to take the player alive. */
export const ARREST_MAX_STARS = 2;

export interface WantedState {
	stars: number;
	heat: number;
	/** The police have lost sight of the player and are searching where they last saw them. */
	searching: boolean;
	/** Seconds since any officer last saw the player. */
	sinceSeen: number;
	/** Where the police last saw the player; where units head while searching. */
	lastSeenX: number;
	lastSeenZ: number;
	/** Set when an arrest completes; the player controller takes it and plays out the arrest. */
	busted: boolean;
}

const state: WantedState = { stars: 0, heat: 0, searching: false, sinceSeen: 0, lastSeenX: 0, lastSeenZ: 0, busted: false };
/** Units that saw the player this frame (they call `spotted`). */
let seenThisFrame = false;
/** A unit has pulled up beside the player, who's standing still on foot (they call `markArrestable`). */
let arrestableThisFrame = false;
let arrestTimer = 0;

export function starsForHeat(heat: number): number {
	let stars = 0;
	for (let i = 0; i < STAR_HEAT.length; i++) if (heat >= STAR_HEAT[i]) stars = i + 1;
	return stars;
}

export function evadeSeconds(stars: number): number {
	return EVADE_BASE_SECONDS + EVADE_PER_STAR * Math.max(0, stars - 1);
}

/** A crime at (x, z). Whoever saw it or not, the police know where it happened. */
export function reportCrime(crime: Crime, x: number, z: number): void {
	state.heat += HEAT[crime];
	// Stars only ever go up from a crime; the heat that gets you out again is evasion.
	state.stars = Math.max(state.stars, Math.min(MAX_STARS, starsForHeat(state.heat)));
	state.lastSeenX = x;
	state.lastSeenZ = z;
	state.sinceSeen = 0;
	state.searching = false;
}

/** A police unit or officer can see the player at (x, z) this frame. */
export function spotted(x: number, z: number): void {
	if (state.stars === 0) return;
	seenThisFrame = true;
	state.lastSeenX = x;
	state.lastSeenZ = z;
}

/** A unit is stopped right beside the player, who's standing still on foot. */
export function markArrestable(): void {
	arrestableThisFrame = true;
}

/**
 * Once a frame. An officer right beside a player standing still on foot (`arrestable`, or a
 * unit's `markArrestable` this frame), held long enough at low stars, is an arrest.
 */
export function updateWanted(dt: number, arrestable = false): void {
	const canArrest = arrestable || arrestableThisFrame;
	arrestableThisFrame = false;
	if (state.stars === 0) {
		seenThisFrame = false;
		arrestTimer = 0;
		return;
	}
	if (seenThisFrame) {
		state.sinceSeen = 0;
		state.searching = false;
	} else {
		state.sinceSeen += dt;
		state.searching = state.sinceSeen > 1.5;
		if (state.sinceSeen >= evadeSeconds(state.stars)) clearWanted();
	}
	seenThisFrame = false;

	arrestTimer = canArrest && state.stars <= ARREST_MAX_STARS ? arrestTimer + dt : 0;
	if (arrestTimer >= ARREST_SECONDS) {
		arrestTimer = 0;
		state.busted = true;
	}
}

/** Dead, arrested or escaped: nobody's looking any more. */
export function clearWanted(): void {
	state.stars = 0;
	state.heat = 0;
	state.searching = false;
	state.sinceSeen = 0;
	arrestTimer = 0;
}

/** The arrest the controller should play out, once. */
export function takeBusted(): boolean {
	const busted = state.busted;
	state.busted = false;
	return busted;
}

export function readWanted(): Readonly<WantedState> {
	return state;
}
