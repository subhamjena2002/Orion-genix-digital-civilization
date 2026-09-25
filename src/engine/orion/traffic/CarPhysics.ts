import type { VehicleStyle } from "./Vehicles";

/**
 * Car handling for anything that isn't following a traffic lane: the player's car, and cars
 * that are stopped, parked or knocked out of their lane.
 *
 * A single-track ("bicycle") model with real tyre forces: each axle makes a lateral force from
 * its slip angle, capped by the grip its load allows. Load shifts forward under braking and
 * back under power, the driven rear axle shares one friction budget between traction and
 * cornering, and the handbrake takes most of the rear grip away. Oversteer, understeer, lift-off
 * rotation and power slides all come out of that rather than being scripted.
 *
 * Cornering grip is deliberately above real-world tyres (as in most driving games), so
 * junction turns can be taken at city speeds; braking and traction stay close to real.
 *
 * Two driver aids keep it playable on a keyboard, as in most modern cars: the steering lock
 * shrinks to roughly what the tyres can use at speed, and stability control trims the throttle
 * and counters the yaw when the rear lets go — except while the handbrake is in use, so
 * deliberate slides still work.
 *
 * Conventions: heading is radians with forward = (sin h, cos h); "left" = (cos h, -sin h);
 * positive steer and positive yaw rate both turn left.
 */

const GRAVITY = 9.81;
const SUBSTEP = 1 / 120;
/** Slip angles use at least this speed so the tyres stay stable when nearly stopped. */
const LOW_SPEED = 2;
/** Below this, with the brake held and no throttle, the car is held still. */
const HOLD_SPEED = 0.35;
/** Sideways grip relative to the tyres' longitudinal grip. */
const CORNERING_GRIP = 2;
/** Steering speed (rad/s) turning in and returning to centre. */
const STEER_IN_RATE = 5;
const STEER_OUT_RATE = 7;
/** Share of an axle's grip the throttle may use. */
const TRACTION_CONTROL = 0.9;
/** Steering lock is capped at this multiple of what the tyres can turn at the current speed. */
const LOCK_HEADROOM = 1.7;
/** Rear slip angle (rad) beyond which stability control steps in. */
const ESC_SLIP = 0.09;
const ESC_THROTTLE_CUT = 7;
const ESC_YAW_GAIN = 6;
/**
 * Extra rear grip over the front (wider rear tyres), so at the limit the nose washes wide
 * before the tail steps out.
 */
const REAR_GRIP_BIAS = 1.15;
/** Deceleration from the engine when coasting off the throttle (m/s²). */
const ENGINE_BRAKING = 0.9;
/** Seconds stability control stays off after the handbrake is released. */
const ESC_HANDBRAKE_HOLDOFF = 0.9;

export interface CarSpec {
	mass: number;
	/** Metres from the front axle to the rear. */
	wheelbase: number;
	/** Share of the weight on the front axle, at rest. */
	frontWeight: number;
	/** Centre of mass height, for load transfer. */
	cgHeight: number;
	/** Yaw inertia. */
	inertia: number;
	/** Peak engine power (W) and the most force the drivetrain can put down (N). */
	power: number;
	maxDriveForce: number;
	topSpeed: number;
	reverseSpeed: number;
	/** Brake force at full pedal, before the grip limit (N). */
	brakeForce: number;
	/** Aerodynamic drag: F = drag * v^2. */
	drag: number;
	/** Rolling resistance: F = rolling * v. */
	rolling: number;
	/** Front and rear axle cornering stiffness (N per radian of slip). */
	corneringFront: number;
	corneringRear: number;
	/** Tyre friction coefficient. */
	grip: number;
	/** Share of drive going to the front wheels: 0 rear-drive, 1 front-drive. */
	frontDrive: number;
	/** Share of rear grip left with the handbrake on. */
	handbrakeGrip: number;
	/** Full-lock steering angle (rad) when stopped; it shrinks with speed. */
	maxSteer: number;
	/** Speed (m/s) at which the available lock has halved. */
	steerFalloff: number;
}

interface StyleTuning {
	mass: number;
	power: number;
	topSpeed: number;
	grip: number;
	drag: number;
	cgHeight: number;
	frontWeight: number;
	frontDrive: number;
}

