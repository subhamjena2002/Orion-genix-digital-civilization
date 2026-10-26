import { AIRFIELD_BOUNDS } from "./Airfield";
import { HIGHWAYS, projectOnto } from "./Highways";
import { BASE_BOUNDS } from "./MilitaryBase";
import { LAND_Y, terrainHeightAt } from "./Mountains";
import { isOnLand } from "./StateOutline";
import { distanceFromRail } from "../rail/RailLine";
import { CITY_EXTENT_X, CITY_EXTENT_Z, ROAD_GEOMETRY } from "../roads/RoadNetwork";

/**
 * The residential estates round the city: the land between the grid and the coast that stood
 * empty. Each is a few curving streets off the ends of the city's roads, lined with houses on
 * generous lots — bungalows, mansions and modern villas with hedged gardens, driveways and pools.
 *
 * Laid out here as data (roads as smoothed centrelines, lots with a house type), and checked
 * against everything else on the ground: every lot is on land clear of the beach, flat (off the
 * hills), and clear of the highways, airfield, army base, railway, city blocks, every road and
 * every other lot. Lots that fail are simply not built, so the layout can't put a house in the sea.
 */

export type Point = readonly [number, number];
export type HouseType = "bungalow" | "mansion" | "villa";

export interface EstateRoad {
	id: string;
	estate: string;
	/** Centreline, smoothed, about every SAMPLE_SPACING metres. */
	points: readonly Point[];
	/** Each end: true where it meets another road (no pavement across it), false for a dead end (turning circle). */
	startJoins: boolean;
	endJoins: boolean;
}

export interface HouseLot {
	id: string;
	estate: string;
	type: HouseType;
	/** House centre and facing (degrees; the front faces the road, which is local +Z). */
	x: number;
	z: number;
	yaw: number;
	/** The house's own footprint, metres (width along the road, depth back from it). */
	width: number;
	depth: number;
	/** Whether there's room behind for a pool. */
	pool: boolean;
	seed: number;
}

export interface Estate {
	id: string;
	name: string;
	/** Which house types it's built of, in proportion. */
	types: readonly HouseType[];
	roads: readonly { id: string; control: readonly Point[]; startJoins: boolean; endJoins: boolean; sides?: "both" | "left" | "right" }[];
	/** Lot spacing along the street. */
	spacing: number;
}

export const ESTATE_ROAD_WIDTH = 8;
export const ESTATE_PAVEMENT = 1.8;
/** Road surface height: a hair under the city's asphalt, so where they meet the city's shows. */
export const ESTATE_ROAD_Y = ROAD_GEOMETRY.surfaceY + ROAD_GEOMETRY.thickness / 2 - 0.004;
export const TURNING_CIRCLE_RADIUS = 10;
const SAMPLE_SPACING = 4;

/** House sizes by type: width along the street, depth. */
export const HOUSE_SIZES: Readonly<Record<HouseType, readonly [number, number]>> = {
	bungalow: [17, 12],
	mansion: [26, 16],
	villa: [20, 14],
};
/** From the road's edge to the front of the house: pavement, hedge and front garden. */
const FRONT_SETBACK = 8;
/** Behind the house: the back garden, and the pool if it fits. */
const BACK_GARDEN = 13;

