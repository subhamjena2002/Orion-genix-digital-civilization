/**
 * Flight dynamics for the jet: a rigid body moved by thrust, gravity, lift, drag and side force
 * from the wing and fuselage, and sprung, damped landing gear with steerable nose wheel, rolling
 * resistance and brakes. Pure code — no engine types — so it can be tested and stepped at a fixed
 * rate whatever the frame rate.
 *
 * Frames match the gunship's: world Y up; body +X left, +Y up, +Z forward. Angular velocity is in
 * the body frame: +x noses down, +y yaws left, +z rolls right.
 *
 * The pilot doesn't move the control surfaces. As on a modern fighter, a flight control system
 * turns the stick into commands and flies them through the physics:
 *  - left/right asks for a bank angle (let go and the wings roll level);
 *  - forward/back asks for load factor (g), and the neutral stick asks for whatever holds the
 *    flight path — so a banked turn holds its height with the stick let go;
 *  - an angle-of-attack limiter keeps the wing short of the stall, and there's a load limit;
 *  - the rudder is co-ordinated automatically (sideslip is trimmed out).
 * Nothing is set directly, so the aircraft keeps its inertia and energy: pull hard and it bleeds
 * speed, fly slow and the controls go soft.
 */

export interface GearPoint {
	/** Body frame, relative to the centre of mass. */
	x: number;
	y: number;
	z: number;
	stiffness: number;
	damping: number;
	/** The nose wheel steers; the main wheels brake. */
	steers: boolean;
}

export interface JetSpec {
	mass: number;
	/** Moments of inertia about the pitch (x), yaw (y) and roll (z) axes, kg·m². */
	inertia: readonly [number, number, number];
	wingArea: number;
	/** Lift coefficient per radian of angle of attack, and the most the wing gives. */
	liftSlope: number;
	maxLift: number;
	zeroLiftDrag: number;
	inducedDrag: number;
	/** Side force per radian of sideslip, as an area (m²). */
	sideArea: number;
	/** Extra drag areas (m²) with the gear down and the airbrake out. */
	gearDrag: number;
	airbrakeDrag: number;
	/** The braking parachute, streamed on the landing roll (m²). */
	chuteDrag: number;
	/** Thrust at full dry power and with the afterburner lit, N; idle as a share of dry. */
	dryThrust: number;
	afterburnerThrust: number;
	idle: number;
	/** Seconds for the engines to spool from idle to full dry power. */
	spoolSeconds: number;
	/** Lever travel a second while the throttle is held. */
	throttleRate: number;
	gear: readonly GearPoint[];
	tyre: { rolling: number; brake: number; lateral: number };
	/** Load factor limits (g). */
	maxLoad: number;
	minLoad: number;
	maxBank: number;
	maxRollRate: number;
	maxYawRate: number;
	/** Nose-up attitude the controls stop at on the ground, short of a tail strike (rad). */
	rotateLimit: number;
	/** Service ceiling, m above sea level: the air thins out above it and the controls push over. */
	ceiling: number;
}

/** What the pilot asks for, each -1..1. */
export interface JetInput {
	/** Nose up (+) or down (-). */
	pitch: number;
	/** Bank right (+) or left (-). On the ground, steers the nose wheel. */
	roll: number;
	/** Rudder right (+) or left (-). On the ground, steers the nose wheel. */
	yaw: number;
	/** Throttle forward (+) or back (-), held. Held back at idle, it brakes. */
	throttle: number;
}

export const NO_JET_INPUT: Readonly<JetInput> = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };

/** Ground height at (x, z), or null where there's nothing (open sea). */
export type GroundAt = (x: number, z: number) => number | null;

const G = 9.81;
const AIR_DENSITY = 1.225;
const STEP = 1 / 120;
const DEG = Math.PI / 180;

/** Centre of mass above the model's wheel contact, and the model's gear points (see JetModel). */
const CG_Y = 2.1 + 0.12;
const CG_Z = -2.9;

