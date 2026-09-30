import { addQuad, addVertex, emptyMesh, type MeshData } from "./MeshData";
import { AIRFIELD_GATE, BASE, type Placement } from "./MilitaryBase";

/**
 * The army base's airfield, for fighter jets: a runway down the peninsula east of the base (the
 * approaches come in over the sea), a parallel taxiway, an apron with jet stands by the base's
 * east gate, hardened aircraft shelters, a control tower, and a wall across the land side.
 *
 * World metres; z grows southwards, so the runway's north end is "18" (landing there, you
 * head 180°) and its south end "36".
 */

export type SurfaceKind = "runway" | "shoulder" | "blastPad" | "taxiway" | "apron" | "shelterApron";

/** A paved rectangle, centre x/z, `width` along x and `depth` along z. */
export interface Surface {
	id: string;
	kind: SurfaceKind;
	x: number;
	z: number;
	width: number;
	depth: number;
}

export const RUNWAY = {
	x: 195,
	northZ: 290,
	southZ: 840,
	width: 30,
	/** Paved but unmarked, either side. */
	shoulder: 7.5,
	/** Beyond each end, for jet blast and overruns. */
	blastPad: 15,
	north: "18",
	south: "36",
};

export const TAXIWAY = { x: 145, width: 18, northZ: 291, southZ: 809 };
/** Where taxiway links cross over to the runway. */
export const CONNECTOR_Z: readonly number[] = [300, 560, 800];

const TAXI_WEST = TAXIWAY.x - TAXIWAY.width / 2;
const TAXI_EAST = TAXIWAY.x + TAXIWAY.width / 2;
const RUNWAY_WEST = RUNWAY.x - RUNWAY.width / 2;
const RUNWAY_EAST = RUNWAY.x + RUNWAY.width / 2;
const STRIP_WEST = RUNWAY_WEST - RUNWAY.shoulder;
const RUNWAY_LENGTH = RUNWAY.southZ - RUNWAY.northZ;

/** The apron: jets park here, between the base's east wall and the taxiway. */
export const APRON = { minX: 85, maxX: TAXI_WEST, minZ: 318, maxZ: 436 };

/** Jet stands on the apron, nose east to taxi straight out; `x`/`z` is the jet's centre. */
export const STANDS: readonly { number: number; x: number; z: number }[] = Array.from({ length: 6 }, (_, index) => ({
	number: index + 1,
	x: 106,
	z: 327 + index * 19,
}));

/** A hardened aircraft shelter: a concrete arch, closed at the back, open at the door. */
export const SHELTER = { width: 22, height: 9, depth: 32, wall: 0.8 };
/** Shelters down the peninsula's west side, doors facing the taxiway (east). */
export const SHELTERS: readonly { id: string; backX: number; z: number }[] = [490, 535, 580, 625, 670].map((z, index) => ({
	id: `shelter-${index + 1}`,
	backX: 95,
	z,
}));
const SHELTER_DOOR_X = SHELTERS[0].backX + SHELTER.depth;

export const CONTROL_TOWER = {
	x: 105,
	z: 290,
	shaft: 6,
	/** Height of the cab's floor. */
	height: 16,
	cab: 10,
	cabHeight: 4,
	/** The operations block at the tower's foot, north of it. */
	block: { x: 105, z: 276, width: 20, depth: 10, height: 4.5 },
};

export const WINDSOCK = { x: 226, z: 302, height: 7 };