const ESTATES: readonly Estate[] = [
	{
		id: "coral-bay",
		name: "Coral Bay",
		types: ["villa", "mansion", "villa", "mansion", "bungalow"],
		spacing: 34,
		roads: [
			{ id: "coral-link", control: [[400, 0], [450, 0], [500, -6], [540, -30]], startJoins: true, endJoins: true },
			{ id: "coral-drive", control: [[548, -112], [552, -60], [540, -30], [532, 30], [548, 100], [560, 170], [550, 262]], startJoins: false, endJoins: false },
			{ id: "coral-cross", control: [[400, 160], [450, 162], [500, 168], [560, 170]], startJoins: true, endJoins: true },
		],
	},
	{
		id: "hillcrest",
		name: "Hillcrest",
		types: ["mansion", "villa", "bungalow", "mansion"],
		spacing: 32,
		roads: [
			{
				id: "hillcrest-drive",
				control: [[-560, -292], [-480, -286], [-400, -296], [-320, -290], [-240, -282], [-160, -290], [-80, -297], [0, -289], [80, -282], [160, -292], [210, -300]],
				startJoins: false,
				endJoins: false,
				sides: "right",
			},
			{ id: "hillcrest-west", control: [[-320, -240], [-320, -265], [-320, -290]], startJoins: true, endJoins: true },
			{ id: "hillcrest-mid", control: [[0, -240], [0, -265], [0, -289]], startJoins: true, endJoins: true },
			{ id: "hillcrest-east", control: [[160, -240], [160, -266], [160, -292]], startJoins: true, endJoins: true },
		],
	},
	{
		id: "westwood",
		name: "Westwood",
		types: ["bungalow", "villa", "bungalow", "mansion"],
		spacing: 30,
		roads: [
			{ id: "westwood-avenue", control: [[-480, -286], [-505, -330], [-560, -372], [-640, -400], [-700, -430]], startJoins: true, endJoins: false },
			{ id: "westwood-close", control: [[-560, -372], [-520, -410], [-450, -430], [-380, -420]], startJoins: true, endJoins: false },
		],
	},
	{
		id: "palm-heights",
		name: "Palm Heights",
		types: ["mansion", "mansion", "villa"],
		spacing: 36,
		roads: [
			{ id: "palm-heights-loop", control: [[240, -240], [240, -300], [255, -350], [290, -385], [335, -362], [365, -320], [385, -280], [400, -240]], startJoins: true, endJoins: true },
		],
	},
	{
		id: "sunset-park",
		name: "Sunset Park",
		types: ["bungalow", "bungalow", "villa", "bungalow"],
		spacing: 28,
		roads: [
			{ id: "sunset-loop", control: [[-240, 240], [-245, 295], [-230, 345], [-195, 385], [-150, 370], [-140, 320], [-160, 280], [-160, 240]], startJoins: true, endJoins: true },
		],
	},
	{
		id: "marina-heights",
		name: "Marina Heights",
		types: ["villa", "bungalow", "villa", "mansion"],
		spacing: 32,
		roads: [
			{ id: "marina-loop", control: [[320, 240], [322, 295], [350, 345], [410, 368], [460, 335], [445, 285], [400, 240]], startJoins: true, endJoins: true },
		],
	},
];

// ---- Curves ------------------------------------------------------------------------------------------

/** Catmull-Rom through the control points, resampled about every `spacing` metres. */
export function smoothPath(control: readonly Point[], spacing = SAMPLE_SPACING): Point[] {
	if (control.length < 2) return [...control];
	const dense: Point[] = [];
	for (let i = 0; i < control.length - 1; i++) {
		const p0 = control[Math.max(0, i - 1)];
		const p1 = control[i];
		const p2 = control[i + 1];
		const p3 = control[Math.min(control.length - 1, i + 2)];
		const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1));
		for (let s = 0; s < steps; s++) {
			const t = s / steps;
			const t2 = t * t;
			const t3 = t2 * t;
			const at = (k: 0 | 1) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
			dense.push([at(0), at(1)]);
		}
	}
	dense.push(control[control.length - 1]);
	// Even spacing along the curve.
	const out: Point[] = [dense[0]];
	let carried = 0;
	for (let i = 1; i < dense.length; i++) {
		const [ax, az] = dense[i - 1];
		const [bx, bz] = dense[i];
		let segment = Math.hypot(bx - ax, bz - az);
		let fromX = ax;
		let fromZ = az;
		while (carried + segment >= spacing) {
			const t = (spacing - carried) / segment;
			fromX += (bx - fromX) * t;
			fromZ += (bz - fromZ) * t;
			out.push([fromX, fromZ]);
			segment = Math.hypot(bx - fromX, bz - fromZ);
			carried = 0;
		}
		carried += segment;
	}
	const last = control[control.length - 1];
	if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > spacing * 0.3) out.push(last);
	else out[out.length - 1] = last;
	return out;
}

/** Distance from a point to a polyline. */
export function distanceToPath(points: readonly Point[], x: number, z: number): number {
	let best = Infinity;
	for (let i = 1; i < points.length; i++) {
		const [ax, az] = points[i - 1];
		const [bx, bz] = points[i];
		const dx = bx - ax;
		const dz = bz - az;
		const lengthSq = dx * dx + dz * dz;
		const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
		best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
	}
	return best;
}

/** Each path's bounding box, worked out once: [minX, minZ, maxX, maxZ]. */
const PATH_BOUNDS = new WeakMap<readonly Point[], readonly [number, number, number, number]>();

/**
 * Whether a point is closer than `distance` to a polyline — distanceToPath(...) < distance, but a
 * point outside the path's bounding box grown by `distance` is answered without walking it. The
 * house lots are laid out at load time with thousands of these checks against every estate road.
 */
