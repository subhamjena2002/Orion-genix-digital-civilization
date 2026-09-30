/**
 * Flight dynamics for the gunship: a rigid body (mass, inertia, velocity, orientation, angular
 * velocity) moved by rotor thrust, gravity, drag, the tail fin and stabiliser, the reaction to
 * rotor torque and sprung, damped landing gear. Pure code — no engine types — so it can be tested
 * and stepped at a fixed rate whatever the frame rate.
 *
 * Frames: world is Y up. The body frame matches the game's vehicles: +X left, +Y up, +Z forward.
 * Angular velocity is in the body frame: +x noses down, +y yaws left, +z rolls right.
 *
 * The pilot doesn't move the controls directly. As on a modern attack helicopter, a flight
 * control system turns stick and keys into cyclic, pedal and collective: it holds attitude and
 * heading, co-ordinates turns at speed, holds a hover when the stick is let go and keeps the
 * climb rate that's asked for. Those controls then act through the physics; nothing is set
 * directly, so the aircraft still has inertia, lag, and limits it can hit.
 */

export interface GearPoint {
	/** Body frame, relative to the centre of mass. */
	x: number;
	y: number;
	z: number;
	stiffness: number;
	damping: number;
}

export interface HelicopterSpec {
	mass: number;
	/** Moments of inertia about the pitch (x), yaw (y) and roll (z) axes, kg·m². */
	inertia: readonly [number, number, number];
	/** Thrust at full collective and full rotor speed, N. */
	maxThrust: number;
	/** Thrust lost per m/s of climb (gained per m/s of sink), as a share of weight. */
	heaveDamping: number;
	/** Main rotor: radius and the hub's height above the centre of mass. */
	rotorRadius: number;
	rotorHeight: number;
	/** Drag areas (Cd·A, m²) along the body's x (side), y (vertical) and z (frontal). */
	dragAreas: readonly [number, number, number];
	/** Angular acceleration at full cyclic / pedal and full rotor speed, rad/s². */
	pitchPower: number;
	rollPower: number;
	yawPower: number;
	/** Aerodynamic damping of pitch, yaw and roll rate, 1/s. */
	pitchDamping: number;
	yawDamping: number;
	rollDamping: number;
	/** Yaw acceleration from main-rotor torque per unit collective away from trim, rad/s². */
	torqueCoupling: number;
	/** Tail fin and stabiliser: how hard they swing the nose into the relative wind. */
	finStability: number;
	stabiliserStability: number;
	gear: readonly GearPoint[];
	/** Tyre grip with the wheel brakes on. */
	gearFriction: number;
	spoolUpSeconds: number;
	spoolDownSeconds: number;
	/** Service ceiling, m above sea level: the controls won't climb past it and the rotor thins out above. */
	ceiling: number;
}

/** Height of the centre of mass above the wheels' contact patches when parked. */
export const GUNSHIP_CG_HEIGHT = 1.85;

export const GUNSHIP: HelicopterSpec = {
	mass: 7500,
	inertia: [45000, 40000, 12000],
	maxThrust: 7500 * 9.81 * 1.65,
	heaveDamping: 0.045,
	rotorRadius: 7.05,
	rotorHeight: 3.54 - GUNSHIP_CG_HEIGHT,
	dragAreas: [22, 14, 8],
	pitchPower: 1.8,
	rollPower: 3.0,
	yawPower: 1.6,
	pitchDamping: 2.6,
	yawDamping: 1.8,
	rollDamping: 3.6,
	torqueCoupling: 0.5,
	finStability: 0.0025,
	stabiliserStability: 0.0003,
	gear: [
		// Main wheels either side, just ahead of the mast; the tail wheel ten metres back.
		{ x: 0.9, y: -GUNSHIP_CG_HEIGHT, z: 0.69, stiffness: 7e5, damping: 5e4 },
		{ x: -0.9, y: -GUNSHIP_CG_HEIGHT, z: 0.69, stiffness: 7e5, damping: 5e4 },
		{ x: 0, y: -GUNSHIP_CG_HEIGHT, z: -10.25, stiffness: 1.5e5, damping: 1.2e4 },
	],
	gearFriction: 0.6,
	spoolUpSeconds: 6,
	spoolDownSeconds: 14,
	ceiling: 120,
};

