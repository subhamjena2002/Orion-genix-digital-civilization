import { Entity, Script, Vec3, type Material, type RaycastResult } from "playcanvas";

import { combatAudio } from "../combat/CombatAudio";
import { damageableMoved, registerDamageable, unregisterDamageable, type Listener } from "../combat/CombatWorld";
import type { DamageEvent } from "../combat/Damage";
import { nextCombatId } from "../combat/Damage";
import { distanceFromCamera, inCameraView, needsPosing, readPlayerPose } from "../player/PlayerPose";
import { CarjackRig, drivableCars, registerDrivableCar, unregisterDrivableCar } from "./Carjack";
import { BURNT_PAINT, getCarMeshes } from "./CarMeshes";
import { CarPhysics, carSpecFor, type CarControls } from "./CarPhysics";
import { crashEffects, type DamageSource } from "./CrashEffects";
import {
	BLAST_RADIUS,
	BURN_SECONDS,
	blastAt,
	burnDown,
	BURNING_BELOW,
	conditionOf,
	crashDamage,
	damageEffect,
	PEDESTRIAN_DAMAGE,
	powerFactor,
	type VehicleCondition,
} from "./VehicleDamage";
import { skidMarks } from "./SkidMarks";
import type { VehicleStyle } from "./Vehicles";
import { pavedHeightAt, ROAD_GRID } from "../roads/RoadNetwork";
import { railStopAhead } from "../rail/RailTraffic";
import { registerTrafficAgent, trafficAgents, unregisterTrafficAgent, type TrafficAgent } from "./TrafficAgents";
import {
	axisOf,
	crossRoadWidth,
	HEADINGS,
	JUNCTION_LAYOUT,
	junctionExists,
	laneOffsets,
	leftOf,
	ROAD_TOP_Y,
	signalColour,
	signalGroup,
	travelRoadWidth,
} from "./TrafficSignals";

/**
 * Beyond this a car may be recycled onto a road near the player, but only while the camera
 * can't see it, so nothing vanishes in view. Past the hard limit it goes regardless (it's
 * a couple of pixels by then).
 */
const RECYCLE_DISTANCE = 240;
const RECYCLE_HARD_LIMIT = 600;
/** How far the camera is considered to see, for recycling (the lens's far clip is 800). */
const VISIBLE_RANGE = 800;
const RESPAWN_MIN = 45;
const RESPAWN_MAX = 200;
/**
 * A recycled car must land out of the camera's sight. Checked on its final road position,
 * after snapping to the grid.
 */
const RESPAWN_HIDDEN_RANGE = VISIBLE_RANGE;
const RESPAWN_ATTEMPTS = 24;

const ACCELERATION = 2.8;
/** Deceleration the car plans with; it can brake harder when it has to. */
const COMFORT_BRAKING = 4.5;
const MAX_BRAKING = 9;
/** Beyond this braking an amber light is run rather than stopped for. */
const AMBER_BRAKING_LIMIT = 6;
const TURN_SPEED = { left: 4.5, right: 5.5 } as const;
/** Bumper-to-bumper gap kept to whatever is ahead. */
const FOLLOW_GAP = 2.2;
const PERSON_GAP = 2.5;
const PERSON_RADIUS = 0.45;
/** Seconds held up by a crossing (non-parallel) car before it's ignored, to break deadlocks. */
const DEADLOCK_SECONDS = 4;
const DEADLOCK_RELEASE_SECONDS = 2.5;
const TURN_CHANCE = 0.4;
const BRAKE_LIGHT_THRESHOLD = 0.4;
const FLASH_SECONDS = 0.28;

// Off-lane driving (the player, parked and crashed cars) runs on CarPhysics.
/** Share of an impact's closing speed that bounces back. */
const RESTITUTION = 0.18;
/** Sideways speed kept while scraping along a wall. */
const SCRAPE_FRICTION = 0.9;
/** Gap kept between the body and whatever it hit. */
const COLLISION_SKIN = 0.06;
/** Yaw kick from off-centre impacts, as a share of the full rigid-body value. */
const IMPACT_SPIN = 0.6;
/** Below this the car just nudges people instead of running them over. */
const STRIKE_SPEED = 1.4;
const PERSON_HIT_RADIUS = 0.32;
const PERSON_MASS = 75;
/** Traffic stuck behind a stalled car waits this long, then squeezes past for a while. */
const STALLED_SPEED = 0.5;
const STALLED_WAIT_SECONDS = 3;
const STALLED_PASS_SECONDS = 5;
const RIDE_SMOOTHING = 14;
/** Effects are only drawn for cars this close to the camera. */
const EFFECT_DISTANCE = 160;
/** Where the engine sits, as a share of half the car's length ahead of centre. */
const ENGINE_FORWARD = 0.55;
const GROUND_PROBE_UP = 1.2;
const GROUND_PROBE_DOWN = 2.5;
/** Rear sliding below this leaves no rubber. */
const SKID_THRESHOLD = 0.2;
const TYRE_WIDTH = 0.24;
/** A change of velocity (m/s) at which a crash is at full volume. */
const CRASH_FULL_VOLUME = 9;
/** Below this share of that, it's a scrape and not worth a sound. */
const CRASH_QUIETEST = 0.12;
/** Shortest gap between one car's crash sounds, in seconds. */
const CRASH_SOUND_GAP = 0.25;

type Phase = "leg" | "turn";

/**
 * Who is driving: the traffic AI, nobody (stopped for a carjack), the player, or nobody
 * (left parked where the player got out).
 */
export type VehicleDriver = "ai" | "held" | "player" | "parked" | "wrecked";

/** Body outline points (fractions of half-width, half-length) swept for collisions. */
const SWEEP_POINTS: readonly [number, number][] = [
	[-1, 1], [0, 1], [1, 1],
	[-1, 0], [1, 0],
	[-1, -1], [0, -1], [1, -1],
];

/** Heights (fractions of half-height above the body centre) swept for collisions. */
const SWEEP_LIFTS: readonly number[] = [0, 0.75];

type RaycastAll = (start: Vec3, end: Vec3, options?: { filterCallback?: (entity: Entity) => boolean }) => RaycastResult[];

/**
 * Drives one car around the road grid, keeping left.
 *
 * A trip is a chain of *legs* (straight runs from one junction box to the next) and *turns*
 * (a curve through the junction box). Speed is planned against the nearest constraint ahead —
 * a red or amber signal's stop line, the car or person in front, or the slow-down for a turn —
 * so the car eases to a stop instead of snapping.
 */
