import { CITY_EXTENT_X, CITY_EXTENT_Z } from "../roads/RoadNetwork";
import { HIGHWAY_GEOMETRY, HIGHWAYS, projectOnto, spanAt, type Highway, type HighwaySpan } from "./Highways";
import { addVertex, emptyMesh, type MeshData } from "./MeshData";
import { isOnLand } from "./StateOutline";

/**
 * The hills and mountains outside the city.
 *
 * Each range (a massif) is its own patch of terrain laid over the flat land: a rectangle in its
 * own frame whose height falls to nothing at the edges, so it blends into the plain without a
 * seam. Ranges never overlap, stay clear of the city, and fade out before the coast, so the
 * beach and the sea are untouched.
 *
 * Roads cut through them: within reach of a highway the ground is lowered to a V-shaped rock
 * cutting (flat under the road, rising at a steep batter either side). Under a bridge the
 * valley is left alone, and over a tunnel the mountain stays whole.
 *
 * The ridge a tunnel goes through is laid out along the tunnel, so the portals fall exactly on
 * grid lines: the terrain inside the tunnel's length (the roof) and outside it (the cutting)
 * are built as separate blocks, and a concrete portal wall fills the step between them.
 */

/** Top of the flat land everywhere else (see StateTerrain). */
export const LAND_Y = -0.65;

export type MassifShape = "ridge" | "dome";

export interface MassifDef {
	id: string;
	name: string;
	/** Centre and heading (degrees from +X towards +Z) of the u axis. Taken from the tunnel if there is one. */
	centre?: readonly [number, number];
	heading?: number;
	/** Half-size along u and v, metres. */
	halfLength: number;
	halfWidth: number;
	/** Highest point above the plain, metres (before the rock detail). */
	peak: number;
	shape: MassifShape;
	seed: number;
	/** The highway whose tunnel runs through this massif, along u. */
	tunnel?: string;
}

export interface MassifTunnel {
	highway: Highway;
	span: HighwaySpan;
	/** Half the tunnel's length: the portals are at u = ±halfLength. */
	halfLength: number;
	/** Road height inside, above the plain. */
	roadRise: number;
}

export interface Massif {
	id: string;
	name: string;
	centreX: number;
	centreZ: number;
	/** Unit u axis; v is to its left, (-uz, ux). */
	ux: number;
	uz: number;
	halfLength: number;
	halfWidth: number;
	peak: number;
	shape: MassifShape;
	seed: number;
	tunnel: MassifTunnel | null;
}

/** Grid spacing of the terrain, metres. */
export const MASSIF_CELL = 5;
/** Side slope of a road cutting: metres up per metre out. */
const CUT_SLOPE = 1.15;
/** The cut face over a tunnel portal leans back into the hill this steeply. */
const PORTAL_FACE_SLOPE = 1.5;
/** Distance inside a tunnel span that still counts as the cutting in front of the portal. */
const PORTAL_EPSILON = 0.5;
/** Ground this close to the plain isn't drawn (the flat land shows instead). */
const FLAT_EPSILON = 0.05;
/** How far outside the road grid the ground may start to rise. */
const CITY_CLEARANCE_START = 35;
const CITY_CLEARANCE_FULL = 95;
/** Ring sampled to keep the hills off the beach. */
const COAST_PROBE = 45;

const TUNNEL_HALF_WIDTH = HIGHWAY_GEOMETRY.halfWidth + 0.6;

export const MASSIF_DEFS: readonly MassifDef[] = [
	{ id: "ghat-ridge", name: "Ghat Ridge", tunnel: "ghats-expressway", halfLength: 190, halfWidth: 130, peak: 62, shape: "ridge", seed: 3.1 },
	{ id: "cape-heights", name: "Cape Heights", centre: [-870, -300], heading: 60, halfLength: 110, halfWidth: 75, peak: 70, shape: "dome", seed: 7.7 },
	{ id: "south-hills", name: "Sundar Hills", centre: [-560, 205], heading: -15, halfLength: 95, halfWidth: 55, peak: 36, shape: "dome", seed: 1.9 },
	{ id: "north-range", name: "Uttar Range", centre: [-40, -445], heading: 0, halfLength: 250, halfWidth: 75, peak: 44, shape: "ridge", seed: 5.3 },
	{ id: "tara-peak", name: "Tara Peak", centre: [1000, -398], heading: 20, halfLength: 62, halfWidth: 56, peak: 30, shape: "dome", seed: 9.4 },
];

