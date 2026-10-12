import type { MeshData } from "../world/MeshData";
import { BAY_METRES, BAYS, FLOOR_METRES, FLOORS, GROUND_METRES, TRIM_TILE_METRES, type FacadeStyle, type GroundStyle } from "./FacadeTextures";

/**
 * A city building as geometry: storeys of facade on a ground floor, stepping back as it rises,
 * with the details that give a block its silhouette and shadows — a cornice and parapet, a
 * canopy over the shopfronts, an art-deco fin, plant on the roof.
 *
 * Built in the building's own space (base centred on the origin, its front facing +Z), as three
 * meshes by material: facade walls, ground floor, and trim — everything plain-plastered, metal or
 * roofed, coloured per vertex (the roof is dark plaster, like a concrete slab). Three draw calls a
 * building. Pure, so it's testable without a GPU.
 */

export type Rgb = readonly [number, number, number];

export interface Tier {
	/** Storeys of facade above the ground floor before this tier's top. */
	floors: number;
	/** How far this tier steps in from the one below, metres. */
	inset: number;
}

export interface BuildingSpec {
	width: number;
	depth: number;
	style: FacadeStyle;
	/** A distinct ground floor (shopfronts, loading bays), or facade all the way down. */
	ground: GroundStyle | null;
	/** Bottom to top; the first tier's inset is ignored. */
	tiers: readonly Tier[];
	tint: Rgb;
	trimTint: Rgb;
	accentTint: Rgb;
	cornice: boolean;
	/** A canopy along the top of the ground floor. */
	canopy: boolean;
	/** A tall art-deco fin up the middle of the front. */
	fin: boolean;
	/** A front door with a little canopy (for buildings without shopfronts). */
	door: boolean;
	/** Rooftop units on the top tier. */
	rooftop: number;
	/** Shifts which part of the facade tile shows, so neighbours don't match window for window. */
	bayOffset: number;
	floorOffset: number;
	seed: number;
}

export interface BuildingGeometry {
	wall: MeshData;
	ground: MeshData;
	trim: MeshData;
	/** Total height, roof included (not the parapet or rooftop plant). */
	height: number;
	/** The footprint of the bottom tier, for the collider. */
	width: number;
	depth: number;
}

const CORNICE_OUT = 0.32;
const CORNICE_HEIGHT = 0.55;
const PARAPET_HEIGHT = 0.9;
const PARAPET_THICKNESS = 0.28;
const CANOPY_OUT = 0.75;
const CANOPY_THICKNESS = 0.32;
const FIN_WIDTH = 0.9;
const FIN_DEPTH = 1.1;
const FIN_RISE = 4;