export class OrionVehicle extends Script {
	public static scriptName = "orionVehicle";

	public seed = 1;
	public maxSpeed = 10;
	public halfLength = 2.2;
	public halfWidth = 0.9;
	/** The collision box is centred on the entity, so it rides this far above the road. */
	public halfHeight = 0.75;
	public style: VehicleStyle = "sedan";
	/** Body colour, so a burnt-out shell can be put back to it when the car is recycled. */
	public paint = "#ffffff";
	public police = false;
	/**
	 * A car kept at a fixed spot (the police station's car park) instead of joining traffic:
	 * parked there with nobody in it, and put back there once it's been left somewhere out of
	 * sight. NaN for traffic cars.
	 */
	public homeX = Number.NaN;
	public homeZ = 0;
	/** Heading at home, degrees about Y (0 = +Z). */
	public homeYaw = 0;
	/** Height of the ground the car stands on at home. */
	public homeGround = 0;
	public brakeOn: Material | null = null;
	public brakeOff: Material | null = null;
	public flashRedOn: Material | null = null;
	public flashBlueOn: Material | null = null;
	public flashOff: Material | null = null;

	public driver: VehicleDriver = "ai";
	public readonly carjack = new CarjackRig(this);
	/** This car in the combat world (weapons find and damage it through it). */
	private target: Listener | null = null;
	/** Largest collision closing speed this frame (m/s), for camera shake. */
	public impact = 0;
	/** Condition, 100% straight off the production line down to 0% and on fire. */
	public integrity = 100;
	/** True once the car has exploded; it stays a burnt shell until it's recycled. */
	public burnedOut = false;
	private burnTimer = 0;
	/** Seconds since the car exploded. */
	private burnedFor = 0;
	private readonly damageSource: DamageSource = {
		x: 0, y: 0, z: 0, sin: 0, cos: 1, halfWidth: 0, halfLength: 0, groundY: 0, stage: "smoking", severity: 0,
	};
	private physics: CarPhysics | null = null;
	private manual = false;
	private readonly controls: CarControls = { drive: 0, steer: 0, handbrake: false, brake: 0 };
	private ignoreStalledSeconds = 0;
	private stalledBlockSeconds = 0;
	private skidding = false;
	/**
	 * Body height while off-lane. Kept here rather than read back from the entity, because a
	 * React re-render re-applies the entity's initial position between frames.
	 */
	private rideY = 0;
	private readonly rayFrom = new Vec3();
	private readonly rayTo = new Vec3();

	private random: () => number = Math.random;
	private agent: TrafficAgent | null = null;
	private speed = 0;
	/** The speed the AI is aiming for this frame; see the `throttle` getter. */
	private targetSpeed = 0;
	/** Seconds since this car last made a crash noise; see crashSound. */
	private sinceCrashSound = CRASH_SOUND_GAP;
	private phase: Phase = "leg";
	// Junction the current leg starts from, and the direction of travel.
	private xIndex = 0;
	private zIndex = 0;
	private dx = 1;
	private dz = 0;
	private laneIndex = 0;
	// Leg: straight line P0 -> P1 (P1 is the edge of the next junction box).
	private p0: [number, number] = [0, 0];
	private p1: [number, number] = [0, 0];
	private legLength = 1;
	private distance = 0;
	private runningAmber = false;
	// Turn: quadratic curve P1 -> control -> P2 through the junction.
	private nextDx = 1;
	private nextDz = 0;
	private control: [number, number] = [0, 0];
	private p2: [number, number] = [0, 0];
	private turnLength = 1;
	private turnSpeed: number = TURN_SPEED.left;
	private blockedSeconds = 0;
	/** While positive, crossing cars are ignored so a stand-off can resolve. */
	private ignoreCrossingSeconds = 0;
	private flashTimer = 0;
	private brakeLit = false;

	private braking = false;
	private yawRate = 0;
	private lastYaw: number | null = null;
	private headingDegrees = 0;

	/** Read by the car's visual model to spin wheels, light brakes and lean the body. */
	public get currentSpeed(): number {
		return this.speed;
	}

	/**
	 * How far the throttle is open, 0..1. AI cars have no pedal, so it is read back from whether
	 * they are getting up to their planned speed — which is what the engine would be doing.
	 */
	public get throttle(): number {
		if (this.manual) return Math.max(0, this.controls.drive);
		if (this.driver !== "ai") return 0;
		const wanted = Math.max(0.001, this.maxSpeed);
		return Math.min(1, Math.max(0, (this.targetSpeed - this.speed) / wanted + this.speed / wanted * 0.35));
	}

	public get isBraking(): boolean {
		return this.braking;
	}

	/** Degrees per second, positive when turning left. */
	public get turnRate(): number {
		return this.yawRate;
	}

	private rideHeight = ROAD_TOP_Y;
	private lightNodes = new Map<string, Entity[]>();

	public initialize() {
		this.rideHeight = ROAD_TOP_Y + this.halfHeight;
		this.random = mulberry32(this.seed);
		this.laneIndex = this.random() < 0.5 ? 0 : 1;
		this.agent = registerTrafficAgent("vehicle", this.halfLength);
		if (this.hasHome) this.parkAtHome();
		else this.respawnNearPlayer(0);
		registerDrivableCar(this);
		this.registerTarget();
		this.on("destroy", () => {
			if (this.agent) unregisterTrafficAgent(this.agent);
			if (this.target) unregisterDamageable(this.target);
			unregisterDrivableCar(this);
			this.carjack.destroy();
		});
	}