const TUNING: Readonly<Record<VehicleStyle, StyleTuning>> = {
	luxury: { mass: 1600, power: 480_000, topSpeed: 88, grip: 1.25, drag: 0.34, cgHeight: 0.42, frontWeight: 0.43, frontDrive: 0.4 },
	sedan: { mass: 1450, power: 130_000, topSpeed: 58, grip: 1.0, drag: 0.4, cgHeight: 0.55, frontWeight: 0.56, frontDrive: 1 },
	suv: { mass: 2050, power: 190_000, topSpeed: 55, grip: 0.92, drag: 0.55, cgHeight: 0.72, frontWeight: 0.55, frontDrive: 0.5 },
	hatchback: { mass: 1100, power: 80_000, topSpeed: 50, grip: 0.95, drag: 0.42, cgHeight: 0.52, frontWeight: 0.6, frontDrive: 1 },
	auto: { mass: 420, power: 9_000, topSpeed: 17, grip: 0.8, drag: 0.6, cgHeight: 0.6, frontWeight: 0.35, frontDrive: 0 },
	police: { mass: 1850, power: 260_000, topSpeed: 66, grip: 1.05, drag: 0.45, cgHeight: 0.62, frontWeight: 0.54, frontDrive: 0 },
	// Loaded weight, a diesel's worth of power and a centre of gravity up where the bed is: it
	// takes a while to get going, longer to stop, and leans hard through a corner.
	truck: { mass: 8500, power: 240_000, topSpeed: 34, grip: 0.82, drag: 0.95, cgHeight: 1.15, frontWeight: 0.45, frontDrive: 0 },
	// An SUV's weight again on all-wheel drive, sitting high on its suspension.
	militaryWagon: { mass: 2600, power: 205_000, topSpeed: 48, grip: 0.95, drag: 0.55, cgHeight: 0.78, frontWeight: 0.55, frontDrive: 0.5 },
};

export function carSpecFor(style: VehicleStyle, length: number, width: number): CarSpec {
	const tuning = TUNING[style];
	const mass = tuning.mass;
	const wheelbase = length * 0.6;
	// Stiffness scales with the load each axle carries, with a little more at the rear for a
	// car that settles into understeer instead of spinning on every lift.
	const perNewton = 17;
	const weight = mass * GRAVITY;
	return {
		mass,
		wheelbase,
		frontWeight: tuning.frontWeight,
		cgHeight: tuning.cgHeight,
		inertia: (mass * (length * length + width * width)) / 12,
		power: tuning.power,
		maxDriveForce: mass * GRAVITY * tuning.grip * 0.95,
		topSpeed: tuning.topSpeed,
		reverseSpeed: 9,
		brakeForce: mass * GRAVITY * 1.1,
		drag: tuning.drag,
		rolling: mass * 0.012,
		corneringFront: weight * tuning.frontWeight * perNewton,
		corneringRear: weight * (1 - tuning.frontWeight) * perNewton * 1.15,
		grip: tuning.grip,
		frontDrive: tuning.frontDrive,
		handbrakeGrip: 0.42,
		maxSteer: 0.62,
		steerFalloff: 11,
	};
}

export interface CarControls {
	/** -1..1: W/S. Backwards throttle brakes first, then reverses once stopped. */
	drive: number;
	/** -1..1, +1 = left. */
	steer: number;
	handbrake: boolean;
	/** 0..1: brake without ever reversing (used for cars nobody is driving). */
	brake: number;
}

export class CarPhysics {
	public x = 0;
	public z = 0;
	public heading = 0;
	public velocityX = 0;
	public velocityZ = 0;
	public yawRate = 0;
	/** Current road-wheel angle (rad), eased towards the input. */
	public steer = 0;
	/** Engine power left, 0..1; a damaged engine pulls less (see VehicleDamage). */
	public powerFactor = 1;

	// Read-outs for visuals, sound and the HUD.
	public forwardSpeed = 0;
	public lateralSpeed = 0;
	public longitudinalAcceleration = 0;
	public lateralAcceleration = 0;
	/** How hard the rear tyres are sliding, 0..1+. */
	public rearSlide = 0;
	public braking = false;
	public reversing = false;

	private escHoldoff = 0;
	private readonly frontLength: number;
	private readonly rearLength: number;

	public constructor(public readonly spec: CarSpec) {
		this.frontLength = spec.wheelbase * (1 - spec.frontWeight);
		this.rearLength = spec.wheelbase * spec.frontWeight;
	}