export const JET: JetSpec = {
	mass: 16000,
	inertia: [160000, 190000, 45000],
	wingArea: 62,
	liftSlope: 4.6,
	maxLift: 1.5,
	zeroLiftDrag: 0.07,
	inducedDrag: 0.11,
	sideArea: 16,
	gearDrag: 1.6,
	airbrakeDrag: 4.5,
	chuteDrag: 32,
	dryThrust: 95000,
	afterburnerThrust: 150000,
	idle: 0.06,
	spoolSeconds: 2.2,
	throttleRate: 0.6,
	gear: [
		{ x: 0, y: -0.172 - 2.1, z: 1.61 - CG_Z, stiffness: 2.2e5, damping: 3.2e4, steers: true },
		{ x: 2.21, y: -0.061 - 2.1, z: -3.79 - CG_Z, stiffness: 6e5, damping: 7e4, steers: false },
		{ x: -2.21, y: -0.061 - 2.1, z: -3.79 - CG_Z, stiffness: 6e5, damping: 7e4, steers: false },
	],
	tyre: { rolling: 0.02, brake: 0.75, lateral: 0.9 },
	maxLoad: 7.5,
	minLoad: -2.5,
	maxBank: 75 * DEG,
	maxRollRate: 2.6,
	maxYawRate: 0.3,
	rotateLimit: 13 * DEG,
	ceiling: 800,
};

/** Height of the centre of mass above the wheels' contact patches when parked. */
export const JET_CG_HEIGHT = CG_Y;

/** Afterburner lights above this share of the throttle's travel. */
export const AFTERBURNER_FROM = 0.85;

/** Flight control system gains. */
const FCS = {
	/** Stick and pedals ease towards where they're held (per second), so a key is never a jolt. */
	inputRate: 4.5,
	/** How fast each axis's rate follows what's asked (1/s): pitch, yaw, roll. */
	pitchResponse: 5,
	yawResponse: 4,
	rollResponse: 7,
	/** Bank angle error to roll rate (1/s), and the level-wings assist's. */
	bankGain: 2.4,
	/** Sideslip trimmed out by the rudder (1/s). */
	slipGain: 3,
	/** Angle of attack held short of the stall by this much. */
	alphaMargin: 3 * DEG,
	alphaGain: 6,
	/** How hard the pitch channel corrects the load being made towards the load asked for. */
	loadGain: 2.5,
	/** Dynamic pressure at which the controls have full authority (≈ 55 m/s). */
	fullAuthority: 0.5 * AIR_DENSITY * 55 * 55,
	/** In the air the controls never go completely slack. */
	minAuthority: 0.25,
	maxPitchRate: 1.2,
	/** Hands-off, the flight path eases back to level (extra g per radian of climb), within this angle. */
	levelGain: 3.5,
	levelWithin: 45 * DEG,
	/** Most the neutral stick pulls to hold the flight path in a bank. */
	maxHoldLoad: 4.5,
	/** Nose wheel steering: its lock at walking pace, and at the speed where it's all but gone. */
	maxSteer: 50 * DEG,
	steerFadeSpeed: 40,
	/** Gear and airbrake travel, per second. */
	gearRate: 0.4,
	airbrakeRate: 1.5,
} as const;

/** After a collision, the airframe counts as touching something for this long, s. */
const CONTACT_HOLD = 0.5;

export class JetFlight {
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
	public engineOn = false;
	/** Throttle lever, 0..1 (afterburner above AFTERBURNER_FROM). */
	public throttle = 0;
	/** Engine output, 0..1 on the same scale, lagging the lever. */
	public spool = 0;
	/** Gear asked for, and how far down it is (0 up .. 1 down). */
	public gearDown = true;
	public gear = 1;
	/** Airbrake, 0 shut .. 1 out. */
	public airbrake = 0;
	/** Wheel brakes on this step. */
	public braking = false;
	/** Braking parachute, 0 packed .. 1 fully open; it goes once released. */
	public chute = 0;
	private chuteUsed = false;
	/** Wheels on the ground this step. */
	public wheelsDown = 0;
	/** Angle of attack and sideslip (rad), load factor (g), this step. */
	public alpha = 0;
	public beta = 0;
	public load = 1;
	/** Wrecked: no thrust, no control; it falls as a lump. */
	public wrecked = false;