	public update(dt: number) {
		this.sinceCrashSound += dt;
		const player = readPlayerPose();
		const position = this.entity.getPosition();
		this.syncTarget(position.y);
		const playerDistance = Math.hypot(position.x - player.x, position.z - player.z);
		this.carjack.update(dt, playerDistance);
		// The agent carries the pose this car set itself; the entity's own position can be the
		// spawn value React re-applied between frames.
		this.updateCondition(dt, this.agent?.x ?? position.x, position.y, this.agent?.z ?? position.z);
		// Crashed and parked cars stay where they are, like any other car, until they're far
		// away and out of sight.
		// Anything but the car the player is in: that includes a car held for a carjack the
		// player walked away from, which would otherwise sit there for good.
		const recyclable = this.driver !== "player";
		const outOfPlay = playerDistance > RECYCLE_HARD_LIMIT
			|| (playerDistance > RECYCLE_DISTANCE && !inCameraView(position.x, position.z, VISIBLE_RANGE));
		if (recyclable && outOfPlay && this.hasHome) {
			if (!this.atHome()) this.parkAtHome();
		} else if (recyclable && outOfPlay) {
			this.driver = "ai";
			this.manual = false;
			this.repair();
			this.carjack.reset();
			this.respawnNearPlayer(RESPAWN_MIN);
		}
		if (this.driver !== "ai") {
			this.updateManual(dt);
			return;
		}

		const targetSpeed = this.plannedSpeed(dt) * powerFactor(this.integrity);
		// Kept for the engine sound, which needs to know whether the car is pulling or coasting.
		this.targetSpeed = targetSpeed;
		if (targetSpeed > this.speed) this.speed = Math.min(targetSpeed, this.speed + ACCELERATION * dt);
		else this.speed = Math.max(targetSpeed, this.speed - MAX_BRAKING * dt);

		this.advance(this.speed * dt);
		this.braking = targetSpeed < this.speed - 0.05 || this.speed < BRAKE_LIGHT_THRESHOLD;
		this.updateLights(dt, this.braking);
		this.trackTurnRate(dt);
	}

	/** Player input, each frame while driving: drive and steer in -1..1 (steer +1 = left). */
	public setDriveInput(drive: number, steer: number, handbrake: boolean) {
		this.controls.drive = drive;
		this.controls.steer = steer;
		this.controls.handbrake = handbrake;
	}

	/**
	 * Hit by a weapon (see combat/Damage). Bullets chip at the car's condition, explosions wreck
	 * it, and a blast shoves it. From there the car's own damage model takes over: smoke, then
	 * fire, then it goes up (updateCondition / explode) — the extension point for any further
	 * destruction, such as disabling the engine sooner or detaching parts.
	 */
	public takeWeaponDamage(event: DamageEvent) {
		this.applyDamage(event.amount);
		if (event.type === "explosive" && event.impulse > 0 && this.driver !== "player") {
			const shove = event.impulse * 0.6;
			this.receiveImpact(event.directionX * shove, event.directionZ * shove, (Math.random() - 0.5) * event.impulse * 6);
		}
	}

	/** This car as a combat target: an oriented box the size of its collider. */
	private registerTarget() {
		const isAlive = () => !this.burnedOut;
		this.target = {
			id: nextCombatId(),
			kind: "vehicle",
			x: 0, y: 0, z: 0,
			radius: this.halfWidth,
			height: this.halfHeight * 2,
			halfLength: this.halfLength,
			headingX: 0, headingZ: 1,
			get alive() {
				return isAlive();
			},
			takeDamage: (event) => this.takeWeaponDamage(event),
		};
		this.syncTarget(this.entity.getPosition().y);
		registerDamageable(this.target);
	}

	/** Keeps the combat box on the car (the agent holds the pose the car set itself). */
	private syncTarget(centreY: number) {
		const target = this.target;
		const agent = this.agent;
		if (!target || !agent) return;
		target.x = agent.x;
		target.z = agent.z;
		target.y = centreY - this.halfHeight;
		const radians = (this.headingDegrees * Math.PI) / 180;
		target.headingX = Math.sin(radians);
		target.headingZ = Math.cos(radians);
		damageableMoved(target);
	}

	/** Degrees, matching the entity's Y rotation. */
	public get heading(): number {
		return this.headingDegrees;
	}

	/** Road-wheel angle in radians, positive left; turns the front wheels. */
	public get steerAngle(): number {
		if (this.manual && this.physics) return this.physics.steer;
		if (Math.abs(this.speed) < 0.5) return 0;
		const wheelbase = this.halfLength * 1.2;
		return Math.atan(((this.yawRate / DEGREES) * wheelbase) / this.speed);
	}

	/** Sideways acceleration (m/s², positive left), for body roll. */
	public get lateralAcceleration(): number {
		if (this.manual && this.physics) return this.physics.lateralAcceleration;
		return this.speed * (this.yawRate / DEGREES);
	}

	/** How hard the rear tyres are sliding (0 = gripping); drives skid marks. */
	public get rearSlide(): number {
		return this.manual && this.physics ? this.physics.rearSlide : 0;
	}

	public get isManual(): boolean {
		return this.manual;
	}

	public get velocityX(): number {
		return this.manual && this.physics ? this.physics.velocityX : Math.sin(this.headingDegrees / DEGREES) * this.speed;
	}

	public get velocityZ(): number {
		return this.manual && this.physics ? this.physics.velocityZ : Math.cos(this.headingDegrees / DEGREES) * this.speed;
	}

	public get condition(): VehicleCondition {
		return conditionOf(this.integrity, this.burnedOut);
	}

	/**
	 * Wears the car down. At 0% the engine is alight and, after a few seconds of burning,
	 * the car goes up (see explode).
	 */
	public applyDamage(amount: number) {
		if (this.burnedOut || amount <= 0) return;
		this.integrity = Math.max(0, this.integrity - amount);
	}

	public get mass(): number {
		return this.carPhysics().spec.mass;
	}

	/**
	 * Run over by the train. Nothing survives that, so the car goes up on the spot and is
	 * thrown off the line rather than burning down to it over the next few seconds.
	 */
	public struckByTrain(pushX: number, pushZ: number) {
		const position = this.entity.getPosition();
		if (!this.burnedOut) this.explode(position.x, position.y, position.z);
		this.receiveImpact(pushX, pushZ, (Math.random() - 0.5) * 6);
	}

	/** Knocked by another car: an AI car loses its lane and slides as a wreck. */
	public receiveImpact(deltaVelocityX: number, deltaVelocityZ: number, spin: number) {
		if (this.driver === "player") return;
		const car = this.beginManual();
		if (this.driver === "ai") this.driver = "wrecked";
		car.velocityX += deltaVelocityX;
		car.velocityZ += deltaVelocityZ;
		car.yawRate += spin;
	}

	private get hasHome(): boolean {
		return Number.isFinite(this.homeX);
	}

	private atHome(): boolean {
		const position = this.entity.getPosition();
		return this.driver === "parked" && !this.burnedOut && this.integrity >= 100
			&& Math.hypot(position.x - this.homeX, position.z - this.homeZ) < 0.5;
	}

