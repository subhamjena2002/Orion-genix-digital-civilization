import { railBlocks } from "../rail/RailLine";
import { CITY_EXTENT_X, CITY_EXTENT_Z, PAVEMENT_TOP_Y, ROAD_GEOMETRY, ROAD_GRID, roadWidthAt } from "../roads/RoadNetwork";
import type { MeshData } from "./MeshData";

/**
 * What lines the city's pavements: palm trees, and street lights reaching out over the road.
 *
 * Geometry is built once per kind in its own space, then copied into one mesh per material per
 * chunk of the city — hundreds of trees and lamps for a few draw calls, and a chunk out of view
 * isn't drawn at all. Pure, so it's testable without a GPU.
 */

export type DressingKind = "palm" | "lamp";

export interface DressingItem {
	kind: DressingKind;
	x: number;
	y: number;
	z: number;
	/** Degrees; for a lamp, the way its arm reaches (towards the road). */
	yaw: number;
	/** Picks the palm's shape. */
	variant: number;
}

/** Spacing along the kerb, metres. */
const SPACING = 18;
/** In from the kerb edge, metres: clear of the road, and of people walking down the middle. */
const KERB_INSET = 0.45;
/** Kept clear of junctions (signals, crossings, turning traffic), past the pavement corner. */
const JUNCTION_CLEARANCE = 5;
/** Every third post along a pavement is a street light; the rest are palms. */
const LAMP_EVERY = 3;

export const CHUNK_SIZE = 160;

function nearJunction(along: number, lines: readonly number[]): boolean {
	return lines.some((line) => Math.abs(along - line) < roadWidthAt(line) / 2 + ROAD_GEOMETRY.pavementWidth + JUNCTION_CLEARANCE);
}

/** Every palm and lamp in the city, along both kerbs of every road. */
export function streetDressing(spacing = SPACING): DressingItem[] {
	const items: DressingItem[] = [];
	let count = 0;
	const place = (x: number, z: number, yaw: number) => {
		if (railBlocks(x, z, 1, 1)) return;
		const kind: DressingKind = count % LAMP_EVERY === LAMP_EVERY - 1 ? "lamp" : "palm";
		items.push({ kind, x, y: PAVEMENT_TOP_Y, z, yaw, variant: (count * 7 + Math.floor(Math.abs(x * 3 + z))) % 4 });
		count++;
	};
	for (const x of ROAD_GRID.xs) {
		const offset = roadWidthAt(x) / 2 + KERB_INSET;
		for (let z = -CITY_EXTENT_Z + spacing / 2; z <= CITY_EXTENT_Z; z += spacing) {
			if (nearJunction(z, ROAD_GRID.zs)) continue;
			// The arm reaches across the road: from the east kerb it points west (yaw -90).
			place(x + offset, z, -90);
			place(x - offset, z, 90);
		}
	}
	for (const z of ROAD_GRID.zs) {
		const offset = roadWidthAt(z) / 2 + KERB_INSET;
		for (let x = -CITY_EXTENT_X + spacing / 2; x <= CITY_EXTENT_X; x += spacing) {
			if (nearJunction(x, ROAD_GRID.xs)) continue;
			place(x, z + offset, 180);
			place(x, z - offset, 0);
		}
	}
	return items;
}

export function chunkKey(x: number, z: number): string {
	return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}

// ---- Geometry ----------------------------------------------------------------------------------

type Vec = [number, number, number];