export const AIRFIELD_SURFACES: readonly Surface[] = [
	{ id: "runway", kind: "runway", x: RUNWAY.x, z: (RUNWAY.northZ + RUNWAY.southZ) / 2, width: RUNWAY.width, depth: RUNWAY_LENGTH },
	{ id: "shoulder-west", kind: "shoulder", x: RUNWAY_WEST - RUNWAY.shoulder / 2, z: (RUNWAY.northZ + RUNWAY.southZ) / 2, width: RUNWAY.shoulder, depth: RUNWAY_LENGTH },
	{ id: "shoulder-east", kind: "shoulder", x: RUNWAY_EAST + RUNWAY.shoulder / 2, z: (RUNWAY.northZ + RUNWAY.southZ) / 2, width: RUNWAY.shoulder, depth: RUNWAY_LENGTH },
	{ id: "blast-pad-north", kind: "blastPad", x: RUNWAY.x, z: RUNWAY.northZ - RUNWAY.blastPad / 2, width: RUNWAY.width, depth: RUNWAY.blastPad },
	{ id: "blast-pad-south", kind: "blastPad", x: RUNWAY.x, z: RUNWAY.southZ + RUNWAY.blastPad / 2, width: RUNWAY.width, depth: RUNWAY.blastPad },
	{ id: "taxiway", kind: "taxiway", x: TAXIWAY.x, z: (TAXIWAY.northZ + TAXIWAY.southZ) / 2, width: TAXIWAY.width, depth: TAXIWAY.southZ - TAXIWAY.northZ },
	...CONNECTOR_Z.map((z, index): Surface => ({ id: `connector-${index + 1}`, kind: "taxiway", x: (TAXI_EAST + STRIP_WEST) / 2, z, width: STRIP_WEST - TAXI_EAST, depth: TAXIWAY.width })),
	{ id: "apron", kind: "apron", x: (APRON.minX + APRON.maxX) / 2, z: (APRON.minZ + APRON.maxZ) / 2, width: APRON.maxX - APRON.minX, depth: APRON.maxZ - APRON.minZ },
	// Through the base's east gate, from the motor pool's edge to the apron.
	{ id: "gate-link", kind: "apron", x: (AIRFIELD_GATE.x - 4 + APRON.minX) / 2, z: AIRFIELD_GATE.z, width: APRON.minX - (AIRFIELD_GATE.x - 4), depth: AIRFIELD_GATE.width },
	...SHELTERS.map((shelter): Surface => ({ id: `${shelter.id}-apron`, kind: "shelterApron", x: (shelter.backX + TAXI_WEST) / 2, z: shelter.z, width: TAXI_WEST - shelter.backX, depth: SHELTER.width })),
];

/** The wall across the land side: each run starts at the base's wall and ends in the sea. */
export const AIRFIELD_FENCE: readonly (readonly (readonly [number, number])[])[] = [
	[[BASE.centre[0] + BASE.size[0] / 2, BASE.centre[1] - BASE.size[1] / 2], [75, 262], [240, 262], [240, 540], [259, 540]],
	[[BASE.centre[0] + BASE.size[0] / 2, BASE.centre[1] + BASE.size[1] / 2], [75, 731]],
];

export const AIRFIELD_BOUNDS = { minX: 75, maxX: 240, minZ: 262, maxZ: 870 };

function fencePanels(): Placement[] {
	const out: Placement[] = [];
	for (const run of AIRFIELD_FENCE) {
		for (let i = 1; i < run.length; i++) {
			const [ax, az] = run[i - 1];
			const [bx, bz] = run[i];
			const length = Math.hypot(bx - ax, bz - az);
			const count = Math.max(1, Math.round(length / BASE.wallPanel));
			// A wall panel runs along its x; turned to run from a to b.
			const yaw = Math.atan2(-(bz - az), bx - ax) * 180 / Math.PI;
			for (let k = 0; k < count; k++) {
				const t = (k + 0.5) / count;
				out.push({ piece: "wall", x: ax + (bx - ax) * t, z: az + (bz - az) * t, yaw });
			}
		}
	}
	return out;
}

/** Kit pieces for the airfield: its wall, watchtowers at the corners, floodlights on the apron. */
export const AIRFIELD_LAYOUT: readonly Placement[] = [
	...fencePanels(),
	{ piece: "watchtower", x: 80, z: 267, yaw: 0 },
	{ piece: "watchtower", x: 235, z: 267, yaw: 0 },
	{ piece: "watchtower", x: 81, z: 700, yaw: 0 },
	...[330, 360, 400, 430].map((z): Placement => ({ piece: "lamp", x: 80, z, yaw: 0 })),
	// Ground equipment by the shelters.
	{ piece: "generator", x: 90, z: 504, yaw: 90 },
	{ piece: "barrels", x: 90, z: 549, yaw: 0 },
	{ piece: "crate", x: 90, z: 594, yaw: 0 },
	{ piece: "smallCrate", x: 90, z: 596, yaw: 20 },
];