	/** Puts a home car back in its bay: whole, empty and parked. */
	private parkAtHome() {
		this.driver = "parked";
		this.repair();
		// No one sits in a parked car, so getting in skips dragging a driver out.
		this.carjack.reset();
		const car = this.carPhysics();
		car.reset(this.homeX, this.homeZ, this.homeYaw / DEGREES, 0);
		this.manual = true;
		this.speed = 0;
		this.headingDegrees = this.homeYaw;
		this.rideY = this.homeGround + this.halfHeight;
		this.entity.setPosition(this.homeX, this.rideY, this.homeZ);
		this.entity.setEulerAngles(0, this.homeYaw, 0);
		this.entity.rigidbody?.teleport(this.homeX, this.rideY, this.homeZ, 0, this.homeYaw, 0);
		if (this.agent) {
			this.agent.x = this.homeX;
			this.agent.z = this.homeZ;
			this.agent.speed = 0;
		}
		this.lastYaw = null;
	}

	/**
	 * Takes a burning or burnt-out car out of the way and brings it back whole — the same recycling
	 * that happens once a wreck is far enough off, done on the spot. Says whether there was
	 * anything to clear.
	 */
	public clearWreck(): boolean {
		if (this.driver === "player") return false;
		if (!this.burnedOut && this.integrity >= BURNING_BELOW) return false;
		if (this.hasHome) {
			this.parkAtHome();
			return true;
		}
		this.driver = "ai";
		this.manual = false;
		this.repair();
		this.carjack.reset();
		this.respawnNearPlayer(RESPAWN_MIN);
		return true;
	}

	/** A recycled car comes back as a fresh one. */
	private repair() {
		if (this.burnedOut) this.scorch(false);
		this.burnedOut = false;
		this.integrity = 100;
		this.burnTimer = 0;
		this.burnedFor = 0;
		if (this.physics) this.physics.powerFactor = 1;
	}

	private carPhysics(): CarPhysics {
		this.physics ??= new CarPhysics(carSpecFor(this.style, this.halfLength * 2, this.halfWidth * 2));
		return this.physics;
	}

	/** Hands the car from lane-following to the physics model, keeping its motion. */
	private beginManual(): CarPhysics {
		const car = this.carPhysics();
		if (!this.manual) {
			const position = this.entity.getPosition();
			car.reset(position.x, position.z, this.headingDegrees / DEGREES, this.speed);
			this.rideY = this.rideHeight;
			this.manual = true;
		}
		return car;
	}

	private updateManual(dt: number) {
		const car = this.beginManual();
		const controls = this.controls;
		if (this.driver === "player") {
			controls.brake = 0;
		} else {
			controls.drive = 0;
			controls.steer = 0;
			controls.handbrake = this.driver === "parked";
			// A crashed car rolls to a stop; a stopped or parked one stays put.
			controls.brake = this.driver === "wrecked" ? 0.35 : 1;
		}

		const previousX = car.x;
		const previousZ = car.z;
		car.step(dt, controls);
		this.impact = 0;
		if (Math.hypot(car.x - previousX, car.z - previousZ) > 1e-5) {
			this.resolveCollisions(car, previousX, previousZ);
			this.strikePeople(car);
		}

		this.headingDegrees = car.heading * DEGREES;
		const ground = this.groundHeight(car.x, car.z, this.rideY);
		this.rideY += (ground + this.halfHeight - this.rideY) * (1 - Math.exp(-RIDE_SMOOTHING * dt));
		const y = this.rideY;
		this.entity.setPosition(car.x, y, car.z);
		this.entity.setEulerAngles(0, this.headingDegrees, 0);
		this.speed = car.forwardSpeed;
		this.layRubber(car, y - this.halfHeight);

		if (this.agent) {
			this.agent.x = car.x;
			this.agent.z = car.z;
			this.agent.headingX = Math.sin(car.heading);
			this.agent.headingZ = Math.cos(car.heading);
			this.agent.speed = car.speed;
			this.agent.stalled = this.driver !== "player" && car.speed < STALLED_SPEED;
			this.agent.playerControlled = this.driver === "player";
		}
		const player = this.driver === "player";
		this.braking = car.braking || controls.handbrake || (!player && car.speed > 0.2);
		// Reversing lights share the brake lamps here.
		this.updateLights(dt, this.braking || (player && car.reversing));
		this.trackTurnRate(dt);
	}

	/** Skid marks from the rear tyres while they slide. */
	private layRubber(car: CarPhysics, groundY: number) {
		const strength = car.speed > 2 ? (car.rearSlide - SKID_THRESHOLD) * 1.5 : 0;
		if (strength <= 0 && !this.skidding) return;
		this.skidding = strength > 0;
		const marks = skidMarks(this.app);
		const sin = Math.sin(car.heading);
		const cos = Math.cos(car.heading);
		const along = -this.halfLength * 0.62;
		for (const side of [-1, 1]) {
			const lateral = side * this.halfWidth * 0.82;
			const x = car.x + along * sin + lateral * cos;
			const z = car.z + along * cos - lateral * sin;
			marks.track(`${this.agent?.id ?? 0}:${side}`, x, groundY, z, TYRE_WIDTH, strength);
		}
		marks.flush();
	}

	/** Smoke, flames, the countdown to going up, and the loss of engine power. */
	private updateCondition(dt: number, x: number, y: number, z: number) {
		if (this.burnedOut) {
			this.burnedFor += dt;
		} else {
			// Once alight, the fire eats what's left of the car, then the tank goes.
			this.integrity = burnDown(this.integrity, dt);
			if (this.integrity <= 0) {
				this.burnTimer += dt;
				if (this.burnTimer >= BURN_SECONDS) {
					this.explode(x, y, z);
					return;
				}
			}
		}
		if (this.physics) this.physics.powerFactor = powerFactor(this.integrity);

		const effect = damageEffect(this.integrity, this.burnedOut, this.burnedFor);
		// Effects are the expensive part, so only cars near the camera get them.
		if (!effect || distanceFromCamera(x, z) > EFFECT_DISTANCE) return;
		const source = this.damageSource;
		const sin = Math.sin(this.headingDegrees / DEGREES);
		const cos = Math.cos(this.headingDegrees / DEGREES);
		// A running car burns from the engine bay; a wreck from all over.
		const forward = this.burnedOut ? 0 : this.halfLength * ENGINE_FORWARD;
		source.x = x + sin * forward;
		source.z = z + cos * forward;
		source.y = y + this.halfHeight * 0.4;
		source.sin = sin;
		source.cos = cos;
		source.halfWidth = this.halfWidth;
		source.halfLength = this.halfLength;
		source.groundY = y - this.halfHeight;
		source.stage = effect.stage;
		source.severity = effect.severity;
		crashEffects(this.app).vehicleDamage(this, source, dt);
	}

