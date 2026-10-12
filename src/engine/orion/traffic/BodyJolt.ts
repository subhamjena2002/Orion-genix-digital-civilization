/**
 * The body's lurch in a crash: a hard stop dives the nose, a shunt from behind squats the
 * tail, a blow to the side tips the body away from it — then it rocks back on its springs
 * and settles.
 *
 * Driving lean (braking, cornering) is a slow follow of the car's acceleration and stays
 * within a few degrees. A crash is over in a tenth of a second: the body is kicked, overshoots
 * and bounces. So the jolt is its own spring, added on top.
 *
 * Signs follow the driving lean: pitch positive is nose down, roll positive leans the body to
 * the right. A side blow lands on the body, above the tyres that hold the car's footing, so
 * the body tips the way it's pushed — unlike cornering, where the tyres pull and the body
 * leans out.
 */

/** Rocking frequency (rad/s, about 2 Hz) and how quickly it dies away (share of critical). */
const FREQUENCY = 13;
const DAMPING = 0.3;
/** Kick for each m/s of change in velocity, degrees per second. */
const PITCH_KICK = 15;
const ROLL_KICK = 18;
/** No more lurch than this, degrees: a car's springs bottom out. */
const MAX_PITCH = 9;
const MAX_ROLL = 11;
/** Longest integration step, seconds: stable for the spring above. */
const MAX_STEP = 1 / 60;

export class BodyJolt {
	pitch = 0;
	roll = 0;
	private pitchRate = 0;
	private rollRate = 0;

	/**
	 * A blow of `deltaV` (m/s), pushing the body along `along` (share towards the front) and
	 * `left` (share towards the car's left).
	 */
	kick(along: number, left: number, deltaV: number) {
		// Pushed back is a sudden stop: the nose goes down. Pushed forward, it comes up.
		this.pitchRate -= along * deltaV * PITCH_KICK;
		// Pushed left, the body tips left (negative roll).
		this.rollRate -= left * deltaV * ROLL_KICK;
	}

	/** Advances the springs; returns true while there's still movement worth drawing. */
	update(dt: number): boolean {
		const stiffness = FREQUENCY * FREQUENCY;
		const friction = 2 * DAMPING * FREQUENCY;
		// Semi-implicit Euler in short steps, so a long frame (or a car not posed for a few frames)
		// still settles in real time rather than in slow motion. Past a second it's settled anyway.
		for (let left = Math.min(dt, 1); left > 0; left -= MAX_STEP) {
			const step = Math.min(left, MAX_STEP);
			this.pitchRate += (-stiffness * this.pitch - friction * this.pitchRate) * step;
			this.rollRate += (-stiffness * this.roll - friction * this.rollRate) * step;
			this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.pitchRate * step));
			this.roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, this.roll + this.rollRate * step));
		}
		const moving = Math.abs(this.pitch) + Math.abs(this.roll) + (Math.abs(this.pitchRate) + Math.abs(this.rollRate)) * 0.05 > 0.01;
		if (!moving) this.pitch = this.roll = this.pitchRate = this.rollRate = 0;
		return moving;
	}
}