/** Ground vehicles parked on the apron. */
export const AIRFIELD_VEHICLES: readonly { id: string; style: "serviceTruck" | "towTruck"; x: number; z: number; yaw: number }[] = [
	{ id: "airfield-service-1", style: "serviceTruck", x: 91, z: 322, yaw: 0 },
	{ id: "airfield-tow-1", style: "towTruck", x: 91, z: 432, yaw: 180 },
];

// ---------------------------------------------------------------------------------------------
// Paint and lights.

export type Paint = "white" | "yellow";

/** A painted stripe: centre, `width` along x and `depth` along z before turning by `yaw` degrees. */
export interface Marking {
	x: number;
	z: number;
	width: number;
	depth: number;
	yaw: number;
	paint: Paint;
}

/** Painted characters: `up` is the direction the tops of the characters point. */
export interface PaintedLabel {
	text: string;
	x: number;
	z: number;
	/** Size across and along the reading direction. */
	width: number;
	height: number;
	up: "north" | "south" | "east" | "west";
	paint: Paint;
}

const stripe = (x: number, z: number, width: number, depth: number, paint: Paint = "white", yaw = 0): Marking => ({ x, z, width, depth, yaw, paint });

function runwayMarkings(): Marking[] {
	const out: Marking[] = [];
	const { x, northZ, southZ, width } = RUNWAY;
	// Edge lines, the full length.
	for (const side of [-1, 1]) out.push(stripe(x + side * (width / 2 - 0.45), (northZ + southZ) / 2, 0.9, RUNWAY_LENGTH));
	// At each end (sign +1 at the north, heading south; -1 at the south): threshold stripes,
	// aiming points 150 m in, and a chevron on the blast pad.
	for (const [threshold, into] of [[northZ, 1], [southZ, -1]] as const) {
		for (const side of [-1, 1]) {
			for (let k = 0; k < 4; k++) out.push(stripe(x + side * (2.4 + k * 3.6), threshold + into * 21, 1.8, 30));
			out.push(stripe(x + side * 7, threshold + into * 150, 4, 30));
			// The chevron's arms, apex at the runway end.
			const apexZ = threshold - into * 2;
			const tipX = x + side * 13;
			const tipZ = threshold - into * 13;
			const length = Math.hypot(tipX - x, tipZ - apexZ);
			out.push({ x: (x + tipX) / 2, z: (apexZ + tipZ) / 2, width: length, depth: 0.9, yaw: Math.atan2(-(tipZ - apexZ), tipX - x) * 180 / Math.PI, paint: "yellow" });
		}
	}
	// Centreline: 30 m stripes, 20 m gaps, between the numbers.
	for (let z = northZ + 65; z + 30 <= southZ - 62; z += 50) out.push(stripe(x, z + 15, 0.6, 30));
	return out;
}

function taxiMarkings(): Marking[] {
	const out: Marking[] = [];
	const line = 0.3;
	// The taxiway's centreline, and each link's across to the runway's edge.
	out.push(stripe(TAXIWAY.x, (TAXIWAY.northZ + TAXIWAY.southZ) / 2, line, TAXIWAY.southZ - TAXIWAY.northZ, "yellow"));
	for (const z of CONNECTOR_Z) {
		out.push(stripe((TAXIWAY.x + line / 2 + RUNWAY_WEST) / 2, z, RUNWAY_WEST - TAXIWAY.x - line / 2, line, "yellow"));
		// Holding position: two solid lines, then two dashed, across the link.
		const holdX = STRIP_WEST - 4;
		for (const offset of [0, 0.6]) out.push(stripe(holdX + offset, z, 0.3, TAXIWAY.width - 1, "yellow"));
		for (const offset of [1.2, 1.8]) {
			for (let dz = -TAXIWAY.width / 2 + 1; dz + 1 <= TAXIWAY.width / 2 - 0.5; dz += 2) out.push(stripe(holdX + offset, z + dz + 0.5, 0.3, 1, "yellow"));
		}
	}
	// Each stand: a lead-in line from the taxiway's centreline, and a stop bar at the nose wheel.
	for (const stand of STANDS) {
		const from = stand.x - 9;
		out.push(stripe((from + TAXIWAY.x - line / 2) / 2, stand.z, TAXIWAY.x - line / 2 - from, line, "yellow"));
		out.push(stripe(stand.x + 6, stand.z, 0.4, 4, "yellow"));
	}
	// Each shelter: its lead-in, from the taxiway to the back of the shelter.
	for (const shelter of SHELTERS) {
		const from = shelter.backX + 6;
		out.push(stripe((from + TAXIWAY.x - line / 2) / 2, shelter.z, TAXIWAY.x - line / 2 - from, line, "yellow"));
	}
	return out;
}