	/**
	 * The car goes up: a fireball, and everything close by is hurt and thrown clear. What's
	 * left is a burnt shell that stays put until it's recycled.
	 */
	private explode(x: number, y: number, z: number) {
		this.burnedOut = true;
		this.integrity = 0;
		this.burnTimer = 0;
		crashEffects(this.app).explosion(x, y + this.halfHeight * 0.5, z, y - this.halfHeight);

		for (const car of drivableCars()) {
			if (car === this) continue;
			const position = car.entity.getPosition();
			const distance = Math.hypot(position.x - x, position.z - z);
			const blast = blastAt(distance);
			if (blast.damage <= 0) continue;
			car.applyDamage(blast.damage);
			const away = Math.max(distance, 0.5);
			car.receiveImpact(((position.x - x) / away) * blast.push, ((position.z - z) / away) * blast.push, (Math.random() - 0.5) * 2);
		}
		for (const person of trafficAgents()) {
			if (person.kind !== "person" || !person.alive || !person.onStruck) continue;
			const distance = Math.hypot(person.x - x, person.z - z);
			if (distance >= BLAST_RADIUS) continue;
			const away = Math.max(distance, 0.5);
			const push = blastAt(distance).push;
			person.onStruck(((person.x - x) / away) * push, ((person.z - z) / away) * push);
		}

		this.scorch();
		this.driver = this.driver === "ai" ? "wrecked" : this.driver;
		this.beginManual();
		if (this.physics) {
			this.physics.velocityX *= 0.3;
			this.physics.velocityZ *= 0.3;
		}
		this.carjack.burnDriver();
	}

	/** Blackens the paint of a burnt-out shell (and puts it back when the car is recycled). */
	private scorch(burnt = true) {
		const model = this.entity.findByName("car-model") as Entity | null;
		const glb = model?.script?.get("orionVehicleModel") as unknown as { repaint?: (colour: string | null) => void } | undefined;
		if (glb?.repaint) {
			glb.repaint(burnt ? BURNT_PAINT : null);
			return;
		}
		const body = model?.findByName("car-body") as Entity | null;
		const instance = body?.render?.meshInstances[0];
		if (!instance) return;
		// Box cars carry their paint in the mesh, so swap in the burnt-coloured build.
		instance.mesh = getCarMeshes(this.app.graphicsDevice, this.style, burnt ? BURNT_PAINT : this.paint).body;
	}

	private get raycastAll(): RaycastAll | null {
		const system = this.app.systems.rigidbody as unknown as { raycastAll?: RaycastAll };
		return system.raycastAll ? system.raycastAll.bind(system) : null;
	}

	private readonly notSelf = (entity: Entity) => entity !== this.entity && entity.name !== "player";

	private readonly notSolidBody = (entity: Entity) => (
		entity !== this.entity && entity.name !== "player" && !entity.script?.has("orionVehicle")
	);

	/**
	 * Sweeps the body outline along this step's movement. On contact the car stops at the
	 * surface, the speed into it bounces back a little, the rest scrapes along, and an
	 * off-centre hit spins the car. Another car takes its share of the momentum.
	 */
	private resolveCollisions(car: CarPhysics, fromX: number, fromZ: number) {
		const raycastAll = this.raycastAll;
		if (!raycastAll) return;
		const moveX = car.x - fromX;
		const moveZ = car.z - fromZ;
		const distance = Math.hypot(moveX, moveZ);
		const dirX = moveX / distance;
		const dirZ = moveZ / distance;
		const sin = Math.sin(car.heading);
		const cos = Math.cos(car.heading);
		const centreY = this.rideY;
		const reach = distance + COLLISION_SKIN;

		let best: RaycastResult | null = null;
		let bestTravel = Infinity;
		let offsetX = 0;
		let offsetZ = 0;
		for (const [side, along] of SWEEP_POINTS) {
			const px = along * this.halfLength * sin + side * this.halfWidth * cos;
			const pz = along * this.halfLength * cos - side * this.halfWidth * sin;
			// Only points on the leading side of the body can run into anything.
			if (px * dirX + pz * dirZ < -0.01) continue;
			// Two heights: buildings stand on plinths above the road, so a single ray at the
			// body's centre would pass underneath them. Neither is low enough to catch a kerb.
			for (const lift of SWEEP_LIFTS) {
				const y = centreY + lift * this.halfHeight;
				this.rayFrom.set(fromX + px, y, fromZ + pz);
				this.rayTo.set(fromX + px + dirX * reach, y, fromZ + pz + dirZ * reach);
				for (const hit of raycastAll(this.rayFrom, this.rayTo, { filterCallback: this.notSelf })) {
					if (Math.abs(hit.normal.y) > 0.6) continue;
					const travel = hit.hitFraction * reach;
					if (travel < bestTravel) {
						best = hit;
						bestTravel = travel;
						offsetX = px;
						offsetZ = pz;
					}
				}
			}
		}
		if (!best) return;

		const normalLength = Math.hypot(best.normal.x, best.normal.z) || 1;
		const nx = best.normal.x / normalLength;
		const nz = best.normal.z / normalLength;
		const closing = car.velocityX * nx + car.velocityZ * nz;
		const allowed = Math.max(0, bestTravel - COLLISION_SKIN);
		car.x = fromX + dirX * allowed;
		car.z = fromZ + dirZ * allowed;
		if (closing >= 0) return;

		const other = best.entity.script?.get("orionVehicle") as OrionVehicle | undefined;
		const totalMass = car.spec.mass + (other?.mass ?? 0);
		const ownShare = other ? other.mass / totalMass : 1;
		const change = -(1 + RESTITUTION) * closing * ownShare;
		const tangentX = car.velocityX - closing * nx;
		const tangentZ = car.velocityZ - closing * nz;
		car.velocityX = (closing + change) * nx + tangentX * SCRAPE_FRICTION;
		car.velocityZ = (closing + change) * nz + tangentZ * SCRAPE_FRICTION;
		// Torque of the impulse about the centre, at the contact point (yaw positive = left).
		const impulseX = change * nx * car.spec.mass;
		const impulseZ = change * nz * car.spec.mass;
		car.yawRate += ((impulseX * offsetZ - impulseZ * offsetX) / car.spec.inertia) * IMPACT_SPIN;
		this.impact = Math.max(this.impact, -closing);
		this.crashSound(Math.abs(change));
		// Both cars are hurt by their own change of velocity, so the lighter one comes off worse.
		this.applyDamage(crashDamage(Math.abs(change)));

		if (other) {
			const otherChange = -(1 + RESTITUTION) * closing * (car.spec.mass / totalMass);
			const spin = (Math.random() - 0.5) * otherChange * 0.4;
			other.receiveImpact(-nx * otherChange, -nz * otherChange, spin);
			other.applyDamage(crashDamage(Math.abs(otherChange)));
		}
	}

