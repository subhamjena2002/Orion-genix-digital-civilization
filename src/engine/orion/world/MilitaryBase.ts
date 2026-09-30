import { CITY_EXTENT_Z, roadWidthAt } from "../roads/RoadNetwork";

/**
 * The army base south of the city: a walled compound with watchtowers at the corners, a guarded
 * gate facing the city, barracks, tents, container offices, a parade ground, a helipad and a
 * motor pool — laid out here as data, built from the pieces of one modular kit (MilitaryBase
 * component).
 *
 * Positions are world metres; `yaw` is degrees about Y (0 = the piece as the kit has it).
 */

/** Pieces of the kit, by what they are (see MILITARY_KIT_NODES for the kit's node names). */
export type BasePiece =
	| "barracks" | "containerOffice" | "tent" | "watchtower" | "gateTower"
	| "wall" | "barrier" | "sandbags" | "lamp" | "shortLamp"
	| "barrels" | "barrel" | "crate" | "smallCrate" | "tyre" | "pallets" | "generator";

/** The kit's top-level nodes for each piece (a piece can be several nodes sharing a spot). */
export const MILITARY_KIT_NODES: Readonly<Record<BasePiece, readonly string[]>> = {
	// The concrete barracks, its roof and the doors at either end.
	barracks: ["Circle.008_1", "Circle.015_2", "Circle.012_0", "Circle.030_3"],
	containerOffice: ["Plane_5"],
	tent: ["Circle.029_6"],
	watchtower: ["Plane.016_15"],
	gateTower: ["Plane.013_13"],
	wall: ["Plane.011_19"],
	barrier: ["Cube_21"],
	sandbags: ["Plane.010_8"],
	lamp: ["Circle.037_10"],
	shortLamp: ["Circle.039_11"],
	barrels: ["Circle.031_26"],
	barrel: ["Circle.045_25"],
	crate: ["Cube.003_17"],
	smallCrate: ["Cube.002_16"],
	tyre: ["Circle.042_23"],
	pallets: ["Plane.004_7"],
	generator: ["Plane.018_28"],
};

/** Pieces too small or flat to stop anyone: no collider. */
export const WALK_THROUGH_PIECES: ReadonlySet<BasePiece> = new Set<BasePiece>(["tyre", "pallets"]);

export interface Placement {
	piece: BasePiece;
	x: number;
	z: number;
	yaw: number;
}

export interface Pad {
	id: string;
	kind: "yard" | "asphalt" | "concrete";
	x: number;
	z: number;
	width: number;
	depth: number;
}

export const BASE = {
	name: "Orion Army Base",
	centre: [0, 372] as const,
	/** Inside the perimeter wall, x by z. */
	size: [150, 116] as const,
	/** Width of the opening in the north wall, on the base's centreline. */
	gateWidth: 10,
	/** Length of one wall panel in the kit. */
	wallPanel: 3.1,
};

/** The opening in the east wall onto the airfield's apron (see Airfield), from the motor pool. */
export const AIRFIELD_GATE = { x: BASE.centre[0] + BASE.size[0] / 2, z: BASE.centre[1] + 8, width: 10 };

const HALF_X = BASE.size[0] / 2;
const HALF_Z = BASE.size[1] / 2;
const [CX, CZ] = BASE.centre;
const NORTH = CZ - HALF_Z;
const SOUTH = CZ + HALF_Z;
const WEST = CX - HALF_X;
const EAST = CX + HALF_X;

/** The city's southern road, which the access road leaves from. */
const CITY_EDGE_ROAD_Z = CITY_EXTENT_Z;

function walls(): Placement[] {
	const out: Placement[] = [];
	const panel = BASE.wallPanel;
	// North and south, along x; the north one leaves the gate open.
	for (let x = WEST + panel / 2; x < EAST; x += panel) {
		if (Math.abs(x - CX) > BASE.gateWidth / 2 + panel / 2) out.push({ piece: "wall", x, z: NORTH, yaw: 0 });
		out.push({ piece: "wall", x, z: SOUTH, yaw: 0 });
	}
	// East and west, along z; the east one leaves the airfield gate open.
	for (let z = NORTH + panel / 2; z < SOUTH; z += panel) {
		out.push({ piece: "wall", x: WEST, z, yaw: 90 });
		if (Math.abs(z - AIRFIELD_GATE.z) > AIRFIELD_GATE.width / 2 + panel / 2) out.push({ piece: "wall", x: EAST, z, yaw: 90 });
	}
	return out;
}