function buildMassif(def: MassifDef): Massif {
	if (def.tunnel) {
		const highway = HIGHWAYS.find((candidate) => candidate.id === def.tunnel);
		const span = highway?.spans.find((candidate) => candidate.kind === "tunnel");
		if (!highway || !span) throw new Error(`No tunnel on ${def.tunnel}`);
		const a = pointAt(highway, span.from);
		const b = pointAt(highway, span.to);
		const length = Math.hypot(b.x - a.x, b.z - a.z);
		return {
			id: def.id, name: def.name,
			centreX: (a.x + b.x) / 2, centreZ: (a.z + b.z) / 2,
			ux: (b.x - a.x) / length, uz: (b.z - a.z) / length,
			halfLength: def.halfLength, halfWidth: def.halfWidth, peak: def.peak, shape: def.shape, seed: def.seed,
			tunnel: { highway, span, halfLength: length / 2, roadRise: (a.y + b.y) / 2 - LAND_Y },
		};
	}
	const heading = ((def.heading ?? 0) * Math.PI) / 180;
	return {
		id: def.id, name: def.name,
		centreX: def.centre?.[0] ?? 0, centreZ: def.centre?.[1] ?? 0,
		ux: Math.cos(heading), uz: Math.sin(heading),
		halfLength: def.halfLength, halfWidth: def.halfWidth, peak: def.peak, shape: def.shape, seed: def.seed,
		tunnel: null,
	};
}

/** Road position and height at a distance along a route. */
export function pointAt(highway: Highway, distance: number): { x: number; y: number; z: number } {
	const samples = highway.samples;
	for (let i = 1; i < samples.length; i++) {
		if (samples[i].distance < distance && i < samples.length - 1) continue;
		const a = samples[i - 1];
		const b = samples[i];
		const t = Math.max(0, Math.min(1, (distance - a.distance) / (b.distance - a.distance || 1)));
		return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
	}
	return samples[samples.length - 1];
}

export const MASSIFS: readonly Massif[] = MASSIF_DEFS.map(buildMassif);

// --- Shape ---------------------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function hash(x: number, z: number, seed: number): number {
	const h = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
	return h - Math.floor(h);
}