	/**
	 * The noise of hitting something, as loud as the hit was hard.
	 *
	 * Scraping a wall runs this every frame, so there is a floor on what counts as a hit and a
	 * gap before the next one — otherwise a long scrape is a machine-gun of crunches.
	 */
	private crashSound(change: number) {
		if (this.sinceCrashSound < CRASH_SOUND_GAP) return;
		const severity = Math.min(1, change / CRASH_FULL_VOLUME);
		if (severity < CRASH_QUIETEST) return;
		this.sinceCrashSound = 0;
		const position = this.entity.getPosition();
		combatAudio().play("crash", position.x, position.y, position.z, severity);
	}

	/** Anyone inside the body outline is run over. */
	private strikePeople(car: CarPhysics) {
		const speed = car.speed;
		if (speed < STRIKE_SPEED) return;
		const sin = Math.sin(car.heading);
		const cos = Math.cos(car.heading);
		for (const person of trafficAgents()) {
			if (person.kind !== "person" || !person.alive || !person.onStruck) continue;
			const relX = person.x - car.x;
			const relZ = person.z - car.z;
			const along = relX * sin + relZ * cos;
			const side = relX * cos - relZ * sin;
			if (Math.abs(along) > this.halfLength + PERSON_HIT_RADIUS) continue;
			if (Math.abs(side) > this.halfWidth + PERSON_HIT_RADIUS) continue;
			person.onStruck(car.velocityX, car.velocityZ);
			this.applyDamage(PEDESTRIAN_DAMAGE);
			// The car loses the momentum the body carries away.
			const keep = 1 - (PERSON_MASS * 1.05) / car.spec.mass;
			car.velocityX *= keep;
			car.velocityZ *= keep;
			this.impact = Math.max(this.impact, speed * 0.25);
		}
	}

	/** Top of whatever the car is over (road, pavement, terrain), or its current level if nothing. */
	private groundHeight(x: number, z: number, currentY: number): number {
		const paved = pavedHeightAt(x, z);
		if (paved !== null) return paved;
		const raycastAll = this.raycastAll;
		const fallback = currentY - this.halfHeight;
		if (!raycastAll) return fallback;
		this.rayFrom.set(x, currentY + GROUND_PROBE_UP, z);
		this.rayTo.set(x, currentY - GROUND_PROBE_DOWN, z);
		let best = -Infinity;
		for (const hit of raycastAll(this.rayFrom, this.rayTo, { filterCallback: this.notSolidBody })) {
			if (hit.normal.y > 0.6 && hit.point.y > best) best = hit.point.y;
		}
		return best === -Infinity ? fallback : best;
	}

	/** The highest speed that still lets the car stop for everything ahead of it. */
	private plannedSpeed(dt: number): number {
		const [x, z, hx, hz] = this.pose();
		let limit = this.maxSpeed;
		const stopWithin = (distance: number) => Math.sqrt(2 * COMFORT_BRAKING * Math.max(0, distance));

		if (this.phase === "leg") {
			const toEnd = this.legLength - this.distance;
			const stopLine = toEnd - JUNCTION_LAYOUT.stopLine - this.halfLength;
			const bx = this.xIndex + this.dx;
			const bz = this.zIndex + this.dz;
			const colour = signalColour(signalGroup(bx, bz), axisOf(this.dx));
			if (colour === "green") {
				this.runningAmber = false;
			} else if (stopLine > -0.5) {
				// On amber, carry on if stopping would need a panic stop.
				const needed = (this.speed * this.speed) / (2 * Math.max(stopLine, 0.01));
				if (colour === "amber" && (this.runningAmber || needed > AMBER_BRAKING_LIMIT)) {
					this.runningAmber = true;
				} else {
					limit = Math.min(limit, stopLine < 0.15 ? 0 : stopWithin(stopLine));
				}
			}
			const exitSpeed = this.nextDx === this.dx && this.nextDz === this.dz ? this.maxSpeed : this.turnSpeed;
			limit = Math.min(limit, Math.sqrt(exitSpeed * exitSpeed + 2 * COMFORT_BRAKING * toEnd));
		} else {
			limit = Math.min(limit, this.turnSpeed);
		}

		const lookAhead = Math.max(14, (this.speed * this.speed) / (2 * COMFORT_BRAKING) + 10);
		// A level crossing with its barriers down is a wall: the queue waits for the train.
		const crossing = railStopAhead(x, z, hx, hz, lookAhead, this.halfLength);
		if (crossing < Infinity) limit = Math.min(limit, crossing <= 0.15 ? 0 : stopWithin(crossing));
		let nearest = Infinity;
		let blockedByCrossing = false;
		let blockedByStalled = false;
		const consider = (ox: number, oz: number, radius: number, gap: number) => {
			const relX = ox - x;
			const relZ = oz - z;
			const ahead = relX * hx + relZ * hz;
			if (ahead <= 0 || ahead > lookAhead + radius) return false;
			const lateral = Math.abs(relX * -hz + relZ * hx);
			if (lateral > this.halfWidth + radius + 0.35) return false;
			nearest = Math.min(nearest, ahead - this.halfLength - radius - gap);
			return true;
		};

		for (const other of trafficAgents()) {
			if (other === this.agent) continue;
			if (other.kind === "person") {
				consider(other.x, other.z, PERSON_RADIUS, PERSON_GAP);
				continue;
			}
			if (other.stalled) {
				if (this.ignoreStalledSeconds > 0) continue;
				if (consider(other.x, other.z, other.halfLength, FOLLOW_GAP)) blockedByStalled = true;
				continue;
			}
			const parallel = other.headingX * hx + other.headingZ * hz > 0.5;
			// For crossing cars, the lower id has right of way, so two can't wait on each other.
			// Nobody assumes right of way over the player.
			const yields = other.playerControlled || other.id < (this.agent?.id ?? 0);
			if (!parallel && (!yields || this.ignoreCrossingSeconds > 0)) continue;
			const hit = consider(other.x, other.z, other.halfLength, FOLLOW_GAP);
			if (hit && !parallel) blockedByCrossing = true;
		}
		const player = readPlayerPose();
		consider(player.x, player.z, PERSON_RADIUS, PERSON_GAP);

		if (nearest < Infinity) limit = Math.min(limit, nearest <= 0 ? 0 : stopWithin(nearest));
		this.blockedSeconds = blockedByCrossing && this.speed < 0.3 ? this.blockedSeconds + dt : 0;
		this.ignoreCrossingSeconds = Math.max(0, this.ignoreCrossingSeconds - dt);
		this.stalledBlockSeconds = blockedByStalled && this.speed < 0.3 ? this.stalledBlockSeconds + dt : 0;
		this.ignoreStalledSeconds = Math.max(0, this.ignoreStalledSeconds - dt);
		if (this.stalledBlockSeconds > STALLED_WAIT_SECONDS) {
			this.ignoreStalledSeconds = STALLED_PASS_SECONDS;
			this.stalledBlockSeconds = 0;
		}
		if (this.blockedSeconds > DEADLOCK_SECONDS) {
			this.ignoreCrossingSeconds = DEADLOCK_RELEASE_SECONDS;
			this.blockedSeconds = 0;
		}
		return limit;
	}

