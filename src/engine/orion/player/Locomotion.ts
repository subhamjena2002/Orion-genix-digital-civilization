/**
 * How the character turns and carries its weight on foot.
 *
 * Turning used to close a fixed fraction of the gap each frame, so a 180 swung round at over
 * 2000 degrees a second on the first frame and crawled into the last few degrees: the body
 * snapped, then drifted. Here the facing follows a critically damped spring instead (the
 * "smooth damp" used for third-person characters and cameras): it speeds up into the turn,
 * slows into the new heading without overshooting, never exceeds a top turn rate, and comes out
 * the same at 30 fps as at 144.
 *
 * The turn rate and the change of speed then tip the body, as a runner leans into a corner and
 * forward as they push off — small angles, eased, so it reads as weight rather than wobble.
 */

export interface TurnState {
	/** Facing, degrees. */
	yaw: number;
	/** Degrees per second, carried between frames. */
	rate: number;
}

export interface TurnTuning {
	/** Roughly how long the turn takes to settle, seconds. */
	smoothTime: number;
	/** Fastest the body may swing round, degrees per second. */
	maxRate: number;
}

/** Shortest signed angle from `from` to `to`, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
	const d = (((to - from) % 360) + 540) % 360 - 180;
	return d === -180 ? 180 : d;
}

/**
 * One step of a critically damped turn towards `target` (degrees). Exact for any `dt`, so a
 * long frame can't make it overshoot or ring.
 */
export function stepTurn(state: TurnState, target: number, dt: number, tuning: TurnTuning): void {
	if (!(dt > 0)) return;
	const smoothTime = Math.max(1e-4, tuning.smoothTime);
	const omega = 2 / smoothTime;
	const x = omega * dt;
	const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
	// Work relative to the target so the turn always takes the short way round.
	const goal = state.yaw + angleDelta(state.yaw, target);
	const limit = tuning.maxRate * smoothTime;
	const change = Math.max(-limit, Math.min(limit, state.yaw - goal));
	// With the change clamped, this is how far the spring is aiming this step.
	const aim = state.yaw - change;
	const temp = (state.rate + omega * change) * dt;
	let rate = (state.rate - omega * temp) * decay;
	let yaw = aim + (change + temp) * decay;
	// Never past the target: a clamped change could otherwise carry it over.
	if ((goal - state.yaw > 0) === (yaw > goal)) {
		yaw = goal;
		rate = 0;
	}
	state.rate = Math.max(-tuning.maxRate, Math.min(tuning.maxRate, rate));
	state.yaw = yaw;
}

export interface LeanState {
	/** Sideways tilt, degrees: positive tips the head to the body's right. */
	roll: number;
	/** Forward tilt, degrees: positive tips the head forward. */
	pitch: number;
}

export interface LeanTuning {
	/** Degrees of roll per (radian/s of turn x m/s of speed). */
	rollPerTurn: number;
	maxRoll: number;
	/** Degrees of pitch per m/s² of forward acceleration. */
	pitchPerAccel: number;
	maxPitchForward: number;
	maxPitchBack: number;
	/** How quickly the lean follows, per second. */
	response: number;
}

export const LEAN: LeanTuning = {
	rollPerTurn: 1.6,
	maxRoll: 9,
	pitchPerAccel: 0.55,
	maxPitchForward: 6,
	maxPitchBack: 4,
	response: 9,
};

/**
 * Eases the lean towards what this frame's motion calls for. `turnRate` is degrees/s (positive
 * turns left, as yaw increases), `speed` m/s and `forwardAccel` m/s² along the facing.
 */
export function stepLean(state: LeanState, turnRate: number, speed: number, forwardAccel: number, dt: number, tuning: LeanTuning = LEAN): void {
	if (!(dt > 0)) return;
	// Into the turn: turning left (positive rate) tips the head left, a negative roll.
	const roll = clamp(-tuning.rollPerTurn * (turnRate * Math.PI / 180) * speed, -tuning.maxRoll, tuning.maxRoll);
	const pitch = clamp(forwardAccel * tuning.pitchPerAccel, -tuning.maxPitchBack, tuning.maxPitchForward);
	const k = 1 - Math.exp(-tuning.response * dt);
	state.roll += (roll - state.roll) * k;
	state.pitch += (pitch - state.pitch) * k;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