	public get speed(): number {
		return Math.hypot(this.velocityX, this.velocityZ);
	}

	/** Places the car, rolling straight ahead at `speed`. */
	public reset(x: number, z: number, heading: number, speed: number) {
		this.x = x;
		this.z = z;
		this.heading = heading;
		this.velocityX = Math.sin(heading) * speed;
		this.velocityZ = Math.cos(heading) * speed;
		this.yawRate = 0;
		this.steer = 0;
		this.longitudinalAcceleration = 0;
	}

	public step(dt: number, controls: Readonly<CarControls>) {
		let remaining = Math.min(dt, 0.1);
		while (remaining > 1e-6) {
			const h = Math.min(SUBSTEP, remaining);
			this.substep(h, controls);
			remaining -= h;
		}
	}

	private substep(dt: number, controls: Readonly<CarControls>) {
		const spec = this.spec;
		const sin = Math.sin(this.heading);
		const cos = Math.cos(this.heading);
		// Body-frame velocity.
		const vLong = this.velocityX * sin + this.velocityZ * cos;
		const vLat = this.velocityX * cos - this.velocityZ * sin;
		const speed = Math.abs(vLong);

		// Pedals: backwards on the stick brakes a forward-rolling car, and only reverses once
		// it has stopped (and the same the other way round).
		let throttle = 0;
		let brake = 0;
		if (controls.drive > 0) {
			if (vLong < -0.5) brake = controls.drive;
			else throttle = controls.drive;
		} else if (controls.drive < 0) {
			if (vLong > 0.5) brake = -controls.drive;
			else throttle = controls.drive;
		}
		brake = Math.max(brake, controls.brake);
		this.braking = brake > 0;
		this.reversing = vLong < -0.5 || throttle < 0;

		// Steering: the wheel moves at a finite rate, and the lock shrinks with speed to about
		// what the tyres can actually use there.
		const gripTurn = (LOCK_HEADROOM * spec.wheelbase * spec.grip * CORNERING_GRIP * GRAVITY) / Math.max(speed * speed, 1);
		const lock = Math.min(spec.maxSteer / (1 + speed / spec.steerFalloff), Math.max(gripTurn, 0.03));
		const target = controls.steer * lock;
		const rate = Math.abs(target) < Math.abs(this.steer) ? STEER_OUT_RATE : STEER_IN_RATE;
		this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));

		// Axle loads, with longitudinal load transfer from last step's acceleration.
		const weight = spec.mass * GRAVITY;
		const transfer = (spec.mass * this.longitudinalAcceleration * spec.cgHeight) / spec.wheelbase;
		const loadFront = Math.max(weight * 0.15, weight * spec.frontWeight - transfer);
		const loadRear = Math.max(weight * 0.15, weight * (1 - spec.frontWeight) + transfer);
		const frontGrip = spec.grip * loadFront;
		const rearGrip = spec.grip * REAR_GRIP_BIAS * loadRear * (controls.handbrake ? spec.handbrakeGrip : 1);

		// Slip angles. The front is measured in the steered wheel's own frame.
		const steerSin = Math.sin(this.steer);
		const steerCos = Math.cos(this.steer);
		const frontLat = vLat + this.yawRate * this.frontLength;
		const tyreLat = frontLat * steerCos - vLong * steerSin;
		const tyreLong = vLong * steerCos + frontLat * steerSin;
		const slipFront = Math.atan2(tyreLat, Math.max(Math.abs(tyreLong), LOW_SPEED));
		const rearLat = vLat - this.yawRate * this.rearLength;
		const slipRear = Math.atan2(rearLat, Math.max(speed, LOW_SPEED));

		// Stability control: off while the handbrake is (or was just) in use.
		this.escHoldoff = controls.handbrake ? ESC_HANDBRAKE_HOLDOFF : Math.max(0, this.escHoldoff - dt);
		const escExcess = this.escHoldoff > 0 || speed < 3 ? 0 : Math.max(0, Math.abs(slipRear) - ESC_SLIP);

		// Engine, split between the axles.
		let drive = 0;
		if (throttle > 0) {
			const available = Math.min(spec.maxDriveForce, (spec.power * this.powerFactor) / Math.max(speed, 4));
			drive = speed < spec.topSpeed ? throttle * available : 0;
		} else if (throttle < 0) {
			drive = vLong > -spec.reverseSpeed ? throttle * spec.maxDriveForce * 0.45 : 0;
		}
		drive *= Math.max(0, 1 - escExcess * ESC_THROTTLE_CUT);
		const tractionShare = controls.handbrake ? 1 : TRACTION_CONTROL;
		const driveFront = clamp(drive * spec.frontDrive, frontGrip * tractionShare);
		const driveRear = clamp(drive * (1 - spec.frontDrive), rearGrip * tractionShare);

		// Each axle's traction and cornering share one friction circle.
		const frontLateralLimit = frontGrip * CORNERING_GRIP * ellipse(driveFront, frontGrip);
		const frontForce = clamp(-spec.corneringFront * CORNERING_GRIP * slipFront, frontLateralLimit);
		const rearLateralLimit = rearGrip * CORNERING_GRIP * ellipse(driveRear, rearGrip);
		const rearDemand = -spec.corneringRear * CORNERING_GRIP * (controls.handbrake ? 0.5 : 1) * slipRear;
		const rearForce = clamp(rearDemand, rearLateralLimit);
		this.rearSlide = Math.abs(rearDemand) > rearLateralLimit
			? Math.min(1.5, Math.abs(rearLat) / 4)
			: Math.max(0, Math.abs(slipRear) - 0.12) * 3;
		if (controls.handbrake) this.rearSlide = Math.max(this.rearSlide, Math.min(1, Math.abs(rearLat) / 3));

		// Body-frame forces: the front wheel's forces rotated back from its own frame, plus drag.
		const velocity = Math.hypot(vLong, vLat);
		const frontAlong = driveFront * steerCos - frontForce * steerSin;
		const frontAcross = driveFront * steerSin + frontForce * steerCos;
		let forceLong = frontAlong + driveRear - spec.drag * vLong * velocity - spec.rolling * vLong;
		const forceLat = frontAcross + rearForce - spec.drag * 0.5 * vLat * velocity;
		let torque = this.frontLength * frontAcross - this.rearLength * rearForce;
		if (escExcess > 0) {
			// Brake-based yaw correction: pull the yaw rate back towards what the steering asks for.
			const wanted = (vLong * Math.tan(this.steer)) / spec.wheelbase;
			torque += (wanted - this.yawRate) * spec.inertia * ESC_YAW_GAIN * Math.min(1, escExcess * 10);
		}

		// Brakes (and the handbrake on the rear), limited by grip, applied as a clamp so they
		// stop the car rather than pushing it backwards.
		let brakeForce = brake * Math.min(spec.brakeForce, spec.grip * weight);
		if (throttle === 0) brakeForce += spec.mass * ENGINE_BRAKING;
		if (controls.handbrake) brakeForce += spec.grip * loadRear * 0.7;
		let newLong = vLong + (forceLong / spec.mass) * dt;
		const brakeDelta = (brakeForce / spec.mass) * dt;
		if (brakeDelta > 0) {
			newLong = Math.abs(newLong) <= brakeDelta ? 0 : newLong - Math.sign(newLong) * brakeDelta;
			forceLong -= Math.sign(vLong) * brakeForce;
		}
		let newLat = vLat + (forceLat / spec.mass) * dt;
		this.yawRate += (torque / spec.inertia) * dt;

		// Parked or braking to a halt: hold still instead of creeping.
		const holding = throttle === 0 && (brake > 0 || controls.handbrake);
		if (holding && Math.hypot(newLong, newLat) < HOLD_SPEED) {
			newLong = 0;
			newLat *= 0.5;
			this.yawRate *= 0.5;
		}

		this.velocityX = newLong * sin + newLat * cos;
		this.velocityZ = newLong * cos - newLat * sin;
		this.heading += this.yawRate * dt;
		this.x += this.velocityX * dt;
		this.z += this.velocityZ * dt;

		this.forwardSpeed = newLong;
		this.lateralSpeed = newLat;
		this.longitudinalAcceleration = forceLong / spec.mass;
		this.lateralAcceleration = forceLat / spec.mass;
	}
}

/** Lateral share left on a friction ellipse once `used` of `limit` goes to traction. */
function ellipse(used: number, limit: number): number {
	const ratio = limit > 0 ? used / limit : 1;
	return Math.sqrt(Math.max(0, 1 - ratio * ratio));
}

function clamp(value: number, limit: number): number {
	return Math.max(-limit, Math.min(limit, value));
}