	private touchdown = 0;
	private readonly input: JetInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
	private readonly contacts: boolean[];
	private accumulator = 0;
	private contactTime = 0;
	private wreckDown = false;
	/** Scratch: body axes in world space. */
	private readonly up = [0, 0, 0];
	private readonly fwd = [0, 0, 0];
	private readonly left = [0, 0, 0];

	public constructor(public readonly spec: JetSpec = JET) {
		this.contacts = spec.gear.map(() => false);
	}

	/** Parks it on its wheels at (x, groundY, z), facing `headingDegrees`, engines off. */
	public park(x: number, groundY: number, z: number, headingDegrees: number): void {
		this.x = x;
		this.y = groundY + JET_CG_HEIGHT;
		this.z = z;
		this.vx = this.vy = this.vz = 0;
		this.wx = this.wy = this.wz = 0;
		const half = (headingDegrees * DEG) / 2;
		this.qx = 0;
		this.qy = Math.sin(half);
		this.qz = 0;
		this.qw = Math.cos(half);
		this.input.pitch = this.input.roll = this.input.yaw = this.input.throttle = 0;
		this.engineOn = false;
		this.throttle = 0;
		this.spool = 0;
		this.gearDown = true;
		this.gear = 1;
		this.airbrake = 0;
		this.braking = false;
		this.chute = 0;
		this.chuteUsed = false;
		this.wrecked = false;
		this.touchdown = 0;
		this.accumulator = 0;
		this.contactTime = 0;
		this.wreckDown = false;
		this.alpha = this.beta = 0;
		this.load = 1;
	}