/** What the pilot asks for, each -1..1. */
export interface PilotInput {
	/** Forward (+) or back (-): nose down to fly forward, up to slow or back up. */
	forward: number;
	/** Turn right (+) or left (-): pedals in a hover, a banked turn at speed. */
	turn: number;
	/** Slide right (+) or left (-): bank without turning. */
	strafe: number;
	/** Climb (+) or descend (-). */
	climb: number;
}

export const NO_INPUT: Readonly<PilotInput> = { forward: 0, turn: 0, strafe: 0, climb: 0 };

/** Ground height at (x, z), or null where there's nothing (open sea). */
export type GroundAt = (x: number, z: number) => number | null;

const G = 9.81;
const AIR_DENSITY = 1.225;
const STEP = 1 / 120;
const DEG = Math.PI / 180;
/** After a collision, the airframe counts as touching something for this long, s. */
const CONTACT_HOLD = 0.5;

/** Flight control system. */
const FCS = {
	maxNoseDown: 26 * DEG,
	maxNoseUp: 18 * DEG,
	/** Pulling back at speed flares harder than backing up from a hover. */
	flareNoseUp: 30 * DEG,
	/** Extra braking from the flared disc, m/s² per m/s of forward speed, and at most (reached by ~16 m/s). */
	flareBrakePerSpeed: 0.5,
	flareBrakeLimit: 8,
	maxBank: 32 * DEG,
	/** Bank a turn asks for at speed. */
	turnBank: 35 * DEG,
	/** Yaw rate a turn asks for in the hover. */
	hoverTurnRate: 60 * DEG,
	/** Speeds the stick lets go of: flying backwards and sideways are limited, as on the real thing. */
	maxBackSpeed: 12,
	maxSideSpeed: 15,
	/** Letting go holds the hover: pitch/bank against drift, per m/s, and the most it will use. */
	holdPerSpeed: 0.6 * DEG,
	holdLimit: 12 * DEG,
	climbRate: 12,
	descentRate: 7,
	/** Gains. */
	pitchGain: 3,
	pitchRateGain: 1.2,
	rollGain: 2.5,
	rollRateGain: 0.8,
	yawRateGain: 2.5,
	climbGain: 0.08,
	/** How fast stick and keys move the controls (per second), so a key press is never a jolt. */
	inputRate: 4,
	cyclicRate: 6,
	pedalRate: 6,
	collectiveRate: 1.5,
} as const;

export class HelicopterFlight {
	/** Position of the centre of mass. */
	public x = 0;
	public y = 0;
	public z = 0;
	public vx = 0;
	public vy = 0;
	public vz = 0;
	/** Orientation, body to world (x, y, z, w). */
	public qx = 0;
	public qy = 0;
	public qz = 0;
	public qw = 1;
	/** Angular velocity, body frame, rad/s. */
	public wx = 0;
	public wy = 0;
	public wz = 0;
	/** Rotor speed as a share of its governed speed. */
	public rotor = 0;
	public engineOn = false;
	/** Controls as they actually stand (after the flight control system and their own lag). */
	public collective = 0;
	public cyclicPitch = 0;
	public cyclicRoll = 0;
	public pedal = 0;
	/** Wheels on the ground this step. */
	public wheelsDown = 0;
	/** Sink rate of the hardest touchdown since last read (see takeTouchdown). */
	private touchdown = 0;
	/** A rotor tip went into the ground. */
	public rotorStrike = false;
	/** Wrecked: no thrust, no control; it falls as a lump. */
	public wrecked = false;