function mesh(): MeshData {
	return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

function push(target: MeshData, p: Vec, n: Vec, u: number, v: number, c: Vec): number {
	const index = target.positions.length / 3;
	target.positions.push(p[0], p[1], p[2]);
	target.normals.push(n[0], n[1], n[2]);
	target.uvs.push(u, v);
	target.colors!.push(c[0], c[1], c[2], 1);
	return index;
}

function normalize(v: Vec): Vec {
	const length = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec, b: Vec): Vec {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * A tube along a centreline (rings of `sides` vertices), uv round and along (`vPerMetre`).
 * Triangles wound outward.
 */
function tube(target: MeshData, centre: (t: number) => Vec, radius: (t: number) => number, rings: number, sides: number, vPerMetre: number, colour: (t: number) => Vec): void {
	const base = target.positions.length / 3;
	let travelled = 0;
	let last = centre(0);
	for (let ring = 0; ring <= rings; ring++) {
		const t = ring / rings;
		const c = centre(t);
		travelled += Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]);
		last = c;
		const ahead = centre(Math.min(1, t + 0.01));
		const behind = centre(Math.max(0, t - 0.01));
		const axis = normalize([ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]]);
		// A frame round the axis: side is horizontal, the other completes it.
		const side = normalize(Math.abs(axis[1]) > 0.99 ? [1, 0, 0] : cross(axis, [0, 1, 0]));
		const other = cross(side, axis);
		const r = radius(t);
		for (let i = 0; i <= sides; i++) {
			const angle = (i / sides) * Math.PI * 2;
			const n: Vec = [
				side[0] * Math.cos(angle) + other[0] * Math.sin(angle),
				side[1] * Math.cos(angle) + other[1] * Math.sin(angle),
				side[2] * Math.cos(angle) + other[2] * Math.sin(angle),
			];
			push(target, [c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r], n, i / sides * 2, travelled * vPerMetre, colour(t));
		}
	}
	const stride = sides + 1;
	for (let ring = 0; ring < rings; ring++) {
		for (let i = 0; i < sides; i++) {
			const a = base + ring * stride + i;
			const b = a + 1;
			const c = a + stride + 1;
			const d = a + stride;
			// Round from side towards other is anticlockwise seen from outside when going up the axis.
			target.indices.push(a, c, b, a, d, c);
		}
	}
}