export function withinPath(points: readonly Point[], x: number, z: number, distance: number): boolean {
	let bounds = PATH_BOUNDS.get(points);
	if (!bounds) {
		let minX = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxZ = -Infinity;
		for (const [px, pz] of points) {
			minX = Math.min(minX, px);
			minZ = Math.min(minZ, pz);
			maxX = Math.max(maxX, px);
			maxZ = Math.max(maxZ, pz);
		}
		bounds = [minX, minZ, maxX, maxZ];
		PATH_BOUNDS.set(points, bounds);
	}
	if (x < bounds[0] - distance || x > bounds[2] + distance || z < bounds[1] - distance || z > bounds[3] + distance) return false;
	return distanceToPath(points, x, z) < distance;
}

// ---- Layout ------------------------------------------------------------------------------------------

export const ESTATE_ROADS: readonly EstateRoad[] = ESTATES.flatMap((estate) => estate.roads.map((road): EstateRoad => ({
	id: road.id,
	estate: estate.id,
	points: smoothPath(road.control),
	startJoins: road.startJoins,
	endJoins: road.endJoins,
})));

/** For the GPS (see navigation/Navigation). */
export const ESTATE_ROAD_LINKS: readonly { id: string; points: readonly Point[] }[] = ESTATE_ROADS.map((road) => ({ id: road.id, points: road.points }));

/** Corners of a house's lot (house, front garden to the road edge, back garden), in world space. */
function lotCorners(lot: Pick<HouseLot, "x" | "z" | "yaw" | "width" | "depth">, margin = 0): Point[] {
	const yaw = (lot.yaw * Math.PI) / 180;
	const fx = Math.sin(yaw);
	const fz = Math.cos(yaw);
	const rx = Math.cos(yaw);
	const rz = -Math.sin(yaw);
	const half = lot.width / 2 + 4 + margin;
	const front = lot.depth / 2 + FRONT_SETBACK - 2 + margin;
	const back = lot.depth / 2 + BACK_GARDEN + margin;
	return [
		[lot.x + rx * half + fx * front, lot.z + rz * half + fz * front],
		[lot.x - rx * half + fx * front, lot.z - rz * half + fz * front],
		[lot.x - rx * half - fx * back, lot.z - rz * half - fz * back],
		[lot.x + rx * half - fx * back, lot.z + rz * half - fz * back],
	];
}

/** Points over a whole lot (front hedge to back hedge, side to side), about every 3 m. */
function lotGrid(lot: Pick<HouseLot, "x" | "z" | "yaw" | "width" | "depth">): Point[] {
	const yaw = (lot.yaw * Math.PI) / 180;
	const fx = Math.sin(yaw);
	const fz = Math.cos(yaw);
	const rx = Math.cos(yaw);
	const rz = -Math.sin(yaw);
	const half = lot.width / 2 + 4;
	const front = lot.depth / 2 + FRONT_SETBACK - 0.3;
	const back = lot.depth / 2 + BACK_GARDEN;
	const points: Point[] = [];
	const across = Math.ceil((half * 2) / 3);
	const along = Math.ceil((front + back) / 3);
	for (let i = 0; i <= across; i++) {
		for (let j = 0; j <= along; j++) {
			const a = -half + (i / across) * half * 2;
			const b = -back + (j / along) * (front + back);
			points.push([lot.x + rx * a + fx * b, lot.z + rz * a + fz * b]);
		}
	}
	return points;
}