	private advance(step: number) {
		let remaining = step;
		// A long frame can finish a leg and start a turn; loop so no distance is lost.
		for (let guard = 0; guard < 4 && remaining > 0; guard++) {
			const length = this.phase === "leg" ? this.legLength : this.turnLength;
			const left = length - this.distance;
			if (remaining < left) {
				this.distance += remaining;
				remaining = 0;
			} else {
				remaining -= left;
				if (this.phase === "leg") this.beginTurn();
				else this.beginLeg(this.xIndex + this.dx, this.zIndex + this.dz, this.nextDx, this.nextDz);
			}
		}
		this.applyPose();
	}

	private pose(): [number, number, number, number] {
		if (this.phase === "leg") {
			const t = this.distance / this.legLength;
			return [
				this.p0[0] + (this.p1[0] - this.p0[0]) * t,
				this.p0[1] + (this.p1[1] - this.p0[1]) * t,
				this.dx,
				this.dz,
			];
		}
		const t = Math.min(1, this.distance / this.turnLength);
		const [x, z] = bezier(this.p1, this.control, this.p2, t);
		const [tx, tz] = bezierTangent(this.p1, this.control, this.p2, t);
		const length = Math.hypot(tx, tz) || 1;
		return [x, z, tx / length, tz / length];
	}

	private applyPose(force = false) {
		const [x, z, hx, hz] = this.pose();
		this.headingDegrees = (Math.atan2(hx, hz) * 180) / Math.PI;
		if (force || needsPosing(x, z, this.app.frame, this.agent?.id ?? 0)) {
			this.entity.setPosition(x, this.entity.getPosition().y, z);
			this.entity.setEulerAngles(0, this.headingDegrees, 0);
		}
		if (this.agent) {
			this.agent.x = x;
			this.agent.z = z;
			this.agent.headingX = hx;
			this.agent.headingZ = hz;
			this.agent.speed = this.speed;
			this.agent.stalled = false;
			this.agent.playerControlled = false;
		}
	}

	/** Starts a straight run from junction (xIndex, zIndex) heading (dx, dz). */
	private beginLeg(xIndex: number, zIndex: number, dx: number, dz: number) {
		this.xIndex = xIndex;
		this.zIndex = zIndex;
		this.dx = dx;
		this.dz = dz;
		this.phase = "leg";
		this.distance = 0;
		this.runningAmber = false;

		const lane = this.laneOffset(xIndex, zIndex, dx);
		const [lx, lz] = leftOf(dx, dz);
		const ax = ROAD_GRID.xs[xIndex];
		const az = ROAD_GRID.zs[zIndex];
		const bx = ROAD_GRID.xs[xIndex + dx];
		const bz = ROAD_GRID.zs[zIndex + dz];
		const startBack = crossRoadWidth(xIndex, zIndex, dx) / 2;
		const endBack = crossRoadWidth(xIndex + dx, zIndex + dz, dx) / 2;
		this.p0 = [ax + dx * startBack + lx * lane, az + dz * startBack + lz * lane];
		this.p1 = [bx - dx * endBack + lx * lane, bz - dz * endBack + lz * lane];
		this.legLength = Math.max(0.1, Math.hypot(this.p1[0] - this.p0[0], this.p1[1] - this.p0[1]));
		this.chooseExit();
	}

	/** Picks what to do at the junction ahead: straight on, or a left or right turn. */
	private chooseExit() {
		const bx = this.xIndex + this.dx;
		const bz = this.zIndex + this.dz;
		const heading = HEADINGS.findIndex(([hx, hz]) => hx === this.dx && hz === this.dz);
		const straight = HEADINGS[heading];
		const left = HEADINGS[(heading + 3) % 4];
		const right = HEADINGS[(heading + 1) % 4];
		const canGo = ([hx, hz]: readonly [number, number]) => junctionExists(bx + hx, bz + hz);

		const turns = [left, right].filter(canGo);
		let choice = straight;
		if (!canGo(straight) || (turns.length > 0 && this.random() < TURN_CHANCE)) {
			choice = turns.length > 0 ? turns[Math.floor(this.random() * turns.length)] : HEADINGS[(heading + 2) % 4];
		}
		this.nextDx = choice[0];
		this.nextDz = choice[1];
		// Keeping left, a left turn is the tight inside corner; a right turn swings wide.
		this.turnSpeed = choice === left ? TURN_SPEED.left : TURN_SPEED.right;
	}

	private beginTurn() {
		const bx = this.xIndex + this.dx;
		const bz = this.zIndex + this.dz;
		const cx = ROAD_GRID.xs[bx];
		const cz = ROAD_GRID.zs[bz];
		const lane = this.laneOffset(bx, bz, this.nextDx);
		const [lx, lz] = leftOf(this.nextDx, this.nextDz);
		const exitBack = crossRoadWidth(bx, bz, this.nextDx) / 2;
		this.p2 = [cx + this.nextDx * exitBack + lx * lane, cz + this.nextDz * exitBack + lz * lane];

		const straight = this.nextDx === this.dx && this.nextDz === this.dz;
		const uTurn = this.nextDx === -this.dx && this.nextDz === -this.dz;
		if (straight || uTurn) {
			this.control = [(this.p1[0] + this.p2[0]) / 2 + this.dx * (uTurn ? 6 : 0), (this.p1[1] + this.p2[1]) / 2 + this.dz * (uTurn ? 6 : 0)];
		} else {
			// Where the incoming and outgoing lane lines meet gives a clean quarter curve.
			this.control = this.dx !== 0 ? [this.p2[0], this.p1[1]] : [this.p1[0], this.p2[1]];
		}
		this.turnLength = curveLength(this.p1, this.control, this.p2);
		this.phase = "turn";
		this.distance = 0;
	}

