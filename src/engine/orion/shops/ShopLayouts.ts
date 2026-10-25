/**
 * Where the shops stand and what's where inside them: the building or lot, the counter the player
 * walks up to, who serves there, and the spot each thing for sale is on show (a gun on the wall,
 * a car on the lot) with where the camera stands to show it. The building (components/world/
 * ShopBuildings), the counter (components/world/Shops) and the catalog all read it from here.
 *
 * Everything inside a site is laid out in its own frame: +Z is the way it faces the street (the
 * door, the lot's road side), +X to the right of someone walking in. `toWorld` puts it in place.
 * Data and plain maths only, so the map can list the shops without pulling the game in.
 */

export type Point3 = readonly [number, number, number];

/** The city's land level (world/Mountains' LAND_Y): the shops stand on it, as the hospital does. */
const LAND = -0.65;

export interface ShopSite {
	/** The middle of the plot, on the ground. */
	x: number;
	z: number;
	/** Height of its floor: the store's tiles, the lot's asphalt. */
	ground: number;
	/** Turn (degrees about Y) that faces the site's +Z onto the street. */
	yaw: number;
	/** Across (X) and deep (Z), metres. */
	width: number;
	depth: number;
	/** The grid buildings whose plot it takes. */
	replaces: readonly string[];
}

/** Something on show, and where the camera stands to look at it. */
export interface DisplaySpot {
	at: Point3;
	from: Point3;
}

/** A car on the lot: where it's parked, which way it faces (degrees in the site's frame), and how it's shown. */
export interface DisplayBay {
	x: number;
	z: number;
	yaw: number;
	/** Picked for each car: a clear line to it past the others on the lot. */
	view: DisplaySpot;
}