	private readonly input: PilotInput = { forward: 0, turn: 0, strafe: 0, climb: 0 };
	private readonly contacts: boolean[];
	private accumulator = 0;
	/** Seconds since something last pushed back on the airframe, counting down (see collide). */
	private contactTime = 0;
	/** A wreck has hit something: it doesn't start tumbling again after a bounce. */
	private wreckDown = false;
	/** Scratch: body axes in world space. */
	private readonly right = [0, 0, 0];
	private readonly up = [0, 0, 0];
	private readonly fwd = [0, 0, 0];
	private readonly left = [0, 0, 0];

	public constructor(public readonly spec: HelicopterSpec = GUNSHIP) {
		this.contacts = spec.gear.map(() => false);
	}

	/** Parks it with its wheels on the ground at (x, groundY, z), facing `headingDegrees`. */
	public park(x: number, groundY: number, z: number, headingDegrees: number): void {
		this.x = x;
		this.y = groundY + GUNSHIP_CG_HEIGHT;
		this.z = z;
		this.vx = this.vy = this.vz = 0;
		this.wx = this.wy = this.wz = 0;
		const half = (headingDegrees * DEG) / 2;
		this.qx = 0;
		this.qy = Math.sin(half);
		this.qz = 0;
		this.qw = Math.cos(half);
		this.collective = this.cyclicPitch = this.cyclicRoll = this.pedal = 0;
		this.input.forward = this.input.turn = this.input.strafe = this.input.climb = 0;
		this.rotor = 0;
		this.engineOn = false;
		this.wrecked = false;
		this.rotorStrike = false;
		this.touchdown = 0;
		this.accumulator = 0;
		this.contactTime = 0;
		this.wreckDown = false;
	}

	/** Advances by `dt` seconds in fixed steps. */
	public advance(dt: number, pilot: Readonly<PilotInput>, groundAt: GroundAt): void {
		this.accumulator = Math.min(this.accumulator + dt, 0.25);
		while (this.accumulator >= STEP) {
			this.accumulator -= STEP;
			this.step(STEP, pilot, groundAt);
		}
	}

	// ---- What the rest of the game reads -----------------------------------------------------

	public get speed(): number {
		return Math.hypot(this.vx, this.vy, this.vz);
	}

	/** Heading in degrees (0 = +Z, rising towards +X), like the cars. */
	public get heading(): number {
		this.axes();
		return Math.atan2(this.fwd[0], this.fwd[2]) / DEG;
	}

	/** Nose-down pitch and right-wing-down bank, degrees. */
	public get pitch(): number {
		this.axes();
		return Math.asin(Math.max(-1, Math.min(1, -this.fwd[1]))) / DEG;
	}

	public get bank(): number {
		this.axes();
		return Math.atan2(this.left[1], this.up[1]) / DEG;
	}

	/** Settled on its wheels: all of them down and barely moving. */
	public get landed(): boolean {
		return this.wheelsDown === this.spec.gear.length && this.speed < 1.2;
	}

	/** The hardest touchdown sink rate since the last call, then clears it. */
	public takeTouchdown(): number {
		const value = this.touchdown;
		this.touchdown = 0;
		return value;
	}

	/** A body-frame point in world space. */
	public toWorld(bx: number, by: number, bz: number, out: [number, number, number]): [number, number, number] {
		this.axes();
		out[0] = this.x + this.left[0] * bx + this.up[0] * by + this.fwd[0] * bz;
		out[1] = this.y + this.left[1] * bx + this.up[1] * by + this.fwd[1] * bz;
		out[2] = this.z + this.left[2] * bx + this.up[2] * by + this.fwd[2] * bz;
		return out;
	}

	/** A body-frame direction in world space. */
	public directionToWorld(bx: number, by: number, bz: number, out: [number, number, number]): [number, number, number] {
		this.axes();
		out[0] = this.left[0] * bx + this.up[0] * by + this.fwd[0] * bz;
		out[1] = this.left[1] * bx + this.up[1] * by + this.fwd[1] * bz;
		out[2] = this.left[2] * bx + this.up[2] * by + this.fwd[2] * bz;
		return out;
	}

