/**
 * When each half of a light bar is lit. Halves are "red" (the car's left) and "blue" (its
 * right), as scripts/build-vehicles.mjs names their materials.
 */

/** A police light bar: the two halves in turn, `period` seconds each. */
export function policeFlash(time: number, blue: boolean, period: number): boolean {
	const redPhase = Math.floor(time / period) % 2 === 0;
	return blue ? !redPhase : redPhase;
}

/** One full left-right cycle of an emergency vehicle's beacons, s. */
export const EMERGENCY_CYCLE = 0.6;

/**
 * An ambulance's or fire engine's beacons: a double burst on one side, then the other, as
 * emergency strobes do — quicker and harder than a patrol car's swap, so it reads differently.
 */
export function emergencyFlash(time: number, blue: boolean): boolean {
	const t = (time % EMERGENCY_CYCLE) / EMERGENCY_CYCLE;
	const local = blue ? t - 0.5 : t;
	return (local >= 0 && local < 0.14) || (local >= 0.24 && local < 0.38);
}