function layout(): Placement[] {
	const out = walls();
	const p = (piece: BasePiece, x: number, z: number, yaw = 0) => out.push({ piece, x: CX + x, z: CZ + z, yaw });

	// Watchtowers inside each corner.
	for (const sx of [-1, 1]) for (const sz of [-1, 1]) p("watchtower", sx * (HALF_X - 4), sz * (HALF_Z - 4));
	// The gate: a tower either side, sandbag emplacements, barriers staggered in the road outside
	// (a chicane, so nothing drives straight in), floodlights.
	p("gateTower", -9, -HALF_Z + 3.5);
	p("gateTower", 9, -HALF_Z + 3.5);
	p("sandbags", -9, -HALF_Z - 3, 0);
	p("sandbags", 9, -HALF_Z - 3, 0);
	p("barrier", -2.2, -HALF_Z - 12);
	p("barrier", 2.2, -HALF_Z - 20);
	p("lamp", -6.5, -HALF_Z - 1.5);
	p("lamp", 6.5, -HALF_Z - 1.5);
	// Guard post just inside the gate.
	p("containerOffice", 16, -HALF_Z + 8, 90);

	// Barracks: a row of four huts on the west side, end doors opening north and south.
	for (let i = 0; i < 4; i++) p("barracks", -58 + i * 13, -24);
	// Tents behind them.
	for (let i = 0; i < 4; i++) p("tent", -58 + i * 12, 14);
	// Container offices (the headquarters) on the east side, side by side.
	p("containerOffice", 30, -24);
	p("containerOffice", 36, -24);
	p("containerOffice", 42, -24);
	// Floodlights round the parade ground and along the roadway.
	for (const [x, z] of [[-14, -10], [26, -10], [-14, 28], [26, 28], [0, -40], [0, 42], [-40, 42], [28, 42]]) p("lamp", x, z);
	for (const [x, z] of [[-64, -2], [-40, -2]]) p("shortLamp", x, z);
	// And either side of the airfield gate, out of the way of anything driving through.
	for (const side of [-1, 1]) p("shortLamp", HALF_X - 3, AIRFIELD_GATE.z - CZ + side * (AIRFIELD_GATE.width / 2 + 1.5));

	// Motor pool supplies (the vehicles themselves are placed as parked cars).
	p("barrels", 66, 20);
	p("barrel", 64, 24);
	p("barrel", 66, 25.5);
	p("generator", 62, 18);
	p("tyre", 58, 26);
	p("tyre", 59.6, 26.4);
	// A supply dump by the tents.
	p("crate", -64, 30);
	p("crate", -62.4, 30.4);
	p("smallCrate", -63, 31.9);
	p("pallets", -58, 32);
	p("barrels", -52, 32);
	// Sandbag nests at the corners of the parade ground and by the helipad.
	p("sandbags", -26, 44, 90);
	p("sandbags", 52, 36, 0);
	return out;
}

export const BASE_LAYOUT: readonly Placement[] = layout();

/** Ground: the yard inside the walls, and paved areas on it. */
export const BASE_PADS: readonly Pad[] = [
	{ id: "yard", kind: "yard", x: CX, z: CZ, width: BASE.size[0], depth: BASE.size[1] },
	{ id: "parade-ground", kind: "asphalt", x: CX + 6, z: CZ + 9, width: 38, depth: 36 },
	{ id: "motor-pool", kind: "asphalt", x: CX + 56, z: CZ + 12, width: 30, depth: 30 },
	{ id: "roadway", kind: "asphalt", x: CX, z: CZ - HALF_Z / 2 - 4, width: 8, depth: HALF_Z - 8 },
];

/** The helipad: a concrete disc with a painted H. */
export const HELIPAD = { x: CX + 44, z: CZ + 44, radius: 9 };

/** The access road from the city's southern road to the gate. */
export const ACCESS_ROAD = {
	x: CX,
	/** From the south kerb of the city road... */
	fromZ: CITY_EDGE_ROAD_Z + roadWidthAt(CITY_EDGE_ROAD_Z) / 2,
	/** ...to the gate. */
	toZ: NORTH + 1,
	width: 8,
};

/** Army vehicles parked in the motor pool. */
export const BASE_VEHICLES: readonly { id: string; style: "militaryWagon" | "truck"; x: number; z: number; yaw: number }[] = [
	{ id: "army-wagon-1", style: "militaryWagon", x: CX + 46, z: CZ + 2, yaw: 180 },
	{ id: "army-wagon-2", style: "militaryWagon", x: CX + 52, z: CZ + 2, yaw: 180 },
	{ id: "army-wagon-3", style: "militaryWagon", x: CX + 58, z: CZ + 2, yaw: 180 },
	{ id: "army-truck-1", style: "truck", x: CX + 54, z: CZ + 17, yaw: 90 },
];

export const BASE_BOUNDS = { minX: WEST, maxX: EAST, minZ: NORTH, maxZ: SOUTH };