	/** A world direction in the body frame. */
	public directionToBody(x: number, y: number, z: number, out: [number, number, number]): [number, number, number] {
		const body = this.worldToBody(x, y, z);
		out[0] = body[0];
		out[1] = body[1];
		out[2] = body[2];
		return out;
	}

	/**
	 * Something hard in the way: stops the point's motion into the surface (normal pointing out
	 * of it), with a little bounce and scrape, and the off-centre push spins the body. Returns
	 * the closing speed, for damage.
	 */
	public collide(bx: number, by: number, bz: number, nx: number, ny: number, nz: number): number {
		// Velocity of the contact point: v + w × r, with w and r in the body frame.
		const rwx = this.wy * bz - this.wz * by;
		const rwy = this.wz * bx - this.wx * bz;
		const rwz = this.wx * by - this.wy * bx;
		const spin: [number, number, number] = [0, 0, 0];
		this.directionToWorld(rwx, rwy, rwz, spin);
		const pvx = this.vx + spin[0];
		const pvy = this.vy + spin[1];
		const pvz = this.vz + spin[2];
		const closing = pvx * nx + pvy * ny + pvz * nz;
		if (closing >= 0) return 0;
		this.contactTime = CONTACT_HOLD;
		// One impulse along the normal, shared between the body's travel and its spin by how hard
		// each is to change there (1/m + n·((I⁻¹(r×n))×r)). Putting all of the point's closing
		// speed, spin included, into the travel as well as spinning the body made every impact add
		// energy: a tumbling wreck bounced off the ground higher each time until it flew off.
		const restitution = 0.15;
		const nb = this.worldToBody(nx, ny, nz);
		const [ix, iy, iz] = this.spec.inertia;
		const cx = (by * nb[2] - bz * nb[1]) / ix;
		const cy = (bz * nb[0] - bx * nb[2]) / iy;
		const cz = (bx * nb[1] - by * nb[0]) / iz;
		const angular = nb[0] * (cy * bz - cz * by) + nb[1] * (cz * bx - cx * bz) + nb[2] * (cx * by - cy * bx);
		const impulse = (-(1 + restitution) * closing) / (1 / this.spec.mass + angular);
		const change = impulse / this.spec.mass;
		this.vx += nx * change;
		this.vy += ny * change;
		this.vz += nz * change;
		this.wx += cx * impulse;
		this.wy += cy * impulse;
		this.wz += cz * impulse;
		// Scrape: bleed the sliding speed, and the spin with it.
		this.vx *= 0.85;
		this.vz *= 0.85;
		this.wx *= 0.85;
		this.wy *= 0.85;
		this.wz *= 0.85;
		return -closing;
	}

	/** Moves the whole body (after a collision pushed it out of something). */
	public nudge(dx: number, dy: number, dz: number): void {
		this.x += dx;
		this.y += dy;
		this.z += dz;
	}

	// ---- The step ----------------------------------------------------------------------------

