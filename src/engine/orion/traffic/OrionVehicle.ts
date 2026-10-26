import { Entity, Quat, Script, Vec3, type Material, type RaycastResult } from "playcanvas";

import { onWorldReset } from "../world/WorldReset";
import { emitGameEvent } from "../missions/GameEvents";
import { combatAudio } from "../combat/CombatAudio";
import { damageableMoved, registerDamageable, unregisterDamageable, type Listener } from "../combat/CombatWorld";
import type { DamageEvent, DamageSourceRef, HitDetail, RayLike } from "../combat/Damage";
import { makeDamageEvent, nextCombatId, unscaledDamage } from "../combat/Damage";
import { playAt } from "../audio/SoundBank";
import { decals } from "../effects/Decals";
import { glassDamage } from "./GlassDamage";
import { deflate, hitTyre, newTyre, NO_TYRE_EFFECT, repairTyre, tyreHandling, tyreHitDamage, type TyreHandling, type TyreState } from "./TyreDamage";
import { VehicleFire } from "./VehicleFire";
import type { OrionVehicleModel } from "./OrionVehicleModel";
import { approachSpeed, junctionPosition, nearestJunction, stepToward, steerToward, wrapAngle } from "../police/PursuitDriver";
import { requestOfficer, type OrionFootOfficer } from "../police/OrionFootOfficer";
import { FIRE_FROM_STARS, fireAtPlayer, nextShotDelay, policeGun } from "../police/PoliceFire";
import { POLICE_STATION } from "../police/Police";
import { markArrestable, readWanted, reportCrime, spotted } from "../police/Wanted";
import { distanceFromCamera, inCameraView, needsPosing, readPlayerPose } from "../player/PlayerPose";
import { runsThisFrame, updateInterval } from "../characters/NpcBrain";
import { CarjackRig, drivableCars, registerDrivableCar, unregisterDrivableCar } from "./Carjack";
import { BURNT_PAINT, getCarMeshes } from "./CarMeshes";
import { CarPhysics, carSpecFor, type CarControls } from "./CarPhysics";
import { crashEffects, type DamageSource } from "./CrashEffects";
import { crashImpulse, type CrashBody } from "./CrashImpulse";
import { extentAlong, footprintContact, separationShares, type Contact, type Footprint } from "./VehicleContacts";
import { EmissionAccumulator } from "../effects/ParticleField";
import {
	BLAST_RADIUS,
	BURN_SECONDS,
	blastAt,
	BURNING_BELOW,
	conditionOf,
	buildOf,
	crashDamage,
	FIRE_DRAIN_PER_SECOND,
	PEDESTRIAN_DAMAGE,
	powerFactor,
	SMOKING_BELOW,
	type DamageEffect,
	type VehicleCondition,
	type VehicleBuild,
} from "./VehicleDamage";
import type { FoldingRoof } from "./FoldingRoof";
import { skidMarks } from "./SkidMarks";
import type { VehicleStyle } from "./Vehicles";
import { pavedHeightAt, ROAD_GRID } from "../roads/RoadNetwork";
import { ORION_OCEAN } from "../world/Ocean";
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
/** Room either side of the body that counts as in the way: for a car, and for someone on foot. */
const VEHICLE_CLEARANCE = 0.35;
/**
 * Someone waiting on the kerb at a corner stood just inside the wider margin of a car turning past,
 * and the two waited on each other for good.
 */
const PERSON_CLEARANCE = 0.1;
/**
 * Seconds held up by a crossing (non-parallel) car before right of way is dropped, to break
 * deadlocks. The car still never drives into anything (see bodyBlocked): it only edges forward
 * while there is room.
 */
const DEADLOCK_SECONDS = 4;
const DEADLOCK_RELEASE_SECONDS = 2.5;
/** Room kept to anything in front when checking a lane-following car can physically move. */
const CONTACT_MARGIN = 0.15;
/** Physically blocked this long while out of sight: the car is recycled onto another road. */
const BLOCKED_RECYCLE_SECONDS = 6;
/** Physically blocked this long in sight: it backs up a little to let the other car through. */
const BLOCKED_BACKOFF_SECONDS = 7;
const BACKOFF_SPEED = 1.2;
const BACKOFF_DISTANCE = 2.5;
/** After backing off, it holds this long so the other car can go. */
const BACKOFF_HOLD_SECONDS = 2;
/** Changing lane round a stalled car: the road left on the leg it needs, and how fast it drifts across. */
const LANE_CHANGE_ROOM = 14;
const LANE_CHANGE_SPEED = 3.5;
const TURN_CHANCE = 0.4;
const BRAKE_LIGHT_THRESHOLD = 0.4;
const FLASH_SECONDS = 0.28;

// Off-lane driving (the player, parked and crashed cars) runs on CarPhysics.
/** Share of an impact's closing speed that bounces back. */
const RESTITUTION = 0.18;
/** Friction across a contact: steel scraping a wall, and two bodies locked together for a moment. */
const WALL_FRICTION = 0.3;
const CAR_FRICTION = 0.45;
/** A hit this hard (change of velocity, m/s) throws sparks off the metal. */
const SPARK_DELTA_V = 6;
/** Gap kept between the body and whatever it hit. */
const COLLISION_SKIN = 0.06;
/**
 * Yaw kick from off-centre impacts, as a share of the full rigid-body value: the tyres are
 * already gripping as the blow lands and take a little of it.
 */
const IMPACT_SPIN = 0.8;
/** A blow this hard (m/s) puts a car's stability control out of its depth for KNOCK_SECONDS. */
const KNOCK_DELTA_V = 2;
const KNOCK_SECONDS = 1.5;
/** What a car runs into that isn't another car: it neither moves nor turns. */
const WALL: CrashBody = { mass: Infinity, inertia: Infinity, velocityX: 0, velocityZ: 0, turnRate: 0, offsetX: 0, offsetZ: 0 };
/** Below this the car just nudges people instead of running them over. */
const STRIKE_SPEED = 1.4;
const PERSON_HIT_RADIUS = 0.32;
const PERSON_MASS = 75;
/**
 * Traffic stuck behind a stalled car waits this long, then changes lane round it where the road
 * has a second lane; where it hasn't, it queues (and is recycled once out of sight).
 */
const STALLED_SPEED = 0.5;
const STALLED_WAIT_SECONDS = 3;
/** Queued behind a stalled car with no lane to change into, this long and out of sight: recycled. */
const STALLED_RECYCLE_SECONDS = 12;
const RIDE_SMOOTHING = 14;
/** Effects are only drawn for cars this close to the camera. */
const EFFECT_DISTANCE = 160;
/** Where the engine sits, as a share of half the car's length ahead of centre. */
const ENGINE_FORWARD = 0.55;
/**
 * How far above the car it looks for the ground. Enough for a fast climb in a slow frame, and
 * still well under a tunnel roof or a bridge deck overhead.
 */
const GROUND_PROBE_UP = 3;
/** Far enough to find the valley floor below any cliff or bridge edge. */
const GROUND_PROBE_DOWN = 150;
/** The ground dropping away by more than this at once is a fall, not a slope to follow. */
const FALL_STEP = 0.6;
/** A parked or wrecked car this still, for this long, rests (see OrionVehicle.resting). */
const REST_SPEED = 0.02;
const REST_YAW_RATE = 0.01;
const REST_AFTER = 0.5;
const GRAVITY = 9.81;
/** Steepest a car will lie along the ground, radians (about 35°). */
const MAX_TILT = 0.6;
/** Landing faster than this (m/s, downwards) hurts the car, more the harder it lands. */
const SAFE_LANDING_SPEED = 7;
const LANDING_DAMAGE_PER_MS = 4;
/** With nothing below at all (open sea past the beach), the car sinks this far under the waterline. */
const SEA_FLOOR_BELOW_WATER = 1.5;
/** Ground steeper than this (about 44°: cuttings, cliffs) is a wall to a car, not a slope. */
const DRIVABLE_SLOPE_UP = 0.72;
/** Rear sliding below this leaves no rubber. */
const SKID_THRESHOLD = 0.2;
const TYRE_WIDTH = 0.24;
/** A change of velocity (m/s) at which a crash is at full volume. */
const CRASH_FULL_VOLUME = 9;
/** Below this share of that, it's a scrape and not worth a sound. */
const CRASH_QUIETEST = 0.12;
/** Shortest gap between one car's crash sounds, in seconds. */
const CRASH_SOUND_GAP = 0.25;
/**
 * Closing speed (m/s) below which a contact is a push, not a crash: the bodies part and slow, but
 * there is no sound, shake, knock or dent.
 */
const CONTACT_PUSH_SPEED = 1.2;
/** Touching the same car (or any wall) again within this long is the same collision. */
const CONTACT_MEMORY = 0.35;
/** ...unless it closes at least this fast again (a second ram while still against it). */
const REHIT_SPEED = 3;
/**
 * A lane-following car is only knocked off its lane by a hit at least this hard (closing m/s);
 * a gentler one meets it like a wall, and it carries on its way.
 */
const KNOCK_OFF_LANE_SPEED = 2;
/** Car-against-car checks along a step lie at most this share of the car's half-width apart. */
const SWEEP_SPACING = 0.6;
const MAX_SWEEP_SAMPLES = 8;

// Police pursuit (cars with a pursuitSlot: see updatePursuitSlot).
/** Where a dispatched unit joins the chase: out of sight, this far from the player. */
const DISPATCH_MIN = 85;
/** Seconds between one unit being dispatched and the next, so they don't arrive as a convoy. */
const DISPATCH_STAGGER = 4;
/** First unit out, this long after the first star. */
const FIRST_DISPATCH_DELAY = 1;
/**
 * An explosive hit this hard that finishes a car blows it up there and then — a rocket doesn't
 * leave it burning for six seconds first. Lighter blast damage still leaves it to burn.
 */
const INSTANT_WRECK_DAMAGE = 80;
/**
 * Crash damage a unit on a chase takes, as a share of an ordinary car's. Pursuit cars are built
 * for it (push bars, heavy-duty everything); at the ordinary rate a few scrapes at chase speed
 * set them alight before they ever reached the player.
 */
const POLICE_CRASH_RESISTANCE = 0.25;
/** Where each unit pulls up around a player on foot (degrees off the line it came in on), so they
 * surround them instead of all braking for the same spot and piling into each other. */
const STOP_ANGLES: readonly number[] = [0, 55, -55, 110, -110];
/** Obstacle lookahead: the car's own length plus this many seconds of travel. */
const AVOID_LOOKAHEAD_SECONDS = 0.9;
/** A unit this far behind, and out of sight, is brought round in front again. */
const PURSUIT_LEASH = 230;
/** How far a unit can see the player, and how often it looks. */
const SIGHT_RANGE = 95;
const SIGHT_INTERVAL = 0.25;
/** Inside this, with the player in sight, the unit drives straight at them rather than by road. */
const DIRECT_RANGE = 55;
/** Top speed a unit drives the grid at, and how close it pulls up to someone on foot. */
const PURSUIT_CRUISE = 38;
const STOP_SHORT = 7;
/** Braking a unit plans its stop with (m/s²): well inside what the tyres can do, so it pulls up in time. */
const PURSUIT_BRAKING = 6;
/** A route junction counts as reached this close. */
const WAYPOINT_REACHED = 10;
/** Pushing and not moving this long means stuck: back off and try again. */
const STUCK_SECONDS = 1.3;
const REVERSE_SECONDS = 1.1;
/** A stopped unit this close to the player puts its crew out on foot. */
const CREW_DEPLOY_RANGE = 16;
/** Seconds stopped beside the player before the doors open. */
const DISMOUNT_DELAY = 0.7;
/** The crew runs back to the car once the player is this far away (or driving off). */
const CREW_RECALL_RANGE = 40;
/** After the crew gets back in, this long before they'll get out again. */
const CREW_COOLDOWN = 3;
/** A car the player damaged this recently and that then blows up is the player's doing. */
const PLAYER_BLAME_SECONDS = 20;
/** Where an idle unit waits: nowhere near the city, and not drawn. */
const STOW_Y = -400;
/** Longest single step of lane-following, however long a far car went without updating. */
const MAX_AI_STEP = 0.25;

/** Mission cars driving a route: their cruise (m/s) and how close counts as reaching a point. */
const MISSION_CRUISE = 15;
const MISSION_ROUTE_REACHED = 12;
/** Taking a right-angle bend, a route driver gets down to this share of its cruise; braking at this rate. */
const MISSION_CORNER_SHARE = 0.22;
const MISSION_CORNER_BRAKING = 5.5;
/** Stuck this long (backing off hasn't freed it) and out of sight: put back on its route. */
const MISSION_UNSTICK_SECONDS = 8;
/** How far ahead along its route a route driver aims, m, plus half a second of travel. */
const MISSION_LOOKAHEAD = 10;

/**
 * The point `ahead` metres on from (x, z)'s nearest point on the leg from → to, stopping at the
 * leg's end (the next bend is taken from there).
 */
function alongLeg(from: readonly [number, number], to: readonly [number, number], x: number, z: number, ahead: number): [number, number] {
	const legX = to[0] - from[0];
	const legZ = to[1] - from[1];
	const length = Math.hypot(legX, legZ);
	if (length < 1e-3) return [to[0], to[1]];
	const along = Math.max(0, ((x - from[0]) * legX + (z - from[1]) * legZ) / length);
	const at = Math.min(length, along + ahead) / length;
	return [from[0] + legX * at, from[1] + legZ * at];
}

/** How a mission car drives its route (see OrionVehicle.placeForMission). */
export interface MissionDriving {
	cruise?: number;
	racer?: boolean;
	/** The driver gives up and pulls over once the car's knocked below this integrity. */
	disableBelow?: number;
	/** Placed already damaged (a crash scene), 0..100. */
	integrity?: number;
	/** Placed on fire, the fire held steady until the mission lets it burn (see holdFire). */
	burning?: boolean;
}

/**
 * The speed to be doing now, heading for `point` with `after` beyond it: the tighter the bend at
 * the point, the slower it's taken, and braking for it starts in time.
 */
function cornerSpeed(x: number, z: number, point: readonly [number, number], after: readonly [number, number], cruise: number): number {
	const inX = point[0] - x;
	const inZ = point[1] - z;
	const outX = after[0] - point[0];
	const outZ = after[1] - point[1];
	const inLength = Math.hypot(inX, inZ) || 1;
	const outLength = Math.hypot(outX, outZ) || 1;
	const turn = Math.acos(Math.max(-1, Math.min(1, (inX * outX + inZ * outZ) / (inLength * outLength))));
	const share = 1 - (1 - MISSION_CORNER_SHARE) * Math.min(1, turn / (Math.PI / 2));
	const bend = cruise * share;
	return Math.min(cruise, Math.sqrt(bend * bend + 2 * MISSION_CORNER_BRAKING * Math.max(0, inLength - MISSION_ROUTE_REACHED)));
}

type Phase = "leg" | "turn";
/** How far (m) before a junction traffic starts signalling the turn it's about to take. */
const SIGNAL_DISTANCE = 35;

/**
 * Who is driving: the traffic AI, nobody (stopped for a carjack), the player, or nobody
 * (left parked where the player got out).
 */
export type VehicleDriver = "ai" | "held" | "player" | "parked" | "wrecked" | "police" | "fire" | "convoy";

/** Body outline points (fractions of half-width, half-length) swept for collisions. */
const SWEEP_POINTS: readonly [number, number][] = [
	[-1, 1], [0, 1], [1, 1],
	[-1, 0], [1, 0],
	[-1, -1], [0, -1], [1, -1],
];

/** Heights (fractions of half-height above the body centre) swept for collisions. */
const SWEEP_LIFTS: readonly number[] = [0, 0.75];
/**
 * And one low sweep, this far above the bottom of the body, for tall vehicles: a garbage truck's
 * centre rides at about 1.6 m, above a taxi's roof, so both of its sweeps passed over the taxi
 * and it drove straight into it. Skipped where it would sit at the centre sweep anyway (cars).
 */
const SWEEP_LOW_ABOVE_BOTTOM = 0.5;
/**
 * Outline points (fractions of half-width, half-length) checked for being inside a wall after
 * each step (see pushOutOfWorld): closer along the sides than the sweep's, so a post or a
 * building's corner can't sit between two of them.
 */