/** An axis-aligned box (all faces), vertex coloured; uvs unused. */
function box(target: MeshData, centre: Vec, size: Vec, colour: Vec): void {
	const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
	const faces: [Vec, Vec, Vec][] = [
		[[1, 0, 0], [0, 0, -1], [0, 1, 0]],
		[[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
		[[0, 1, 0], [1, 0, 0], [0, 0, -1]],
		[[0, -1, 0], [1, 0, 0], [0, 0, 1]],
		[[0, 0, 1], [1, 0, 0], [0, 1, 0]],
		[[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
	];
	for (const [n, u, v] of faces) {
		const base = target.positions.length / 3;
		for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			push(target, [
				centre[0] + (n[0] + u[0] * su + v[0] * sv) * hx,
				centre[1] + (n[1] + u[1] * su + v[1] * sv) * hy,
				centre[2] + (n[2] + u[2] * su + v[2] * sv) * hz,
			], n, (su + 1) / 2, (sv + 1) / 2, colour);
		}
		target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
}

export interface PalmGeometry {
	trunk: MeshData;
	fronds: MeshData;
}

/** Shape per variant: height, lean, crown size. */
const PALMS = [
	{ height: 8.5, lean: 0.9, fronds: 11, length: 3.8 },
	{ height: 10.5, lean: 1.6, fronds: 12, length: 4.1 },
	{ height: 7, lean: 0.5, fronds: 10, length: 3.4 },
	{ height: 9.5, lean: 2.2, fronds: 12, length: 3.9 },
] as const;

/**
 * A palm: a ringed trunk curving up from a flared foot, a crown of arching fronds and a couple of
 * dead ones hanging below. Fronds are a strip each, folded along the rib, for a cut-out leaf
 * texture whose u runs across and v from the crown to the tip.
 */
export function palmGeometry(variant: number): PalmGeometry {
	const shape = PALMS[((variant % PALMS.length) + PALMS.length) % PALMS.length];
	const trunk = mesh();
	const fronds = mesh();
	const centre = (t: number): Vec => [shape.lean * t * t, shape.height * t, 0];
	tube(trunk, centre, (t) => 0.2 * (1 - 0.3 * t) + 0.16 * Math.max(0, 1 - t * 14), 12, 7, 0.8, (t) => {
		const g = 0.78 + 0.18 * t;
		return [g, g * 0.97, g * 0.92];
	});
	const top = centre(1);
	// A knob where the fronds spring from.
	tube(trunk, (t): Vec => [top[0], top[1] - 0.25 + t * 0.6, top[2]], (t) => 0.26 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 0.02, 3, 7, 2, () => [0.62, 0.66, 0.42]);

	const addFrond = (azimuth: number, rise: number, droop: number, length: number, width: number, colour: Vec) => {
		const segments = 6;
		const dirX = Math.cos(azimuth);
		const dirZ = Math.sin(azimuth);
		const side: Vec = [-dirZ, 0, dirX];
		let p: Vec = [top[0], top[1] + 0.2, top[2]];
		const rows: { left: Vec; mid: Vec; right: Vec; v: number }[] = [];
		for (let s = 0; s <= segments; s++) {
			const t = s / segments;
			const pitch = rise - droop * t * t;
			const w = width * Math.pow(Math.sin(Math.PI * Math.min(0.98, t * 0.92 + 0.08)), 0.7);
			// Folded along the rib: the leaflets lift a little either side.
			const lift = w * 0.22;
			rows.push({
				left: [p[0] + side[0] * w, p[1] + lift, p[2] + side[2] * w],
				mid: [p[0], p[1], p[2]],
				right: [p[0] - side[0] * w, p[1] + lift, p[2] - side[2] * w],
				v: t,
			});
			const step = length / segments;
			p = [p[0] + dirX * Math.cos(pitch) * step, p[1] + Math.sin(pitch) * step, p[2] + dirZ * Math.cos(pitch) * step];
		}
		for (let s = 0; s < segments; s++) {
			const a = rows[s];
			const b = rows[s + 1];
			for (const [outer0, outer1, u0] of [[a.left, b.left, 0], [a.right, b.right, 1]] as const) {
				const e1: Vec = [b.mid[0] - a.mid[0], b.mid[1] - a.mid[1], b.mid[2] - a.mid[2]];
				const e2: Vec = [outer0[0] - a.mid[0], outer0[1] - a.mid[1], outer0[2] - a.mid[2]];
				let n = normalize(cross(e1, e2));
				if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
				const i0 = push(fronds, a.mid, n, 0.5, a.v, colour);
				const i1 = push(fronds, outer0, n, u0, a.v, colour);
				const i2 = push(fronds, outer1, n, u0, b.v, colour);
				const i3 = push(fronds, b.mid, n, 0.5, b.v, colour);
				// Two-sided material: either winding draws; keep one consistent.
				fronds.indices.push(i0, i1, i2, i0, i2, i3);
			}
		}
	};

	const turn = variant * 0.7;
	for (let i = 0; i < shape.fronds; i++) {
		const azimuth = turn + (i / shape.fronds) * Math.PI * 2 + Math.sin(i * 2.3) * 0.18;
		const young = i % 3 === 0;
		const shadeOf = 0.82 + ((i * 37) % 10) / 50;
		addFrond(azimuth, young ? 0.95 : 0.55, young ? 1.6 : 2.1, shape.length * (young ? 0.85 : 1), 0.62, [shadeOf * 0.95, shadeOf, shadeOf * 0.8]);
	}
	// Dead fronds hanging under the crown.
	for (let i = 0; i < 2; i++) {
		addFrond(turn + 1.1 + i * 2.8, -0.6, 1.4, shape.length * 0.75, 0.45, [0.82, 0.66, 0.42]);
	}
	return { trunk, fronds };
}

export interface LampGeometry {
	/** Pole, arm and housing: painted metal, vertex coloured. */
	metal: MeshData;
	/** The glass under the housing, which lights up. */
	glass: MeshData;
}

const LAMP_HEIGHT = 7.6;
const ARM_REACH = 2.4;

/** A single-arm street light, its arm reaching along +Z (the yaw turns it towards the road). */
export function lampGeometry(): LampGeometry {
	const metal = mesh();
	const glass = mesh();
	const paint: Vec = [0.26, 0.27, 0.27];
	box(metal, [0, 0.25, 0], [0.42, 0.5, 0.42], [0.55, 0.54, 0.5]);
	tube(metal, (t) => [0, 0.5 + (LAMP_HEIGHT - 0.5) * t, 0], (t) => 0.1 - 0.035 * t, 4, 8, 1, () => paint);
	// The arm curves out and up from the top of the pole.
	tube(metal, (t) => [0, LAMP_HEIGHT - 0.4 + 0.5 * Math.sin(t * Math.PI / 2), ARM_REACH * t], () => 0.055, 6, 6, 1, () => paint);
	box(metal, [0, LAMP_HEIGHT + 0.02, ARM_REACH + 0.25], [0.42, 0.2, 0.95], paint);
	box(glass, [0, LAMP_HEIGHT - 0.1, ARM_REACH + 0.25], [0.32, 0.06, 0.8], [1, 1, 1]);
	return { metal, glass };
}

/** Copies `source` into `target`, turned by `yawDegrees` about Y and moved to (x, y, z). */
export function appendTransformed(target: MeshData, source: MeshData, x: number, y: number, z: number, yawDegrees: number): void {
	const yaw = (yawDegrees * Math.PI) / 180;
	const cos = Math.cos(yaw);
	const sin = Math.sin(yaw);
	const base = target.positions.length / 3;
	const p = source.positions;
	const n = source.normals;
	for (let i = 0; i < p.length; i += 3) {
		// Same convention as an entity's yaw: +Z turns towards +X for a positive angle.
		target.positions.push(x + p[i] * cos + p[i + 2] * sin, y + p[i + 1], z - p[i] * sin + p[i + 2] * cos);
		target.normals.push(n[i] * cos + n[i + 2] * sin, n[i + 1], -n[i] * sin + n[i + 2] * cos);
	}
	target.uvs.push(...source.uvs);
	if (target.colors && source.colors) target.colors.push(...source.colors);
	for (const index of source.indices) target.indices.push(base + index);
}

export interface ChunkGeometry {
	trunks: MeshData;
	fronds: MeshData;
	metal: MeshData;
	glass: MeshData;
	/** Centre, for sorting and debugging. */
	x: number;
	z: number;
}

/** The dressing grouped into chunks, each merged into one mesh per material. */
export function buildDressingChunks(items: readonly DressingItem[]): ChunkGeometry[] {
	const palms = [0, 1, 2, 3].map(palmGeometry);
	const lamp = lampGeometry();
	const chunks = new Map<string, ChunkGeometry>();
	for (const item of items) {
		const key = chunkKey(item.x, item.z);
		let chunk = chunks.get(key);
		if (!chunk) {
			const [cx, cz] = key.split(",").map(Number);
			chunk = { trunks: mesh(), fronds: mesh(), metal: mesh(), glass: mesh(), x: (cx + 0.5) * CHUNK_SIZE, z: (cz + 0.5) * CHUNK_SIZE };
			chunks.set(key, chunk);
		}
		if (item.kind === "palm") {
			const palm = palms[item.variant % palms.length];
			// Each palm leans its own way.
			const yaw = (item.variant * 97 + item.x * 13 + item.z * 7) % 360;
			appendTransformed(chunk.trunks, palm.trunk, item.x, item.y, item.z, yaw);
			appendTransformed(chunk.fronds, palm.fronds, item.x, item.y, item.z, yaw);
		} else {
			appendTransformed(chunk.metal, lamp.metal, item.x, item.y, item.z, item.yaw);
			appendTransformed(chunk.glass, lamp.glass, item.x, item.y, item.z, item.yaw);
		}
	}
	return [...chunks.values()];
}

/** Palms planted on the city's park lots: a loose grove of five on each, never quite in rows. */
export function parkGroves(parks: readonly { position: readonly [number, number, number]; bounds: readonly [number, number] }[], groundY: number): DressingItem[] {
	const items: DressingItem[] = [];
	parks.forEach((park, index) => {
		const [x, , z] = park.position;
		const [w, d] = park.bounds;
		const spots: [number, number][] = [[-0.32, -0.3], [0.3, -0.34], [0, 0.02], [-0.3, 0.32], [0.34, 0.28]];
		spots.forEach(([u, v], spot) => {
			const jitter = Math.sin((index * 5 + spot) * 12.9898) * 0.08;
			items.push({ kind: "palm", x: x + (u + jitter) * w, y: groundY, z: z + (v - jitter) * d, yaw: 0, variant: (index + spot) % 4 });
		});
	});
	return items;
}