	private step(dt: number, pilot: Readonly<PilotInput>, groundAt: GroundAt) {
		const spec = this.spec;
		// Stick and keys ease towards where they're held.
		const ease = (from: number, to: number, rate: number) => from + Math.max(-rate * dt, Math.min(rate * dt, to - from));
		this.input.forward = ease(this.input.forward, clamp(pilot.forward), FCS.inputRate);
		this.input.turn = ease(this.input.turn, clamp(pilot.turn), FCS.inputRate);
		this.input.strafe = ease(this.input.strafe, clamp(pilot.strafe), FCS.inputRate);
		this.input.climb = ease(this.input.climb, clamp(pilot.climb), FCS.inputRate);

		const target = this.engineOn && !this.wrecked ? 1 : 0;
		const spool = target > this.rotor ? 1 / spec.spoolUpSeconds : 1 / spec.spoolDownSeconds;
		this.rotor = ease(this.rotor, target, spool);
		const power = this.wrecked ? 0 : this.rotor * this.rotor;

		this.axes();
		const up = this.up;
		const fwd = this.fwd;
		const left = this.left;
		// Velocity in the body frame.
		const bvx = this.vx * left[0] + this.vy * left[1] + this.vz * left[2];
		const bvy = this.vx * up[0] + this.vy * up[1] + this.vz * up[2];
		const bvz = this.vx * fwd[0] + this.vy * fwd[1] + this.vz * fwd[2];
		const speed = Math.hypot(this.vx, this.vy, this.vz);
		const horizontal = Math.hypot(this.vx, this.vz);
		const rotorGround = this.heightAbove(groundAt, 0, spec.rotorHeight, 0);

		// Rotor efficiency: translational lift once there's clean air through the disc, ground
		// effect within a diameter of the ground, and some lost sinking into its own downwash.
		const translational = 1 + 0.12 * smoothstep(4, 16, horizontal);
		const groundHeight = rotorGround === null ? Infinity : rotorGround;
		const inGround = 1 + 0.12 * Math.max(0, 1 - groundHeight / (2 * spec.rotorRadius)) ** 2;
		const vortexRing = 1 - 0.2 * smoothstep(7.5, 11, -this.vy) * (1 - smoothstep(6, 10, horizontal));
		// Thin air near the ceiling: enough to hover a little above it, not to climb on.
		const thinAir = 1 - 0.35 * smoothstep(spec.ceiling - 20, spec.ceiling + 30, this.y);
		const efficiency = translational * inGround * vortexRing * thinAir;

		this.flightControls(dt, bvx, bvz, horizontal, efficiency, power, rotorGround);

		// Forces, world frame.
		let fx = 0;
		let fy = -spec.mass * G;
		let fz = 0;
		const heave = spec.heaveDamping * spec.mass * G * this.vy * Math.max(0, up[1]) * this.rotor;
		const thrust = Math.max(0, spec.maxThrust * power * this.collective * efficiency - heave);
		fx += up[0] * thrust;
		fy += up[1] * thrust;
		fz += up[2] * thrust;
		const q = 0.5 * AIR_DENSITY;
		const dragX = -q * spec.dragAreas[0] * Math.abs(bvx) * bvx;
		const dragY = -q * spec.dragAreas[1] * Math.abs(bvy) * bvy;
		const dragZ = -q * spec.dragAreas[2] * Math.abs(bvz) * bvz;
		fx += left[0] * dragX + up[0] * dragY + fwd[0] * dragZ;
		fy += left[1] * dragX + up[1] * dragY + fwd[1] * dragZ;
		fz += left[2] * dragX + up[2] * dragY + fwd[2] * dragZ;

		// Flare: pulling back at speed, the disc tilted into the airflow brakes hard.
		if (this.input.forward < -0.02 && bvz > 0 && horizontal > 0.5 && !this.wrecked) {
			const brake = spec.mass * power * -this.input.forward * Math.min(FCS.flareBrakeLimit, FCS.flareBrakePerSpeed * bvz * bvz / horizontal);
			fx -= (brake * this.vx) / horizontal;
			fz -= (brake * this.vz) / horizontal;
		}

		// Landing gear: a spring and damper at each wheel, with the brakes on.
		let tx = 0;
		let ty = 0;
		let tz = 0;
		this.wheelsDown = 0;
		spec.gear.forEach((wheel, index) => {
			const rx = left[0] * wheel.x + up[0] * wheel.y + fwd[0] * wheel.z;
			const ry = left[1] * wheel.x + up[1] * wheel.y + fwd[1] * wheel.z;
			const rz = left[2] * wheel.x + up[2] * wheel.y + fwd[2] * wheel.z;
			const ground = groundAt(this.x + rx, this.z + rz);
			const depth = ground === null ? -1 : ground - (this.y + ry);
			if (depth <= 0) {
				this.contacts[index] = false;
				return;
			}
			// The wheel's velocity: v + ω × r (ω into the world frame first).
			const [owx, owy, owz] = this.angularWorld();
			const pvx = this.vx + owy * rz - owz * ry;
			const pvy = this.vy + owz * rx - owx * rz;
			const pvz = this.vz + owx * ry - owy * rx;
			if (!this.contacts[index]) this.touchdown = Math.max(this.touchdown, -pvy);
			this.contacts[index] = true;
			this.wheelsDown++;
			const normal = Math.max(0, wheel.stiffness * Math.min(depth, 0.5) - wheel.damping * pvy);
			const slide = Math.hypot(pvx, pvz);
			const grip = (spec.gearFriction * normal) / (slide + 0.3);
			const cx = -pvx * grip;
			const cz = -pvz * grip;
			fx += cx;
			fy += normal;
			fz += cz;
			tx += ry * cz - rz * normal;
			ty += rz * cx - rx * cz;
			tz += rx * normal - ry * cx;
		});

		// Rotor tips into the ground.
		if (rotorGround !== null && !this.rotorStrike) {
			for (const [sx, sz] of TIP_DIRECTIONS) {
				const tipHeight = this.heightAbove(groundAt, sx * spec.rotorRadius, spec.rotorHeight, sz * spec.rotorRadius);
				if (tipHeight !== null && tipHeight < 0) this.rotorStrike = this.rotor > 0.3;
			}
		}

		// Moments, body frame (contact torques first brought into it).
		const tb = this.worldToBody(tx, ty, tz);
		const damping = 0.3 + 0.7 * this.rotor;
		const along = Math.min(speed, 60);
		let ax = spec.pitchPower * power * this.cyclicPitch - spec.pitchDamping * damping * this.wx
			- spec.stabiliserStability * bvy * Math.abs(bvz) + tb[0] / spec.inertia[0];
		let ay = -spec.yawPower * power * this.pedal - spec.yawDamping * damping * this.wy
			- spec.torqueCoupling * power * (this.collective - this.trimCollective(efficiency, power))
			+ spec.finStability * bvx * along + tb[1] / spec.inertia[1];
		let az = spec.rollPower * power * this.cyclicRoll - spec.rollDamping * damping * this.wz + tb[2] / spec.inertia[2];
		this.contactTime = Math.max(0, this.contactTime - dt);
		if (this.wrecked && (this.contactTime > 0 || this.wheelsDown > 0)) this.wreckDown = true;
		if (!this.wrecked) this.wreckDown = false;
		if (this.wrecked && !this.wreckDown) {
			// Out of control: it tumbles on the way down.
			ax += 0.4;
			az += 0.9;
			ay += 1.2;
		} else if (this.wrecked) {
			// Down: the wreck grinds to a halt rather than spinning on.
			const settle = Math.exp(-3 * dt);
			ax -= (this.wx * (1 - settle)) / dt;
			ay -= (this.wy * (1 - settle)) / dt;
			az -= (this.wz * (1 - settle)) / dt;
		}

		this.vx += (fx / spec.mass) * dt;
		this.vy += (fy / spec.mass) * dt;
		this.vz += (fz / spec.mass) * dt;
		this.x += this.vx * dt;
		this.y += this.vy * dt;
		this.z += this.vz * dt;
		this.wx += ax * dt;
		this.wy += ay * dt;
		this.wz += az * dt;
		this.integrateOrientation(dt);
	}

