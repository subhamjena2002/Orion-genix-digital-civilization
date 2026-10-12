import type { MeshData } from "../world/MeshData";
import { box, hash01, mesh, quad, ring, type Rgb } from "./CityBuildingMesh";
import { BAY_METRES, BAYS, FLOOR_METRES, FLOORS, TRIM_TILE_METRES, type FacadeStyle } from "./FacadeTextures";

/**
 * Houses for the estates (see world/Estates): a single-storey bungalow under a tiled hip roof, a
 * two-storey mansion with a columned portico and wings, and a modern villa of stacked white boxes
 * and glass. Each comes with its garden — lawn, hedges, a driveway and path, and a pool out back.
 *
 * Built in the house's own space (centred on the origin at ground level, front facing +Z) as one
 * mesh per material: facade walls (by facade style), trim (plaster, stone, hedges, paving — all
 * vertex coloured), roof tiles and pool water. Pure, so it's testable without a GPU.
 */

export type HouseType = "bungalow" | "mansion" | "villa";

export interface HouseSpec {
	type: HouseType;
	/** Footprint of the house itself, metres. */
	width: number;
	depth: number;
	pool: boolean;
	seed: number;
	/** The garden: how far it runs in front of the house (to the pavement) and behind it. */
	frontGarden: number;
	backGarden: number;
}

export interface HouseGeometry {
	walls: Partial<Record<FacadeStyle, MeshData>>;
	trim: MeshData;
	tiles: MeshData;
	water: MeshData;
	/** The house's solid block, for the collider: centre and size, local. */
	solid: { x: number; z: number; width: number; depth: number; height: number };
}

const HOUSE_PASTELS: readonly Rgb[] = [
	[0.96, 0.92, 0.84], [0.97, 0.84, 0.78], [0.98, 0.88, 0.74], [0.84, 0.92, 0.86], [0.85, 0.9, 0.96],
	[0.97, 0.93, 0.72], [0.98, 0.97, 0.94], [0.93, 0.87, 0.8],
];
const WHITE: Rgb = [0.98, 0.97, 0.95];
const STONE: Rgb = [0.82, 0.77, 0.68];
const HEDGE: Rgb = [0.2, 0.36, 0.17];
const LAWN: Rgb = [0.42, 0.62, 0.3];
const PAVING: Rgb = [0.78, 0.76, 0.72];
const DECK: Rgb = [0.92, 0.87, 0.76];
const DOOR: Rgb = [0.36, 0.24, 0.16];
const GARAGE: Rgb = [0.88, 0.88, 0.86];
const WOOD: Rgb = [0.55, 0.38, 0.24];
const GROUND_LIFT = 0.03;

type Vec = readonly [number, number, number];