export function mesh(): MeshData {
	return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

function vertex(target: MeshData, x: number, y: number, z: number, n: Rgb, u: number, v: number, colour: Rgb): number {
	const index = target.positions.length / 3;
	target.positions.push(x, y, z);
	target.normals.push(n[0], n[1], n[2]);
	target.uvs.push(u, v);
	target.colors!.push(colour[0], colour[1], colour[2], 1);
	return index;
}

/** Quad from its bottom-left going round anticlockwise as seen from outside. */
export function quad(target: MeshData, corners: readonly (readonly [number, number, number])[], n: Rgb, uvs: readonly (readonly [number, number])[], colour: Rgb): void {
	const [a, b, c, d] = corners.map((p, i) => vertex(target, p[0], p[1], p[2], n, uvs[i][0], uvs[i][1], colour));
	target.indices.push(a, b, c, a, c, d);
}

interface Side {
	normal: Rgb;
	/** Bottom-left and bottom-right corners (x, z) seen from outside. */
	from: readonly [number, number];
	to: readonly [number, number];
}

/** The four sides of an axis-aligned footprint, each seen from outside, left to right. */
function sides(halfW: number, halfD: number): Side[] {
	return [
		{ normal: [0, 0, 1], from: [-halfW, halfD], to: [halfW, halfD] },
		{ normal: [1, 0, 0], from: [halfW, halfD], to: [halfW, -halfD] },
		{ normal: [0, 0, -1], from: [halfW, -halfD], to: [-halfW, -halfD] },
		{ normal: [-1, 0, 0], from: [-halfW, -halfD], to: [-halfW, halfD] },
	];
}

/**
 * One storey band of facade around a footprint, mapped so whole bays fit each side: the tile
 * stretches by at most half a bay rather than cutting a window at a corner.
 */
export function facadeBand(target: MeshData, halfW: number, halfD: number, y0: number, y1: number, vAt: (y: number) => number, uOffset: number, colour: Rgb): void {
	for (const side of sides(halfW, halfD)) {
		const length = Math.hypot(side.to[0] - side.from[0], side.to[1] - side.from[1]);
		const bays = Math.max(1, Math.round(length / BAY_METRES));
		const u0 = uOffset;
		const u1 = uOffset + bays / BAYS;
		quad(target, [
			[side.from[0], y0, side.from[1]],
			[side.to[0], y0, side.to[1]],
			[side.to[0], y1, side.to[1]],
			[side.from[0], y1, side.from[1]],
		], side.normal, [[u0, vAt(y0)], [u1, vAt(y0)], [u1, vAt(y1)], [u0, vAt(y1)]], colour);
	}
}

/**
 * A box with planar mapping on each face (`tile` metres per repeat), all six faces or just the
 * sides and top.
 */
export function box(target: MeshData, cx: number, y0: number, cz: number, w: number, h: number, d: number, colour: Rgb, tile: number, bottom = false): void {
	const x0 = cx - w / 2;
	const x1 = cx + w / 2;
	const z0 = cz - d / 2;
	const z1 = cz + d / 2;
	const y1 = y0 + h;
	const t = 1 / tile;
	for (const side of sides(w / 2, d / 2)) {
		const length = Math.hypot(side.to[0] - side.from[0], side.to[1] - side.from[1]);
		const fx = cx + side.from[0];
		const fz = cz + side.from[1];
		const tx = cx + side.to[0];
		const tz = cz + side.to[1];
		quad(target, [[fx, y0, fz], [tx, y0, tz], [tx, y1, tz], [fx, y1, fz]], side.normal, [[0, -y0 * t], [length * t, -y0 * t], [length * t, -y1 * t], [0, -y1 * t]], colour);
	}
	quad(target, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0 * t, z1 * t], [x1 * t, z1 * t], [x1 * t, z0 * t], [x0 * t, z0 * t]], colour);
	if (bottom) quad(target, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0 * t, z0 * t], [x1 * t, z0 * t], [x1 * t, z1 * t], [x0 * t, z1 * t]], colour);
}

/** A ring of four boxes hugging a footprint's edge (cornice, canopy, parapet). */
export function ring(target: MeshData, halfW: number, halfD: number, y0: number, height: number, outward: number, thickness: number, colour: Rgb): void {
	// Outer edge at half + outward, inner edge thickness further in.
	const outerW = halfW + outward;
	const outerD = halfD + outward;
	const mid = thickness / 2;
	box(target, 0, y0, outerD - mid, outerW * 2, height, thickness, colour, TRIM_TILE_METRES, true);
	box(target, 0, y0, -outerD + mid, outerW * 2, height, thickness, colour, TRIM_TILE_METRES, true);
	box(target, outerW - mid, y0, 0, thickness, height, outerD * 2 - thickness * 2, colour, TRIM_TILE_METRES, true);
	box(target, -outerW + mid, y0, 0, thickness, height, outerD * 2 - thickness * 2, colour, TRIM_TILE_METRES, true);
}

export function roofQuad(target: MeshData, halfW: number, halfD: number, y: number, colour: Rgb): void {
	const t = 1 / TRIM_TILE_METRES;
	quad(target, [[-halfW, y, halfD], [halfW, y, halfD], [halfW, y, -halfD], [-halfW, y, -halfD]], [0, 1, 0], [[-halfW * t, halfD * t], [halfW * t, halfD * t], [halfW * t, -halfD * t], [-halfW * t, -halfD * t]], colour);
}

export function shadeOf(colour: Rgb, factor: number): Rgb {
	return [colour[0] * factor, colour[1] * factor, colour[2] * factor];
}