	/**
	 * The flight control system: from the pilot's asks to cyclic, pedal and collective.
	 */
	private flightControls(dt: number, bvx: number, bvz: number, horizontal: number, efficiency: number, power: number, rotorGround: number | null) {
		const input = this.input;
		const pitch = Math.asin(Math.max(-1, Math.min(1, -this.fwd[1])));
		const bank = Math.atan2(this.left[1], this.up[1]);
		const flying = smoothstep(8, 30, Math.abs(bvz));
		const onGround = this.wheelsDown > 0;

		// Pitch: forward / back, and holding the hover (against drift) when let go.
		let targetPitch: number;
		if (input.forward > 0.02) targetPitch = input.forward * FCS.maxNoseDown;
		else if (input.forward < -0.02) {
			// Backwards flight is limited: the ask fades as the back speed nears the limit. Moving
			// forward fast, it's a flare to stop: the nose comes up further.
			const back = Math.max(0, -bvz);
			const noseUp = FCS.maxNoseUp + (FCS.flareNoseUp - FCS.maxNoseUp) * smoothstep(8, 30, bvz);
			targetPitch = input.forward * noseUp * clamp01((FCS.maxBackSpeed - back) / 6) - FCS.holdPerSpeed * Math.min(0, bvz);
			targetPitch = Math.max(-noseUp, targetPitch);
		} else targetPitch = clamp(-FCS.holdPerSpeed * bvz, FCS.holdLimit);
		// Right (+X is left, so right is -bvx).
		const rightSpeed = -bvx;
		let targetBank = input.strafe * FCS.maxBank * clamp01((FCS.maxSideSpeed - Math.abs(rightSpeed) * Math.sign(input.strafe || 1) * Math.sign(rightSpeed || 1)) / 6);
		// At speed a turn banks into it.
		targetBank += input.turn * FCS.turnBank * flying;
		if (Math.abs(input.strafe) < 0.02 && Math.abs(input.turn) < 0.02) targetBank += clamp(-FCS.holdPerSpeed * 1.5 * rightSpeed, FCS.holdLimit);
		targetBank = clamp(targetBank, FCS.maxBank + FCS.turnBank * flying * 0.3);
		if (onGround && this.rotor < 0.9) {
			targetPitch = 0;
			targetBank = 0;
		}

		// Yaw: a rate in the hover; at speed, the rate that goes with the bank (a co-ordinated turn).
		const hoverRate = -input.turn * FCS.hoverTurnRate;
		const coordinated = -(G * Math.tan(bank)) / Math.max(horizontal, 10);
		// Sideslip (bvx > 0: sliding left) is trimmed out with pedal, nose into the airflow.
		const targetYawRate = hoverRate * (1 - flying) + (coordinated + 0.03 * bvx) * flying;

		const cyclicPitch = clamp(FCS.pitchGain * (targetPitch - pitch) - FCS.pitchRateGain * this.wx);
		const cyclicRoll = clamp(FCS.rollGain * (targetBank - bank) - FCS.rollRateGain * this.wz);
		const trim = this.trimCollective(efficiency, power);
		const torque = power > 0.05 ? -(this.spec.torqueCoupling * (this.collective - trim)) / this.spec.yawPower : 0;
		const pedal = clamp(-FCS.yawRateGain * (targetYawRate - this.wy) + torque);

		// Collective: the climb rate asked for (holding height when let go), gentle near the
		// ground so holding "descend" still sets it down softly; flat on the ground unless climbing.
		let collective: number;
		if (onGround && input.climb <= 0.02) collective = 0;
		else {
			let targetClimb = input.climb >= 0 ? input.climb * FCS.climbRate : input.climb * FCS.descentRate;
			const height = rotorGround === null ? Infinity : rotorGround - this.spec.rotorHeight;
			if (targetClimb < 0) targetClimb = Math.max(targetClimb, -(0.5 + 0.35 * Math.max(0, height)));
			// Level off approaching the ceiling, and sink back under it if carried over.
			targetClimb = Math.min(targetClimb, (this.spec.ceiling - this.y) * 0.25);
			const tilt = Math.max(0.5, this.up[1]);
			const lift = this.spec.maxThrust * Math.max(power, 0.05) * efficiency;
			const needed = (this.spec.mass * G * (1 + this.spec.heaveDamping * targetClimb * this.rotor * tilt)) / (lift * tilt);
			collective = needed + FCS.climbGain * (targetClimb - this.vy);
		}

		const ease = (from: number, to: number, rate: number) => from + Math.max(-rate * dt, Math.min(rate * dt, to - from));
		this.cyclicPitch = ease(this.cyclicPitch, cyclicPitch, FCS.cyclicRate);
		this.cyclicRoll = ease(this.cyclicRoll, cyclicRoll, FCS.cyclicRate);
		this.pedal = ease(this.pedal, pedal, FCS.pedalRate);
		this.collective = ease(this.collective, Math.max(0, Math.min(1, collective)), FCS.collectiveRate);
	}

