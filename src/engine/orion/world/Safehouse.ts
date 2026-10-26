import { HOUSE_LOTS, SAFEHOUSE_LOT } from "./Estates";
import { LAND_Y } from "./Mountains";

/**
 * The player's safehouse: a three-level modern villa on Hillcrest's lot SAFEHOUSE_LOT, modelled
 * in Blender (blender/build_safehouse.py → models/buildings/safehouse/orion-safehouse.glb).
 *
 *   Level 0  a stone podium holding the garage: ten bays off a central aisle, driven into from
 *            the street through the opening in the podium's front. The cars the player has
 *            bought or earned are parked here.
 *   Level 1  the glass living floor on top: a sofa facing the TV (somewhere to rest), dining,
 *            kitchen, a terrace and a raised pool. Reached by the stair at the garage's back or
 *            the front stair up from the garden.
 *   Level 2  a teak box cantilevered over the front terrace, seen but not entered.
 *
 * Everything here is in the lot's own frame — x to the right looking at the house from the street,
 * y up from the land, z toward the street — the same numbers as the Blender script. `toWorld`
 * puts a point in the world. Data and plain maths only.
 */

export type Local = readonly [number, number, number];

const lot = HOUSE_LOTS.find((candidate) => candidate.id === SAFEHOUSE_LOT);
if (!lot) throw new Error(`Safehouse lot ${SAFEHOUSE_LOT} isn't laid out`);

export const SAFEHOUSE_SITE = { x: lot.x, z: lot.z, yaw: lot.yaw, ground: LAND_Y } as const;
export const SAFEHOUSE_MODEL = "/models/buildings/safehouse/orion-safehouse.glb";

/** The living floor's level above the land. */
export const LIVING_FLOOR = 4.3;