/** Deterministic 0..1 from a seed and a slot. */
export function hash01(seed: number, slot: number): number {
	let h = (seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildCityBuilding(spec: BuildingSpec): BuildingGeometry {
	const wall = mesh();
	const ground = mesh();
	const trim = mesh();

	const groundTop = spec.ground ? GROUND_METRES : 0;
	// Facade storeys run up from the ground floor's top (or the pavement); the tile's rows count
	// down from the top of the texture, hence 1 - …
	const span = FLOOR_METRES * FLOORS;
	const vUpper = (y: number) => spec.floorOffset / FLOORS + 1 - (y - groundTop) / span;
	const uOffset = spec.bayOffset / BAYS;

	let halfW = spec.width / 2;
	let halfD = spec.depth / 2;
	let floorBase = 0;
	let top = groundTop;
	const roofGrey: Rgb = shadeOf([0.62, 0.6, 0.57], 0.85 + hash01(spec.seed, 99) * 0.25);

	if (spec.ground) {
		facadeBand(ground, halfW, halfD, 0, groundTop, (y) => 1 - y / GROUND_METRES, uOffset, [1, 1, 1]);
	}

	spec.tiers.forEach((tier, index) => {
		if (index > 0) {
			const inset = Math.min(tier.inset, halfW - 2, halfD - 2);
			if (inset > 0) {
				// The terrace left by stepping in, behind a low parapet.
				roofQuad(trim, halfW, halfD, top, roofGrey);
				ring(trim, halfW, halfD, top, PARAPET_HEIGHT * 0.8, 0, PARAPET_THICKNESS, spec.trimTint);
				halfW -= inset;
				halfD -= inset;
			}
		}
		const floors = Math.max(1, Math.round(tier.floors));
		const y0 = top;
		const y1 = groundTop + (floorBase + floors) * FLOOR_METRES;
		facadeBand(wall, halfW, halfD, y0, y1, vUpper, uOffset, spec.tint);
		floorBase += floors;
		top = y1;
		// A string course between tiers.
		if (index < spec.tiers.length - 1 && spec.cornice) ring(trim, halfW, halfD, top - 0.2, 0.4, 0.15, 0.4, spec.trimTint);
	});

	// The top: cornice, parapet, roof.
	roofQuad(trim, halfW, halfD, top, roofGrey);
	if (spec.cornice) ring(trim, halfW, halfD, top - 0.25, CORNICE_HEIGHT, CORNICE_OUT, CORNICE_OUT + PARAPET_THICKNESS, spec.trimTint);
	ring(trim, halfW, halfD, top, PARAPET_HEIGHT, spec.cornice ? 0.05 : 0, PARAPET_THICKNESS, spec.cornice ? spec.trimTint : shadeOf(spec.tint, 0.9));

	if (spec.canopy && spec.ground) {
		ring(trim, spec.width / 2, spec.depth / 2, groundTop - CANOPY_THICKNESS / 2, CANOPY_THICKNESS, CANOPY_OUT, CANOPY_OUT + 0.05, spec.trimTint);
	}

	const front = spec.depth / 2;
	if (spec.fin) {
		// Up the middle of the front, from the ground floor to above the roof.
		box(trim, 0, groundTop, front + FIN_DEPTH / 2 - 0.15, FIN_WIDTH, top + FIN_RISE - groundTop, FIN_DEPTH, spec.accentTint, TRIM_TILE_METRES);
		// Banding across the fin above the roof.
		for (let i = 0; i < 3; i++) {
			box(trim, 0, top + 0.6 + i * 1.1, front + FIN_DEPTH / 2 - 0.15, FIN_WIDTH + 0.3, 0.25, FIN_DEPTH + 0.3, spec.trimTint, TRIM_TILE_METRES, true);
		}
	}

	if (spec.door && !spec.ground) {
		const doorX = spec.fin ? 1.8 : 0;
		box(trim, doorX, 0, front + 0.04, 1.5, 2.5, 0.12, [0.32, 0.24, 0.18], TRIM_TILE_METRES);
		box(trim, doorX, 0, front + 0.1, 1.2, 2.25, 0.06, [0.18, 0.2, 0.21], TRIM_TILE_METRES);
		box(trim, doorX, 2.7, front + 0.55, 2.4, 0.18, 1.1, spec.trimTint, TRIM_TILE_METRES, true);
	}

	// Plant on the roof: a stair house and a few units, kept clear of the parapet.
	const roomW = halfW - PARAPET_THICKNESS - 0.8;
	const roomD = halfD - PARAPET_THICKNESS - 0.8;
	for (let i = 0; i < spec.rooftop && roomW > 1.5 && roomD > 1.5; i++) {
		const r = (slot: number) => hash01(spec.seed, i * 8 + slot);
		const stairs = i === 0;
		const w = stairs ? 3 : 1.2 + r(1) * 1.4;
		const d = stairs ? 3.4 : 1 + r(2) * 1.6;
		const h = stairs ? 2.7 : 0.8 + r(3) * 1;
		const x = (r(4) * 2 - 1) * Math.max(0, roomW - w / 2);
		const z = (r(5) * 2 - 1) * Math.max(0, roomD - d / 2);
		const grey = 0.55 + r(6) * 0.3;
		box(trim, x, top, z, w, h, d, stairs ? shadeOf(spec.trimTint, 0.85) : [grey, grey, grey * 1.02], TRIM_TILE_METRES);
	}

	return { wall, ground, trim, height: top, width: spec.width, depth: spec.depth };
}
