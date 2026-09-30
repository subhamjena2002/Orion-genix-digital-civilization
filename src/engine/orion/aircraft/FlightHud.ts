import type { GunshipWeapon, LockState } from "./GunshipWeapons";

/**
 * What the flight HUD shows, written by the aircraft being flown each frame and read by React — like the
 * combat HUD, a plain module value so the game never re-renders the UI per frame. The sight
 * marks (screen positions) are read by a requestAnimationFrame loop rather than React state.
 */
export interface FlightHudState {
	/** The player is at the controls. */
	flying: boolean;
	/** What they're flying. */
	aircraft: "gunship" | "jet";
	/** On foot, close enough to climb in. */
	nearGunship: boolean;
	nearJet: boolean;
	/** Above the ground under it, metres. */
	altitude: number;
	/** Airspeed, m/s. */
	speed: number;
	verticalSpeed: number;
	/** Compass heading, degrees (0 north, clockwise). */
	heading: number;
	/** Rotor speed, 0..1. */
	rotor: number;
	/** Jet: throttle lever 0..1, afterburner lit, gear 0 up .. 1 down, load factor (g). */
	throttle: number;
	afterburner: boolean;
	gear: number;
	load: number;
	/** Airframe condition, 0..100. */
	integrity: number;
	weapon: GunshipWeapon;
	cannon: number;
	rockets: number;
	missiles: number;
	lock: LockState;
	lockProgress: number;
	landed: boolean;
	/** Rearming on the pad: 0..1, or -1. */
	rearm: number;
	warning: string;
	/** Screen positions, 0..1 from the top-left, or -1 when off screen. */
	gunX: number;
	gunY: number;
	boresightX: number;
	boresightY: number;
	/** Jet: where it's actually flying (the flight path marker). */
	pathX: number;
	pathY: number;
	lockX: number;
	lockY: number;
}

const state: FlightHudState = {
	flying: false,
	aircraft: "gunship",
	nearGunship: false,
	nearJet: false,
	altitude: 0,
	speed: 0,
	verticalSpeed: 0,
	heading: 0,
	rotor: 0,
	throttle: 0,
	afterburner: false,
	gear: 1,
	load: 1,
	integrity: 100,
	weapon: "cannon",
	cannon: 0,
	rockets: 0,
	missiles: 0,
	lock: "none",
	lockProgress: 0,
	landed: true,
	rearm: -1,
	warning: "",
	gunX: -1,
	gunY: -1,
	boresightX: -1,
	boresightY: -1,
	pathX: -1,
	pathY: -1,
	lockX: -1,
	lockY: -1,
};

export function writeFlightHud(update: Partial<FlightHudState>): void {
	Object.assign(state, update);
}

export function readFlightHud(): Readonly<FlightHudState> {
	return state;
}