	/** Advances by `dt` seconds in fixed steps. */
	public advance(dt: number, pilot: Readonly<JetInput>, groundAt: GroundAt): void {
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

	/** Heading in degrees (0 = +Z, rising towards +X), like the cars and the gunship. */
	public get heading(): number {
		this.axes();
		return Math.atan2(this.fwd[0], this.fwd[2]) / DEG;
	}

	/** Nose-up pitch and right-wing-down bank, degrees. */
	public get pitch(): number {
		this.axes();
		return Math.asin(clamp(this.fwd[1])) / DEG;
	}

	public get bank(): number {
		this.axes();
		return Math.atan2(this.left[1], this.up[1]) / DEG;
	}

	/** The afterburner is lit. */
	public get afterburner(): boolean {
		return this.engineOn && !this.wrecked && this.spool > AFTERBURNER_FROM + 0.005;
	}

	/** At the stall: the wing is past its limit, or too slow to hold the aircraft up. */
	public get stalling(): boolean {
		return this.wheelsDown === 0 && (Math.abs(this.alpha) > this.stallAlpha - 0.5 * DEG || (this.speed < this.stallSpeed * 1.05 && this.speed > 5));
	}

	/** Speed at which full lift just holds the aircraft up in level flight, m/s. */
	public get stallSpeed(): number {
		return Math.sqrt((2 * this.spec.mass * G) / (AIR_DENSITY * this.spec.wingArea * this.spec.maxLift));
	}

	private get stallAlpha(): number {
		return this.spec.maxLift / this.spec.liftSlope;
	}

	/** Settled on its wheels: all of them down and barely moving. */
	public get landed(): boolean {
		return this.wheelsDown === this.spec.gear.length && this.speed < 1;
	}

	/** On the ground on all its wheels, at whatever speed (taxiing, rolling out). */
	public get onGround(): boolean {
		return this.wheelsDown === this.spec.gear.length;
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

	/**
	 * Something hard in the way: stops the point's motion into the surface (normal pointing out
	 * of it) with one impulse shared between travel and spin, a little bounce and scrape. Returns
	 * the closing speed, for damage. (As HelicopterFlight.collide.)
	 */
	public collide(bx: number, by: number, bz: number, nx: number, ny: number, nz: number): number {
		const rwx = this.wy * bz - this.wz * by;
		const rwy = this.wz * bx - this.wx * bz;
		const rwz = this.wx * by - this.wy * bx;
		const spin: [number, number, number] = [0, 0, 0];
		this.directionToWorld(rwx, rwy, rwz, spin);
		const closing = (this.vx + spin[0]) * nx + (this.vy + spin[1]) * ny + (this.vz + spin[2]) * nz;
		if (closing >= 0) return 0;
		this.contactTime = CONTACT_HOLD;
		const restitution = 0.1;
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
		this.vx *= 0.8;
		this.vz *= 0.8;
		this.wx *= 0.8;
		this.wy *= 0.8;
		this.wz *= 0.8;
		return -closing;
	}

	/** Moves the whole body (after a collision pushed it out of something). */
	public nudge(dx: number, dy: number, dz: number): void {
		this.x += dx;
		this.y += dy;
		this.z += dz;
	}

	// ---- The step ----------------------------------------------------------------------------

	private step(dt: number, pilot: Readonly<JetInput>, groundAt: GroundAt) {
		const spec = this.spec;
		const ease = (from: number, to: number, rate: number) => from + Math.max(-rate * dt, Math.min(rate * dt, to - from));
		const live = this.engineOn && !this.wrecked;
		this.input.pitch = ease(this.input.pitch, live ? clamp(pilot.pitch) : 0, FCS.inputRate);
		this.input.roll = ease(this.input.roll, live ? clamp(pilot.roll) : 0, FCS.inputRate);
		this.input.yaw = ease(this.input.yaw, live ? clamp(pilot.yaw) : 0, FCS.inputRate);
		const throttleHeld = live ? clamp(pilot.throttle) : -1;
		this.throttle = Math.max(0, Math.min(1, this.throttle + throttleHeld * spec.throttleRate * dt));
		if (!live) this.throttle = 0;

		// Engines: they follow the lever with a lag; the afterburner lights quicker than the core spools.
		const target = live ? Math.max(spec.idle, this.throttle) : 0;
		const rate = target > this.spool ? (this.spool > AFTERBURNER_FROM ? 2.5 : 1 / spec.spoolSeconds) : 1 / 1.4;
		this.spool = ease(this.spool, target, rate);
		const thrust = this.spool <= AFTERBURNER_FROM
			? (spec.dryThrust * this.spool) / AFTERBURNER_FROM
			: spec.dryThrust + ((spec.afterburnerThrust - spec.dryThrust) * (this.spool - AFTERBURNER_FROM)) / (1 - AFTERBURNER_FROM);

		// Held back at idle: wheel brakes on the ground, the airbrake in the air. Stopped at idle,
		// the brakes hold it so idle thrust doesn't creep it off its stand; rolling, it taxis.
		const holdingBack = throttleHeld < -0.3 && this.throttle <= 0.001;
		const onGround = this.wheelsDown > 0;
		const rolling = Math.hypot(this.vx, this.vy, this.vz);
		this.braking = onGround && (holdingBack || (this.throttle <= 0.001 && rolling < 1));
		this.airbrake = ease(this.airbrake, holdingBack && !onGround ? 1 : holdingBack && this.speed > 25 ? 1 : 0, FCS.airbrakeRate);
		// The braking parachute: streamed when braking on the landing roll, released once slow or
		// when power comes back on. One per landing; it's repacked once airborne again.
		const allDown = this.wheelsDown === spec.gear.length;
		if (!onGround) this.chuteUsed = false;
		const streaming = allDown && this.braking && holdingBack && !this.chuteUsed && Math.hypot(this.vx, this.vy, this.vz) > 25;
		if (streaming) this.chute = Math.min(1, this.chute + dt / 0.6);
		else if (this.chute > 0 && (this.throttle > 0.05 || Math.hypot(this.vx, this.vy, this.vz) < 8 || !allDown)) {
			this.chute = 0;
			this.chuteUsed = true;
		}
		// The gear can't come up with weight on it.
		const gearWanted = this.gearDown || onGround ? 1 : 0;
		this.gear = ease(this.gear, gearWanted, FCS.gearRate);

		this.axes();
		const up = this.up;
		const fwd = this.fwd;
		const left = this.left;
		const speed = Math.hypot(this.vx, this.vy, this.vz);
		const bvx = this.vx * left[0] + this.vy * left[1] + this.vz * left[2];
		const bvy = this.vx * up[0] + this.vy * up[1] + this.vz * up[2];
		const bvz = this.vx * fwd[0] + this.vy * fwd[1] + this.vz * fwd[2];
		this.alpha = speed > 2 ? Math.atan2(-bvy, Math.abs(bvz) + 1e-3) : 0;
		this.beta = speed > 2 ? Math.atan2(bvx, Math.abs(bvz) + 1e-3) : 0;
		// Thin air near the ceiling: less lift and less thrust.
		const thin = 1 - 0.5 * smoothstep(spec.ceiling - 60, spec.ceiling + 40, this.y);
		const q = 0.5 * AIR_DENSITY * speed * speed * thin;
		const lift = this.wrecked ? 0.3 * this.liftCoefficient(this.alpha) : this.liftCoefficient(this.alpha);

		// Forces, world frame.
		let fx = 0;
		let fy = -spec.mass * G;
		let fz = 0;
		const push = this.wrecked ? 0 : thrust * thin;
		fx += fwd[0] * push;
		fy += fwd[1] * push;
		fz += fwd[2] * push;
		if (speed > 0.5) {
			const vx = this.vx / speed;
			const vy = this.vy / speed;
			const vz = this.vz / speed;
			// Lift: across the airflow, in the plane of the airflow and the wing's up.
			const upAlong = up[0] * vx + up[1] * vy + up[2] * vz;
			let lx = up[0] - upAlong * vx;
			let ly = up[1] - upAlong * vy;
			let lz = up[2] - upAlong * vz;
			const liftLength = Math.hypot(lx, ly, lz) || 1;
			lx /= liftLength;
			ly /= liftLength;
			lz /= liftLength;
			const liftForce = q * spec.wingArea * lift;
			fx += lx * liftForce;
			fy += ly * liftForce;
			fz += lz * liftForce;
			// Load factor: everything pushing across the flight path, the thrust's share included
			// (at a few degrees of angle of attack it's enough to make the aircraft climb away).
			const thrustAcross = push * (fwd[0] * lx + fwd[1] * ly + fwd[2] * lz);
			this.load = (liftForce + thrustAcross) / (spec.mass * G);
			// Side force against sideslip, across the airflow towards the body's side.
			const leftAlong = left[0] * vx + left[1] * vy + left[2] * vz;
			let sx = left[0] - leftAlong * vx;
			let sy = left[1] - leftAlong * vy;
			let sz = left[2] - leftAlong * vz;
			const sideLength = Math.hypot(sx, sy, sz) || 1;
			sx /= sideLength;
			sy /= sideLength;
			sz /= sideLength;
			const side = -q * spec.sideArea * clamp(this.beta, 0.6);
			fx += sx * side;
			fy += sy * side;
			fz += sz * side;
			// Drag, along the airflow.
			const dragArea = spec.wingArea * (spec.zeroLiftDrag + spec.inducedDrag * lift * lift)
				+ spec.gearDrag * this.gear + spec.airbrakeDrag * this.airbrake + spec.chuteDrag * this.chute + spec.sideArea * 0.4 * Math.abs(this.beta)
				+ (this.wrecked ? 12 : 0);
			const drag = q * dragArea;
			fx -= vx * drag;
			fy -= vy * drag;
			fz -= vz * drag;
		} else {
			this.load = 1;
		}

		// The ceiling is firm: past it, any climb is taken off quickly (a loop begun at speed would
		// otherwise carry it hundreds of metres higher), and it's pressed back down.
		// It acts as drag along the flight path, never across it: pushing the aircraft bodily
		// downwards bent its path under the wing and threw the angle of attack past the stall.
		const over = smoothstep(spec.ceiling, spec.ceiling + 30, this.y);
		if (over > 0 && speed > 1 && this.vy > 0) {
			const bleed = spec.mass * over * Math.min(45, 1.5 * this.vy + 0.1 * (this.y - spec.ceiling));
			fx -= (this.vx / speed) * bleed;
			fy -= (this.vy / speed) * bleed;
			fz -= (this.vz / speed) * bleed;
		}

		// Landing gear: a spring and damper at each wheel; rolling, braking and cornering grip.
		let tx = 0;
		let ty = 0;
		let tz = 0;
		this.wheelsDown = 0;
		const [owx, owy, owz] = this.angularWorld();
		const steer = this.steerAngle(speed);
		spec.gear.forEach((wheel, index) => {
			if (this.gear < 0.95) {
				this.contacts[index] = false;
				return;
			}
			const rx = left[0] * wheel.x + up[0] * wheel.y + fwd[0] * wheel.z;
			const ry = left[1] * wheel.x + up[1] * wheel.y + fwd[1] * wheel.z;
			const rz = left[2] * wheel.x + up[2] * wheel.y + fwd[2] * wheel.z;
			const ground = groundAt(this.x + rx, this.z + rz);
			const depth = ground === null ? -1 : ground - (this.y + ry);
			if (depth <= 0) {
				this.contacts[index] = false;
				return;
			}
			const pvx = this.vx + owy * rz - owz * ry;
			const pvy = this.vy + owz * rx - owx * rz;
			const pvz = this.vz + owx * ry - owy * rx;
			if (!this.contacts[index]) this.touchdown = Math.max(this.touchdown, -pvy);
			this.contacts[index] = true;
			this.wheelsDown++;
			const normal = Math.max(0, wheel.stiffness * Math.min(depth, 0.6) - wheel.damping * pvy);
			// The wheel rolls along the body's heading (the nose wheel turned by the steering).
			let hx = fwd[0];
			let hz = fwd[2];
			const flat = Math.hypot(hx, hz) || 1;
			hx /= flat;
			hz /= flat;
			if (wheel.steers && steer !== 0) {
				// Positive steer turns right, which is towards -left: rotate the heading about up.
				const c = Math.cos(-steer);
				const s = Math.sin(-steer);
				const nhx = hx * c + hz * s;
				const nhz = -hx * s + hz * c;
				hx = nhx;
				hz = nhz;
			}
			const along = pvx * hx + pvz * hz;
			const across = pvx * hz - pvz * hx;
			const rolling = spec.tyre.rolling + (this.braking && !wheel.steers ? spec.tyre.brake : 0);
			const roll = -(rolling * normal * along) / (Math.abs(along) + 0.3);
			const grip = -(spec.tyre.lateral * normal * across) / (Math.abs(across) + 0.3);
			const cx = hx * roll + hz * grip;
			const cz = hz * roll - hx * grip;
			fx += cx;
			fy += normal;
			fz += cz;
			tx += ry * cz - rz * normal;
			ty += rz * cx - rx * cz;
			tz += rx * normal - ry * cx;
		});

		// Moments: what the flight control system asks for, and the airframe's own tendencies.
		const tb = this.worldToBody(tx, ty, tz);
		const [pitchRate, yawRate, rollRate, authority] = this.flightControls(speed, q, onGround);
		const [ix, iy, iz] = spec.inertia;
		// The angle-of-attack limiter keeps its grip even when slow: that's when it's needed.
		const limiting = !onGround && Math.abs(this.alpha) > this.stallAlpha - FCS.alphaMargin;
		const pitchWeight = FCS.pitchResponse * (onGround ? authority : Math.max(authority, limiting ? 0.8 : FCS.minAuthority));
		const rollWeight = FCS.rollResponse * (onGround ? authority : Math.max(authority, FCS.minAuthority));
		const yawWeight = FCS.yawResponse * (onGround ? authority * authority : Math.max(authority, FCS.minAuthority));
		let ax = 0;
		let ay = 0;
		let az = 0;
		if (!this.wrecked) {
			// Pitch up is -x (x noses down); yaw right is -y.
			ax = pitchWeight * (-pitchRate - this.wx);
			ay = yawWeight * (-yawRate - this.wy);
			az = rollWeight * (rollRate - this.wz);
			// Past the stall the nose falls towards the airflow, and the tail keeps it pointing into it.
			const qNorm = Math.min(2, q / FCS.fullAuthority);
			const beyond = Math.abs(this.alpha) - this.stallAlpha;
			if (beyond > 0 && !onGround) ax += Math.sign(this.alpha) * beyond * 4 * Math.max(qNorm, 0.3);
			ay += this.beta * 1.5 * qNorm;
		} else if (!this.wreckDown) {
			// Out of control: it tumbles on the way down.
			ax = 0.3;
			ay = 0.5;
			az = 1.2;
		} else {
			// Down: the wreck grinds to a halt.
			const settle = Math.exp(-3 * dt);
			ax = (-this.wx * (1 - settle)) / dt;
			ay = (-this.wy * (1 - settle)) / dt;
			az = (-this.wz * (1 - settle)) / dt;
		}
		// A little damping on every axis; the contact torques come in on top.
		ax += -0.3 * this.wx + tb[0] / ix;
		ay += -0.3 * this.wy + tb[1] / iy;
		az += -0.3 * this.wz + tb[2] / iz;

		this.contactTime = Math.max(0, this.contactTime - dt);
		if (this.wrecked && (this.contactTime > 0 || this.wheelsDown > 0)) this.wreckDown = true;
		if (!this.wrecked) this.wreckDown = false;

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

	/** Lift coefficient at angle of attack `alpha`: linear to the stall, then falling away. */
	private liftCoefficient(alpha: number): number {
		const spec = this.spec;
		const magnitude = Math.abs(alpha);
		const stall = this.stallAlpha;
		if (magnitude <= stall) return spec.liftSlope * alpha;
		const after = Math.max(0.9 * Math.abs(Math.sin(2 * alpha)), spec.maxLift - 2.5 * (magnitude - stall));
		return Math.sign(alpha) * after;
	}

	/** Nose wheel angle (rad, right positive): full lock at taxiing speeds, a few degrees at speed. */
	private steerAngle(speed: number): number {
		const input = clamp(this.input.yaw + this.input.roll);
		const fade = Math.max(0.08, 1 - speed / FCS.steerFadeSpeed);
		return input * FCS.maxSteer * fade;
	}

	/**
	 * The flight control system: from the pilot's asks to the rates it wants about each axis —
	 * pitch up, yaw right, roll right (rad/s) — and how much authority the controls have.
	 */
	private flightControls(speed: number, q: number, onGround: boolean): [number, number, number, number] {
		const spec = this.spec;
		const input = this.input;
		const authority = Math.min(1, q / FCS.fullAuthority);
		const pitchAngle = Math.asin(clamp(this.fwd[1]));
		const bank = Math.atan2(this.left[1], this.up[1]);

		if (onGround) {
			// Rotate for take-off with the stick; the wheels keep it level and the tyres steer it.
			let pitchRate = input.pitch * 0.3;
			if (input.pitch > 0 && pitchAngle > spec.rotateLimit - 3 * DEG) pitchRate = Math.min(pitchRate, (spec.rotateLimit - pitchAngle) * 2);
			const yawRate = input.yaw * spec.maxYawRate;
			return [pitchRate, yawRate, -bank * FCS.bankGain, authority];
		}

		// Flight path angle and bank, and what holds the flight path with the stick let go.
		const gamma = speed > 1 ? Math.asin(clamp(this.vy / speed)) : 0;
		const cosGamma = Math.cos(gamma);
		const cosBank = Math.cos(bank);
		let hold = cosBank > 0 ? Math.min(FCS.maxHoldLoad, cosGamma / Math.max(cosBank, 0.2)) : cosGamma * cosBank;
		// Let go in a gentle climb or dive and it eases back to level (not in a loop or a steep dive,
		// and not rolled far over, where "level" isn't what the pilot is after).
		if (Math.abs(input.pitch) < 0.05 && Math.abs(gamma) < FCS.levelWithin && cosBank > 0.5) hold -= gamma * FCS.levelGain;
		let demand = input.pitch >= 0
			? hold + input.pitch * (spec.maxLoad - hold)
			: hold + input.pitch * (hold - spec.minLoad);
		// Above the ceiling the controls ease the nose over.
		if (this.y > spec.ceiling) demand -= Math.min(1.5, (this.y - spec.ceiling) * 0.04);
		// The rate that bends the flight path to give that load, (n − cosγ·cosφ)·g / V, and a
		// correction for the load the wing is actually making: without it the nose holds its
		// attitude, and as the speed builds the extra lift balloons the aircraft upwards.
		const effectiveSpeed = Math.max(speed, 45);
		let pitchRate = ((demand - cosGamma * cosBank + FCS.loadGain * (demand - this.load)) * G) / effectiveSpeed;
		// Angle-of-attack limiter, both ways, and it has the last word: however hard the stick is
		// held, the nose turns no faster than the flight path does at the limit (the path's own
		// rate, plus a correction back to the limit). At the limit it holds; past it, it pushes.
		const alphaLimit = this.stallAlpha - FCS.alphaMargin;
		const pathRate = ((this.load - cosGamma * cosBank) * G) / effectiveSpeed;
		pitchRate = Math.min(pitchRate, pathRate + (alphaLimit - this.alpha) * FCS.alphaGain);
		pitchRate = Math.max(pitchRate, pathRate + (-alphaLimit * 0.6 - this.alpha) * FCS.alphaGain);
		pitchRate = clamp(pitchRate, FCS.maxPitchRate);

		// Roll: to the bank asked for (level with the stick let go). Near the vertical, bank means
		// nothing, so the roll channel eases off rather than chase it.
		// No more bank than the wing can hold level at this speed: a 75° bank needs almost 4 g, and
		// slow, the stick-held turn would otherwise sink steadily into the ground.
		const available = (q * spec.wingArea * spec.liftSlope * alphaLimit) / (spec.mass * G);
		const sustainable = available > 1.1 ? Math.acos(Math.min(1, 1 / (0.8 * available))) : 15 * DEG;
		const bankLimit = Math.max(15 * DEG, Math.min(spec.maxBank, sustainable));
		const targetBank = input.roll * bankLimit;
		const error = wrapAngle(targetBank - bank);
		const nearVertical = clamp01((Math.cos(pitchAngle) - 0.3) / 0.4);
		let rollRate = clamp(error * FCS.bankGain, spec.maxRollRate) * nearVertical;
		// Pulling through inverted (over the top of a loop) with the roll let go: hold the bank, so
		// the loop carries on round rather than being rolled out of halfway.
		if (Math.abs(input.roll) < 0.05 && input.pitch > 0.3 && Math.abs(bank) > 100 * DEG) rollRate = 0;

		// Rudder: what's asked, plus the sideslip trimmed out (sliding left, yaw left: +beta).
		const yawRate = input.yaw * spec.maxYawRate - this.beta * FCS.slipGain;
		return [pitchRate, yawRate, rollRate, authority];
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
	}
}

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

function wrapAngle(angle: number): number {
	return ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}