	private laneOffset(xIndex: number, zIndex: number, dx: number): number {
		const lanes = laneOffsets(travelRoadWidth(xIndex, zIndex, dx));
		return lanes[Math.min(this.laneIndex, lanes.length - 1)];
	}

	private respawnNearPlayer(minDistance: number) {
		const player = readPlayerPose();
		// Score candidates and keep the best: hidden and uncrowded beats everything, and when
		// nothing qualifies the car at least goes wherever it's least noticeable.
		let best: { xIndex: number; zIndex: number; dx: number; dz: number; distance: number; score: number } | null = null;
		for (let attempt = 0; attempt < RESPAWN_ATTEMPTS; attempt++) {
			const angle = this.random() * Math.PI * 2;
			const reach = minDistance + this.random() * (RESPAWN_MAX - minDistance);
			const xIndex = nearestIndex(ROAD_GRID.xs, player.x + Math.cos(angle) * reach);
			const zIndex = nearestIndex(ROAD_GRID.zs, player.z + Math.sin(angle) * reach);
			const options = HEADINGS.filter(([hx, hz]) => junctionExists(xIndex + hx, zIndex + hz));
			const [dx, dz] = options[Math.floor(this.random() * options.length)];
			this.beginLeg(xIndex, zIndex, dx, dz);
			const distance = this.random() * this.legLength * 0.8;
			this.distance = distance;
			const [x, z] = this.pose();

			const crowded = [...trafficAgents()].some((other) => (
				other !== this.agent && other.kind === "vehicle" && Math.hypot(other.x - x, other.z - z) < 12
			));
			const fromPlayer = Math.hypot(x - player.x, z - player.z);
			const hidden = minDistance === 0 || !inCameraView(x, z, RESPAWN_HIDDEN_RANGE);
			const farEnough = fromPlayer >= minDistance && fromPlayer <= RECYCLE_DISTANCE - 20;
			const score = (hidden ? 4 : 0) + (farEnough ? 2 : 0) + (crowded ? 0 : 1) + Math.min(1, distanceFromCamera(x, z) / RECYCLE_DISTANCE);
			if (!best || score > best.score) best = { xIndex, zIndex, dx, dz, distance, score };
			if (hidden && farEnough && !crowded) break;
		}
		if (best) {
			this.beginLeg(best.xIndex, best.zIndex, best.dx, best.dz);
			this.distance = best.distance;
		}
		this.speed = this.maxSpeed * 0.5;
		const [x, z] = this.pose();
		// Ride height above the road is fixed by the scene; only X/Z are placed here.
		const y = this.rideHeight;
		this.entity.setPosition(x, y, z);
		this.entity.rigidbody?.teleport(x, y, z);
		this.applyPose(true);
		this.lastYaw = null;
	}

	private trackTurnRate(dt: number) {
		// The heading computed in applyPose — Euler readback flips beyond +/-90 degrees.
		const yaw = this.headingDegrees;
		if (this.lastYaw !== null && dt > 0) {
			const delta = ((yaw - this.lastYaw + 540) % 360) - 180;
			// Smoothed: the raw per-frame value is jittery, and it only drives visuals.
			this.yawRate += (delta / dt - this.yawRate) * Math.min(1, dt * 6);
		}
		this.lastYaw = yaw;
	}

	private setMaterial(name: string, material: Material) {
		let nodes = this.lightNodes.get(name);
		// Re-query when the body was swapped (a loaded GLB replaces the placeholder).
		if (!nodes || nodes.length === 0 || nodes.some((node) => !node.parent)) {
			nodes = this.entity.find((candidate) => candidate.name === name) as Entity[];
			this.lightNodes.set(name, nodes);
		}
		for (const node of nodes) {
			for (const instance of node.render?.meshInstances ?? []) {
				if (instance.material !== material) instance.material = material;
			}
		}
	}

	private updateLights(dt: number, braking: boolean) {
		if (braking !== this.brakeLit && this.brakeOn && this.brakeOff) {
			this.brakeLit = braking;
			this.setMaterial("brake-light", braking ? this.brakeOn : this.brakeOff);
		}
		if (!this.police || !this.flashOff) return;
		if (this.driver === "parked") {
			// A parked patrol car has its beacons off.
			this.setMaterial("beacon-red", this.flashOff);
			this.setMaterial("beacon-blue", this.flashOff);
			return;
		}
		this.flashTimer += dt;
		const redPhase = Math.floor(this.flashTimer / FLASH_SECONDS) % 2 === 0;
		this.setMaterial("beacon-red", redPhase ? this.flashRedOn ?? this.flashOff : this.flashOff);
		this.setMaterial("beacon-blue", redPhase ? this.flashOff : this.flashBlueOn ?? this.flashOff);
	}
}


const DEGREES = 180 / Math.PI;

function bezier(a: readonly number[], c: readonly number[], b: readonly number[], t: number): [number, number] {
	const u = 1 - t;
	return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

function bezierTangent(a: readonly number[], c: readonly number[], b: readonly number[], t: number): [number, number] {
	return [2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]), 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1])];
}

function curveLength(a: readonly number[], c: readonly number[], b: readonly number[]): number {
	let length = 0;
	let previous = bezier(a, c, b, 0);
	for (let i = 1; i <= 12; i++) {
		const point = bezier(a, c, b, i / 12);
		length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
		previous = point;
	}
	return Math.max(0.1, length);
}

function nearestIndex(values: readonly number[], target: number): number {
	let best = 0;
	for (let i = 1; i < values.length; i++) {
		if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
	}
	return best;
}

function mulberry32(seed: number) {
	let state = seed | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Clears every burning or burnt-out car within `radius` of a point, and says how many there were.
 * Used when the player respawns: dying leaves the street alight, and four seconds later they were
 * standing back in the middle of their own wreckage.
 */
export function clearWrecksNear(x: number, z: number, radius: number): number {
	let cleared = 0;
	for (const car of drivableCars()) {
		const position = car.entity.getPosition();
		if (Math.hypot(position.x - x, position.z - z) > radius) continue;
		if (car.clearWreck()) cleared++;
	}
	return cleared;
}