	/** Collective that holds a hover: where the tail rotor is rigged to cancel the torque. */
	private trimCollective(efficiency: number, power: number): number {
		return Math.min(1, (this.spec.mass * G) / (this.spec.maxThrust * Math.max(power, 0.05) * efficiency));
	}

	/** Height of a body-frame point above the ground under it, or null over open water. */
	private heightAbove(groundAt: GroundAt, bx: number, by: number, bz: number): number | null {
		const px = this.x + this.left[0] * bx + this.up[0] * by + this.fwd[0] * bz;
		const py = this.y + this.left[1] * bx + this.up[1] * by + this.fwd[1] * bz;
		const pz = this.z + this.left[2] * bx + this.up[2] * by + this.fwd[2] * bz;
		const ground = groundAt(px, pz);
		return ground === null ? null : py - ground;
	}

	private angularWorld(): [number, number, number] {
		const l = this.left;
		const u = this.up;
		const f = this.fwd;
		return [
			l[0] * this.wx + u[0] * this.wy + f[0] * this.wz,
			l[1] * this.wx + u[1] * this.wy + f[1] * this.wz,
			l[2] * this.wx + u[2] * this.wy + f[2] * this.wz,
		];
	}

	private worldToBody(x: number, y: number, z: number): [number, number, number] {
		this.axes();
		const l = this.left;
		const u = this.up;
		const f = this.fwd;
		return [x * l[0] + y * l[1] + z * l[2], x * u[0] + y * u[1] + z * u[2], x * f[0] + y * f[1] + z * f[2]];
	}