export const AIRFIELD_MARKINGS: readonly Marking[] = [...runwayMarkings(), ...taxiMarkings()];

export const AIRFIELD_LABELS: readonly PaintedLabel[] = [
	// Runway numbers 12 m past the threshold stripes, read by a pilot landing over them.
	{ text: RUNWAY.north, x: RUNWAY.x, z: RUNWAY.northZ + 6 + 30 + 12 + 4.5, width: 12, height: 9, up: "south", paint: "white" },
	{ text: RUNWAY.south, x: RUNWAY.x, z: RUNWAY.southZ - 6 - 30 - 12 - 4.5, width: 12, height: 9, up: "north", paint: "white" },
	// Stand numbers on each lead-in, read by a pilot taxiing in.
	...STANDS.map((stand): PaintedLabel => ({ text: String(stand.number), x: stand.x + 18, z: stand.z + 3.5, width: 3, height: 3, up: "west", paint: "yellow" })),
];

export type LightColour = "white" | "green" | "blue";

export const AIRFIELD_LIGHTS: readonly { x: number; z: number; colour: LightColour }[] = [
	// Runway edge lights in the shoulders, every 50 m.
	...[-1, 1].flatMap((side) => Array.from({ length: Math.floor(RUNWAY_LENGTH / 50) + 1 }, (_, k) => ({ x: RUNWAY.x + side * (RUNWAY.width / 2 + 1.5), z: RUNWAY.northZ + k * 50, colour: "white" as const }))),
	// Threshold lights across each end, on the blast pads.
	...[RUNWAY.northZ - 1, RUNWAY.southZ + 1].flatMap((z) => Array.from({ length: 8 }, (_, k) => ({ x: RUNWAY_WEST + 1.5 + k * 3.857, z, colour: "green" as const }))),
	// Taxiway edge lights, clear of the links and the apron.
	...[TAXI_WEST - 0.5, TAXI_EAST + 0.5].flatMap((x) => Array.from({ length: 9 }, (_, k) => ({ x, z: 330 + k * 60, colour: "blue" as const })))
		.filter((light) => !CONNECTOR_Z.some((z) => Math.abs(light.z - z) < TAXIWAY.width / 2 + 1))
		.filter((light) => !(light.x < TAXIWAY.x && light.z > APRON.minZ - 1 && light.z < APRON.maxZ + 1))
		.filter((light) => !(light.x < TAXIWAY.x && SHELTERS.some((shelter) => Math.abs(light.z - shelter.z) < SHELTER.width / 2 + 1))),
];

// ---------------------------------------------------------------------------------------------
// Shelter geometry.

/** Segments around the arch. */
const ARCH_SEGMENTS = 20;

/**
 * One hardened aircraft shelter in its own frame: back wall on x = 0, door at x = depth, the
 * arch across z and standing on y = 0. A closed solid, faces outward.
 */
