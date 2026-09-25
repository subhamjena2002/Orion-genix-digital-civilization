import type { ActionState } from "./OrionSkinnedCharacterAnimation";

/**
 * Last known player transform, written every frame by the controller script and sampled
 * on a throttle by React (minimap, distance culling). Deliberately a plain mutable module
 * value rather than React state — per-frame setState would re-render the whole scene tree.
 */
/** Name of the visual child the controller rotates (see PlayerVisual for why). */
export const PLAYER_VISUAL_NAME = "player-visual";

export interface PlayerPose {
	x: number;
	y: number;
	z: number;
	/** Facing in degrees, matching the entity's Y euler angle. */
	yaw: number;
	speed: number;
	/** 0 when dry, rising to 1 at the moment the player drowns. */
	drowning: number;
	/** Clip that overrides walking (carjacking, driving, attacking); empty when on foot. */
	action: ActionState | "";
	/** Playback rate for `action` (attacks are sped up to their gameplay timing). */
	actionSpeed: number;
	/** In a car (including climbing in). */
	inVehicle: boolean;
	/** Car speed in m/s while driving. */
	vehicleSpeed: number;
	/** On foot and close enough to a car's door to take it. */
	nearCar: boolean;
	/** Condition of the car being driven, 100% down to 0%. */
	vehicleIntegrity: number;
	/** The car is alight and about to go up. */
	vehicleBurning: boolean;
}

const pose: PlayerPose = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, drowning: 0, action: "", actionSpeed: 1, inVehicle: false, vehicleSpeed: 0, nearCar: false, vehicleIntegrity: 100, vehicleBurning: false };

export function writeVehicleState(
	inVehicle: boolean,
	vehicleSpeed: number,
	nearCar: boolean,
	vehicleIntegrity = 100,
	vehicleBurning = false,
): void {
	pose.inVehicle = inVehicle;
	pose.vehicleSpeed = vehicleSpeed;
	pose.nearCar = nearCar;
	pose.vehicleIntegrity = vehicleIntegrity;
	pose.vehicleBurning = vehicleBurning;
}

export function writePlayerAction(action: ActionState | "", speed = 1): void {
	pose.action = action;
	pose.actionSpeed = speed;
}

export function writePlayerPose(x: number, y: number, z: number, yaw: number, speed: number, drowning: number): void {
	pose.x = x;
	pose.y = y;
	pose.z = z;
	pose.yaw = yaw;
	pose.speed = speed;
	pose.drowning = drowning;
}

export function readPlayerPose(): Readonly<PlayerPose> {
	return pose;
}

/**
 * Where the camera is and which way it looks (flat, unit length). Anything that spawns,
 * despawns or freezes out of sight checks this, so nothing visibly pops in or out.
 */
const view = { x: 0, z: 0, forwardX: 0, forwardZ: 1, known: false };

/** Half-width of the "on screen" cone, as a cosine (wider than the lens, for safety). */
const VIEW_CONE_COS = Math.cos((75 * Math.PI) / 180);

export function writeCameraView(x: number, z: number, forwardX: number, forwardZ: number): void {
	const length = Math.hypot(forwardX, forwardZ);
	if (length < 1e-6) return;
	view.x = x;
	view.z = z;
	view.forwardX = forwardX / length;
	view.forwardZ = forwardZ / length;
	view.known = true;
}

/** Distance from the camera to (x, z). */
export function distanceFromCamera(x: number, z: number): number {
	return view.known ? Math.hypot(x - view.x, z - view.z) : Math.hypot(x - pose.x, z - pose.z);
}

/**
 * Whether a point could be on screen: in front of the camera and nearer than `range`.
 * Anything within a few metres counts, since a car beside the camera can still show.
 */
export function inCameraView(x: number, z: number, range: number): boolean {
	if (!view.known) return true;
	const dx = x - view.x;
	const dz = z - view.z;
	const distance = Math.hypot(dx, dz);
	if (distance > range) return false;
	if (distance < 8) return true;
	return (dx * view.forwardX + dz * view.forwardZ) / distance > VIEW_CONE_COS;
}

/** Closer to the player than this, a moving thing is always posed: it can be touched or hit. */
const ALWAYS_POSE_DISTANCE = 60;
/** Out of sight and further away, re-posing is spread over this many frames. */
const UNSEEN_POSE_INTERVAL = 4;
/** How far the camera is considered to see (the lens's far clip is 800). */
const POSE_VIEW_RANGE = 800;

/**
 * Whether something moving at (x, z) should have its entity transform updated this frame.
 *
 * Moving an entity dirties its whole hierarchy — a car with a seated driver is a hundred or so
 * nodes, a detailed car model several hundred — and all of it is re-transformed before the frame
 * is drawn. Nobody sees a car behind the camera, so those catch up every few frames instead,
 * staggered by `slot` so the work is spread evenly. Anything near the player is always exact,
 * since its collider can be driven or walked into.
 */
export function needsPosing(x: number, z: number, frame: number, slot: number): boolean {
	if (inCameraView(x, z, POSE_VIEW_RANGE)) return true;
	if (Math.hypot(x - pose.x, z - pose.z) < ALWAYS_POSE_DISTANCE) return true;
	return (frame + slot) % UNSEEN_POSE_INTERVAL === 0;
}

/** The lens, for anything that judges how big something looks on screen (LOD). */
const lens = { fov: 48, viewportHeight: 1080 };

export function writeCameraLens(fov: number, viewportHeight: number): void {
	lens.fov = fov;
	if (viewportHeight > 0) lens.viewportHeight = viewportHeight;
}

export function cameraLens(): Readonly<{ fov: number; viewportHeight: number }> {
	return lens;
}