	/** q ← q + ½ q ⊗ (ω, 0) dt, renormalised. */
	private integrateOrientation(dt: number) {
		const { qx, qy, qz, qw, wx, wy, wz } = this;
		const h = 0.5 * dt;
		this.qx = qx + h * (qw * wx + qy * wz - qz * wy);
		this.qy = qy + h * (qw * wy + qz * wx - qx * wz);
		this.qz = qz + h * (qw * wz + qx * wy - qy * wx);
		this.qw = qw + h * (-qx * wx - qy * wy - qz * wz);
		const length = Math.hypot(this.qx, this.qy, this.qz, this.qw) || 1;
		this.qx /= length;
		this.qy /= length;
		this.qz /= length;
		this.qw /= length;
	}

	/** The body's axes in world space, from the quaternion. */
	private axes() {
		const { qx: x, qy: y, qz: z, qw: w } = this;
		this.left[0] = 1 - 2 * (y * y + z * z);
		this.left[1] = 2 * (x * y + w * z);
		this.left[2] = 2 * (x * z - w * y);
		this.up[0] = 2 * (x * y - w * z);
		this.up[1] = 1 - 2 * (x * x + z * z);
		this.up[2] = 2 * (y * z + w * x);
		this.fwd[0] = 2 * (x * z + w * y);
		this.fwd[1] = 2 * (y * z - w * x);
		this.fwd[2] = 1 - 2 * (x * x + y * y);
		this.right[0] = -this.left[0];
		this.right[1] = -this.left[1];
		this.right[2] = -this.left[2];
	}
}

/** Directions round the rotor disc checked for a blade strike. */
const TIP_DIRECTIONS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]];

function clamp(value: number, limit = 1): number {
	return Math.max(-limit, Math.min(limit, value));
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}