const OUTLINE_POINTS: readonly [number, number][] = [
	[-1, 1], [-0.5, 1], [0, 1], [0.5, 1], [1, 1],
	[-1, 0.5], [1, 0.5], [-1, 0], [1, 0], [-1, -0.5], [1, -0.5],
	[-1, -1], [-0.5, -1], [0, -1], [0.5, -1], [1, -1],
];
/** Push-outs per step: a car wedged into a corner is pushed off one wall, then the other. */
const PUSH_OUT_PASSES = 2;

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
	/** Turns an ambulance's or fire engine's beacons on whoever is driving (a mission's call-out). */
	public sirenOn = false;
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
	/**
	 * On show in the showroom (see PREMIUM_STYLES): locked, so it can't be taken, and proof against
	 * weapons, so it stays on its plinth. The only way to drive one is to buy it.
	 */
	public forSale = false;
	/** A convertible's soft top, if it has one (set by OrionVehicleModel once its model is ready). */
	public roof: FoldingRoof | null = null;
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
	/** The fire, if there is one: its strength, the water on it, the smoulder after (see VehicleFire). */
	public readonly blaze = new VehicleFire();
	/** Each wheel's tyre, in the model's wheel order (see OrionVehicleModel.wheelCorners). */
	public readonly tyres: TyreState[] = [];
	private readonly tyreEffect: TyreHandling = { ...NO_TYRE_EFFECT };
	/** Damage taken since the fire was put out: enough of it lights a hot engine again. */
	private damageSinceOut = 0;
	/** The engine was scorched by a fire that's been put out. */
	private scorched = false;
	private readonly damageSource: DamageSource = {
		x: 0, y: 0, z: 0, sin: 0, cos: 1, halfWidth: 0, halfLength: 0, groundY: 0, stage: "smoking", severity: 0,
	};
	private physics: CarPhysics | null = null;
	private manual = false;
	/**
	 * Parked or wrecked, and settled: nothing is stepped until something moves it. A dozen parked
	 * cars (the base's, the airfield's, the hospital's) were each running their physics and five
	 * ground raycasts every frame to stay exactly where they were: a couple of milliseconds a
	 * frame for nothing. A knock (receiveImpact gives it velocity) or a new driver wakes it.
	 */
	private resting = false;
	private stillFor = 0;
	private readonly controls: CarControls = { drive: 0, steer: 0, handbrake: false, brake: 0 };
	/** The stalled car being passed by a lane change (left out of speed planning meanwhile). */
	private passing: TrafficAgent | null = null;
	private stalledBlockSeconds = 0;
	/** Lateral offset from the lane's centre while changing lane, m along leftOf (eases to 0). */
	private laneShift = 0;
	/** Sideways speed of that drift, m/s along leftOf (for the slight angle it's driven at). */
	private laneDrift = 0;
	/** Seconds this lane-following car has been unable to move for a car in its way. */
	private hardBlockedSeconds = 0;
	private backoffLeft = 0;
	private holdSeconds = 0;
	/** Contact bookkeeping: running seconds, and when each car (null: a wall) was last touched. */
	private contactClock = 0;
	private readonly touching = new Map<OrionVehicle | null, number>();
	/** A hit another car dealt this one, for its camera shake on its next frame. */
	private receivedImpact = 0;
	private skidding = false;
	/**
	 * Body height while off-lane. Kept here rather than read back from the entity, because a
	 * React re-render re-applies the entity's initial position between frames.
	 */
	private rideY = 0;
	/** Nose-up and left-side-up tilt to lie along the ground, radians (smoothed). */
	private pitch = 0;
	private roll = 0;
	/** Downward speed while airborne (off a cliff or a ramp), m/s; 0 on the ground. */
	private fallSpeed = 0;
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

	/**
	 * Police pursuit unit number (0 is the first car sent, at one star), or -1 for an ordinary
	 * car. A unit waits out of the world until the wanted level calls for it.
	 */
	public pursuitSlot = -1;
	/**
	 * Fire engine number, or -1. An engine waits out of the world until something is burning,
	 * then drives to it and puts it out (see updateFireSlot).
	 */
	public fireSlot = -1;
	/**
	 * A mission's car (see missions/MissionActors): out of the world until a mission puts it
	 * somewhere, parked or driving a route, and taken away again when the mission's over.
	 */
	public missionSlot = -1;
	private missionRoute: readonly (readonly [number, number])[] | null = null;
	private missionRouteIndex = 0;
	/** A mission still has a use for it; once let go, it leaves when nobody's looking. */
	private missionClaimed = false;
	/** Its route's cruising speed, m/s; a race opponent, and whether it's still held on the grid. */
	private missionCruise = MISSION_CRUISE;
	private missionRacer = false;
	private missionHeld = false;
	private missionDisableBelow = 0;
	/** Time spent going nowhere since it last got going properly. */
	private missionStuckSeconds = 0;
	/** Lane-following time owed from frames this car's driving was skipped (far, unseen). */
	private aiSkipped = 0;
	/** Where its route began (the first leg runs from here). */
	private missionStartX = 0;
	private missionStartZ = 0;
	private stowed = false;
	/** The burning car this engine is going to, and what it's doing about it. */
	private fireTarget: OrionVehicle | null = null;
	private fireDuty: "responding" | "hosing" | "leaving" = "responding";
	/** Where the monitor's jet is landing now, walked onto the fire (see respondToFire). */
	private readonly hoseAim = new Vec3();
	private hoseAimed = false;
	/** How far short of the fire the engine pulls up; closer after the jet couldn't get there. */
	private fireStandoff = FIRE_STANDOFF;
	/** Whether the monitor last had a clear line to the fire, and when to look again. */
	private hoseClear = true;
	private hoseSight = 0;
	/** Seconds hosing with no water getting to the fire; seconds of cooling once it's out. */
	private hoseBlocked = 0;
	private hoseCooling = 0;
	private wetPatchTimer = 0;
	private readonly firePoint3 = new Vec3();
	private dutySeconds = 0;
	private readonly hoseTrail = new EmissionAccumulator();

	/** How this vehicle takes a crash: a car, a van, a lorry or a bus (see VehicleDamage). */
	public get build(): VehicleBuild {
		return buildOf(this.style);
	}

	/** Passes a crash to the body, which dents, cracks and comes apart (see BodyDamage). */
	public bodyCrash(x: number, y: number, z: number, dirX: number, dirZ: number, deltaV: number) {
		if (this.burnedOut) return;
		this.bodyModel()?.crash({ x, y, z, dirX, dirZ, deltaV, lost: 100 - this.integrity });
	}

	private bodyModelScript: OrionVehicleModel | null = null;

	/** The model's script, once it exists (a model streams in after the car does). */
	private bodyModel(): OrionVehicleModel | null {
		if (!this.bodyModelScript) {
			const model = this.entity.findByName("car-model") as Entity | null;
			this.bodyModelScript = (model?.script?.get("orionVehicleModel") as unknown as OrionVehicleModel | null) ?? null;
		}
		return this.bodyModelScript;
	}

	/**
	 * A carjacker breaking the window at (x, y, z): the glass system breaks it, or says it's
	 * already gone. "none" if this car has no breakable glass there (the rig breaks its own).
	 */
	public smashWindowAt(x: number, y: number, z: number): "smashed" | "already" | "none" {
		return this.bodyModel()?.smashWindowsNear(x, y, z, 0.8) ?? "none";
	}

	/** Any tyre flat or going down. */
	public get hasFlat(): boolean {
		return this.tyres.some((tyre) => tyre.punctured);
	}

	/** Share of crash damage this car takes: a unit on a chase shrugs most of it off. */
	public get crashResistance(): number {
		if (this.pursuitSlot >= 0 && this.driver === "police") return POLICE_CRASH_RESISTANCE;
		// Race rivals are built for it: a race lost to a fender-bender in traffic is no race.
		return this.missionRacer && this.driver === "convoy" ? POLICE_CRASH_RESISTANCE : 1;
	}

	/** A police unit out on a chase and still able to drive it. */
	public get chasing(): boolean {
		return this.pursuitSlot >= 0 && !this.stowed && this.driver === "police" && !this.burnedOut && this.integrity > 0;
	}

	/**
	 * Whether there's an engine running to be heard: someone at the wheel, or the player getting in.
	 * A parked car is empty, a crashed one has stalled, a burnt-out one has no engine left, and a
	 * unit waiting out of the world isn't anywhere.
	 */
	public get engineRunning(): boolean {
		return !this.stowed && !this.burnedOut && this.driver !== "parked" && this.driver !== "wrecked";
	}

	/** False for a police unit waiting out of the world (it can't be seen, entered or hit). */
	public get inWorld(): boolean {
		return !this.stowed;
	}

	/** Flames showing: a car burning down to going up, or a wreck still alight. */
	public get onFire(): boolean {
		return !this.stowed && this.blaze.burning;
	}

	/**
	 * Puts the flames out at once (the fire crew's job is done by water: see douse). A burning
	 * car stops burning — badly damaged, smoking, but it won't go up; a wreck smoulders.
	 */
	public extinguish() {
		if (!this.blaze.burning) return;
		this.blaze.putOut();
		this.fireWentOut();
	}

	/**
	 * Water from a hose landing on this car's fire this frame: `flow` is the share of a full jet
	 * that's actually reaching it. Knocks the fire back, and cools it once out.
	 */
	public douse(flow: number, dt: number) {
		const wasBurning = this.blaze.burning;
		this.blaze.applyWater(flow, dt);
		if (wasBurning && !this.blaze.burning) this.fireWentOut();
	}

	/** Where the fire is: the engine bay on a running car, the middle of a wreck. */
	public firePoint(out: Vec3): Vec3 {
		const position = this.entity.getPosition();
		const x = this.agent?.x ?? position.x;
		const z = this.agent?.z ?? position.z;
		const forward = this.burnedOut ? 0 : this.halfLength * ENGINE_FORWARD;
		const radians = this.headingDegrees / DEGREES;
		return out.set(x + Math.sin(radians) * forward, position.y + this.halfHeight * 0.2, z + Math.cos(radians) * forward);
	}

	/** The flames are out: the engine's dead, the paint scorched where it burned. */
	private fireWentOut() {
		this.burnTimer = 0;
		this.damageSinceOut = 0;
		if (this.physics) this.physics.powerFactor = powerFactor(0);
		if (!this.burnedOut && !this.scorched) {
			this.scorched = true;
			this.bodyModel()?.scorch(0.55, false);
		}
		// An engine that's burned doesn't run: nobody drives it away.
		if (this.driver === "ai" || this.driver === "police") this.driver = "wrecked";
	}
	private dispatchTimer = 0;
	/** Route: the junction being driven to, and the step that led to it. */
	private routeX = -1;
	private routeZ = -1;
	private routeDx = 0;
	private routeDz = 0;
	private sightTimer = 0;
	private seesPlayer = false;
	private stuckSeconds = 0;
	private reverseSeconds = 0;
	private reverseSteer = 1;
	private fireTimer = 0;
	/** A mission's crash-scene fire, burning steadily without burning down (holdFire). */
	private fireHeld = false;
	/** Officers out of the car on foot, and the timers for putting them out. */
	private crew: OrionFootOfficer[] = [];
	private dismountSeconds = 0;
	private crewCooldown = 0;
	private readonly shot: DamageEvent = makeDamageEvent();
	private readonly shooter: DamageSourceRef = { id: nextCombatId(), kind: "npc", x: 0, z: 0 };
	/** When the player last hurt this car (seconds, trafficClock-free wall time). */
	private playerHarmedAt = -Infinity;

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

	/**
	 * Which way the car is signalling: +1 left, -1 right, 0 not at all. Traffic signals from
	 * SIGNAL_DISTANCE before a junction it's turning at until it's through the turn; the player's
	 * car, police on a call and mission cars don't.
	 */
	public get turnSignal(): number {
		if (this.manual || this.driver !== "ai" || this.stowed || this.burnedOut) return 0;
		// Nose along (dx, dz), +X of the car its left: a left turn swings the heading that way.
		const side = this.dz * this.nextDx - this.dx * this.nextDz;
		if (side === 0) return 0;
		if (this.phase === "turn") return side;
		return this.legLength - this.distance < SIGNAL_DISTANCE ? side : 0;
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
		this.agent = registerTrafficAgent("vehicle", this.halfLength, this.halfWidth);
		if (this.pursuitSlot >= 0 || this.fireSlot >= 0 || this.missionSlot >= 0) this.stow();
		else if (this.hasHome) this.parkAtHome();
		else this.respawnNearPlayer(0);
		registerDrivableCar(this);
		if (this.missionSlot >= 0) missionCars.set(this.entity.name, this);
		this.registerTarget();
		const stopListening = onWorldReset(() => this.resetForNewGame());
		this.on("destroy", () => {
			stopListening();
			if (this.agent) unregisterTrafficAgent(this.agent);
			if (this.target) unregisterDamageable(this.target);
			unregisterDrivableCar(this);
			if (missionCars.get(this.entity.name) === this) missionCars.delete(this.entity.name);
			this.carjack.destroy();
		});
	}

	public update(dt: number) {
		this.sinceCrashSound += dt;
		const player = readPlayerPose();
		if (this.pursuitSlot >= 0 && this.updatePursuitSlot(dt)) return;
		if (this.fireSlot >= 0 && this.updateFireSlot(dt)) return;
		if (this.missionSlot >= 0 && this.updateMissionSlot()) return;
		const position = this.entity.getPosition();
		this.syncTarget(position.y);
		const playerDistance = Math.hypot(position.x - player.x, position.z - player.z);
		this.carjack.update(dt, playerDistance);
		// The agent carries the pose this car set itself; the entity's own position can be the
		// spawn value React re-applied between frames.
		this.updateCondition(dt, this.agent?.x ?? position.x, position.y, this.agent?.z ?? position.z);
		this.updateTyres(dt);
		// Crashed and parked cars stay where they are, like any other car, until they're far
		// away and out of sight.
		// Anything but the car the player is in: that includes a car held for a carjack the
		// player walked away from, which would otherwise sit there for good.
		// Pursuit units come and go by the wanted level (updatePursuitSlot), never into traffic.
		// Nor do a mission's cars: they stay where the player left them until the mission's over.
		const recyclable = this.driver !== "player" && this.pursuitSlot < 0 && this.fireSlot < 0 && this.missionSlot < 0;
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
			this.aiSkipped = 0;
			this.updateManual(dt);
			return;
		}

		// Traffic far off or out of sight thinks less often (as the crowd does): its lane-following
		// is kinematic, so a few frames' time taken in one step lands it in the same place.
		this.aiSkipped += dt;
		const interval = updateInterval(playerDistance, inCameraView(position.x, position.z, VISIBLE_RANGE));
		if (!runsThisFrame(this.app.frame, this.agent?.id ?? 0, interval)) return;
		dt = Math.min(this.aiSkipped, MAX_AI_STEP);
		this.aiSkipped = 0;

		let targetSpeed = this.plannedSpeed(dt) * powerFactor(this.integrity) * (this.tyres.length > 0 ? this.flatPace : 1);
		if (this.holdSeconds > 0) {
			this.holdSeconds -= dt;
			targetSpeed = 0;
		}
		// Kept for the engine sound, which needs to know whether the car is pulling or coasting.
		this.targetSpeed = targetSpeed;
		if (targetSpeed > this.speed) this.speed = Math.min(targetSpeed, this.speed + ACCELERATION * dt);
		else this.speed = Math.max(targetSpeed, this.speed - MAX_BRAKING * dt);

		if (this.backoffLeft > 0) {
			this.backOff(dt);
			return;
		}
		// Planning keeps a gap to what it gives way to; this is the last word on what's physically
		// there, whoever has right of way: lane following moves the car without any contact
		// response, so it must never step into another body.
		let step = this.speed * dt;
		if (step > 0 && this.bodyBlocked(step)) {
			step = 0;
			this.speed = 0;
			this.hardBlockedSeconds += dt;
			if (this.hardBlockedSeconds > BLOCKED_RECYCLE_SECONDS && !inCameraView(position.x, position.z, VISIBLE_RANGE)) {
				this.respawnNearPlayer(RESPAWN_MIN);
				return;
			}
			if (this.hardBlockedSeconds > BLOCKED_BACKOFF_SECONDS) {
				this.hardBlockedSeconds = 0;
				this.backoffLeft = BACKOFF_DISTANCE;
			}
		} else if (step > 0) {
			this.hardBlockedSeconds = 0;
		}
		// Queued behind a wreck with no lane to get round it by: once nobody's looking, off it goes
		// to another road rather than waiting there for good.
		if (this.stalledBlockSeconds > STALLED_RECYCLE_SECONDS && !inCameraView(position.x, position.z, VISIBLE_RANGE)) {
			this.respawnNearPlayer(RESPAWN_MIN);
			return;
		}
		this.easeLaneShift(dt);
		this.advance(step);
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
		if (this.forSale) return;
		if (event.source?.kind === "player") this.playerHarmedAt = performance.now() / 1000;
		// Where the round went decides what it does: glass and tyres take their own damage, and
		// cost the car itself little; the body takes the hole and the hit to its condition.
		const detail = event.detail;
		let share = 1;
		if (detail) {
			const raw = unscaledDamage("vehicle", event);
			const model = this.bodyModel();
			const travel = Math.hypot(event.directionX, event.directionZ) || 1;
			const dx = event.directionX / travel;
			const dz = event.directionZ / travel;
			switch (detail.part) {
				case "glass":
					model?.struck(detail, event.x, event.y, event.z, dx, 0, dz, glassDamage(event.type, raw));
					share = 0.25;
					break;
				case "tyre":
					this.damageTyre(detail.index, tyreHitDamage(event.type, raw, detail.incidence, detail.sidewall), event.x, event.y, event.z);
					model?.struck(detail, event.x, event.y, event.z, dx, 0, dz, 0);
					share = 0.1;
					break;
				case "rim":
					share = 0.5;
					break;
				case "lamp":
					model?.struck(detail, event.x, event.y, event.z, dx, 0, dz, 0);
					share = 0.4;
					break;
				default:
					model?.struck(detail, event.x, event.y, event.z, dx, 0, dz, 0);
					break;
			}
		} else if (event.type === "explosive") {
			this.blastDamage(event.amount, event.x, event.y, event.z);
		}
		this.applyDamage(event.amount * share);
		if (event.type === "explosive" && event.amount >= INSTANT_WRECK_DAMAGE && this.integrity <= 0 && !this.burnedOut && !this.stowed) {
			const position = this.entity.getPosition();
			this.explode(this.agent?.x ?? position.x, position.y, this.agent?.z ?? position.z);
		}
		if (event.type === "explosive" && event.impulse > 0 && this.driver !== "player") {
			const shove = event.impulse * 0.6;
			this.receiveImpact(event.directionX * shove, event.directionZ * shove, (Math.random() - 0.5) * event.impulse * 6);
		}
	}

	/**
	 * A tyre hit: soaks into that tyre, and once holed it starts to go down (with the hiss of the
	 * air leaving). See TyreDamage for how many rounds that takes.
	 */
	private damageTyre(index: number, damage: number, x: number, y: number, z: number) {
		if (index < 0) return;
		while (this.tyres.length <= index) this.tyres.push(newTyre());
		const tyre = this.tyres[index];
		// A thud into rubber, not the ring of a round off metal.
		playAt("hit-flesh", x, y, z, { level: 0.35, rate: 0.62, variation: 0.08, channel: "impacts" });
		if (!hitTyre(tyre, this.build, damage)) return;
		playAt("tyre-hiss", x, y, z, { level: 0.55, variation: 0.06, channel: "vehicles" });
	}

	/**
	 * A blast close by: the windows go once it's strong enough, and the near tyres burst. (Its
	 * hit to the car's condition and its shove are handled with every other blast.)
	 */
	private blastDamage(amount: number, x: number, y: number, z: number) {
		const model = this.bodyModel();
		if (amount >= 30) model?.shatterGlass(x, y, z);
		if (amount < 45) return;
		const corners = model?.wheelCorners ?? [];
		const position = this.entity.getPosition();
		const radians = this.headingDegrees / DEGREES;
		// Which side and end the blast is on, in the car's own frame (+X its left).
		const ax = x - position.x;
		const az = z - position.z;
		const along = ax * Math.sin(radians) + az * Math.cos(radians);
		const across = ax * Math.cos(radians) - az * Math.sin(radians);
		corners.forEach((corner, index) => {
			const facing = (corner.left ? across > -0.5 : across < 0.5) && (corner.front ? along > -1.5 : along < 1.5);
			if (facing || amount >= 70) this.damageTyre(index, 999, x, y, z);
		});
	}

	/** Lets the air out of holed tyres and hands the handling to the car's physics. */
	private updateTyres(dt: number) {
		if (this.tyres.length === 0) return;
		let any = false;
		for (const tyre of this.tyres) {
			deflate(tyre, dt);
			if (tyre.deflation > 0) any = true;
		}
		const physics = this.physics;
		if (!physics) return;
		const corners = this.bodyModel()?.wheelCorners;
		physics.tyres = any && corners ? tyreHandling(this.tyres, corners, this.tyreEffect) : NO_TYRE_EFFECT;
	}

	/** Share of its usual pace a lane-following car keeps on flats: it limps on, hazards and all. */
	private get flatPace(): number {
		let worst = 0;
		for (const tyre of this.tyres) worst = Math.max(worst, tyre.deflation);
		return 1 - 0.6 * worst;
	}

	/** This car as a combat target: an oriented box the size of its collider. */
	private registerTarget() {
		const isAlive = () => !this.burnedOut && !this.stowed;
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
			refineHit: (ray: Readonly<RayLike>, entry: number, limit: number, detail: HitDetail) => this.bodyModel()?.refineHit(ray, entry, limit, detail) ?? entry,
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

	/** How hard the front tyres are washing wide past their grip (0 = gripping); for the tyre sound. */
	public get frontSlide(): number {
		return this.manual && this.physics ? this.physics.frontSlide : 0;
	}

	/** An ambulance or a fire engine: its beacons flash in their own pattern (OrionVehicleModel). */
	public get emergency(): boolean {
		return EMERGENCY_STYLES.has(this.style);
	}

	/**
	 * Whether the beacons are going. A police car's: on a chase or driven by the player; off
	 * parked, and off for a unit that's been called off and is heading back. An ambulance's or a
	 * fire engine's: with the player at the wheel, an engine out on a call, or `sirenOn` — which
	 * holds parked too, as at the scene of a call.
	 */
	public get lightsFlashing(): boolean {
		if (this.driver === "wrecked" || this.integrity <= 0) return false;
		if (this.emergency) return this.sirenOn || this.driver === "player" || this.onCall;
		if (!this.police || this.driver === "parked") return false;
		return !(this.pursuitSlot >= 0 && readWanted().stars === 0);
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
		// A put-out engine fire only lights again with a fresh blow to a car that's still hot or
		// still wrecked enough to burn: a real cause, never on its own.
		if (this.blaze.out) {
			this.damageSinceOut += amount;
			if (this.damageSinceOut >= REIGNITE_DAMAGE && this.integrity < BURNING_BELOW) {
				this.blaze.reset();
				this.damageSinceOut = 0;
			}
		}
	}

	public get mass(): number {
		return this.carPhysics().spec.mass;
	}

	/** Yaw inertia, kg·m². */
	public get inertia(): number {
		return this.carPhysics().spec.inertia;
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
		if (Math.hypot(deltaVelocityX, deltaVelocityZ) > KNOCK_DELTA_V) car.knock(KNOCK_SECONDS);
	}

	/**
	 * A fresh start after the player dies or is arrested: police units off the street, the
	 * station's cars back in their bays, and every other car whole and back in traffic.
	 */
	private resetForNewGame() {
		lastPursuitDispatch = -Infinity;
		this.playerHarmedAt = -Infinity;
		this.crew = [];
		this.dispatchTimer = 0;
		if (this.pursuitSlot >= 0 || this.fireSlot >= 0 || this.missionSlot >= 0) {
			this.releaseFire();
			this.stow();
			return;
		}
		if (this.hasHome) {
			this.parkAtHome();
			return;
		}
		this.driver = "ai";
		this.manual = false;
		this.repair();
		this.carjack.reset();
		this.respawnNearPlayer(RESPAWN_MIN);
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
		this.clearTrafficAround(this.homeX, this.homeZ, this.homeYaw / DEGREES);
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
		this.bodyModel()?.resetDamage();
		this.burnedOut = false;
		this.integrity = 100;
		this.burnTimer = 0;
		this.fireHeld = false;
		this.blaze.reset();
		this.scorched = false;
		this.damageSinceOut = 0;
		for (const tyre of this.tyres) repairTyre(tyre);
		if (this.physics) {
			this.physics.powerFactor = 1;
			this.physics.tyres = NO_TYRE_EFFECT;
		}
	}

	private carPhysics(): CarPhysics {
		this.physics ??= new CarPhysics(carSpecFor(this.style, this.halfLength * 2, this.halfWidth * 2));
		return this.physics;
	}

	/** Hands the car from lane-following to the physics model, keeping its motion. */
	private beginManual(): CarPhysics {
		const car = this.carPhysics();
		if (!this.manual) {
			// From the lane's pose, which the agent holds: the entity is only re-posed now and then
			// (see applyPose), and React can put its spawn position back between frames.
			const position = this.entity.getPosition();
			car.reset(this.agent?.x ?? position.x, this.agent?.z ?? position.z, this.headingDegrees / DEGREES, this.speed);
			this.rideY = this.rideHeight;
			this.manual = true;
			this.resting = false;
			this.stillFor = 0;
		}
		return car;
	}

	private updateManual(dt: number) {
		const car = this.beginManual();
		const idle = this.driver === "parked" || this.driver === "wrecked";
		if (this.resting) {
			const nudged = Math.abs(car.velocityX) + Math.abs(car.velocityZ) + Math.abs(car.yawRate) > 1e-4;
			if (idle && !nudged) {
				// React can re-apply the spawn position between frames: put it back where it rests.
				const at = this.entity.getPosition();
				if (Math.abs(at.x - car.x) > 1e-3 || Math.abs(at.z - car.z) > 1e-3 || Math.abs(at.y - this.rideY) > 1e-3) this.placeEntity(car);
				return;
			}
			this.resting = false;
			this.stillFor = 0;
		}
		const controls = this.controls;
		if (this.driver === "player") {
			controls.brake = 0;
		} else if (this.driver === "police") {
			this.pursue(dt, car);
		} else if (this.driver === "fire") {
			this.respondToFire(dt, car);
			controls.brake = 0;
		} else if (this.driver === "convoy") {
			this.driveRoute(dt, car);
		} else {
			controls.drive = 0;
			controls.steer = 0;
			controls.handbrake = this.driver === "parked";
			// A crashed car rolls to a stop; a stopped or parked one stays put.
			controls.brake = this.driver === "wrecked" ? 0.35 : 1;
		}

		car.stabilityControl = this.driver !== "wrecked";
		const previousX = car.x;
		const previousZ = car.z;
		const previousHeading = car.heading;
		car.step(dt, controls);
		this.impact = this.receivedImpact;
		this.receivedImpact = 0;
		this.contactClock += dt;
		const moved = Math.hypot(car.x - previousX, car.z - previousZ) > 1e-5;
		const turned = car.heading !== previousHeading;
		if (moved) this.resolveCollisions(car, previousX, previousZ);
		// The sweep only follows the centre's travel: a car turning or spinning on the spot swings its
		// corners into whatever's beside it, and a ray that starts inside a wall never reports it.
		if (moved || turned) this.pushOutOfWorld(car);
		if (moved || turned) this.resolveCarContacts(car, previousX, previousZ, previousHeading);
		if (moved) this.strikePeople(car);

		this.headingDegrees = car.heading * DEGREES;
		let ground = this.groundHeight(car.x, car.z, this.rideY);
		const settle = 1 - Math.exp(-RIDE_SMOOTHING * dt);
		// Off the paved roads the ground can slope: sample under the nose, tail and both sides,
		// and lie the car along it rather than level, half in and half above the hill.
		let pitch = 0;
		let roll = 0;
		if (pavedHeightAt(car.x, car.z) === null) {
			const sin = Math.sin(car.heading);
			const cos = Math.cos(car.heading);
			const reach = this.halfLength * 0.8;
			const side = this.halfWidth * 0.9;
			const front = this.groundHeight(car.x + sin * reach, car.z + cos * reach, this.rideY);
			const back = this.groundHeight(car.x - sin * reach, car.z - cos * reach, this.rideY);
			// Left of the car is +X at heading 0: (cos, −sin).
			const left = this.groundHeight(car.x + cos * side, car.z - sin * side, this.rideY);
			const right = this.groundHeight(car.x - cos * side, car.z + sin * side, this.rideY);
			// Capped: at a cliff edge the ground under the nose can be tens of metres down.
			pitch = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan2(front - back, reach * 2)));
			roll = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan2(left - right, side * 2)));
			// Over a crest the middle rides on the higher of the two axles' average and the centre.
			ground = Math.max(ground, (front + back) / 2, (left + right) / 2);
		}
		// In the air it keeps the attitude it left the ground with.
		if (this.fallSpeed === 0) {
			this.pitch += (pitch - this.pitch) * settle;
			this.roll += (roll - this.roll) * settle;
		}
		const rest = ground + this.halfHeight;
		if (this.fallSpeed > 0 || this.rideY - rest > FALL_STEP) {
			// Off an edge: it falls, rather than riding on thin air, and lands on whatever is below.
			this.fallSpeed += GRAVITY * dt;
			this.rideY -= this.fallSpeed * dt;
			if (this.rideY <= rest) {
				this.rideY = rest;
				if (this.fallSpeed > SAFE_LANDING_SPEED) this.applyDamage((this.fallSpeed - SAFE_LANDING_SPEED) * LANDING_DAMAGE_PER_MS);
				this.impact = Math.max(this.impact, this.fallSpeed * 0.3);
				this.fallSpeed = 0;
			}
		} else {
			this.rideY += (rest - this.rideY) * settle;
		}
		// Smoothed over bumps, but never below the ground: climbing a hillside fast, the lag put
		// the car metres under the slope, where it lost sight of it and drove on inside the hill.
		this.rideY = Math.max(this.rideY, rest - 0.05);
		const y = this.rideY;
		this.placeEntity(car);
		// Settled for a moment with nothing moving it: stop stepping it (see `resting`).
		const settled = idle && car.speed < REST_SPEED && Math.abs(car.yawRate) < REST_YAW_RATE && this.fallSpeed === 0 && this.impact === 0
			&& Math.abs(this.rideY - rest) < 0.005 && Math.abs(pitch - this.pitch) < 1e-3 && Math.abs(roll - this.roll) < 1e-3;
		this.stillFor = settled ? this.stillFor + dt : 0;
		if (this.stillFor > REST_AFTER) {
			this.resting = true;
			car.velocityX = 0;
			car.velocityZ = 0;
			car.yawRate = 0;
		}
		this.speed = car.forwardSpeed;
		this.layRubber(car, y - this.halfHeight);
		this.updateAgentAndLights(dt, car);
	}

	/** The entity at the car's pose: position, heading, and the tilt of the ground under it. */
	private placeEntity(car: CarPhysics) {
		this.entity.setPosition(car.x, this.rideY, car.z);
		if (Math.abs(this.pitch) < 1e-3 && Math.abs(this.roll) < 1e-3) {
			this.entity.setEulerAngles(0, this.headingDegrees, 0);
		} else {
			// Heading about the vertical, then the nose up (turning +Z towards +Y is a negative
			// turn about X), then the left side up (+X towards +Y, positive about Z).
			tiltYaw.setFromAxisAngle(Vec3.UP, this.headingDegrees);
			tiltPitch.setFromAxisAngle(Vec3.RIGHT, (-this.pitch * 180) / Math.PI);
			tiltRoll.setFromAxisAngle(Vec3.BACK, (this.roll * 180) / Math.PI);
			this.entity.setRotation(tiltYaw.mul(tiltPitch).mul(tiltRoll));
		}
	}

	private updateAgentAndLights(dt: number, car: CarPhysics) {
		const controls = this.controls;
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
		const pursuing = this.driver === "police";
		this.braking = car.braking || controls.handbrake || (!player && !pursuing && car.speed > 0.2);
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
		const fire = this.blaze;
		if (!this.burnedOut) {
			// Low enough, the engine catches — unless that fire has been put out.
			if (this.integrity < BURNING_BELOW && fire.stage === "none") fire.ignite(false);
			// A mission holding the fire (a crash scene) keeps it burning without burning down.
			if (fire.burning && !this.fireHeld) {
				// The fire eats what's left of the car as hard as it's burning, then the tank goes.
				this.integrity = Math.max(0, this.integrity - FIRE_DRAIN_PER_SECOND * fire.intensity * dt);
				if (this.integrity <= 0) {
					this.burnTimer += dt;
					if (this.burnTimer >= BURN_SECONDS) {
						this.explode(x, y, z);
						return;
					}
				}
			}
		}
		const wasBurning = fire.burning;
		fire.update(dt, this.burnedOut ? WRECK_BURN_RATE : 0);
		if (wasBurning && !fire.burning) this.fireWentOut();
		if (this.physics) this.physics.powerFactor = fire.out || fire.burning ? powerFactor(0) : powerFactor(this.integrity);

		const effect = this.damageEffect();
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
		source.water = fire.water;
		crashEffects(this.app).vehicleDamage(this, source, dt);
	}

	/** What the car gives off now: engine smoke, flames as strong as the fire, the smoke and steam after. */
	private damageEffect(): DamageEffect | null {
		const fire = this.blaze;
		const effect = this.effectScratch;
		if (fire.burning) {
			effect.stage = this.burnedOut ? "wreck-fire" : "burning";
			effect.severity = fire.intensity;
			return effect;
		}
		if (fire.smouldering) {
			effect.stage = "smouldering";
			effect.severity = fire.residue;
			return effect;
		}
		if (this.burnedOut || fire.out || this.integrity >= SMOKING_BELOW) return null;
		effect.stage = "smoking";
		effect.severity = Math.max(0, Math.min(1, 1 - (this.integrity - BURNING_BELOW) / (SMOKING_BELOW - BURNING_BELOW)));
		return effect;
	}

	private readonly effectScratch: DamageEffect = { stage: "smoking", severity: 0 };

	/**
	 * The car goes up: a fireball, and everything close by is hurt and thrown clear. What's
	 * left is a burnt shell that stays put until it's recycled.
	 */
	private explode(x: number, y: number, z: number) {
		// The player's doing if they were driving a police car into it, or had been hurting this one.
		const blamed = performance.now() / 1000 - this.playerHarmedAt < PLAYER_BLAME_SECONDS;
		if (blamed && (this.driver !== "player" || this.police)) reportCrime(this.police ? "policeCarDestroyed" : "vehicleDestroyed", x, z);
		this.burnedOut = true;
		this.integrity = 0;
		this.burnTimer = 0;
		// The whole car alight now, burning down what's left of it.
		this.blaze.ignite(true, 1);
		emitGameEvent({ type: "vehicleDestroyed", id: this.entity.name, byPlayer: blamed || this.driver === "player" });
		crashEffects(this.app).explosion(x, y + this.halfHeight * 0.5, z, y - this.halfHeight);
		// Every window blown out, the tyres burnt down to the rims, soot over the shell and a
		// scorch on the road under it: what stays once the fire's out.
		const model = this.bodyModel();
		model?.shatterGlass(x, y, z);
		model?.scorch(1, true);
		const corners = model?.wheelCorners ?? [];
		for (let index = 0; index < corners.length; index++) {
			while (this.tyres.length <= index) this.tyres.push(newTyre());
			const tyre = this.tyres[index];
			tyre.punctured = true;
			tyre.deflation = Math.max(tyre.deflation, 0.6);
		}
		decals(this.app).place("soot", null, x, y - this.halfHeight + 0.01, z, 0, 1, 0, Math.max(this.halfLength, this.halfWidth) * 2.6, { life: 600, opacity: 0.85 });

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
		// Traffic and a police unit on a chase both stop being driven: the shell rolls to a stop.
		this.driver = this.driver === "ai" || this.driver === "police" ? "wrecked" : this.driver;
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
	 * Sweeps the body outline along this step's movement, against the world (other vehicles are
	 * resolveCarContacts' job). On contact the car stops at the surface, the speed into it
	 * bounces back a little, the rest scrapes along, and an off-centre hit spins the car.
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
			// A tall vehicle adds a low one, so it can't ride over a low obstacle.
			for (let lift = -1; lift < SWEEP_LIFTS.length; lift++) {
				const low = centreY - this.halfHeight + SWEEP_LOW_ABOVE_BOTTOM;
				if (lift < 0 && low > centreY - 0.25) continue;
				const y = lift < 0 ? low : centreY + SWEEP_LIFTS[lift] * this.halfHeight;
				this.rayFrom.set(fromX + px, y, fromZ + pz);
				this.rayTo.set(fromX + px + dirX * reach, y, fromZ + pz + dirZ * reach);
				// Vehicles are left out: their colliders are only where their last physics step
				// put them, and a ray starting inside one never reports it.
				for (const hit of raycastAll(this.rayFrom, this.rayTo, { filterCallback: this.notSolidBody })) {
					if (Math.abs(hit.normal.y) > DRIVABLE_SLOPE_UP) continue;
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

		this.hitWall(car, nx, nz, best.point, offsetX, offsetZ, closing);
	}

	/**
	 * Pushes the body back out of anything solid it has ended up in (bar other vehicles: see
	 * resolveCarContacts). The sweep only follows the centre's travel and a ray starting inside a
	 * wall never reports it, so a car turning or spinning against a building put its corner
	 * through the wall and then sat there half inside. Here rays run from the body's centre out to
	 * points round its outline: one that meets a wall on the way has that point through it, by as
	 * far as the point lies past the surface, and the car is moved back out by the deepest.
	 */
	private pushOutOfWorld(car: CarPhysics) {
		const raycastAll = this.raycastAll;
		if (!raycastAll) return;
		const centreY = this.rideY;
		for (let pass = 0; pass < PUSH_OUT_PASSES; pass++) {
			const sin = Math.sin(car.heading);
			const cos = Math.cos(car.heading);
			let deepest = 0;
			let nx = 0;
			let nz = 0;
			let offsetX = 0;
			let offsetZ = 0;
			let point: Vec3 | null = null;
			for (const [side, along] of OUTLINE_POINTS) {
				const px = along * this.halfLength * sin + side * this.halfWidth * cos;
				const pz = along * this.halfLength * cos - side * this.halfWidth * sin;
				const reach = Math.hypot(px, pz) || 1;
				// The same heights as the sweep (see resolveCollisions).
				for (let lift = -1; lift < SWEEP_LIFTS.length; lift++) {
					const low = centreY - this.halfHeight + SWEEP_LOW_ABOVE_BOTTOM;
					if (lift < 0 && low > centreY - 0.25) continue;
					const y = lift < 0 ? low : centreY + SWEEP_LIFTS[lift] * this.halfHeight;
					this.rayFrom.set(car.x, y, car.z);
					this.rayTo.set(car.x + px, y, car.z + pz);
					for (const hit of raycastAll(this.rayFrom, this.rayTo, { filterCallback: this.notSolidBody })) {
						if (Math.abs(hit.normal.y) > DRIVABLE_SLOPE_UP) continue;
						const length = Math.hypot(hit.normal.x, hit.normal.z) || 1;
						let hx = hit.normal.x / length;
						let hz = hit.normal.z / length;
						// Facing back towards the centre, whichever side of the face the ray met.
						if (hx * px + hz * pz > 0) {
							hx = -hx;
							hz = -hz;
						}
						// How far the outline point lies past the surface, along its normal.
						const depth = (hit.point.x - car.x - px) * hx + (hit.point.z - car.z - pz) * hz;
						if (depth <= deepest || depth > reach) continue;
						deepest = depth;
						nx = hx;
						nz = hz;
						offsetX = px;
						offsetZ = pz;
						point = hit.point;
					}
				}
			}
			if (!point || deepest <= 0) return;
			car.x += nx * (deepest + COLLISION_SKIN);
			car.z += nz * (deepest + COLLISION_SKIN);
			const closing = (car.velocityX + car.yawRate * offsetZ) * nx + (car.velocityZ - car.yawRate * offsetX) * nz;
			if (closing < 0) this.hitWall(car, nx, nz, point, offsetX, offsetZ, closing);
		}
	}

	/**
	 * Hitting a wall at `point` (`offset` from the car's centre), its surface facing (nx, nz), at
	 * `closing` m/s: the speed into it bounces back a little, the rest scrapes along, and an
	 * off-centre hit spins the car.
	 */
	private hitWall(car: CarPhysics, nx: number, nz: number, point: Vec3, offsetX: number, offsetZ: number, closing: number) {
		const result = crashImpulse(
			{ mass: car.spec.mass, inertia: car.spec.inertia / IMPACT_SPIN, velocityX: car.velocityX, velocityZ: car.velocityZ, turnRate: car.yawRate, offsetX, offsetZ },
			WALL,
			nx,
			nz,
			RESTITUTION,
			WALL_FRICTION,
		);
		car.velocityX = result.a.velocityX;
		car.velocityZ = result.a.velocityZ;
		car.yawRate = result.a.turnRate;
		const change = result.deltaVA;
		this.applyDamage(crashDamage(change, this.build) * this.crashResistance);
		if (!this.newCollision(null, -closing)) return;
		if (change > KNOCK_DELTA_V) car.knock(KNOCK_SECONDS);
		this.impact = Math.max(this.impact, -closing);
		this.crashSound(change, point.x, point.z);
		// The blow shows on the body where it landed: pushed in along the obstacle's normal.
		this.bodyCrash(point.x, point.y, point.z, nx, nz, change);
		if (change > SPARK_DELTA_V) crashEffects(this.app).impact(point.x, point.y, point.z, -nx, 0.3, -nz, "metal");
	}

	/**
	 * Whether a contact closing at `closing` m/s is a collision worth its effects: hard enough to
	 * be more than a push, and not the same contact carrying on (a scrape along a wall, two cars
	 * leaning on each other) — so one crash makes one crunch, however many frames it lasts.
	 */
	private newCollision(other: OrionVehicle | null, closing: number): boolean {
		const last = this.touching.get(other);
		this.touching.set(other, this.contactClock);
		if (other) other.touching.set(this, other.contactClock);
		if (closing < CONTACT_PUSH_SPEED) return false;
		return last === undefined || this.contactClock - last > CONTACT_MEMORY || closing >= REHIT_SPEED;
	}

	/** Where the body is in the plane (see VehicleContacts); false while it's out of the world. */
	public footprint(out: Footprint): boolean {
		if (this.stowed) return false;
		if (this.manual && this.physics) {
			out.x = this.physics.x;
			out.z = this.physics.z;
			out.sin = Math.sin(this.physics.heading);
			out.cos = Math.cos(this.physics.heading);
		} else if (this.agent) {
			out.x = this.agent.x;
			out.z = this.agent.z;
			const length = Math.hypot(this.agent.headingX, this.agent.headingZ);
			out.sin = length > 0 ? this.agent.headingX / length : 0;
			out.cos = length > 0 ? this.agent.headingZ / length : 1;
		} else {
			return false;
		}
		out.halfLength = this.halfLength;
		out.halfWidth = this.halfWidth;
		return true;
	}

	/** Height of the body's centre (to tell a car on a deck from one on the road under it). */
	public get bodyY(): number {
		return this.manual ? this.rideY : this.rideHeight;
	}

	/** Whether two bodies are at heights where they can touch. */
	private level(other: OrionVehicle): boolean {
		return Math.abs(other.bodyY - this.bodyY) < other.halfHeight + this.halfHeight;
	}

	/**
	 * Car against car, for a car on CarPhysics: every other vehicle's footprint is tested against
	 * this one along the step just taken (in a few steps when it moved far, so a fast car can't
	 * jump through another), and any overlap is pushed apart and answered with an impulse.
	 */
	private resolveCarContacts(car: CarPhysics, fromX: number, fromZ: number, fromHeading: number) {
		const own = ownFootprint;
		const other = otherFootprint;
		const turn = wrapAngle(car.heading - fromHeading);
		const travel = Math.hypot(car.x - fromX, car.z - fromZ) + Math.abs(turn) * this.halfLength;
		const samples = Math.min(MAX_SWEEP_SAMPLES, Math.max(1, Math.ceil(travel / (this.halfWidth * SWEEP_SPACING))));
		const ownRadius = Math.hypot(this.halfLength, this.halfWidth);
		own.halfLength = this.halfLength;
		own.halfWidth = this.halfWidth;
		for (const candidate of drivableCars()) {
			if (candidate === this || !candidate.footprint(other) || !this.level(candidate)) continue;
			const reach = travel + ownRadius + Math.hypot(other.halfLength, other.halfWidth);
			const endX = car.x;
			const endZ = car.z;
			const endHeading = car.heading;
			if ((other.x - endX) ** 2 + (other.z - endZ) ** 2 > reach * reach) continue;
			let contact: Contact | null = null;
			for (let i = 1; i <= samples && !contact; i++) {
				const back = 1 - i / samples;
				const heading = endHeading - turn * back;
				own.x = endX + (fromX - endX) * back;
				own.z = endZ + (fromZ - endZ) * back;
				own.sin = Math.sin(heading);
				own.cos = Math.cos(heading);
				contact = footprintContact(own, other);
				// Touching part way along: the car gets no further than that.
				if (contact && back > 0) {
					car.x = own.x;
					car.z = own.z;
					car.heading = heading;
				}
			}
			if (contact) this.collideWith(car, candidate, contact);
		}
	}

	/** Parts this car (on CarPhysics) and another that overlaps it, and deals the crash to both. */
	private collideWith(car: CarPhysics, other: OrionVehicle, contact: Contact) {
		const { normalX: nx, normalZ: nz, depth, pointX, pointZ } = contact;
		const otherCar = other.manual ? other.physics : null;
		const otherVelocityX = other.velocityX;
		const otherVelocityZ = other.velocityZ;
		const otherX = otherCar ? otherCar.x : (other.agent?.x ?? pointX);
		const otherZ = otherCar ? otherCar.z : (other.agent?.z ?? pointZ);
		const offsetX = pointX - car.x;
		const offsetZ = pointZ - car.z;
		const otherOffsetX = pointX - otherX;
		const otherOffsetZ = pointZ - otherZ;
		const otherTurn = otherCar ? otherCar.yawRate : other.turnRate / DEGREES;
		// Closing speed at the contact point (negative while they come together).
		const closing = (car.velocityX + car.yawRate * offsetZ - (otherVelocityX + otherTurn * otherOffsetZ)) * nx
			+ (car.velocityZ - car.yawRate * offsetX - (otherVelocityZ - otherTurn * otherOffsetX)) * nz;
		// A car on its lane gives way to nothing short of a real knock: nudged, it holds its line
		// like a wall and this car does all the moving. A showroom car never moves.
		const movable = !other.forSale && (other.manual || -closing >= KNOCK_OFF_LANE_SPEED);
		const [share, otherShare] = separationShares(car.spec.mass, other.mass, movable);
		car.x += nx * depth * share;
		car.z += nz * depth * share;
		if (movable) other.shove(-nx * depth * otherShare, -nz * depth * otherShare);
		if (closing >= 0) {
			this.touching.set(other, this.contactClock);
			return;
		}

		const result = crashImpulse(
			{ mass: car.spec.mass, inertia: car.spec.inertia / IMPACT_SPIN, velocityX: car.velocityX, velocityZ: car.velocityZ, turnRate: car.yawRate, offsetX, offsetZ },
			movable
				? { mass: other.mass, inertia: other.inertia / IMPACT_SPIN, velocityX: otherVelocityX, velocityZ: otherVelocityZ, turnRate: otherTurn, offsetX: otherOffsetX, offsetZ: otherOffsetZ }
				: { ...WALL, velocityX: otherVelocityX, velocityZ: otherVelocityZ },
			nx,
			nz,
			RESTITUTION,
			CAR_FRICTION,
		);
		car.velocityX = result.a.velocityX;
		car.velocityZ = result.a.velocityZ;
		car.yawRate = result.a.turnRate;
		if (movable) other.takeContactImpulse(result.b.velocityX - otherVelocityX, result.b.velocityZ - otherVelocityZ, result.b.turnRate - otherTurn);

		const change = result.deltaVA;
		const otherChange = movable ? result.deltaVB : 0;
		// Both cars are hurt by their own change of velocity, so the lighter one comes off worse,
		// and each by its own build: a bus or a lorry takes many more hits than a car.
		this.applyDamage(crashDamage(change, this.build) * this.crashResistance);
		if (!other.forSale) other.applyDamage(crashDamage(otherChange, other.build) * other.crashResistance);
		if (this.driver === "player" && -closing >= CONTACT_PUSH_SPEED) other.playerHarmedAt = performance.now() / 1000;
		if (!this.newCollision(other, -closing)) return;
		if (change > KNOCK_DELTA_V) car.knock(KNOCK_SECONDS);
		this.impact = Math.max(this.impact, -closing);
		other.receivedImpact = Math.max(other.receivedImpact, -closing);
		// One crunch for the pair, as hard as the harder of the two blows: the gap before the next
		// is shared, so the other car can't sound the same knock again from its side.
		if (other.sinceCrashSound >= CRASH_SOUND_GAP) this.crashSound(Math.max(change, otherChange), pointX, pointZ);
		other.sinceCrashSound = Math.min(other.sinceCrashSound, this.sinceCrashSound);
		const pointY = Math.min(this.bodyY, other.bodyY);
		this.bodyCrash(pointX, pointY, pointZ, nx, nz, change);
		other.bodyCrash(pointX, pointY, pointZ, -nx, -nz, otherChange);
		if (Math.max(change, otherChange) > SPARK_DELTA_V) crashEffects(this.app).impact(pointX, pointY, pointZ, -nx, 0.3, -nz, "metal");
	}

	/** Moved by a car pushing out of it (see collideWith). */
	private shove(dx: number, dz: number) {
		const car = this.beginManual();
		if (this.driver === "ai") this.driver = "wrecked";
		car.x += dx;
		car.z += dz;
		this.resting = false;
		this.stillFor = 0;
	}

	/**
	 * Struck by another car: the change of motion the impact dealt. Traffic loses its lane and
	 * slides as a wreck; the player's car takes it too (a police ram shoves it), but stays theirs.
	 */
	private takeContactImpulse(deltaVelocityX: number, deltaVelocityZ: number, spin: number) {
		const car = this.beginManual();
		if (this.driver === "ai") this.driver = "wrecked";
		car.velocityX += deltaVelocityX;
		car.velocityZ += deltaVelocityZ;
		car.yawRate += spin;
		this.resting = false;
		this.stillFor = 0;
		if (Math.hypot(deltaVelocityX, deltaVelocityZ) > KNOCK_DELTA_V) car.knock(KNOCK_SECONDS);
	}

	/**
	 * The noise of hitting something, as loud as the hit was hard. Called once per collision (see
	 * newCollision), and with a gap before the next, so a pile-up isn't a machine-gun of crunches.
	 */
	private crashSound(change: number, x: number, z: number) {
		if (this.sinceCrashSound < CRASH_SOUND_GAP) return;
		// Up to 1.5 for a write-off: the worst also breaks glass (see CombatAudio.playCrash).
		const severity = Math.min(1.5, change / CRASH_FULL_VOLUME);
		if (severity < CRASH_QUIETEST) return;
		this.sinceCrashSound = 0;
		combatAudio().play("crash", x, this.bodyY, z, severity);
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
			if (this.driver === "player") reportCrime("murder", person.x, person.z);
			this.applyDamage(PEDESTRIAN_DAMAGE);
			// The car loses the momentum the body carries away.
			const keep = 1 - (PERSON_MASS * 1.05) / car.spec.mass;
			car.velocityX *= keep;
			car.velocityZ *= keep;
			this.impact = Math.max(this.impact, speed * 0.25);
		}
	}

	/**
	 * Police pursuit units, every frame. Returns true when the unit is out of the world and nothing
	 * else should run.
	 *
	 * The wanted level decides how many units are out: one per star. Units are sent one at a time,
	 * a few seconds apart, from out of sight; one that falls far behind is brought round again,
	 * and once it's no longer needed (the stars dropped, it was wrecked, or the player took it)
	 * it's withdrawn the next time nobody can see it.
	 */
	private updatePursuitSlot(dt: number): boolean {
		const wanted = readWanted();
		const needed = wanted.stars > 0;
		if (this.stowed) {
			// One unit per star still in the chase: a unit destroyed or taken is replaced by the next
			// one waiting, even while the wreck is still in view.
			this.dispatchTimer = needed ? this.dispatchTimer + dt : 0;
			const now = performance.now() / 1000;
			const spaced = now - lastPursuitDispatch >= DISPATCH_STAGGER;
			if (this.dispatchTimer >= FIRST_DISPATCH_DELAY && spaced && chasingUnits() < wanted.stars) {
				lastPursuitDispatch = now;
				this.dispatch();
			}
			return this.stowed;
		}
		if (this.driver === "player" || this.driver === "held") return false;
		const position = this.entity.getPosition();
		const player = readPlayerPose();
		const distance = Math.hypot(position.x - player.x, position.z - player.z);
		const unseen = !inCameraView(position.x, position.z, VISIBLE_RANGE) || distance > RECYCLE_HARD_LIMIT;
		const done = !needed || !this.chasing;
		if (done && unseen && distance > 60) {
			this.stow();
			return true;
		}
		if (!done && unseen && distance > PURSUIT_LEASH) this.dispatch();
		return false;
	}

	/** Sends the unit in: onto a road out of sight near the player, lights on, engine running. */
	private dispatch() {
		this.stowed = false;
		this.dispatchTimer = 0;
		this.repair();
		this.carjack.reset();
		this.setStowedVisible(true);
		this.manual = false;
		this.respawnNearPlayer(DISPATCH_MIN);
		this.driver = "police";
		const car = this.beginManual();
		// Out of sight, so it can be turned round: facing the player, not driving away from them.
		const player = readPlayerPose();
		const facing = Math.sin(car.heading) * (player.x - car.x) + Math.cos(car.heading) * (player.z - car.z) >= 0;
		car.reset(car.x, car.z, facing ? car.heading : car.heading + Math.PI, 12);
		this.routeX = -1;
		this.stuckSeconds = 0;
		this.reverseSeconds = 0;
		this.fireTimer = 1.2;
		this.crew = [];
		this.dismountSeconds = 0;
		this.crewCooldown = 0;
		this.seesPlayer = false;
	}

	/**
	 * Into the world for a mission: whole, at (x, z) facing `yaw` degrees, and either parked
	 * (nobody in it) or setting off along `route` with its driver.
	 */
	public placeForMission(x: number, z: number, yaw: number, route: readonly (readonly [number, number])[] | null, options: MissionDriving = {}) {
		this.stowed = false;
		this.setStowedVisible(true);
		this.repair();
		this.carjack.reset();
		this.playerHarmedAt = -Infinity;
		const car = this.carPhysics();
		car.reset(x, z, yaw / DEGREES, 0);
		this.manual = true;
		this.resting = false;
		this.stillFor = 0;
		this.speed = 0;
		this.headingDegrees = yaw;
		this.rideY = this.groundHeight(x, z, this.rideHeight + 20) + this.halfHeight;
		this.entity.setPosition(x, this.rideY, z);
		this.entity.setEulerAngles(0, yaw, 0);
		this.entity.rigidbody?.teleport(x, this.rideY, z, 0, yaw, 0);
		if (this.agent) {
			this.agent.x = x;
			this.agent.z = z;
			this.agent.speed = 0;
		}
		this.clearTrafficAround(x, z, yaw / DEGREES);
		this.touching.clear();
		this.lastYaw = null;
		this.missionRoute = route && route.length > 0 ? route : null;
		this.missionRouteIndex = 0;
		this.missionClaimed = true;
		this.missionCruise = options.cruise ?? MISSION_CRUISE;
		this.missionStartX = x;
		this.missionStartZ = z;
		this.missionStuckSeconds = 0;
		this.stuckSeconds = 0;
		this.reverseSeconds = 0;
		this.missionRacer = options.racer ?? false;
		this.missionHeld = this.missionRacer;
		this.missionDisableBelow = options.disableBelow ?? 0;
		this.driver = this.missionRoute ? "convoy" : "parked";
		if (options.integrity !== undefined) this.integrity = Math.max(1, Math.min(100, options.integrity));
		if (options.burning) this.holdFire();
	}

	/**
	 * A mission car catches fire and keeps burning without burning down: the fire's held until
	 * the mission lets it burn (letBurn) — then it goes up about twenty seconds later, as any
	 * burning car does — or a fire crew puts it out. A crash scene stays a scene until the
	 * player has done something about it.
	 */
	public holdFire() {
		if (!this.missionClaimed || this.burnedOut) return;
		this.integrity = Math.min(this.integrity, BURNING_BELOW - 1);
		this.fireHeld = true;
	}

	/** A held fire burns on as any other does: down to nothing, then the car goes up. */
	public letBurn() {
		this.fireHeld = false;
	}

	/**
	 * The mission's done with it: it stops where it is (a convoy van pulls up) and leaves once
	 * nobody's looking — wrecks included, so nothing vanishes in front of the player.
	 */
	public releaseFromMission() {
		// A crash-scene fire the mission was holding is put out, not left to go up later.
		if (this.fireHeld) {
			this.fireHeld = false;
			this.extinguish();
		}
		this.missionRoute = null;
		this.missionClaimed = false;
		this.missionRacer = false;
		this.missionHeld = false;
		this.missionDisableBelow = 0;
		if (this.driver === "convoy") this.driver = "parked";
	}

	/** Where it is and what shape it's in, while a mission has it out. */
	public get missionState(): { x: number; z: number; integrity: number; onFire: boolean } | null {
		if (!this.missionClaimed || this.stowed) return null;
		const car = this.carPhysics();
		return { x: car.x, z: car.z, integrity: this.burnedOut ? 0 : this.integrity, onFire: this.onFire };
	}

	/** Keeps to its road at a new speed. */
	public pace(cruise: number) {
		if (this.missionClaimed) this.missionCruise = cruise;
	}

	/** A new road to drive (and pace), from where it is now; a car that had pulled over sets off again. */
	public reroute(route: readonly (readonly [number, number])[], cruise?: number) {
		if (!this.missionClaimed || this.stowed || this.burnedOut || route.length === 0) return;
		if (this.missionDisableBelow > 0 && this.integrity < this.missionDisableBelow) return;
		const car = this.carPhysics();
		this.missionRoute = route;
		this.missionRouteIndex = 0;
		this.missionStartX = car.x;
		this.missionStartZ = car.z;
		this.missionStuckSeconds = 0;
		if (cruise !== undefined) this.missionCruise = cruise;
		if (this.driver === "parked" || this.driver === "convoy") this.driver = "convoy";
	}

	/**
	 * Mission cars, every frame. Returns true while the car is out of the world. One the player
	 * was still in when the mission ended is theirs until they leave it somewhere out of sight.
	 */
	private updateMissionSlot(): boolean {
		if (this.stowed) return true;
		if (this.missionClaimed || this.driver === "player" || this.driver === "held") return false;
		const position = this.entity.getPosition();
		const player = readPlayerPose();
		const distance = Math.hypot(position.x - player.x, position.z - player.z);
		if (distance > RECYCLE_HARD_LIMIT || (distance > RECYCLE_DISTANCE && !inCameraView(position.x, position.z, VISIBLE_RANGE))) {
			this.stow();
			return true;
		}
		return false;
	}

	/** The lights go green for a race opponent held on the grid. */
	public releaseFromGrid() {
		this.missionHeld = false;
	}

	/** How far round its route it is: points passed, and where (for a race's standings). */
	public get routeProgress(): { passed: number; x: number; z: number } | null {
		if (!this.missionClaimed || this.stowed) return null;
		const car = this.carPhysics();
		return { passed: this.missionRouteIndex, x: car.x, z: car.z };
	}

	/**
	 * A mission car on its route, at its cruise, braking for the bends and minding the traffic
	 * ahead. A race opponent waits on the grid for the start.
	 */
	private driveRoute(dt: number, car: CarPhysics) {
		const controls = this.controls;
		controls.brake = 0;
		controls.handbrake = false;
		const route = this.missionRoute;
		if (!route || this.integrity <= 0 || this.burnedOut) {
			this.driver = "wrecked";
			controls.drive = 0;
			controls.steer = 0;
			return;
		}
		if (this.missionHeld) {
			controls.drive = 0;
			controls.steer = 0;
			controls.handbrake = true;
			return;
		}
		if (this.missionDisableBelow > 0 && this.integrity < this.missionDisableBelow) {
			// Beaten: the driver gives up and stops where they are.
			this.driver = "parked";
			this.missionRoute = null;
			controls.drive = 0;
			controls.steer = 0;
			controls.brake = 1;
			return;
		}
		if (this.reverseSeconds > 0) {
			// Backing off whatever it ran into, wheels turned away from it.
			this.reverseSeconds -= dt;
			controls.drive = -1;
			controls.steer = this.reverseSteer;
			return;
		}
		let point = route[this.missionRouteIndex];
		while (point && Math.hypot(point[0] - car.x, point[1] - car.z) < MISSION_ROUTE_REACHED) point = route[++this.missionRouteIndex];
		if (!point) {
			// Made it to the end: home first in a race, or — a convoy — away.
			this.driver = "parked";
			this.missionRoute = null;
			controls.drive = 0;
			controls.steer = 0;
			emitGameEvent(this.missionRacer ? { type: "racerFinished", id: this.entity.name } : { type: "actorEscaped", id: this.entity.name });
			return;
		}
		const after = route[this.missionRouteIndex + 1];
		let speed = after ? cornerSpeed(car.x, car.z, point, after, this.missionCruise) : this.missionCruise;
		// Follow the line of the road, not a beeline: aim a little way ahead along this leg, so a
		// car knocked off it steers back onto the road rather than across a block.
		const from = route[this.missionRouteIndex - 1] ?? [this.missionStartX, this.missionStartZ];
		const [aheadX, aheadZ] = alongLeg(from, point, car.x, car.z, MISSION_LOOKAHEAD + Math.max(0, car.forwardSpeed) * 0.5);
		// Still swinging round onto the new heading: no picking up speed until it's lined up.
		const facing = Math.cos(wrapAngle(Math.atan2(aheadX - car.x, aheadZ - car.z) - car.heading));
		const bend = this.missionCruise * MISSION_CORNER_SHARE;
		speed = Math.min(speed, bend + (this.missionCruise - bend) * Math.max(0, facing) ** 4);
		const [x, z, wanted] = this.avoidAhead(car, aheadX, aheadZ, speed, null);
		const drive = steerToward(car.x, car.z, car.heading, car.forwardSpeed, x, z, wanted);
		controls.drive = drive.drive;
		controls.steer = drive.steer;

		// Pinned against something: back off and try again. Still going nowhere after a few goes,
		// and nobody's watching: back on the road where it left it, facing the way to go.
		if (controls.drive > 0.5 && car.speed < 1.5) {
			this.stuckSeconds += dt;
			this.missionStuckSeconds += dt;
		} else {
			this.stuckSeconds = 0;
			if (car.speed > 6) this.missionStuckSeconds = 0;
		}
		if (this.missionStuckSeconds > MISSION_UNSTICK_SECONDS && !inCameraView(car.x, car.z, VISIBLE_RANGE)) {
			this.missionStuckSeconds = 0;
			this.stuckSeconds = 0;
			const from = route[this.missionRouteIndex - 1] ?? [car.x, car.z];
			const heading = Math.atan2(point[0] - from[0], point[1] - from[1]);
			car.reset(from[0], from[1], heading, 0);
			this.headingDegrees = heading * DEGREES;
			return;
		}
		if (this.stuckSeconds > STUCK_SECONDS) {
			this.stuckSeconds = 0;
			this.reverseSeconds = REVERSE_SECONDS;
			this.reverseSteer = drive.steer >= 0 ? -1 : 1;
		}
	}

	/** Takes the unit out of the world until it's needed. */
	private stow() {
		this.stowed = true;
		this.driver = "parked";
		this.repair();
		this.carjack.reset();
		this.setStowedVisible(false);
		const car = this.carPhysics();
		car.reset(0, 0, 0, 0);
		this.manual = true;
		this.speed = 0;
		this.entity.setPosition(0, STOW_Y, 0);
		this.entity.rigidbody?.teleport(0, STOW_Y, 0);
		if (this.agent) {
			this.agent.x = 1e6;
			this.agent.z = 1e6;
			this.agent.speed = 0;
		}
	}

	/** The model, the driver and the collider, on or off together. */
	private setStowedVisible(visible: boolean) {
		for (const child of this.entity.children) (child as Entity).enabled = visible;
		if (this.entity.collision) this.entity.collision.enabled = visible;
		if (this.entity.rigidbody) this.entity.rigidbody.enabled = visible;
	}

	/**
	 * Fire engines, every frame. Returns true while the engine is out of the world.
	 *
	 * An engine is sent when something burns within reach of the player (it'd burn out unseen
	 * otherwise): from out of sight, a block or two away from the fire, to drive in by road.
	 * Once the fire is out it drives off and is taken away again when nobody can see it.
	 */
	private updateFireSlot(dt: number): boolean {
		if (this.stowed) {
			const fire = pickFire(this);
			if (fire) this.dispatchToFire(fire);
			return this.stowed;
		}
		if (this.driver === "player" || this.driver === "held") {
			// Taken by the player: the job's off.
			this.releaseFire();
			return false;
		}
		this.dutySeconds += dt;
		const position = this.entity.getPosition();
		const player = readPlayerPose();
		const distance = Math.hypot(position.x - player.x, position.z - player.z);
		const unseen = !inCameraView(position.x, position.z, VISIBLE_RANGE) || distance > RECYCLE_HARD_LIMIT;
		// Done (or given up: wrecked, or far too long on the way), out of sight: back to the station.
		const finished = this.fireDuty === "leaving" || this.driver === "wrecked" || this.driver === "parked" || this.dutySeconds > FIRE_GIVE_UP_SECONDS;
		if (finished && unseen && distance > 60) {
			this.releaseFire();
			this.stow();
			return true;
		}
		return false;
	}

	private dispatchToFire(fire: OrionVehicle) {
		claimedFires.set(fire, this);
		this.fireTarget = fire;
		this.fireDuty = "responding";
		this.hoseAimed = false;
		this.hoseBlocked = 0;
		this.hoseCooling = 0;
		this.fireStandoff = FIRE_STANDOFF;
		this.dutySeconds = 0;
		this.stowed = false;
		this.repair();
		this.carjack.reset();
		this.setStowedVisible(true);
		this.manual = false;
		const at = fire.entity.getPosition();
		this.respawnNearPlayer(FIRE_DISPATCH_MIN, { x: at.x, z: at.z });
		this.driver = "fire";
		const car = this.beginManual();
		// Out of sight, so it can be turned to face the fire.
		const towards = Math.sin(car.heading) * (at.x - car.x) + Math.cos(car.heading) * (at.z - car.z) >= 0;
		car.reset(car.x, car.z, towards ? car.heading : car.heading + Math.PI, 8);
		// Start the route at the junction ahead on this road. Left to pick the nearest junction as
		// the crow flies, it could be one across a block — and a nine-metre engine went straight
		// for it, off the road and into the buildings.
		if (towards) {
			this.routeX = this.xIndex + this.dx;
			this.routeZ = this.zIndex + this.dz;
			this.routeDx = this.dx;
			this.routeDz = this.dz;
		} else {
			this.routeX = this.xIndex;
			this.routeZ = this.zIndex;
			this.routeDx = -this.dx;
			this.routeDz = -this.dz;
		}
		this.stuckSeconds = 0;
		this.reverseSeconds = 0;
	}

	private releaseFire() {
		if (this.fireTarget && claimedFires.get(this.fireTarget) === this) claimedFires.delete(this.fireTarget);
		this.fireTarget = null;
	}

	/** An engine out on a call (for the map and the sirens). */
	public get onCall(): boolean {
		return this.fireSlot >= 0 && !this.stowed && this.driver === "fire" && this.fireDuty !== "leaving";
	}

	/**
	 * The crew on the roof monitor. The jet is walked onto the fire (it starts short, in front of
	 * the engine) and only counts once it's landing on it, from within the monitor's reach, with
	 * nothing in the way; the fire then dies back for as long as the water stays on it (see
	 * VehicleFire). Once the flames are out the crew keeps the water on a few seconds to cool the
	 * shell, then packs up. A jet that can't get there (out of reach, a wall in the way) has the
	 * engine move in closer.
	 */
	private hoseFire(dt: number, car: CarPhysics, fire: OrionVehicle) {
		const sin = Math.sin(car.heading);
		const cos = Math.cos(car.heading);
		// The monitor on the roof, over the cab.
		const nozzleX = car.x + sin * this.halfLength * 0.55;
		const nozzleZ = car.z + cos * this.halfLength * 0.55;
		const nozzleY = this.rideY + this.halfHeight + 0.4;
		const target = fire.firePoint(this.firePoint3);
		if (!this.hoseAimed) {
			// The first of the water lands short, in front of the engine.
			this.hoseAim.set(nozzleX + sin * 5, target.y - 0.5, nozzleZ + cos * 5);
			this.hoseAimed = true;
		}
		// Walk the jet onto the fire.
		const toX = target.x - this.hoseAim.x;
		const toY = target.y - this.hoseAim.y;
		const toZ = target.z - this.hoseAim.z;
		const off = Math.hypot(toX, toY, toZ);
		const step = Math.min(off, HOSE_AIM_SPEED * dt);
		if (off > 1e-4) this.hoseAim.set(this.hoseAim.x + (toX / off) * step, this.hoseAim.y + (toY / off) * step, this.hoseAim.z + (toZ / off) * step);
		const reach = Math.hypot(target.x - nozzleX, target.z - nozzleZ);
		this.hoseSight -= dt;
		if (this.hoseSight <= 0) {
			this.hoseSight = HOSE_SIGHT_INTERVAL;
			this.hoseClear = this.clearLine(nozzleX, nozzleY, nozzleZ, target.x, target.y + 0.3, target.z);
		}
		const onTarget = Math.hypot(this.hoseAim.x - target.x, this.hoseAim.z - target.z) < Math.max(FIRE_TARGET_RADIUS, fire.halfWidth);
		const flow = reach <= HOSE_REACH && this.hoseClear && onTarget ? 1 : 0;
		const effects = crashEffects(this.app);
		const seen = distanceFromCamera(car.x, car.z) < EFFECT_DISTANCE * 1.5;
		// Where the water really goes: onto the fire, or short of it while it's walked on, or
		// against whatever is in the way.
		// The jet can't land further than the monitor throws it.
		let landX = this.hoseAim.x;
		let landZ = this.hoseAim.z;
		const throwX = landX - nozzleX;
		const throwZ = landZ - nozzleZ;
		const thrown = Math.hypot(throwX, throwZ);
		if (thrown > HOSE_REACH) {
			landX = nozzleX + (throwX / thrown) * HOSE_REACH;
			landZ = nozzleZ + (throwZ / thrown) * HOSE_REACH;
		}
		if (seen) effects.waterJet(nozzleX, nozzleY, nozzleZ, landX, this.hoseAim.y, landZ, this.hoseTrail, dt, flow > 0 && fire.blaze.burning ? Math.max(0.25, fire.blaze.intensity) : 0);
		this.wetPatchTimer -= dt;
		if (this.wetPatchTimer <= 0 && seen) {
			this.wetPatchTimer = WET_PATCH_INTERVAL;
			const ground = fire.entity.getPosition().y - fire.halfHeight + 0.012;
			decals(this.app).place("wet", null, landX + (Math.random() - 0.5) * 1.5, ground, landZ + (Math.random() - 0.5) * 1.5, 0, 1, 0, 2.5 + Math.random() * 2, { life: WET_PATCH_LIFE });
		}
		if (flow > 0) {
			fire.douse(flow, dt);
			this.hoseBlocked = 0;
		} else if (onTarget || off < 0.5) {
			// Aimed, but the water isn't getting there.
			this.hoseBlocked += dt;
		}
		if (fire.blaze.out) this.hoseCooling += dt;
		const done = fire.blaze.out ? this.hoseCooling >= COOLING_SECONDS : !fire.blaze.burning;
		if (done) {
			this.fireDuty = "leaving";
			this.releaseFire();
			this.routeX = -1;
			return;
		}
		if (this.hoseBlocked > HOSE_BLOCKED_SECONDS) {
			// Move in closer and try again.
			this.hoseBlocked = 0;
			this.hoseAimed = false;
			this.fireDuty = "responding";
			this.fireStandoff = Math.max(5, this.fireStandoff - 4);
		}
	}

	/** Nothing solid (a wall, a building) on the straight line between two points; cars don't count. */
	private clearLine(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
		const system = this.app.systems.rigidbody as unknown as { raycastFirst?: (start: Vec3, end: Vec3, options?: { filterCallback?: (entity: Entity) => boolean }) => unknown } | undefined;
		if (!system?.raycastFirst) return true;
		return !system.raycastFirst(this.rayFrom.set(x0, y0, z0), this.rayTo.set(x1, y1, z1), { filterCallback: this.notSolidBody });
	}

	/**
	 * The engine's crew at work: by road to the fire, pulling up a hose-length short of it, a
	 * jet of water from the roof monitor until it's out, then away.
	 */
	private respondToFire(dt: number, car: CarPhysics) {
		const controls = this.controls;
		if (this.integrity <= 0 || this.burnedOut) {
			this.driver = "wrecked";
			controls.drive = 0;
			controls.steer = 0;
			this.releaseFire();
			return;
		}
		const fire = this.fireTarget;
		if (this.fireDuty !== "leaving" && (!fire || (!fire.onFire && !(this.fireDuty === "hosing" && fire.blaze.out)))) {
			// Out (or gone) before the crew got there: nothing to do but leave.
			this.fireDuty = "leaving";
			this.releaseFire();
			this.routeX = -1;
		}
		if (this.fireDuty === "leaving" || !fire) {
			// On along the road, away from the scene, until out of sight (updateFireSlot stows it).
			const [aimX, aimZ, speed] = this.routeToward(car.x, car.z, car.heading, car.x + Math.sin(car.heading) * 400, car.z + Math.cos(car.heading) * 400);
			const [x, z, wanted] = this.avoidAhead(car, aimX, aimZ, speed * FIRE_CRUISE_SHARE, null);
			const drive = steerToward(car.x, car.z, car.heading, car.forwardSpeed, x, z, wanted);
			controls.drive = drive.drive;
			controls.steer = drive.steer;
			controls.handbrake = false;
			return;
		}
		const at = fire.entity.getPosition();
		const distance = Math.hypot(at.x - car.x, at.z - car.z);

		if (this.reverseSeconds > 0) {
			this.reverseSeconds -= dt;
			controls.drive = -1;
			controls.steer = this.reverseSteer;
			controls.handbrake = false;
			return;
		}

		if (this.fireDuty === "hosing" || (distance < HOSE_RANGE && car.speed < 1.2)) {
			// Parked up: hold still and play the water on it.
			this.fireDuty = "hosing";
			controls.drive = 0;
			controls.steer = 0;
			controls.handbrake = true;
			this.hoseFire(dt, car, fire);
			return;
		}

		// On the way: by road to the fire's block, then straight in, stopping a hose-length short.
		let aimX: number;
		let aimZ: number;
		let wanted: number;
		if (distance < FIRE_DIRECT_RANGE) {
			const awayX = (car.x - at.x) / Math.max(distance, 0.01);
			const awayZ = (car.z - at.z) / Math.max(distance, 0.01);
			aimX = at.x + awayX * this.fireStandoff;
			aimZ = at.z + awayZ * this.fireStandoff;
			const toStop = Math.hypot(aimX - car.x, aimZ - car.z);
			wanted = Math.min(FIRE_CRUISE, Math.sqrt(2 * PURSUIT_BRAKING * Math.max(0, toStop - 1)));
			if (toStop < 2) wanted = 0;
		} else {
			[aimX, aimZ, wanted] = this.routeToward(car.x, car.z, car.heading, at.x, at.z);
			wanted = Math.min(wanted, FIRE_CRUISE);
		}
		[aimX, aimZ, wanted] = this.avoidAhead(car, aimX, aimZ, wanted, null);
		const drive = steerToward(car.x, car.z, car.heading, car.forwardSpeed, aimX, aimZ, wanted);
		controls.drive = drive.drive;
		controls.steer = drive.steer;
		controls.handbrake = drive.handbrake;
		if (controls.drive > 0.5 && car.speed < 1.5) this.stuckSeconds += dt;
		else this.stuckSeconds = 0;
		if (this.stuckSeconds > STUCK_SECONDS) {
			this.stuckSeconds = 0;
			this.reverseSeconds = REVERSE_SECONDS;
			this.reverseSteer = drive.steer >= 0 ? -1 : 1;
		}
	}

	/**
	 * Drives the chase: by road to where the player is (or was last seen), straight at them once
	 * they're close and in sight, pulling up beside someone on foot and ramming someone driving.
	 * Officers shoot from the car from two stars.
	 */
	private pursue(dt: number, car: CarPhysics) {
		const controls = this.controls;
		const wanted = readWanted();
		const player = readPlayerPose();
		// On fire: the officers bail out of the chase and the car rolls to a stop.
		if (this.integrity <= 0 || this.burnedOut) {
			this.driver = "wrecked";
			this.seesPlayer = false;
			controls.drive = 0;
			controls.steer = 0;
			controls.handbrake = false;
			return;
		}
		const playerCar = player.inVehicle ? [...drivableCars()].find((candidate) => candidate.driver === "player") ?? null : null;
		if (this.crew.length > 0) {
			if (wanted.stars > 0) spotted(player.x, player.z);
			this.manageCrew(car, player.x, player.z, playerCar, wanted.stars);
			return;
		}
		this.crewCooldown = Math.max(0, this.crewCooldown - dt);
		// Called off (the player escaped, died or was arrested): head back to the station, lights
		// off, until out of sight — then updatePursuitSlot takes the unit away.
		if (wanted.stars === 0) {
			this.seesPlayer = false;
			const [stationX, stationZ] = POLICE_STATION.position;
			const [aimX, aimZ, speed] = this.routeToward(car.x, car.z, car.heading, stationX, stationZ);
			const home = steerToward(car.x, car.z, car.heading, car.forwardSpeed, aimX, aimZ, speed * 0.45);
			controls.drive = home.drive;
			controls.steer = home.steer;
			controls.handbrake = false;
			return;
		}

		this.sightTimer -= dt;
		if (this.sightTimer <= 0) {
			this.sightTimer = SIGHT_INTERVAL;
			this.seesPlayer = this.canSee(car.x, car.z, player.x, player.y, player.z);
		}
		if (this.seesPlayer) spotted(player.x, player.z);

		// Where to go: the player if in sight (leading a moving car a little), else where they were last seen.
		let targetX = this.seesPlayer ? player.x : wanted.lastSeenX;
		let targetZ = this.seesPlayer ? player.z : wanted.lastSeenZ;
		if (this.seesPlayer && playerCar) {
			targetX += playerCar.velocityX * 0.6;
			targetZ += playerCar.velocityZ * 0.6;
		}
		const distance = Math.hypot(targetX - car.x, targetZ - car.z);

		// Stuck against something: back off, turning the other way, then try again.
		if (this.reverseSeconds > 0) {
			this.reverseSeconds -= dt;
			controls.drive = -1;
			controls.steer = this.reverseSteer;
			controls.handbrake = false;
			return;
		}

		let aimX = targetX;
		let aimZ = targetZ;
		let wantedSpeed: number;
		if ((this.seesPlayer && distance < DIRECT_RANGE) || distance < 15) {
			this.routeX = -1;
			if (playerCar) {
				// Ram a car.
				wantedSpeed = PURSUIT_CRUISE;
			} else {
				// Pull up beside someone on foot, each unit on its own side of them, so they end up
				// surrounded rather than rear-ended by the next car in.
				const awayX = (car.x - targetX) / Math.max(distance, 0.01);
				const awayZ = (car.z - targetZ) / Math.max(distance, 0.01);
				const angle = ((STOP_ANGLES[this.pursuitSlot % STOP_ANGLES.length] ?? 0) * Math.PI) / 180;
				aimX = targetX + (awayX * Math.cos(angle) - awayZ * Math.sin(angle)) * STOP_SHORT;
				aimZ = targetZ + (awayX * Math.sin(angle) + awayZ * Math.cos(angle)) * STOP_SHORT;
				// v = sqrt(2 a d): the speed from which it can still stop at that spot.
				const toStop = Math.hypot(aimX - car.x, aimZ - car.z);
				wantedSpeed = Math.min(PURSUIT_CRUISE, Math.sqrt(2 * PURSUIT_BRAKING * Math.max(0, toStop - 1)));
				if (toStop < 2) wantedSpeed = 0;
			}
		} else {
			[aimX, aimZ, wantedSpeed] = this.routeToward(car.x, car.z, car.heading, targetX, targetZ);
		}

		[aimX, aimZ, wantedSpeed] = this.avoidAhead(car, aimX, aimZ, wantedSpeed, playerCar);
		const drive = steerToward(car.x, car.z, car.heading, car.forwardSpeed, aimX, aimZ, wantedSpeed);
		controls.drive = drive.drive;
		controls.steer = drive.steer;
		controls.handbrake = drive.handbrake;

		if (controls.drive > 0.5 && car.speed < 1.5) this.stuckSeconds += dt;
		else this.stuckSeconds = 0;
		if (this.stuckSeconds > STUCK_SECONDS) {
			this.stuckSeconds = 0;
			this.reverseSeconds = REVERSE_SECONDS;
			this.reverseSteer = drive.steer >= 0 ? -1 : 1;
		}

		// Pulled up beside someone standing still on foot: an arrest, at low stars.
		if (!player.inVehicle && this.seesPlayer && car.speed < 1 && Math.hypot(player.x - car.x, player.z - car.z) < STOP_SHORT + 2 && player.speed < 1.2) {
			markArrestable();
		}

		// Pulled up beside the player (on foot, or sat in a stopped car): the crew gets out to fight.
		const playerStill = !playerCar || Math.hypot(playerCar.velocityX, playerCar.velocityZ) < 1.5;
		const beside = Math.hypot(player.x - car.x, player.z - car.z) < CREW_DEPLOY_RANGE;
		if (this.seesPlayer && car.speed < 1 && playerStill && beside && this.crewCooldown === 0) {
			this.dismountSeconds += dt;
			if (this.dismountSeconds >= DISMOUNT_DELAY) {
				this.dismountSeconds = 0;
				this.deployCrew(car, wanted.stars);
				if (this.crew.length > 0) return;
			}
		} else {
			this.dismountSeconds = 0;
		}

		this.shootAtPlayer(dt, car, player.x, player.z, playerCar, wanted.stars);
	}

	/**
	 * The next point to drive at on the way to (targetX, targetZ) by road, and how fast. Junction
	 * to junction along the grid; on the target's own block it goes straight there.
	 */
	private routeToward(x: number, z: number, heading: number, targetX: number, targetZ: number): [number, number, number] {
		const [goalX, goalZ] = nearestJunction(targetX, targetZ);
		let fresh = false;
		if (this.routeX < 0) {
			[this.routeX, this.routeZ] = nearestJunction(x, z);
			this.routeDx = 0;
			this.routeDz = 0;
			fresh = true;
		}
		let [jx, jz] = junctionPosition(this.routeX, this.routeZ);
		// A fresh route's nearest junction can be behind the car: count it as passed rather than
		// turning round for it.
		const behind = fresh && Math.sin(heading) * (jx - x) + Math.cos(heading) * (jz - z) < 0;
		if (behind || Math.hypot(jx - x, jz - z) < WAYPOINT_REACHED) {
			const next = stepToward(this.routeX, this.routeZ, goalX, goalZ, this.routeDx, this.routeDz);
			if (!next) return [targetX, targetZ, PURSUIT_CRUISE * 0.6];
			this.routeDx = next[0] - this.routeX;
			this.routeDz = next[1] - this.routeZ;
			[this.routeX, this.routeZ] = next;
			[jx, jz] = junctionPosition(this.routeX, this.routeZ);
		}
		// Slow for the junction if the route turns there.
		const after = stepToward(this.routeX, this.routeZ, goalX, goalZ, this.routeDx, this.routeDz);
		const turning = after !== null && (after[0] - this.routeX !== this.routeDx || after[1] - this.routeZ !== this.routeDz);
		return [jx, jz, approachSpeed(Math.hypot(jx - x, jz - z), turning, PURSUIT_CRUISE)];
	}

	/**
	 * Something in the road ahead — a car, another unit, a pedestrian: steer round it on whichever
	 * side it isn't, and slow down in proportion to how close it is. The player's own car is the
	 * exception: that one it's trying to hit.
	 */
	private avoidAhead(car: CarPhysics, aimX: number, aimZ: number, wantedSpeed: number, playerCar: OrionVehicle | null): [number, number, number] {
		const sin = Math.sin(car.heading);
		const cos = Math.cos(car.heading);
		const lookahead = this.halfLength + 4 + Math.max(0, car.forwardSpeed) * AVOID_LOOKAHEAD_SECONDS;
		const playerAgent = playerCar?.agent ?? null;
		let nearest = Infinity;
		let nearestSide = 0;
		for (const other of trafficAgents()) {
			if (other === this.agent || other === playerAgent || !other.alive) continue;
			const relX = other.x - car.x;
			const relZ = other.z - car.z;
			const along = relX * sin + relZ * cos;
			if (along <= 0 || along > lookahead) continue;
			// Positive to the car's left (heading rises towards +X).
			const side = relX * cos - relZ * sin;
			const clearance = this.halfWidth + (other.kind === "vehicle" ? 1.3 : 0.7);
			if (Math.abs(side) > clearance || along >= nearest) continue;
			nearest = along;
			nearestSide = side;
		}
		if (!Number.isFinite(nearest)) return [aimX, aimZ, wantedSpeed];
		// Pass on the far side of it, a car's width clear.
		const pass = nearestSide >= 0 ? -1 : 1;
		const offset = pass * (this.halfWidth * 2 + 1.5);
		const passX = car.x + sin * (nearest + 4) + cos * offset;
		const passZ = car.z + cos * (nearest + 4) - sin * offset;
		return [passX, passZ, Math.min(wantedSpeed, 5 + nearest * 0.7)];
	}

	/** A clear line from the unit to the player, within sight range. */
	private canSee(x: number, z: number, playerX: number, playerY: number, playerZ: number): boolean {
		if (Math.hypot(playerX - x, playerZ - z) > SIGHT_RANGE) return false;
		const raycastAll = this.raycastAll;
		if (!raycastAll) return true;
		const eyeY = this.rideY + this.halfHeight;
		this.rayFrom.set(x, eyeY, z);
		this.rayTo.set(playerX, playerY + 1.2, playerZ);
		// Only buildings and the like block the view; people and cars don't hide anyone for long.
		return !raycastAll(this.rayFrom, this.rayTo, { filterCallback: this.notSolidBody }).some((hit) => hit.entity.name !== "player" && !hit.entity.script?.has("orionVehicle"));
	}

	/** Officers firing from the car's window (see PoliceFire for what they carry and how well they shoot). */
	private shootAtPlayer(dt: number, car: CarPhysics, playerX: number, playerZ: number, playerCar: OrionVehicle | null, stars: number) {
		if (stars < FIRE_FROM_STARS || !this.seesPlayer) return;
		const gun = policeGun(stars);
		if (Math.hypot(playerX - car.x, playerZ - car.z) > gun.range) return;
		this.fireTimer -= dt;
		if (this.fireTimer > 0) return;
		this.fireTimer = nextShotDelay(gun);
		// From the driver's window.
		const sin = Math.sin(car.heading);
		const cos = Math.cos(car.heading);
		this.shooter.x = car.x;
		this.shooter.z = car.z;
		fireAtPlayer(this.app, car.x + cos * this.halfWidth, this.rideY + this.halfHeight * 0.6, car.z - sin * this.halfWidth, gun, playerCar, this.shooter, this.shot);
	}

	/**
	 * Puts the crew out: one officer, or two from three stars, stepping out of the doors to fight
	 * from beside the car.
	 */
	private deployCrew(car: CarPhysics, stars: number) {
		const sin = Math.sin(car.heading);
		const cos = Math.cos(car.heading);
		const groundY = this.rideY - this.halfHeight;
		for (const side of stars >= 3 ? [1, -1] : [1]) {
			const officer = requestOfficer();
			if (!officer) break;
			// Left of the car is (cos, -sin); out of the door, then a step clear of it.
			const doorX = car.x + cos * side * (this.halfWidth + 0.35) + sin * 0.3;
			const doorZ = car.z - sin * side * (this.halfWidth + 0.35) + cos * 0.3;
			const postX = doorX + cos * side * 1.3 - sin * 0.8;
			const postZ = doorZ - sin * side * 1.3 - cos * 0.8;
			officer.deploy(doorX, doorZ, postX, postZ, groundY);
			this.crew.push(officer);
		}
	}

	/**
	 * While the crew is out: the car holds still, the officers fight, and they're called back when
	 * the player gets away or drives off. A crew that's all down leaves the car abandoned (and
	 * another unit is sent).
	 */
	private manageCrew(car: CarPhysics, playerX: number, playerZ: number, playerCar: OrionVehicle | null, stars: number) {
		const controls = this.controls;
		controls.drive = 0;
		controls.steer = 0;
		controls.handbrake = true;
		const standing = this.crew.filter((officer) => !officer.down);
		if (standing.length === 0) {
			this.crew = [];
			this.driver = "wrecked";
			return;
		}
		for (const officer of standing) officer.setPlayerCar(playerCar);
		const away = Math.hypot(playerX - car.x, playerZ - car.z) > CREW_RECALL_RANGE;
		const drivingOff = playerCar !== null && Math.hypot(playerCar.velocityX, playerCar.velocityZ) > 5;
		if (away || drivingOff || stars === 0) for (const officer of standing) officer.recall();
		if (this.crew.every((officer) => officer.aboard)) {
			this.crew = [];
			this.crewCooldown = CREW_COOLDOWN;
		}
	}

	/**
	 * Top of whatever the car is over (road, pavement, terrain, a bridge deck); past the beach,
	 * where there is nothing, a little under the waterline.
	 */
	private groundHeight(x: number, z: number, currentY: number): number {
		const paved = pavedHeightAt(x, z);
		if (paved !== null) return paved;
		const raycastAll = this.raycastAll;
		const fallback = Math.min(currentY - this.halfHeight, ORION_OCEAN.level - SEA_FLOOR_BELOW_WATER);
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
		let stalledAhead: TrafficAgent | null = null;
		let stalledDistance = Infinity;
		// Its extents along and across this car's path: a car side-on in the lane ahead is its
		// width deep, not its length (as a circle of its half-length made it), and one in the next
		// lane over is clear of this car's path.
		const consider = (ox: number, oz: number, alongHalf: number, acrossHalf: number, gap: number, clearance = VEHICLE_CLEARANCE) => {
			const relX = ox - x;
			const relZ = oz - z;
			const ahead = relX * hx + relZ * hz;
			if (ahead <= 0 || ahead > lookAhead + alongHalf) return Infinity;
			const lateral = Math.abs(relX * -hz + relZ * hx);
			if (lateral > this.halfWidth + acrossHalf + clearance) return Infinity;
			const room = ahead - this.halfLength - alongHalf - gap;
			nearest = Math.min(nearest, room);
			return room;
		};
		const considerVehicle = (other: TrafficAgent) => {
			const box = agentFootprint;
			box.x = other.x;
			box.z = other.z;
			const length = Math.hypot(other.headingX, other.headingZ);
			box.sin = length > 0 ? other.headingX / length : hx;
			box.cos = length > 0 ? other.headingZ / length : hz;
			box.halfLength = other.halfLength;
			box.halfWidth = other.halfWidth;
			return consider(other.x, other.z, extentAlong(box, hx, hz), extentAlong(box, -hz, hx), FOLLOW_GAP);
		};

		for (const other of trafficAgents()) {
			if (other === this.agent) continue;
			if (other.kind === "person") {
				consider(other.x, other.z, PERSON_RADIUS, PERSON_RADIUS, PERSON_GAP, PERSON_CLEARANCE);
				continue;
			}
			if (other.stalled) {
				// Being passed by a lane change: out of the way, or about to be.
				if (other === this.passing) continue;
				const room = considerVehicle(other);
				if (room < stalledDistance) {
					stalledDistance = room;
					stalledAhead = other;
				}
				continue;
			}
			const parallel = other.headingX * hx + other.headingZ * hz > 0.5;
			// For crossing cars, the lower id has right of way, so two can't wait on each other.
			// Nobody assumes right of way over the player.
			const yields = other.playerControlled || other.id < (this.agent?.id ?? 0);
			if (!parallel && (!yields || this.ignoreCrossingSeconds > 0)) continue;
			const room = considerVehicle(other);
			if (room < Infinity && !parallel) blockedByCrossing = true;
		}
		const player = readPlayerPose();
		consider(player.x, player.z, PERSON_RADIUS, PERSON_RADIUS, PERSON_GAP, PERSON_CLEARANCE);

		if (nearest < Infinity) limit = Math.min(limit, nearest <= 0 ? 0 : stopWithin(nearest));
		// Drifting across into the next lane: at a crawl until it's there.
		if (this.laneShift !== 0) limit = Math.min(limit, LANE_CHANGE_SPEED);
		this.blockedSeconds = blockedByCrossing && this.speed < 0.3 ? this.blockedSeconds + dt : 0;
		this.ignoreCrossingSeconds = Math.max(0, this.ignoreCrossingSeconds - dt);
		const queued = stalledAhead !== null && stalledDistance < 1 && this.speed < 0.3;
		this.stalledBlockSeconds = queued ? this.stalledBlockSeconds + dt : 0;
		if (this.stalledBlockSeconds > STALLED_WAIT_SECONDS && stalledAhead && this.changeLane()) {
			this.passing = stalledAhead;
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
			const [lx, lz] = leftOf(this.dx, this.dz);
			return [
				this.p0[0] + (this.p1[0] - this.p0[0]) * t + lx * this.laneShift,
				this.p0[1] + (this.p1[1] - this.p0[1]) * t + lz * this.laneShift,
				// Angled a little towards the lane it's drifting into.
				...normalised(this.dx + lx * this.laneDrift / Math.max(this.speed, 2), this.dz + lz * this.laneDrift / Math.max(this.speed, 2)),
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
		this.laneShift = 0;
		this.laneDrift = 0;
		this.passing = null;
		this.placeLeg();
		this.chooseExit();
	}

	/** The current leg's ends, in the current lane. */
	private placeLeg() {
		const { xIndex, zIndex, dx, dz } = this;
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
	}

	/**
	 * Moves over into the road's other lane (same direction), to get round a stalled car: only on
	 * a road with two, with room left before the junction, and with the other lane clear beside
	 * and ahead. The car drifts across (see easeLaneShift) rather than jumping.
	 */
	private changeLane(): boolean {
		if (this.phase !== "leg" || this.legLength - this.distance < LANE_CHANGE_ROOM) return false;
		if (laneOffsets(travelRoadWidth(this.xIndex, this.zIndex, this.dx)).length < 2) return false;
		const from = this.laneOffset(this.xIndex, this.zIndex, this.dx);
		const to = this.laneOffsets()[1 - Math.min(this.laneIndex, 1)];
		const [x, z, hx, hz] = this.pose();
		const [lx, lz] = leftOf(this.dx, this.dz);
		// The stretch of the other lane it'll use: from beside the tail to well past the nose.
		const box = ownFootprint;
		const shift = to - from - this.laneShift;
		box.x = x + lx * shift + hx * 4;
		box.z = z + lz * shift + hz * 4;
		box.sin = hx;
		box.cos = hz;
		box.halfLength = this.halfLength + 8;
		box.halfWidth = this.halfWidth + 0.3;
		const other = otherFootprint;
		for (const car of drivableCars()) {
			if (car === this || !car.footprint(other)) continue;
			if (footprintContact(box, other)) return false;
		}
		this.laneIndex = 1 - Math.min(this.laneIndex, 1);
		const before = this.distance;
		this.placeLeg();
		this.distance = before;
		// Still where it was: the offset eases away as it drifts over.
		this.laneShift = from + this.laneShift - to;
		return true;
	}

	private laneOffsets(): readonly number[] {
		return laneOffsets(travelRoadWidth(this.xIndex, this.zIndex, this.dx));
	}

	/** The drift across into a new lane, at a pace that rises with the car's speed. */
	private easeLaneShift(dt: number) {
		if (this.laneShift === 0) {
			this.laneDrift = 0;
			return;
		}
		const rate = 0.6 + 0.35 * this.speed;
		const step = Math.min(Math.abs(this.laneShift), rate * dt);
		// Something has come up alongside in the lane it's moving into: wait for it.
		if (this.bodyBlocked(0, -Math.sign(this.laneShift) * step)) {
			this.laneDrift = 0;
			return;
		}
		this.laneDrift = -Math.sign(this.laneShift) * (dt > 0 ? step / dt : 0);
		this.laneShift -= Math.sign(this.laneShift) * step;
		if (Math.abs(this.laneShift) < 1e-3) {
			this.laneShift = 0;
			this.laneDrift = 0;
			this.passing = null;
		}
	}

	/**
	 * Whether this lane-following car would run into anything solid by moving `distance` metres
	 * along its path (backwards when negative), and `sideways` metres across it. The body is
	 * tested where that move puts it, turned as the curve turns it, so a car swinging through a
	 * turn can't sweep its flank into the car beside it. A move that would bring it into another
	 * vehicle, or deeper into one it's already touching, is blocked; one that eases it out of a
	 * contact is not.
	 */
	private bodyBlocked(distance: number, sideways = 0): boolean {
		const now = ownFootprint;
		const next = clearFootprint;
		const [x, z, hx, hz] = this.pose();
		const [aheadX, aheadZ, nextHx, nextHz] = this.poseAhead(distance);
		// Sideways is towards the left of the leg (see leftOf), as the lane shift is.
		const [lx, lz] = leftOf(this.dx, this.dz);
		now.x = x;
		now.z = z;
		now.sin = hx;
		now.cos = hz;
		next.x = aheadX + lx * sideways;
		next.z = aheadZ + lz * sideways;
		next.sin = nextHx;
		next.cos = nextHz;
		now.halfLength = next.halfLength = this.halfLength;
		now.halfWidth = next.halfWidth = this.halfWidth;
		const other = otherFootprint;
		for (const car of drivableCars()) {
			if (car === this || !car.footprint(other) || !this.level(car)) continue;
			const ahead = footprintContact(next, other, CONTACT_MARGIN);
			if (!ahead) continue;
			const touching = footprintContact(now, other, CONTACT_MARGIN);
			if (!touching || ahead.depth > touching.depth + 1e-4) return true;
		}
		return false;
	}

	/**
	 * The pose `distance` metres on along the path from where the car is (back, when negative),
	 * without moving it: along this leg or turn, and straight on from its end beyond that.
	 */
	private poseAhead(distance: number): [number, number, number, number] {
		const length = this.phase === "leg" ? this.legLength : this.turnLength;
		const at = Math.max(0, Math.min(length, this.distance + distance));
		const beyond = this.distance + distance - at;
		const saved = this.distance;
		this.distance = at;
		const [x, z, hx, hz] = this.pose();
		this.distance = saved;
		return [x + hx * beyond, z + hz * beyond, hx, hz];
	}

	/** Backing up a couple of metres out of a stand-off, then holding so the other car can go. */
	private backOff(dt: number) {
		const step = Math.min(this.backoffLeft, BACKOFF_SPEED * dt, this.distance);
		this.speed = 0;
		this.targetSpeed = 0;
		if (step <= 1e-3 || this.bodyBlocked(-step)) {
			this.backoffLeft = 0;
		} else {
			this.distance -= step;
			this.backoffLeft -= step;
			this.applyPose();
		}
		if (this.backoffLeft <= 0) {
			this.backoffLeft = 0;
			this.holdSeconds = BACKOFF_HOLD_SECONDS;
			this.ignoreCrossingSeconds = 0;
		}
		this.braking = true;
		this.updateLights(dt, true);
		this.trackTurnRate(dt);
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
		// A lane change is only started with room to finish before the junction.
		this.laneShift = 0;
		this.laneDrift = 0;
		this.passing = null;
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

	private respawnNearPlayer(minDistance: number, around: { x: number; z: number } = readPlayerPose()) {
		const player = around;
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
			const [x, z, hx, hz] = this.pose();

			const crowded = [...trafficAgents()].some((other) => (
				other !== this.agent && other.kind === "vehicle" && Math.hypot(other.x - x, other.z - z) < 12
			));
			// Never on top of another car (or so close it can't pull away): a place like that is
			// taken only if nowhere else is.
			const blocked = this.spaceTaken(x, z, hx, hz, FOLLOW_GAP + 1);
			const fromPlayer = Math.hypot(x - player.x, z - player.z);
			const hidden = minDistance === 0 || !inCameraView(x, z, RESPAWN_HIDDEN_RANGE);
			const farEnough = fromPlayer >= minDistance && fromPlayer <= RECYCLE_DISTANCE - 20;
			const score = (blocked ? -10 : 0) + (hidden ? 4 : 0) + (farEnough ? 2 : 0) + (crowded ? 0 : 1) + Math.min(1, distanceFromCamera(x, z) / RECYCLE_DISTANCE);
			if (!best || score > best.score) best = { xIndex, zIndex, dx, dz, distance, score };
			if (hidden && farEnough && !crowded) break;
		}
		if (best) {
			this.beginLeg(best.xIndex, best.zIndex, best.dx, best.dz);
			this.distance = best.distance;
		}
		this.speed = this.maxSpeed * 0.5;
		this.hardBlockedSeconds = 0;
		this.stalledBlockSeconds = 0;
		this.backoffLeft = 0;
		this.holdSeconds = 0;
		this.touching.clear();
		const [x, z] = this.pose();
		// Ride height above the road is fixed by the scene; only X/Z are placed here.
		const y = this.rideHeight;
		this.entity.setPosition(x, y, z);
		this.entity.rigidbody?.teleport(x, y, z);
		this.applyPose(true);
		this.lastYaw = null;
	}

	/**
	 * Whether a body of this car's size at (x, z) facing (hx, hz) would overlap, or come within
	 * `margin` of, any vehicle in the world.
	 */
	private spaceTaken(x: number, z: number, hx: number, hz: number, margin: number): boolean {
		const box = ownFootprint;
		box.x = x;
		box.z = z;
		box.sin = hx;
		box.cos = hz;
		box.halfLength = this.halfLength;
		box.halfWidth = this.halfWidth;
		const other = otherFootprint;
		for (const car of drivableCars()) {
			if (car === this || !car.footprint(other)) continue;
			if (footprintContact(box, other, margin)) return true;
		}
		return false;
	}

	/**
	 * Traffic in the way of a car being put down somewhere fixed (a mission's, a bay's) goes off to
	 * another road, so the two don't start out inside each other.
	 */
	private clearTrafficAround(x: number, z: number, headingRadians: number) {
		const box = clearFootprint;
		box.x = x;
		box.z = z;
		box.sin = Math.sin(headingRadians);
		box.cos = Math.cos(headingRadians);
		box.halfLength = this.halfLength;
		box.halfWidth = this.halfWidth;
		const other = otherFootprint;
		for (const car of drivableCars()) {
			if (car === this || car.driver !== "ai" || car.manual || !car.footprint(other)) continue;
			if (footprintContact(box, other, FOLLOW_GAP)) car.respawnNearPlayer(RESPAWN_MIN);
		}
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
		if (!this.lightsFlashing) {
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

const EMERGENCY_STYLES: ReadonlySet<VehicleStyle> = new Set(["ambulance", "fireTruck"]);

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

function normalised(x: number, z: number): [number, number] {
	const length = Math.hypot(x, z) || 1;
	return [x / length, z / length];
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

/** When the last police unit was sent out, so they come a few seconds apart. */
let lastPursuitDispatch = -Infinity;

/** Condition lost after a fire is put out that lights it again (a fresh crash, more rounds). */
const REIGNITE_DAMAGE = 6;
/** How fast a wreck fire uses up what's left to burn (share per second at full strength): ~45 s. */
const WRECK_BURN_RATE = 0.085;

// Fire service (cars with a fireSlot: see updateFireSlot).
/** Seconds a fire has to have been burning before an engine is sent (a flare-up isn't a call-out). */
const FIRE_CALL_DELAY = 2;
/** Fires further than this from the player are left to burn out. */
const FIRE_RESPONSE_RANGE = 260;
/** Engines are brought in at least this far from the fire, out of sight, and drive the rest. */
const FIRE_DISPATCH_MIN = 90;
/** Within this, off the road and straight at the fire. */
const FIRE_DIRECT_RANGE = 45;
/** Pulls up this far short of the fire: close enough to reach it, clear of a blast. */
const FIRE_STANDOFF = 11;
/** Stopped within this of the fire, the crew starts hosing. */
const HOSE_RANGE = 16;
/** How far the roof monitor throws a useful jet (m). */
const HOSE_REACH = 26;
/** How fast the monitor's jet is walked onto its target (m/s at the landing point). */
const HOSE_AIM_SPEED = 6;
/** The jet counts as on the fire within this of its middle (m), at least. */
const FIRE_TARGET_RADIUS = 1.3;
/** Seconds of water kept on a put-out fire to cool it before the crew packs up. */
const COOLING_SECONDS = 4;
/** Seconds between checks that nothing stands between the monitor and the fire. */
const HOSE_SIGHT_INTERVAL = 0.3;
/** Seconds the crew will hose with no water getting there before it moves in closer. */
const HOSE_BLOCKED_SECONDS = 3;
/** A wet patch where the water lands, laid this often (s) and kept this long (s). */
const WET_PATCH_INTERVAL = 1.4;
const WET_PATCH_LIFE = 75;
/** Top speed on a call (m/s), and the share of it when driving off afterwards. */
const FIRE_CRUISE = 17;
const FIRE_CRUISE_SHARE = 0.55;
/** An engine that hasn't finished in this long (stuck, blocked) is taken off the job. */
const FIRE_GIVE_UP_SECONDS = 150;
/** Each burning car is answered by one engine. */
const claimedFires = new Map<OrionVehicle, OrionVehicle>();
/** When each fire was first noticed (for FIRE_CALL_DELAY). */
const fireNoticed = new Map<OrionVehicle, number>();

/** The nearest fire to the player that needs an engine and hasn't got one, or null. */
function pickFire(engine: OrionVehicle): OrionVehicle | null {
	const now = performance.now() / 1000;
	const player = readPlayerPose();
	let best: OrionVehicle | null = null;
	let bestDistance = FIRE_RESPONSE_RANGE;
	for (const car of drivableCars()) {
		if (!car.onFire) {
			fireNoticed.delete(car);
			continue;
		}
		if (car === engine || car.fireSlot >= 0 || claimedFires.has(car)) continue;
		if (!fireNoticed.has(car)) fireNoticed.set(car, now);
		if (now - fireNoticed.get(car)! < FIRE_CALL_DELAY) continue;
		const position = car.entity.getPosition();
		const distance = Math.hypot(position.x - player.x, position.z - player.z);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = car;
		}
	}
	return best;
}


/** Scratch footprints for contact tests (one car resolves at a time). */
const ownFootprint: Footprint = { x: 0, z: 0, sin: 0, cos: 1, halfLength: 1, halfWidth: 1 };
const otherFootprint: Footprint = { x: 0, z: 0, sin: 0, cos: 1, halfLength: 1, halfWidth: 1 };
const agentFootprint: Footprint = { x: 0, z: 0, sin: 0, cos: 1, halfLength: 1, halfWidth: 1 };
const clearFootprint: Footprint = { x: 0, z: 0, sin: 0, cos: 1, halfLength: 1, halfWidth: 1 };

const tiltYaw = new Quat();
const tiltPitch = new Quat();
const tiltRoll = new Quat();

export interface PoliceMarker {
	x: number;
	z: number;
}

/**
 * Where the police units on a chase are, for the map. Fills `out` in place (the map polls this
 * several times a second) and returns how many were written.
 */
export function policeMarkers(out: PoliceMarker[]): number {
	// Units heading back once the player is no longer wanted are no one's concern.
	if (readWanted().stars === 0) return 0;
	let count = 0;
	for (const car of drivableCars()) {
		if (!car.chasing) continue;
		const position = car.entity.getPosition();
		out[count] ??= { x: 0, z: 0 };
		out[count].x = position.x;
		out[count].z = position.z;
		count++;
	}
	return count;
}

/** Police units on the chase right now (see OrionVehicle.chasing). */
function chasingUnits(): number {
	let count = 0;
	for (const car of drivableCars()) if (car.chasing) count++;
	return count;
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

// Mission cars (cars with a missionSlot: see missions/MissionActors).

/** By id (the entity's name, as the missions know them). */
const missionCars = new Map<string, OrionVehicle>();

/** Puts a mission's car into the world; false if there's no such car. */
export function placeMissionVehicle(id: string, x: number, z: number, yaw: number, route: readonly (readonly [number, number])[] | null = null, options: MissionDriving = {}): boolean {
	const car = missionCars.get(id);
	if (!car) return false;
	car.placeForMission(x, z, yaw, route, options);
	return true;
}

/** Green light: the race opponents set off. */
export function startMissionRacers(ids: Iterable<string>): void {
	for (const id of ids) missionCars.get(id)?.releaseFromGrid();
}

/** How far round its route a mission car is, or null if it isn't out. */
export function missionVehicleProgress(id: string): { passed: number; x: number; z: number } | null {
	return missionCars.get(id)?.routeProgress ?? null;
}

/** Where a mission car is and what shape it's in, if it's out. */
export function missionVehicleState(id: string): { x: number; z: number; integrity: number; onFire: boolean } | null {
	return missionCars.get(id)?.missionState ?? null;
}

/** A mission car on its road at a new speed. */
export function paceMissionVehicle(id: string, cruise: number): void {
	missionCars.get(id)?.pace(cruise);
}

/** Sends a mission car off along a new road. */
export function rerouteMissionVehicle(id: string, route: readonly (readonly [number, number])[], cruise?: number): void {
	missionCars.get(id)?.reroute(route, cruise);
}

/** A mission car catches fire, held steady (see OrionVehicle.holdFire). */
export function igniteMissionVehicle(id: string): void {
	missionCars.get(id)?.holdFire();
}

/** A mission car's held fire burns down; it goes up unless someone puts it out first. */
export function letMissionVehicleBurn(id: string): void {
	missionCars.get(id)?.letBurn();
}

/** Takes a mission's cars out of the world again (bar the one the player's in). */
export function releaseMissionVehicles(ids: Iterable<string>): void {
	for (const id of ids) missionCars.get(id)?.releaseFromMission();
}

/** Where the mission cars that are out are, for the map: fills `out`, returns how many. */
export function missionVehicleMarkers(out: { id: string; x: number; z: number }[]): number {
	let count = 0;
	for (const [id, car] of missionCars) {
		if (!car.inWorld || car.burnedOut) continue;
		const position = car.entity.getPosition();
		const slot = out[count] ?? (out[count] = { id, x: 0, z: 0 });
		slot.id = id;
		slot.x = position.x;
		slot.z = position.z;
		count++;
	}
	return count;
}