export function buildShelterMesh(textureUnit: number): MeshData {
	const mesh = emptyMesh();
	const { width, height, depth, wall } = SHELTER;
	const outer = { a: width / 2, b: height };
	const inner = { a: width / 2 - wall, b: height - wall };
	const point = (ellipse: { a: number; b: number }, t: number) => ({ z: ellipse.a * Math.cos(t), y: ellipse.b * Math.sin(t) });
	const normalAt = (ellipse: { a: number; b: number }, t: number) => {
		const nz = Math.cos(t) / ellipse.a;
		const ny = Math.sin(t) / ellipse.b;
		const length = Math.hypot(nz, ny);
		return { nz: nz / length, ny: ny / length };
	};
	const angles = Array.from({ length: ARCH_SEGMENTS + 1 }, (_, i) => Math.PI * i / ARCH_SEGMENTS);
	const arcLengths = (ellipse: { a: number; b: number }) => {
		const out = [0];
		for (let i = 1; i < angles.length; i++) {
			const p = point(ellipse, angles[i - 1]);
			const q = point(ellipse, angles[i]);
			out.push(out[i - 1] + Math.hypot(q.z - p.z, q.y - p.y));
		}
		return out;
	};

	// The curved faces: outside (x 0..depth) and inside (behind the back wall to the door).
	for (const [ellipse, fromX, sign] of [[outer, 0, 1], [inner, wall, -1]] as const) {
		const arc = arcLengths(ellipse);
		const near: number[] = [];
		const far: number[] = [];
		angles.forEach((t, i) => {
			const p = point(ellipse, t);
			const n = normalAt(ellipse, t);
			near.push(addVertex(mesh, fromX, p.y, p.z, 0, sign * n.ny, sign * n.nz, arc[i] / textureUnit, fromX / textureUnit));
			far.push(addVertex(mesh, depth, p.y, p.z, 0, sign * n.ny, sign * n.nz, arc[i] / textureUnit, depth / textureUnit));
		});
		for (let i = 0; i < ARCH_SEGMENTS; i++) addFacingQuad(mesh, near[i], near[i + 1], far[i + 1], far[i]);
	}

	// The door's face: the ring between the two arches.
	const ringOuter: number[] = [];
	const ringInner: number[] = [];
	for (const t of angles) {
		const p = point(outer, t);
		const q = point(inner, t);
		ringOuter.push(addVertex(mesh, depth, p.y, p.z, 1, 0, 0, p.z / textureUnit, p.y / textureUnit));
		ringInner.push(addVertex(mesh, depth, q.y, q.z, 1, 0, 0, q.z / textureUnit, q.y / textureUnit));
	}
	for (let i = 0; i < ARCH_SEGMENTS; i++) addFacingQuad(mesh, ringOuter[i], ringOuter[i + 1], ringInner[i + 1], ringInner[i]);

	// The back wall: its outside face, and its inside face behind the hangar floor.
	for (const [ellipse, x, nx] of [[outer, 0, -1], [inner, wall, 1]] as const) {
		const centre = addVertex(mesh, x, 0, 0, nx, 0, 0, 0, 0);
		const rim = angles.map((t) => {
			const p = point(ellipse, t);
			return addVertex(mesh, x, p.y, p.z, nx, 0, 0, p.z / textureUnit, p.y / textureUnit);
		});
		for (let i = 0; i < ARCH_SEGMENTS; i++) addFacingTriangle(mesh, centre, rim[i], rim[i + 1]);
	}
	return mesh;
}

/** The normal of triangle a-b-c as wound (counter-clockwise seen from the side it faces). */
function windingNormal(mesh: MeshData, a: number, b: number, c: number): [number, number, number] {
	const p = mesh.positions;
	const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
	const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
	return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
}

/** Does the winding agree with the normal stored at vertex `v`? */
function facesAlong(mesh: MeshData, normal: [number, number, number], v: number): boolean {
	const n = mesh.normals;
	return normal[0] * n[v * 3] + normal[1] * n[v * 3 + 1] + normal[2] * n[v * 3 + 2] >= 0;
}

/** Adds quad a-b-c-d wound to face the way its vertices' normals point. */
function addFacingQuad(mesh: MeshData, a: number, b: number, c: number, d: number): void {
	if (facesAlong(mesh, windingNormal(mesh, a, b, c), a)) addQuad(mesh, a, b, c, d);
	else addQuad(mesh, a, d, c, b);
}

function addFacingTriangle(mesh: MeshData, a: number, b: number, c: number): void {
	if (facesAlong(mesh, windingNormal(mesh, a, b, c), b)) mesh.indices.push(a, b, c);
	else mesh.indices.push(a, c, b);
}

/** Where the shelter doors are, for anything that needs to line up with them. */
export const SHELTER_DOOR = { x: SHELTER_DOOR_X, width: SHELTER.width - 2 * SHELTER.wall };