/** A point in a site's frame, in the world. */
export function toWorld(site: ShopSite, local: Point3): Point3 {
	const radians = (site.yaw * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const [x, y, z] = local;
	return [site.x + x * cos + z * sin, y, site.z - x * sin + z * cos];
}

/** A heading in a site's frame, in the world (degrees about Y, 0 facing +Z). */
export function yawToWorld(site: ShopSite, yaw: number): number {
	return (((site.yaw + yaw) % 360) + 360) % 360;
}

// ---- Orion Arms ------------------------------------------------------------------------------

/**
 * On the west side of the main north–south arterial, across from Kasper Motors: a one-storey
 * store, its door and windows onto the pavement.
 */
export const ORION_ARMS_SITE: ShopSite = { x: -17, z: 53, ground: LAND + 0.02, yaw: 90, width: 12, depth: 12, replaces: ["building-022"] };

/** The room: the counter across it, the gun wall behind, ammo shelves on the left, armour on the right. */
export const ORION_ARMS_ROOM = {
	/** Height to the ceiling. */
	height: 4.4,
	wall: 0.3,
	door: { width: 2.2, height: 2.7 },
	/** The counter's front edge, and how far it runs either side. */
	counter: { z: -1.6, depth: 0.75, halfWidth: 4.2, height: 1.0 },
	/** Where the customer stands to be served. */
	customer: [0, 0, -0.55] as Point3,
	/** The clerk, behind the counter, facing the door. */
	keeper: [0, 0, -2.8] as Point3,
	/** The face of the pegboard on the back wall (whose inside face is at -5.7); the guns hang just off it. */
	pegboardZ: -5.64,
	/** The ammo shelving along the left wall (inside face at x -5.7), and the vest on its stand by the right window. */
	shelves: { x: -5.44, depth: 0.5, fromZ: -0.6, toZ: 3.4, height: 2.2 },
	vest: [4.5, 0, 2.2] as Point3,
} as const;

/** A gun hung on the wall: which, and where its middle is. */
export interface WallGun {
	weapon: "pistol" | "shotgun" | "ar" | "rocketLauncher" | "sword";
	x: number;
	y: number;
}

export const ORION_ARMS_WALL: readonly WallGun[] = [
	{ weapon: "rocketLauncher", x: -2.6, y: 3.35 },
	{ weapon: "sword", x: 2.4, y: 3.35 },
	{ weapon: "ar", x: -2.6, y: 2.55 },
	{ weapon: "ar", x: 2.4, y: 2.55 },
	{ weapon: "shotgun", x: -2.6, y: 1.75 },
	{ weapon: "shotgun", x: 2.4, y: 1.75 },
	{ weapon: "pistol", x: -0.2, y: 2.15 },
];

/** Pistols lying under the counter's glass. */
export const ORION_ARMS_CASE: readonly number[] = [-2.6, -1.3, 1.3, 2.6];

/** Looking at the wall from over the counter: the thing a little left of centre, clear of the panel on the right. */
function onTheWall(x: number, y: number): DisplaySpot {
	const z = ORION_ARMS_ROOM.pegboardZ + 0.1;
	return { at: [x + 0.55, y - 0.05, z], from: [x + 0.85, y + 0.05, z + 2.7] };
}

const ARMS_SHELF: DisplaySpot = { at: [-5.0, 1.2, 1.6], from: [-2.6, 1.5, 2.9] };

/** Each item's spot, by its id in the catalog (see ShopCatalog). */
export const ORION_ARMS_DISPLAYS: Readonly<Record<string, DisplaySpot>> = {
	shotgun: onTheWall(-2.6, 1.75),
	ar: onTheWall(-2.6, 2.55),
	"rocket-launcher": onTheWall(-2.6, 3.35),
	"ammo-pistol": ARMS_SHELF,
	"ammo-shotgun": ARMS_SHELF,
	"ammo-ar": ARMS_SHELF,
	"ammo-rockets": ARMS_SHELF,
	vest: { at: [4.35, 1.38, 2.0], from: [3.0, 1.55, 3.1] },
};

// ---- Kasper Motors' showroom -------------------------------------------------------------------

/**
 * Beside Kasper Motors on the east side of the arterial: the Prestige showroom, a glass pavilion
 * on the plot of the old open lot, a polished forecourt in front of it.
 */
export const KASPER_LOT_SITE: ShopSite = { x: 16.2, z: 35, ground: LAND + 0.06, yaw: -90, width: 13.6, depth: 14, replaces: ["building-026"] };

/**
 * The pavilion: its glass front set back from the street behind a forecourt, an open doorway in the
 * middle of it, stone side walls and a dark feature wall at the back; the reception desk before
 * the feature wall, facing the door, the customer before it and the salesperson behind.
 */
export const KASPER_HALL = {
	/** The glass front (z), the inside face of the back wall, and the side walls' inside faces (±x). */
	front: 5.0,
	back: -6.8,
	side: 6.6,
	wall: 0.2,
	height: 5.2,
	door: { halfWidth: 1.4, height: 3.1 },
	desk: { x: 0, z: -5.9, width: 2.6, depth: 0.7, height: 1.05 },
} as const;

export const KASPER_LOT_PLACES = {
	customer: [0, 0, -5.15] as Point3,
	keeper: [0, 0, -6.45] as Point3,
} as const;

/** A car on show: on a plinth this high. */
export interface ShowroomBay extends DisplayBay {
	plinth: number;
}

/**
 * The cars for sale, by item id, on plinths in the hall: the hypercar on the big plinth in the
 * middle, facing the door, two cars either side angled toward it. Each is shown from inside the hall, the camera
 * a little to the right of it so it sits left of the panel.
 */
export const KASPER_LOT_BAYS: Readonly<Record<string, ShowroomBay>> = {
	halcyon: { x: 0, z: -2.3, yaw: 0, plinth: 0.12, view: { at: [0.7, 0.6, -2.1], from: [2.6, 1.9, 2.2] } },
	calliope: { x: -4.4, z: 2.0, yaw: 12, plinth: 0.08, view: { at: [-3.8, 0.6, 2.2], from: [-0.8, 1.9, 4.6] } },
	"solenne-gt": { x: 4.4, z: 2.0, yaw: -12, plinth: 0.08, view: { at: [5.0, 0.6, 2.2], from: [1.6, 1.9, 4.6] } },
	regalia: { x: -4.4, z: -3.65, yaw: 12, plinth: 0.08, view: { at: [-3.7, 0.75, -3.3], from: [-0.6, 2.2, 0.6] } },
	ascendant: { x: 4.4, z: -3.65, yaw: -12, plinth: 0.08, view: { at: [5.0, 0.85, -3.3], from: [1.8, 2.3, 0.4] } },
};
