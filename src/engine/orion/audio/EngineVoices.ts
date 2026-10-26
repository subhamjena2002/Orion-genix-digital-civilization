/**
 * The engine's revs and gear for the sound, from what the driving model knows: road speed and
 * pedal. There is no gearbox in the driving model, so this is an audio model (see
 * VehicleAudioProfiles): it is what makes an engine recognisable — revs climbing, dropping on the
 * shift, and climbing again — and nothing reads it as simulation data.
 */

/** A vehicle's audio gearbox: nominal idle and redline, and road speed (m/s) at the redline in each gear. */
export interface Gearbox {
	idleRpm: number;
	redlineRpm: number;
	gearTops: readonly number[];
}

export interface EngineState {
	rpm: number;
	gear: number;
	/** How hard the engine is working, 0..1: sets brightness and level. */
	load: number;
}

/** A gear is held until the road speed is well below its own range, so it can't hunt. */
const DOWNSHIFT_MARGIN = 0.82;
/** Off the line the engine revs ahead of the wheels; this is how far. */
const CLUTCH_SLIP = 0.42;
/** Below this road speed the car counts as pulling away rather than driving. */
const PULLING_AWAY = 1.5;

/** Which gear a car is in and what the engine is doing, from its road speed and throttle. */
export function engineState(gearbox: Gearbox, speed: number, throttle: number, previousGear: number): EngineState {
	const gear = selectGear(gearbox, speed, previousGear);
	const top = gearbox.gearTops[gear];
	const fraction = Math.min(1, Math.max(0, speed) / top);
	let rpm = gearbox.idleRpm + (gearbox.redlineRpm - gearbox.idleRpm) * fraction;
	if (speed < PULLING_AWAY) {
		// Standing still with the throttle open: the engine revs against a slipping clutch.
		const revving = gearbox.idleRpm + (gearbox.redlineRpm - gearbox.idleRpm) * CLUTCH_SLIP * Math.max(0, throttle);
		rpm = Math.max(rpm, revving);
	}
	// Working hard means climbing in gear or on the throttle, not just moving.
	const load = Math.min(1, Math.max(0, throttle) * 0.7 + fraction * 0.5);
	return { rpm: Math.min(rpm, gearbox.redlineRpm), gear, load };
}

function selectGear(gearbox: Gearbox, speed: number, previousGear: number): number {
	const gears = gearbox.gearTops.length;
	const held = Math.min(Math.max(previousGear, 0), gears - 1);
	// Stay put while the speed still suits this gear.
	if (speed <= gearbox.gearTops[held] && (held === 0 || speed > gearbox.gearTops[held - 1] * DOWNSHIFT_MARGIN)) return held;
	for (let gear = 0; gear < gears; gear++) {
		if (speed <= gearbox.gearTops[gear]) return gear;
	}
	return gears - 1;
}