/** A lot-frame point in the world (y still above the land). */
export function toWorld(local: Local): Local {
	const radians = (SAFEHOUSE_SITE.yaw * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const [x, y, z] = local;
	return [SAFEHOUSE_SITE.x + x * cos + z * sin, y, SAFEHOUSE_SITE.z - x * sin + z * cos];
}

/** A lot-frame heading (degrees about Y, 0 = toward the street) in the world. */
export function yawToWorld(yaw: number): number {
	return (((SAFEHOUSE_SITE.yaw + yaw) % 360) + 360) % 360;
}

/** The world point back in the lot's frame (y untouched). */
export function toLocal(x: number, y: number, z: number): Local {
	const radians = (SAFEHOUSE_SITE.yaw * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const dx = x - SAFEHOUSE_SITE.x;
	const dz = z - SAFEHOUSE_SITE.z;
	return [dx * cos - dz * sin, y, dx * sin + dz * cos];
}

/** A solid box, min and max corners in the lot frame. */
export interface SolidBox {
	min: Local;
	max: Local;
}

/** A stair's walking surface: a slab from its foot to its head, `width` across. */
export interface Ramp {
	foot: Local;
	head: Local;
	width: number;
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): SolidBox => ({ min: [x0, y0, z0], max: [x1, y1, z1] });

const F1 = LIVING_FLOOR;
/** Podium: half-width, front and back faces, wall thickness, garage ceiling. */
const PX = 11.5;
const PZF = 4;
const PZB = -18.5;
const WALL = 0.4;
const CEIL0 = 3.9;
/**
 * The podium front's opening: x ±3.5. Its header is solid from 2 m up, lower than it's drawn,
 * so anything taller than a van is turned away at the door. Inside, the floor above is solid from
 * 4.1 m: a car finds its ground by probing down from 3 m over its centre (OrionVehicle
 * groundHeight), so a vehicle tall enough to start that probe above the slab would be lifted on
 * to it.
 */
const DOOR_HALF = 3.5;
const HEADER_SOLID_FROM = 2.0;
const SLAB_BOTTOM = 4.1;

/** The inside stair: up along the garage's back wall, from x 2 to x -7.2. */
const STAIR = { xFoot: 2.0, xHead: -7.2, z0: -18.1, z1: -16.1 };
/** The front stair, from the garden up to the terrace. */
const FRONT_STAIR = { x0: 7, x1: 10, zFoot: 13.6, zHead: PZF };
const POOL = { x0: 6, x1: 11, z0: -16.5, z1: -3, kerb: 0.3, top: 5.28, basin: 4.75 };
const BOX = { x0: -11.5, x1: 5, z0: -18.5, z1: 0 };
const EDGE = PX + 0.3;

/** Everything solid, in the lot frame. */
export const SAFEHOUSE_SOLIDS: readonly SolidBox[] = [
	// Podium walls and the door header (the garage spans clear: no columns to swing a car round).
	box(-PX, -DOOR_HALF, 0, CEIL0, PZF - WALL, PZF),
	box(DOOR_HALF, PX, 0, CEIL0, PZF - WALL, PZF),
	box(-DOOR_HALF, DOOR_HALF, HEADER_SOLID_FROM, CEIL0, PZF - WALL, PZF),
	box(-PX, -PX + WALL, 0, CEIL0, PZB, PZF),
	box(PX - WALL, PX, 0, CEIL0, PZB, PZF),
	box(-PX, PX, 0, CEIL0, PZB, PZB + WALL),
	// Stone planters either side of the door.
	box(-PX + 0.2, -DOOR_HALF - 1, 0, 0.7, PZF, PZF + 1),
	box(DOOR_HALF + 1, FRONT_STAIR.x0 - 0.8, 0, 0.7, PZF, PZF + 1),
	// The floor over the garage, round the stair's hole.
	box(-EDGE, EDGE, SLAB_BOTTOM, F1, STAIR.z1, PZF + 0.3),
	box(-EDGE, STAIR.xHead, SLAB_BOTTOM, F1, PZB - 0.3, STAIR.z1),
	box(STAIR.xFoot, EDGE, SLAB_BOTTOM, F1, PZB - 0.3, STAIR.z1),
	box(STAIR.xHead, STAIR.xFoot, SLAB_BOTTOM, F1, PZB - 0.3, STAIR.z0),
	// The stair's open side, garage to the rail upstairs, and the rail at its foot's end upstairs.
	box(STAIR.xHead, STAIR.xFoot, 0, F1 + 1.1, STAIR.z1 - 0.05, STAIR.z1 + 0.05),
	box(STAIR.xFoot - 0.05, STAIR.xFoot + 0.05, F1, F1 + 1.1, STAIR.z0, STAIR.z1),
	// The front stair: solid beneath its upper half, guarded both sides.
	box(FRONT_STAIR.x0, FRONT_STAIR.x1, 0, 2, PZF, 9),
	box(FRONT_STAIR.x0 - 0.05, FRONT_STAIR.x0 + 0.05, 0, F1 + 1.1, PZF, FRONT_STAIR.zFoot),
	box(FRONT_STAIR.x1 - 0.05, FRONT_STAIR.x1 + 0.05, 0, F1 + 1.1, PZF, FRONT_STAIR.zFoot),
	// The living box: back wall, TV wall, front glazing either side of the way in, pool-side glazing.
	box(BOX.x0, BOX.x1, F1, 7.7, BOX.z0, BOX.z0 + WALL),
	box(BOX.x0, BOX.x0 + WALL, F1, 7.7, BOX.z0, BOX.z1),
	box(BOX.x0 + WALL, 1.5, F1, 7.7, BOX.z1 - 0.1, BOX.z1),
	box(3.5, BOX.x1, F1, 7.7, BOX.z1 - 0.1, BOX.z1),
	box(BOX.x1 - 0.1, BOX.x1, F1, 7.7, BOX.z0 + WALL, BOX.z1),
	box(1.5, 3.5, 7.1, 7.7, BOX.z1 - 0.1, BOX.z1),
	box(-EDGE, EDGE, 7.7, 8.1, BOX.z0 - 0.3, BOX.z1 + 0.6),
	// Terrace guards, open where the front stair arrives.
	box(-EDGE, FRONT_STAIR.x0, F1, F1 + 1.15, PZF + 0.2, PZF + 0.3),
	box(FRONT_STAIR.x1, EDGE, F1, F1 + 1.15, PZF + 0.2, PZF + 0.3),
	box(EDGE - 0.1, EDGE, F1, F1 + 1.15, PZB - 0.3, PZF + 0.3),
	box(BOX.x1, EDGE, F1, F1 + 1.15, PZB - 0.3, PZB - 0.2),
	box(-EDGE, -EDGE + 0.1, F1, F1 + 1.15, BOX.z1, PZF + 0.3),
	// The raised pool: kerbs, and the basin's floor under the water.
	box(POOL.x0, POOL.x1, F1, POOL.top, POOL.z0, POOL.z0 + POOL.kerb),
	box(POOL.x0, POOL.x1, F1, POOL.top, POOL.z1 - POOL.kerb, POOL.z1),
	box(POOL.x0, POOL.x0 + POOL.kerb, F1, POOL.top, POOL.z0, POOL.z1),
	box(POOL.x1 - POOL.kerb, POOL.x1, F1, POOL.top, POOL.z0, POOL.z1),
	box(POOL.x0, POOL.x1, F1, POOL.basin, POOL.z0, POOL.z1),
	// Furniture: sofa, coffee table, TV console, dining table, island, tall units, loungers.
	box(-7.1, -6.1, F1, F1 + 0.88, -10.75, -7.25),
	box(-9.3, -7.9, F1, F1 + 0.38, -9.9, -8.1),
	box(-11.1, -10.65, F1, F1 + 0.6, -11.4, -6.6),
	box(-0.8, 2.6, F1, F1 + 0.78, -6.8, -4.8),
	box(-0.5, 3.5, F1, F1 + 0.94, -13.05, -11.6),
	box(2.2, 4.85, F1, 7.1, BOX.z0 + WALL, BOX.z0 + WALL + 0.62),
	box(6.6, 7.4, F1, F1 + 0.42, -2.3, -0.3),
	box(9, 9.8, F1, F1 + 0.42, -2.3, -0.3),
];

/** Stairs, walked up as slopes (the steps are only drawn). */
export const SAFEHOUSE_RAMPS: readonly Ramp[] = [
	{ foot: [STAIR.xFoot + 0.4, 0, (STAIR.z0 + STAIR.z1) / 2], head: [STAIR.xHead, F1, (STAIR.z0 + STAIR.z1) / 2], width: STAIR.z1 - STAIR.z0 },
	{ foot: [(FRONT_STAIR.x0 + FRONT_STAIR.x1) / 2, 0, FRONT_STAIR.zFoot + 0.4], head: [(FRONT_STAIR.x0 + FRONT_STAIR.x1) / 2, F1, FRONT_STAIR.zHead], width: FRONT_STAIR.x1 - FRONT_STAIR.x0 },
];

/**
 * The garage bays, lot frame: five down each side of the aisle, every car backed in so it drives
 * straight out across the aisle. Filled in order, nearest the door first.
 */
const BAY_Z = [1.6, -1.8, -5.2, -8.6, -12];
const BAY_X = 8.4;
export const SAFEHOUSE_BAYS_LOCAL: readonly { x: number; z: number; yaw: number }[] = BAY_Z.flatMap((z) => [
	{ x: -BAY_X, z, yaw: 90 },
	{ x: BAY_X, z, yaw: -90 },
]);

/** Where the driveway meets the street, lot frame. */
export const SAFEHOUSE_DRIVEWAY_LOCAL: Local = [0, 0, 14.5];

/**
 * The sofa: where the player sits (hips over the middle cushion, facing the TV on the stone wall),
 * where they stand up to, and the TV's screen (centre and size), for the rest (components/world/
 * Safehouse).
 */
export const SAFEHOUSE_SOFA = {
	seat: [-6.75, F1 + 0.5, -9] as Local,
	/** Facing the TV: toward -x in the lot frame. */
	yaw: -90,
	stand: [-5.3, F1, -9] as Local,
	/** Rest is offered within this distance of `stand`. */
	reach: 1.3,
	/** The camera while resting: over the sofa's back, looking at the screen. */
	view: { from: [-3.9, F1 + 1.9, -7.6] as Local, at: [-11.1, F1 + 1.45, -9.2] as Local },
	screen: { centre: [-11.0, 5.85, -9] as Local, width: 2.2, height: 1.24 },
} as const;