/** Where a lot may not go. Each check samples the lot's corners, edges and centre. */
function lotIsClear(lot: HouseLot): boolean {
	const corners = lotCorners(lot);
	const samples: Point[] = [[lot.x, lot.z], ...corners];
	for (let i = 0; i < 4; i++) {
		const a = corners[i];
		const b = corners[(i + 1) % 4];
		samples.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
	}
	// The cheap box tests first: a lot fails on whichever check, so the order only changes the cost.
	for (const [x, z] of samples) {
		// Off the city blocks.
		if (Math.abs(x) < CITY_EXTENT_X + 12 && Math.abs(z) < CITY_EXTENT_Z + 12) return false;
		if (x > AIRFIELD_BOUNDS.minX - 20 && x < AIRFIELD_BOUNDS.maxX + 20 && z > AIRFIELD_BOUNDS.minZ - 20 && z < AIRFIELD_BOUNDS.maxZ + 20) return false;
		if (x > BASE_BOUNDS.minX - 20 && x < BASE_BOUNDS.maxX + 20 && z > BASE_BOUNDS.minZ - 20 && z < BASE_BOUNDS.maxZ + 20) return false;
	}
	for (const [x, z] of samples) {
		// Flat: off the hills.
		if (terrainHeightAt(x, z) > LAND_Y + 0.2) return false;
		// On land, with the beach and a strip of sea-front clear.
		for (const [dx, dz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) if (!isOnLand(x + dx, z + dz)) return false;
		if (distanceFromRail(x, z) < 20) return false;
		for (const highway of HIGHWAYS) {
			const hit = projectOnto(highway, x, z);
			if (!hit.beyondEnds && Math.abs(hit.lateral) < 30) return false;
		}
	}
	// Clear of every estate road, its own street included: the whole lot, sampled on a grid, stays
	// behind the pavement (the front hedge stands at the pavement's edge).
	const clearance = ESTATE_ROAD_WIDTH / 2 + ESTATE_PAVEMENT - 0.05;
	for (const [x, z] of lotGrid(lot)) {
		for (const road of ESTATE_ROADS) if (withinPath(road.points, x, z, clearance)) return false;
	}
	return true;
}

function overlaps(a: HouseLot, b: HouseLot): boolean {
	// Separating axes on the two lots' rectangles.
	const ca = lotCorners(a);
	const cb = lotCorners(b);
	for (const corners of [ca, cb]) {
		for (let i = 0; i < 2; i++) {
			const [ax, az] = corners[i];
			const [bx, bz] = corners[i + 1];
			const nx = -(bz - az);
			const nz = bx - ax;
			const span = (points: Point[]) => {
				let min = Infinity;
				let max = -Infinity;
				for (const [x, z] of points) {
					const d = x * nx + z * nz;
					min = Math.min(min, d);
					max = Math.max(max, d);
				}
				return [min, max];
			};
			const [aMin, aMax] = span(ca);
			const [bMin, bMax] = span(cb);
			if (aMax <= bMin || bMax <= aMin) return false;
		}
	}
	return true;
}

function hash(seed: number): number {
	let h = seed >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function layOutLots(): HouseLot[] {
	const lots: HouseLot[] = [];
	let counter = 0;
	for (const estate of ESTATES) {
		for (const definition of estate.roads) {
			const road = ESTATE_ROADS.find((candidate) => candidate.id === definition.id);
			if (!road) continue;
			const sides = definition.sides ?? "both";
			// Walk the street, a lot every `spacing` metres, both sides.
			let travelled = estate.spacing / 2;
			let along = 0;
			for (let i = 1; i < road.points.length; i++) {
				const [ax, az] = road.points[i - 1];
				const [bx, bz] = road.points[i];
				const segment = Math.hypot(bx - ax, bz - az);
				while (along + segment >= travelled) {
					const t = (travelled - along) / segment;
					const x = ax + (bx - ax) * t;
					const z = az + (bz - az) * t;
					const dx = (bx - ax) / segment;
					const dz = (bz - az) / segment;
					for (const side of [1, -1] as const) {
						if ((sides === "left" && side !== 1) || (sides === "right" && side !== -1)) continue;
						counter++;
						const r = hash(counter * 7919 + 17);
						const type = estate.types[Math.floor(r * estate.types.length)];
						const [width, depth] = HOUSE_SIZES[type];
						// Left of travel is (dz, -dx)... facing back towards the road.
						const nx = side * -dz;
						const nz = side * dx;
						const offset = ESTATE_ROAD_WIDTH / 2 + ESTATE_PAVEMENT + FRONT_SETBACK + depth / 2;
						const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
						const lot: HouseLot = {
							id: `${estate.id}-${counter}`,
							estate: estate.id,
							type,
							x: x + nx * offset,
							z: z + nz * offset,
							yaw,
							width,
							depth,
							pool: false,
							seed: Math.floor(hash(counter * 104729 + 3) * 1e9),
						};
						if (!lotIsClear(lot) || lots.some((other) => overlaps(lot, other))) continue;
						lot.pool = type !== "bungalow" || hash(counter * 31 + 5) < 0.4;
						lots.push(lot);
					}
					travelled += estate.spacing;
				}
				along += segment;
			}
		}
	}
	return lots;
}

export const HOUSE_LOTS: readonly HouseLot[] = layOutLots();

/** The lot the player's safehouse stands on (world/Safehouse): its own villa, not a generated house. */
export const SAFEHOUSE_LOT = "hillcrest-58";

export const ESTATE_NAMES: readonly { id: string; name: string; x: number; z: number }[] = ESTATES.map((estate) => {
	const lots = HOUSE_LOTS.filter((lot) => lot.estate === estate.id);
	const points = lots.length > 0 ? lots.map((lot): Point => [lot.x, lot.z]) : ESTATE_ROADS.filter((road) => road.estate === estate.id).flatMap((road) => road.points);
	const x = points.reduce((sum, point) => sum + point[0], 0) / Math.max(1, points.length);
	const z = points.reduce((sum, point) => sum + point[1], 0) / Math.max(1, points.length);
	return { id: estate.id, name: estate.name, x, z };
});

/** Where a lot's driveway meets the pavement (the middle of its frontage). */
export function drivewayMouth(lot: HouseLot): Point {
	const yaw = (lot.yaw * Math.PI) / 180;
	const reach = lot.depth / 2 + FRONT_SETBACK;
	return [lot.x + Math.sin(yaw) * reach, lot.z + Math.cos(yaw) * reach];
}

/** The lot's corners, for the map's garden outlines. */
export function lotOutline(lot: HouseLot): Point[] {
	return lotCorners(lot);
}

export interface EstateDressingItem {
	kind: "palm" | "lamp";
	x: number;
	/** Height of the ground it stands on. */
	y: number;
	z: number;
	yaw: number;
	variant: number;
}

/**
 * Palms and lamps along both kerbs of every estate street (clear of junctions and driveways), and
 * a couple of palms in each garden.
 */
export function estateDressing(spacing = 22): EstateDressingItem[] {
	const items: EstateDressingItem[] = [];
	const pavementY = ESTATE_ROAD_Y + 0.035;
	const ends: Point[] = ESTATE_ROADS.flatMap((road) => [road.points[0], road.points[road.points.length - 1]]);
	let count = 0;
	for (const road of ESTATE_ROADS) {
		let travelled = spacing / 2;
		let along = 0;
		for (let i = 1; i < road.points.length; i++) {
			const [ax, az] = road.points[i - 1];
			const [bx, bz] = road.points[i];
			const segment = Math.hypot(bx - ax, bz - az);
			while (along + segment >= travelled) {
				const t = (travelled - along) / segment;
				const x = ax + (bx - ax) * t;
				const z = az + (bz - az) * t;
				const dx = (bx - ax) / segment;
				const dz = (bz - az) / segment;
				for (const side of [1, -1]) {
					const offset = ESTATE_ROAD_WIDTH / 2 + 0.45;
					const px = x + side * -dz * offset;
					const pz = z + side * dx * offset;
					// Not at junctions or turning circles, nor on the city's roads.
					if (ends.some(([ex, ez]) => Math.hypot(px - ex, pz - ez) < 16)) continue;
					if (Math.abs(px) < CITY_EXTENT_X + 10 && Math.abs(pz) < CITY_EXTENT_Z + 10) continue;
					if (ESTATE_ROADS.some((other) => other !== road && withinPath(other.points, px, pz, ESTATE_ROAD_WIDTH / 2 + 2))) continue;
					// Nor across a driveway.
					if (HOUSE_LOTS.some((lot) => Math.hypot(px - drivewayMouth(lot)[0], pz - drivewayMouth(lot)[1]) < 6)) continue;
					count++;
					const lamp = count % 3 === 0;
					// A lamp's arm reaches over the road: back towards the centreline.
					const yaw = (Math.atan2(side * dz, side * -dx) * 180) / Math.PI;
					items.push({ kind: lamp ? "lamp" : "palm", x: px, y: pavementY, z: pz, yaw, variant: count % 4 });
				}
				travelled += spacing;
			}
			along += segment;
		}
	}
	// In the gardens: one by the front hedge on the side away from the drive, one out back.
	for (const lot of HOUSE_LOTS) {
		// The safehouse plants its own garden.
		if (lot.id === SAFEHOUSE_LOT) continue;
		const yaw = (lot.yaw * Math.PI) / 180;
		const fx = Math.sin(yaw);
		const fz = Math.cos(yaw);
		const rx = Math.cos(yaw);
		const rz = -Math.sin(yaw);
		const side = lot.seed % 2 === 0 ? 1 : -1;
		const spots: [number, number][] = [
			[side * (lot.width / 2 + 1.5), lot.depth / 2 + FRONT_SETBACK - 2.5],
			[-side * (lot.width / 2 + 1.5), -(lot.depth / 2 + BACK_GARDEN - 2.5)],
		];
		spots.forEach(([a, b], index) => {
			items.push({ kind: "palm", x: lot.x + rx * a + fx * b, y: LAND_Y + 0.03, z: lot.z + rz * a + fz * b, yaw: 0, variant: (lot.seed + index) % 4 });
		});
	}
	return items;
}