function valueNoise(x: number, z: number, seed: number): number {
	const xi = Math.floor(x);
	const zi = Math.floor(z);
	const xf = x - xi;
	const zf = z - zi;
	const u = xf * xf * (3 - 2 * xf);
	const v = zf * zf * (3 - 2 * zf);
	const a = hash(xi, zi, seed);
	const b = hash(xi + 1, zi, seed);
	const c = hash(xi, zi + 1, seed);
	const d = hash(xi + 1, zi + 1, seed);
	return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Ridged fractal noise, 0 to about 1: sharp crests and gullies, like eroded rock. */
function ridged(x: number, z: number, seed: number): number {
	let sum = 0;
	let amplitude = 0.55;
	let frequency = 1;
	for (let octave = 0; octave < 5; octave++) {
		const n = 1 - Math.abs(2 * valueNoise(x * frequency, z * frequency, seed + octave * 13.1) - 1);
		sum += n * n * amplitude;
		amplitude *= 0.5;
		frequency *= 2.03;
	}
	return sum;
}

/** 1 well inland, falling to 0 before the beach. */
function coastMask(x: number, z: number): number {
	if (!isOnLand(x, z)) return 0;
	let onLand = 0;
	for (let i = 0; i < 8; i++) {
		const angle = (i / 8) * Math.PI * 2;
		if (isOnLand(x + Math.cos(angle) * COAST_PROBE, z + Math.sin(angle) * COAST_PROBE)) onLand++;
	}
	return smoothstep(5.5, 8, onLand);
}

/** 0 on and near the road grid, rising to 1 well clear of it. */
function cityMask(x: number, z: number): number {
	const dx = Math.max(0, Math.abs(x) - CITY_EXTENT_X);
	const dz = Math.max(0, Math.abs(z) - CITY_EXTENT_Z);
	return smoothstep(CITY_CLEARANCE_START, CITY_CLEARANCE_FULL, Math.hypot(dx, dz));
}

/** The massif as nature made it, before any road: metres above the plain. */
export function naturalHeight(massif: Massif, u: number, v: number): number {
	const tu = u / massif.halfLength;
	const tv = v / massif.halfWidth;
	const edge = (1 - smoothstep(0.62, 1, Math.abs(tu))) * (1 - smoothstep(0.62, 1, Math.abs(tv)));
	if (edge <= 0) return 0;
	const x = massif.centreX + massif.ux * u - massif.uz * v;
	const z = massif.centreZ + massif.uz * u + massif.ux * v;
	const detail = ridged(x / 85, z / 85, massif.seed);
	let base: number;
	if (massif.shape === "dome") {
		const r = Math.hypot(tu, tv);
		base = 1 - smoothstep(0, 1, r);
		// A second, offset summit so it isn't a perfect cone.
		const second = 1 - smoothstep(0, 0.55, Math.hypot(tu + 0.35, tv - 0.25));
		base = Math.max(base, second * 0.75);
	} else {
		// A crest running along v, with saddles and summits along it.
		base = Math.exp(-((tu / 0.58) ** 2)) * (0.8 + 0.2 * Math.cos(tv * Math.PI * 1.4 + massif.seed));
	}
	const height = massif.peak * edge * (base * (0.62 + 0.5 * detail) + 0.06 * detail);
	return height * coastMask(x, z) * cityMask(x, z);
}

/** Ground lowered for every road passing through, except where it tunnels or bridges. */
function cutForRoads(height: number, x: number, z: number): number {
	let result = height;
	for (const highway of HIGHWAYS) {
		const hit = projectOnto(highway, x, z);
		const span = spanAt(highway, hit.distance);
		// Inside a tunnel the hill stays whole — but only strictly inside: the cutting has to
		// reach the portal line itself, or its last row stands across the road as a wall.
		if (span && (span.kind === "bridge" || (hit.distance > span.from + PORTAL_EPSILON && hit.distance < span.to - PORTAL_EPSILON))) continue;
		let reach: number;
		let flatHalf: number;
		const end = highway.samples[highway.samples.length - 1];
		if (hit.beyondEnds && hit.distance > 0 && highway.endPlaza) {
			reach = Math.hypot(x - end.x, z - end.z);
			flatHalf = HIGHWAY_GEOMETRY.plazaRadius + 1.5;
		} else {
			reach = Math.abs(hit.lateral);
			flatHalf = HIGHWAY_GEOMETRY.halfWidth + 1.5;
			if (hit.beyondEnds) {
				const start = hit.distance > 0 ? end : highway.samples[0];
				reach = Math.hypot(x - start.x, z - start.z);
			}
		}
		const cut = hit.y - LAND_Y - 0.15 + Math.max(0, reach - flatHalf) * CUT_SLOPE;
		if (cut < result) result = cut;
	}
	return result;
}

export type TerrainBlock = "open" | "roof";

/**
 * Height of the ground above the plain at (u, v) of a massif. `block` says which side of a
 * tunnel portal the point belongs to (the two meet at the portal line with different heights).
 */
export function massifHeight(massif: Massif, u: number, v: number, block: TerrainBlock = "open"): number {
	const natural = naturalHeight(massif, u, v);
	const x = massif.centreX + massif.ux * u - massif.uz * v;
	const z = massif.centreZ + massif.uz * u + massif.ux * v;
	const tunnel = massif.tunnel;
	if (block === "roof" && tunnel) {
		// The hill over the tunnel: its face leans back from the portal, and the crown is never
		// thinner than the cover the tunnel needs.
		const cutProfile = tunnel.roadRise - 0.15 + Math.max(0, Math.abs(v) - (HIGHWAY_GEOMETRY.halfWidth + 1.5)) * CUT_SLOPE;
		const face = cutProfile + (tunnel.halfLength - Math.abs(u)) * PORTAL_FACE_SLOPE;
		let height = Math.min(natural, face);
		if (Math.abs(v) <= TUNNEL_HALF_WIDTH + 2) height = Math.max(height, tunnelCrownRise(tunnel) + HIGHWAY_GEOMETRY.tunnelCover);
		return Math.max(0, height);
	}
	return Math.max(0, cutForRoads(natural, x, z));
}

export function tunnelCrownRise(tunnel: MassifTunnel): number {
	return tunnel.roadRise + HIGHWAY_GEOMETRY.tunnelWallHeight + HIGHWAY_GEOMETRY.tunnelArchRise;
}

/** Local (u, v) of a world point. */
export function toLocal(massif: Massif, x: number, z: number): { u: number; v: number } {
	const dx = x - massif.centreX;
	const dz = z - massif.centreZ;
	return { u: dx * massif.ux + dz * massif.uz, v: -dx * massif.uz + dz * massif.ux };
}

/** Ground height at (x, z) (absolute), counting every massif; the plain if none. */
export function terrainHeightAt(x: number, z: number): number {
	let best = 0;
	for (const massif of MASSIFS) {
		const { u, v } = toLocal(massif, x, z);
		if (Math.abs(u) > massif.halfLength || Math.abs(v) > massif.halfWidth) continue;
		const inTunnel = massif.tunnel !== null && Math.abs(u) < massif.tunnel.halfLength;
		best = Math.max(best, massifHeight(massif, u, v, inTunnel ? "roof" : "open"));
	}
	return LAND_Y + best;
}

// --- Geometry ------------------------------------------------------------------------------

/** Grid lines from -half to +half, with any `extra` positions included exactly. */
function gridLines(half: number, extra: readonly number[] = []): number[] {
	const count = Math.ceil((half * 2) / MASSIF_CELL);
	const lines = new Set<number>();
	for (let i = 0; i <= count; i++) lines.add(-half + (i * half * 2) / count);
	for (const value of extra) if (Math.abs(value) <= half) lines.add(value);
	return [...lines].sort((a, b) => a - b);
}

/**
 * Multiplied into the grass-and-rock texture, which is yellow-green throughout: the grass tint
 * greens it a little; the rock tints lean blue so the yellow cancels to grey stone.
 */
const GRASS: readonly [number, number, number] = [0.86, 1, 0.8];
const ROCK: readonly [number, number, number] = [0.6, 0.63, 0.74];
const HIGH_ROCK: readonly [number, number, number] = [0.8, 0.83, 0.92];

function tint(slopeUp: number, height: number): [number, number, number] {
	const rocky = smoothstep(0.88, 0.7, slopeUp);
	const high = smoothstep(38, 70, height);
	const out: [number, number, number] = [0, 0, 0];
	for (let i = 0; i < 3; i++) {
		const rock = ROCK[i] + (HIGH_ROCK[i] - ROCK[i]) * high;
		out[i] = GRASS[i] + (rock - GRASS[i]) * rocky;
	}
	return out;
}

/**
 * One block of terrain over a u range. Triangles whose three corners are all at the plain are
 * left out, so the flat land shows through rather than fighting it for the same pixels.
 */
function buildBlock(massif: Massif, us: readonly number[], vs: readonly number[], block: TerrainBlock, textureUnit: number, mesh: MeshData): void {
	const heights: number[][] = us.map((u) => vs.map((v) => massifHeight(massif, u, v, block)));
	const base = mesh.positions.length / 3;
	for (let i = 0; i < us.length; i++) {
		for (let j = 0; j < vs.length; j++) {
			const u = us[i];
			const v = vs[j];
			const h = heights[i][j];
			const x = massif.centreX + massif.ux * u - massif.uz * v;
			const z = massif.centreZ + massif.uz * u + massif.ux * v;
			// Slope from neighbouring heights (one-sided at the edges).
			const i0 = Math.max(0, i - 1);
			const i1 = Math.min(us.length - 1, i + 1);
			const j0 = Math.max(0, j - 1);
			const j1 = Math.min(vs.length - 1, j + 1);
			const dhdu = (heights[i1][j] - heights[i0][j]) / (us[i1] - us[i0] || 1);
			const dhdv = (heights[i][j1] - heights[i][j0]) / (vs[j1] - vs[j0] || 1);
			// Normal in local axes (u, up, v) → world.
			const nu = -dhdu;
			const nv = -dhdv;
			const length = Math.hypot(nu, 1, nv);
			const nx = (massif.ux * nu - massif.uz * nv) / length;
			const nz = (massif.uz * nu + massif.ux * nv) / length;
			const ny = 1 / length;
			addVertex(mesh, x, LAND_Y + h, z, nx, ny, nz, x / textureUnit, z / textureUnit);
			const [r, g, b] = tint(ny, h);
			mesh.colors!.push(r, g, b, 1);
		}
	}
	const columns = vs.length;
	for (let i = 0; i < us.length - 1; i++) {
		for (let j = 0; j < vs.length - 1; j++) {
			const a = base + i * columns + j;
			const b = base + (i + 1) * columns + j;
			const c = base + (i + 1) * columns + j + 1;
			const d = base + i * columns + j + 1;
			const corners = [heights[i][j], heights[i + 1][j], heights[i + 1][j + 1], heights[i][j + 1]];
			if (corners.every((height) => height < FLAT_EPSILON)) continue;
			// Wound so the faces point up whichever way the u axis is turned.
			mesh.indices.push(a, c, b, a, d, c);
		}
	}
}

export interface MassifMeshes {
	/** Grass and scree: everything but the steep faces. */
	terrain: MeshData;
	/** Steep faces and road cuttings, textured from the side (see splitRock). */
	rock: MeshData;
	/** Concrete walls at the tunnel mouths (empty without a tunnel). */
	portals: MeshData;
}

export function buildMassifMeshes(massif: Massif, textureUnit: number): MassifMeshes {
	const terrain = emptyMesh(true);
	const portals = emptyMesh();
	const tunnel = massif.tunnel;
	const vs = gridLines(massif.halfWidth, tunnel ? [-(TUNNEL_HALF_WIDTH + 2), TUNNEL_HALF_WIDTH + 2] : []);
	if (!tunnel) {
		buildBlock(massif, gridLines(massif.halfLength), vs, "open", textureUnit, terrain);
		return { ...splitRock(terrain, textureUnit), portals };
	}
	const t = tunnel.halfLength;
	const all = gridLines(massif.halfLength, [-t, t]);
	buildBlock(massif, all.filter((u) => u <= -t), vs, "open", textureUnit, terrain);
	buildBlock(massif, all.filter((u) => u >= -t && u <= t), vs, "roof", textureUnit, terrain);
	buildBlock(massif, all.filter((u) => u >= t), vs, "open", textureUnit, terrain);
	for (const side of [-1, 1] as const) buildPortal(massif, tunnel, side, vs, portals);
	return { ...splitRock(terrain, textureUnit), portals };
}

/** Faces steeper than this are bare rock. */
const ROCK_FACE_UP = 0.74;

/**
 * Moves the steep triangles into a mesh of their own, for the rock material.
 *
 * The ground texture is projected from above, which on a near-vertical face stretches into
 * streaks — and no tint turns its yellow grass into grey stone. So cliffs and cuttings get
 * their own surface, projected from the side (whichever side the face looks towards).
 */
function splitRock(terrain: MeshData, textureUnit: number): { terrain: MeshData; rock: MeshData } {
	const p = terrain.positions;
	const gentle: number[] = [];
	const steep: number[] = [];
	for (let i = 0; i < terrain.indices.length; i += 3) {
		const a = terrain.indices[i] * 3;
		const b = terrain.indices[i + 1] * 3;
		const c = terrain.indices[i + 2] * 3;
		const e1x = p[b] - p[a];
		const e1y = p[b + 1] - p[a + 1];
		const e1z = p[b + 2] - p[a + 2];
		const e2x = p[c] - p[a];
		const e2y = p[c + 1] - p[a + 1];
		const e2z = p[c + 2] - p[a + 2];
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		const up = ny / (Math.hypot(nx, ny, nz) || 1);
		(up < ROCK_FACE_UP ? steep : gentle).push(terrain.indices[i], terrain.indices[i + 1], terrain.indices[i + 2]);
	}
	const rock = emptyMesh(true);
	const remap = new Map<number, number>();
	for (const index of steep) {
		let mapped = remap.get(index);
		if (mapped === undefined) {
			const x = p[index * 3];
			const y = p[index * 3 + 1];
			const z = p[index * 3 + 2];
			const nx = terrain.normals[index * 3];
			const nz = terrain.normals[index * 3 + 2];
			// Projected along whichever horizontal axis the face looks down.
			const across = Math.abs(nx) > Math.abs(nz) ? z : x;
			mapped = addVertex(rock, x, y, z, nx, terrain.normals[index * 3 + 1], nz, across / (textureUnit * 0.4), y / (textureUnit * 0.4));
			// Strata: bands of lighter and darker stone with height.
			const band = 0.82 + 0.18 * Math.sin(y * 0.9 + Math.sin(across * 0.05) * 2);
			rock.colors!.push(band, band * 0.98, band * 0.95, 1);
			remap.set(index, mapped);
		}
		rock.indices.push(mapped);
	}
	return { terrain: { ...terrain, indices: gentle }, rock };
}

/** Height along a grid line at v, interpolated between grid points exactly as the mesh is. */
function alongLine(vs: readonly number[], heights: readonly number[], v: number): number {
	for (let j = 1; j < vs.length; j++) {
		if (v > vs[j] && j < vs.length - 1) continue;
		const t = Math.max(0, Math.min(1, (v - vs[j - 1]) / (vs[j] - vs[j - 1])));
		return heights[j - 1] + (heights[j] - heights[j - 1]) * t;
	}
	return heights[heights.length - 1];
}

/** Road-level arch opening: height of the tunnel's inside at v, or null outside it. */
export function tunnelOpeningTop(roadRise: number, v: number): number | null {
	const halfWidth = TUNNEL_HALF_WIDTH;
	if (Math.abs(v) >= halfWidth) return null;
	const arch = HIGHWAY_GEOMETRY.tunnelArchRise * Math.sqrt(1 - (v / halfWidth) ** 2);
	return roadRise + HIGHWAY_GEOMETRY.tunnelWallHeight + arch;
}

/**
 * The portal wall at u = side × halfLength: fills the step between the hill over the tunnel
 * and the cutting in front of it, with the arch left open.
 */
function buildPortal(massif: Massif, tunnel: MassifTunnel, side: -1 | 1, vs: readonly number[], mesh: MeshData): void {
	const u = side * tunnel.halfLength;
	const top = vs.map((v) => massifHeight(massif, u, v, "roof"));
	const bottom = vs.map((v) => massifHeight(massif, u, v, "open"));
	const reach = TUNNEL_HALF_WIDTH + 2 + MASSIF_CELL * 2;
	// Faces out of the hill, along the approaching road.
	const nx = massif.ux * side;
	const nz = massif.uz * side;
	const step = 0.5;
	for (let v = -reach; v < reach - 1e-6; v += step) {
		const v1 = Math.min(reach, v + step);
		const tops = [alongLine(vs, top, v), alongLine(vs, top, v1)];
		const lows = [v, v1].map((vv, k) => {
			const opening = tunnelOpeningTop(tunnel.roadRise, (vv + (k === 0 ? 1e-4 : -1e-4)));
			return opening ?? alongLine(vs, bottom, vv);
		});
		if (tops[0] - lows[0] < 0.01 && tops[1] - lows[1] < 0.01) continue;
		const corners = [
			[v, lows[0]], [v1, lows[1]], [v1, tops[1]], [v, tops[0]],
		].map(([vv, h]) => {
			const x = massif.centreX + massif.ux * u - massif.uz * vv;
			const z = massif.centreZ + massif.uz * u + massif.ux * vv;
			return addVertex(mesh, x, LAND_Y + h, z, nx, 0, nz, vv / 4, h / 4);
		});
		// Wound to face along +side·u.
		if (side > 0) mesh.indices.push(corners[0], corners[2], corners[1], corners[0], corners[3], corners[2]);
		else mesh.indices.push(corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]);
	}
}