function sub(a: Vec, b: Vec): Vec {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalOf(a: Vec, b: Vec, c: Vec): Rgb {
	const u = sub(b, a);
	const v = sub(c, a);
	const n: Vec = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
	const length = Math.hypot(n[0], n[1], n[2]) || 1;
	return [n[0] / length, n[1] / length, n[2] / length];
}

/** A triangle, anticlockwise seen from outside. */
function tri(target: MeshData, a: Vec, b: Vec, c: Vec, uvs: readonly (readonly [number, number])[], colour: Rgb): void {
	const n = normalOf(a, b, c);
	const base = target.positions.length / 3;
	[a, b, c].forEach((p, i) => {
		target.positions.push(p[0], p[1], p[2]);
		target.normals.push(n[0], n[1], n[2]);
		target.uvs.push(uvs[i][0], uvs[i][1]);
		target.colors!.push(colour[0], colour[1], colour[2], 1);
	});
	target.indices.push(base, base + 1, base + 2);
}

/** A planar quad with its normal worked out from its corners. */
function face(target: MeshData, corners: readonly Vec[], uvs: readonly (readonly [number, number])[], colour: Rgb): void {
	quad(target, corners, normalOf(corners[0], corners[1], corners[2]), uvs, colour);
}

/** Walls round a box footprint centred at (cx, cz), whole bays per side, storeys from `y0`. */
function walls(target: MeshData, cx: number, cz: number, width: number, depth: number, y0: number, y1: number, floorOffset: number, bayOffset: number, colour: Rgb): void {
	const halfW = width / 2;
	const halfD = depth / 2;
	const span = FLOOR_METRES * FLOORS;
	const v = (y: number) => floorOffset / FLOORS + 1 - (y - y0) / span;
	const sides: { n: Rgb; from: [number, number]; to: [number, number] }[] = [
		{ n: [0, 0, 1], from: [-halfW, halfD], to: [halfW, halfD] },
		{ n: [1, 0, 0], from: [halfW, halfD], to: [halfW, -halfD] },
		{ n: [0, 0, -1], from: [halfW, -halfD], to: [-halfW, -halfD] },
		{ n: [-1, 0, 0], from: [-halfW, -halfD], to: [-halfW, halfD] },
	];
	for (const side of sides) {
		const length = Math.hypot(side.to[0] - side.from[0], side.to[1] - side.from[1]);
		const bays = Math.max(1, Math.round(length / BAY_METRES));
		const u0 = bayOffset / BAYS;
		const u1 = u0 + bays / BAYS;
		quad(target, [
			[cx + side.from[0], y0, cz + side.from[1]],
			[cx + side.to[0], y0, cz + side.to[1]],
			[cx + side.to[0], y1, cz + side.to[1]],
			[cx + side.from[0], y1, cz + side.from[1]],
		], side.n, [[u0, v(y0)], [u1, v(y0)], [u1, v(y1)], [u0, v(y1)]], colour);
	}
}

/**
 * A hip roof over a box (eaves overhanging by `overhang`), its ridge along the longer side, with
 * a soffit underneath so the eaves aren't see-through from below. Tiles map a metre to a repeat.
 */
function hipRoof(tiles: MeshData, trim: MeshData, cx: number, cz: number, width: number, depth: number, y0: number, rise: number, overhang: number, colour: Rgb): void {
	const W = width + overhang * 2;
	const D = depth + overhang * 2;
	const alongX = W >= D;
	// Canonical: ridge along local a-axis (length L), across b-axis (B).
	const L = alongX ? W : D;
	const B = alongX ? D : W;
	const ridge = (L - B) / 2;
	const top = y0 + rise;
	const to = (a: number, b: number, y: number): Vec => (alongX ? [cx + a, y, cz + b] : [cx + b, y, cz - a]);
	const slope = Math.hypot(B / 2, rise);
	const t = 1 / 2;
	// The two long slopes.
	face(tiles, [to(-L / 2, B / 2, y0), to(L / 2, B / 2, y0), to(ridge, 0, top), to(-ridge, 0, top)], [[-L / 2 * t, 0], [L / 2 * t, 0], [ridge * t, slope * t], [-ridge * t, slope * t]], colour);
	face(tiles, [to(L / 2, -B / 2, y0), to(-L / 2, -B / 2, y0), to(-ridge, 0, top), to(ridge, 0, top)], [[L / 2 * t, 0], [-L / 2 * t, 0], [-ridge * t, slope * t], [ridge * t, slope * t]], colour);
	// The hipped ends.
	const endSlope = Math.hypot(L / 2 - ridge, rise);
	tri(tiles, to(L / 2, B / 2, y0), to(L / 2, -B / 2, y0), to(ridge, 0, top), [[B / 2 * t, 0], [-B / 2 * t, 0], [0, endSlope * t]], colour);
	tri(tiles, to(-L / 2, -B / 2, y0), to(-L / 2, B / 2, y0), to(-ridge, 0, top), [[B / 2 * t, 0], [-B / 2 * t, 0], [0, endSlope * t]], colour);
	// Soffit, facing down.
	const s = 1 / TRIM_TILE_METRES;
	face(trim, [[cx - W / 2, y0, cz - D / 2], [cx + W / 2, y0, cz - D / 2], [cx + W / 2, y0, cz + D / 2], [cx - W / 2, y0, cz + D / 2]], [[0, 0], [W * s, 0], [W * s, D * s], [0, D * s]], WHITE);
	// A fascia board round the eaves.
	ring(trim, W / 2 - 0.0, D / 2, y0 - 0.22, 0.24, 0.02, 0.12, WHITE);
}

/** A column: plinth, shaft and capital. */
function column(trim: MeshData, x: number, z: number, height: number, size: number, colour: Rgb): void {
	box(trim, x, 0, z, size * 1.5, 0.3, size * 1.5, colour, TRIM_TILE_METRES);
	box(trim, x, 0.3, z, size, height - 0.6, size, colour, TRIM_TILE_METRES);
	box(trim, x, height - 0.3, z, size * 1.5, 0.3, size * 1.5, colour, TRIM_TILE_METRES);
}

/** A pediment: a triangular gable facing +Z over (cx, z0..z1), its slopes in trim. */
function pediment(trim: MeshData, cx: number, z0: number, z1: number, width: number, y0: number, rise: number, colour: Rgb): void {
	const h = width / 2;
	const s = 1 / TRIM_TILE_METRES;
	tri(trim, [cx - h, y0, z1], [cx + h, y0, z1], [cx, y0 + rise, z1], [[0, 0], [width * s, 0], [h * s, rise * s]], colour);
	face(trim, [[cx + h, y0, z1], [cx + h, y0, z0], [cx, y0 + rise, z0], [cx, y0 + rise, z1]], [[0, 0], [(z1 - z0) * s, 0], [(z1 - z0) * s, h * s], [0, h * s]], colour);
	face(trim, [[cx - h, y0, z0], [cx - h, y0, z1], [cx, y0 + rise, z1], [cx, y0 + rise, z0]], [[0, 0], [(z1 - z0) * s, 0], [(z1 - z0) * s, h * s], [0, h * s]], colour);
}

/** A flat piece of ground (lawn, paving), just proud of the terrain. */
function patch(trim: MeshData, x0: number, z0: number, x1: number, z1: number, y: number, colour: Rgb): void {
	const s = 1 / TRIM_TILE_METRES;
	face(trim, [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [[x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s]], colour);
}

/**
 * A pool on a low stone deck: the ground plane is the terrain itself, so a basin dug below it
 * would be hidden under the grass. The deck's inner faces are the basin's walls; the water sits a
 * hand's width under the lip.
 */
function pool(trim: MeshData, water: MeshData, cx: number, cz: number, width: number, depth: number): void {
	const deck = 1.3;
	const h = 0.38;
	box(trim, cx, 0, cz + depth / 2 + deck / 2, width + deck * 2, h, deck, DECK, TRIM_TILE_METRES);
	box(trim, cx, 0, cz - depth / 2 - deck / 2, width + deck * 2, h, deck, DECK, TRIM_TILE_METRES);
	box(trim, cx - width / 2 - deck / 2, 0, cz, deck, h, depth, DECK, TRIM_TILE_METRES);
	box(trim, cx + width / 2 + deck / 2, 0, cz, deck, h, depth, DECK, TRIM_TILE_METRES);
	const waterY = h - 0.12;
	face(water, [[cx - width / 2, waterY, cz + depth / 2], [cx + width / 2, waterY, cz + depth / 2], [cx + width / 2, waterY, cz - depth / 2], [cx - width / 2, waterY, cz - depth / 2]], [[0, 0], [width, 0], [width, depth], [0, depth]], [1, 1, 1]);
}

/** A clipped hedge between two points along X or Z. */
function hedge(trim: MeshData, x0: number, z0: number, x1: number, z1: number, height: number): void {
	const cx = (x0 + x1) / 2;
	const cz = (z0 + z1) / 2;
	const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
	const length = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
	if (length < 0.5) return;
	box(trim, cx, 0, cz, alongX ? length : 0.9, height, alongX ? 0.9 : length, HEDGE, TRIM_TILE_METRES);
}

export function buildHouse(spec: HouseSpec): HouseGeometry {
	const wallsByStyle: Partial<Record<FacadeStyle, MeshData>> = {};
	const wallMesh = (style: FacadeStyle) => (wallsByStyle[style] ??= mesh());
	const trim = mesh();
	const tiles = mesh();
	const water = mesh();
	const r = (slot: number) => hash01(spec.seed, slot);
	const tint = spec.type === "mansion" ? (r(1) < 0.5 ? WHITE : HOUSE_PASTELS[Math.floor(r(2) * HOUSE_PASTELS.length)]) : HOUSE_PASTELS[Math.floor(r(2) * HOUSE_PASTELS.length)];
	const roofTint: Rgb = r(3) < 0.75 ? [1, 1, 1] : [0.62, 0.6, 0.62];
	const bay = Math.floor(r(4) * 4);
	const floorRow = Math.floor(r(5) * 4);
	const halfW = spec.width / 2;
	const halfD = spec.depth / 2;
	let solid = { x: 0, z: 0, width: spec.width, depth: spec.depth, height: 3.2 };
	// Where the drive runs to: the garage side.
	const driveSide = r(6) < 0.5 ? 1 : -1;

	if (spec.type === "bungalow") {
		const bodyW = spec.width - 5;
		const bodyX = -driveSide * 2.5;
		const h = FLOOR_METRES;
		walls(wallMesh(r(7) < 0.5 ? "deco" : "apartment"), bodyX, 0, bodyW, spec.depth, 0, h, floorRow, bay, tint);
		hipRoof(tiles, trim, bodyX, 0, bodyW, spec.depth, h, 2.4, 0.7, roofTint);
		// Garage beside it, with a flat roof and a white door.
		const garageX = driveSide * (spec.width / 2 - 2.5);
		box(trim, garageX, 0, -0.5, 5, 3, spec.depth - 3, tint, TRIM_TILE_METRES);
		box(trim, garageX, 3, -0.5, 5.4, 0.3, spec.depth - 2.6, WHITE, TRIM_TILE_METRES);
		box(trim, garageX, 0.05, (spec.depth - 3) / 2 - 0.5 + 0.03, 3.6, 2.4, 0.08, GARAGE, TRIM_TILE_METRES);
		// Porch: slab, two posts and a little flat roof over the door.
		box(trim, bodyX, 0, halfD + 1.2, 4.4, 0.25, 2.4, STONE, TRIM_TILE_METRES, true);
		for (const side of [-1, 1]) column(trim, bodyX + side * 1.9, halfD + 2.1, 2.9, 0.22, WHITE);
		box(trim, bodyX, 2.9, halfD + 1.25, 4.8, 0.22, 2.7, WHITE, TRIM_TILE_METRES, true);
		box(trim, bodyX, 0.25, halfD + 0.04, 1.2, 2.25, 0.1, DOOR, TRIM_TILE_METRES);
		solid = { x: 0, z: 0, width: spec.width, depth: spec.depth, height: h };
	} else if (spec.type === "mansion") {
		const mainW = spec.width - 8;
		const h = FLOOR_METRES * 2;
		const style: FacadeStyle = "deco";
		walls(wallMesh(style), 0, 0, mainW, spec.depth, 0, h, floorRow, bay, tint);
		ring(trim, mainW / 2, halfD, h - 0.35, 0.45, 0.3, 0.6, WHITE);
		hipRoof(tiles, trim, 0, 0, mainW, spec.depth, h + 0.1, 3.2, 0.5, roofTint);
		// Wings either side: one storey, flat roofs behind a balustrade.
		for (const side of [-1, 1]) {
			const wx = side * (mainW / 2 + 2);
			walls(wallMesh(style), wx, -1, 4, spec.depth - 3, 0, FLOOR_METRES, floorRow, bay + 1, tint);
			box(trim, wx, FLOOR_METRES, -1, 4.4, 0.25, spec.depth - 2.6, WHITE, TRIM_TILE_METRES, true);
			ring(trim, 2.2, (spec.depth - 2.6) / 2, FLOOR_METRES + 0.25, 0.8, 0, 0.18, WHITE);
		}
		// The portico: four columns, an entablature and a pediment, up the front steps.
		const porticoW = 8;
		const porticoD = 3.4;
		box(trim, 0, 0, halfD + porticoD / 2, porticoW + 2, 0.25, porticoD + 1.6, STONE, TRIM_TILE_METRES, true);
		box(trim, 0, 0, halfD + porticoD + 1, porticoW, 0.12, 1.2, STONE, TRIM_TILE_METRES, true);
		for (let i = 0; i < 4; i++) column(trim, -porticoW / 2 + 0.5 + i * ((porticoW - 1) / 3), halfD + porticoD - 0.4, h - 0.2, 0.5, WHITE);
		box(trim, 0, h - 0.2, halfD + porticoD / 2, porticoW + 0.4, 0.6, porticoD + 0.2, WHITE, TRIM_TILE_METRES, true);
		pediment(trim, 0, halfD, halfD + porticoD + 0.1, porticoW + 0.4, h + 0.4, 1.8, WHITE);
		box(trim, 0, 0.25, halfD + 0.04, 2, 2.9, 0.12, DOOR, TRIM_TILE_METRES);
		solid = { x: 0, z: 0, width: spec.width, depth: spec.depth, height: h };
	} else {
		// Modern villa: a glass ground floor, a white upper box cantilevered over it.
		const lowerW = spec.width - 2;
		const lowerD = spec.depth - 2;
		const h1 = FLOOR_METRES;
		walls(wallMesh("glass"), 0, 0, lowerW, lowerD, 0, h1, floorRow, bay, [1, 1, 1]);
		box(trim, 0, h1, 0, lowerW + 0.6, 0.35, lowerD + 0.6, WHITE, TRIM_TILE_METRES, true);
		const upperX = driveSide * -2;
		const upperW = lowerW * 0.72;
		const upperD = lowerD + 1;
		walls(wallMesh("office"), upperX, -0.5, upperW, upperD, h1 + 0.35, h1 + 0.35 + FLOOR_METRES, floorRow, bay, WHITE);
		box(trim, upperX, h1 + 0.35 + FLOOR_METRES, -0.5, upperW + 0.5, 0.3, upperD + 0.5, WHITE, TRIM_TILE_METRES, true);
		// A wall of timber cladding at one end, and a glass balustrade round the roof terrace.
		box(trim, -upperX * 1.6, 0, 0, 0.4, h1 + 0.6, lowerD + 0.4, WOOD, TRIM_TILE_METRES);
		ring(trim, (lowerW + 0.6) / 2, (lowerD + 0.6) / 2, h1 + 0.35, 0.9, 0, 0.08, [0.75, 0.86, 0.88]);
		// Carport on slim posts.
		const carX = driveSide * (lowerW / 2 + 2.6);
		box(trim, carX, 2.7, 1, 5.4, 0.2, 6, WHITE, TRIM_TILE_METRES, true);
		for (const dz of [-1.8, 3.6]) for (const dx of [-2.4, 2.4]) box(trim, carX + dx, 0, 1 + dz * 0.75, 0.15, 2.7, 0.15, [0.3, 0.3, 0.3], TRIM_TILE_METRES);
		box(trim, 0, 0.05, lowerD / 2 + 0.03, 1.6, 2.6, 0.08, [0.2, 0.2, 0.22], TRIM_TILE_METRES);
		solid = { x: 0, z: 0, width: lowerW, depth: lowerD, height: h1 * 2 };
	}

	// The garden: lawn to the hedges, a drive to the garage side, a path to the door.
	const lotHalf = halfW + 4;
	const front = halfD + spec.frontGarden;
	const back = -(halfD + spec.backGarden);
	patch(trim, -lotHalf, back, lotHalf, front, GROUND_LIFT, LAWN);
	const driveX = driveSide * (halfW - 2.5);
	patch(trim, driveX - 2.2, halfD, driveX + 2.2, front, GROUND_LIFT + 0.01, PAVING);
	if (spec.type !== "bungalow" || Math.abs(driveX) > 3) patch(trim, -0.8, halfD, 0.8, front, GROUND_LIFT + 0.01, PAVING);
	const hedgeHeight = spec.type === "mansion" ? 1.6 : 1.1;
	const gate = [driveX - 2.4, driveX + 2.4] as const;
	const path = [-1, 1] as const;
	// Front hedge, broken for the drive and the path.
	const breaks = [gate, path].sort((a, b) => a[0] - b[0]);
	let x = -lotHalf;
	for (const [from, to] of breaks) {
		if (from > x) hedge(trim, x, front - 0.5, from, front - 0.5, hedgeHeight);
		x = Math.max(x, to);
	}
	if (x < lotHalf) hedge(trim, x, front - 0.5, lotHalf, front - 0.5, hedgeHeight);
	for (const side of [-1, 1]) hedge(trim, side * (lotHalf - 0.5), back, side * (lotHalf - 0.5), front - 1, hedgeHeight);
	hedge(trim, -lotHalf, back + 0.5, lotHalf, back + 0.5, hedgeHeight);

	if (spec.pool) {
		const poolW = spec.type === "bungalow" ? 7 : spec.type === "villa" ? 10 : 11;
		const poolD = spec.type === "bungalow" ? 3.6 : 4.4;
		pool(trim, water, (r(8) - 0.5) * Math.max(0, spec.width - poolW - 4), -(halfD + 1.8 + 1.3 + poolD / 2), poolW, poolD);
	}

	// Never the same twice: a touch of variation in the plaster per house.
	const wobble = 0.96 + r(9) * 0.06;
	for (const style of Object.keys(wallsByStyle) as FacadeStyle[]) {
		const colours = wallsByStyle[style]!.colors!;
		for (let i = 0; i < colours.length; i += 4) {
			colours[i] *= wobble;
			colours[i + 1] *= wobble;
		}
	}
	return { walls: wallsByStyle, trim, tiles, water, solid };
}
