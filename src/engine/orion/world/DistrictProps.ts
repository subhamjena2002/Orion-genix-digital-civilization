import { emptyMesh, type MeshData } from "./MeshData";

/**
 * The pieces districts are dressed with (see SpawnDistrict, DowntownCore): paving, benches, bins,
 * planters, hedges, walls, kiosks, shelters, signs, fences and billboards. Each is plain boxes,
 * vertex coloured, added to one Builder: a district's whole lot becomes one mesh (one draw call
 * and its shadow) and one static collider for what's solid. Pure, so it's testable without a GPU.
 */

export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

/** The lawn's surface: pads sit just above it, and props stand on them. */
export const LAWN_Y = -0.65;
/** Thin enough to step onto without a collider, thick enough not to flicker against the lawn. */
export const PAD_TOP = LAWN_Y + 0.025;
/** Pavement surface (RoadNetwork PAVEMENT_TOP_Y): props on the pavement stand here. */
export const PAVEMENT_Y = -0.54;

export interface Rect {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
}

export interface ParkedCarSpot {
	id: string;
	style: "hatchback" | "suv";
	colour: string;
	x: number;
	z: number;
	/** Degrees about Y (0 faces +Z). */
	yaw: number;
	ground: number;
}

export function newBuilder(): Builder {
	return { mesh: emptyMesh(true), collider: { positions: [], indices: [] } };
}

export const COLOURS = {
	asphalt: [0.2, 0.21, 0.22],
	line: [0.92, 0.92, 0.88],
	stoneA: [0.78, 0.72, 0.62],
	stoneB: [0.7, 0.64, 0.55],
	gravel: [0.66, 0.6, 0.5],
	kerb: [0.6, 0.6, 0.58],
	wall: [0.88, 0.84, 0.74],
	coping: [0.72, 0.68, 0.6],
	hedge: [0.2, 0.36, 0.16],
	hedgeLight: [0.27, 0.44, 0.2],
	soil: [0.3, 0.22, 0.15],
	water: [0.22, 0.48, 0.58],
	wood: [0.5, 0.33, 0.2],
	iron: [0.12, 0.13, 0.14],
	bin: [0.12, 0.3, 0.2],
	kioskGreen: [0.1, 0.38, 0.28],
	awningRed: [0.75, 0.13, 0.1],
	awningWhite: [0.95, 0.94, 0.9],
	paper: [0.9, 0.88, 0.8],
	shelterFrame: [0.3, 0.32, 0.35],
	shelterPanel: [0.62, 0.7, 0.74],
	advert: [0.95, 0.65, 0.15],
	signBlue: [0.1, 0.3, 0.62],
	signWhite: [0.95, 0.95, 0.95],
	bollard: [0.25, 0.26, 0.28],
	fencePost: [0.32, 0.34, 0.36],
	fenceRail: [0.5, 0.52, 0.54],
	billboardFrame: [0.18, 0.19, 0.2],
	adSky: [0.16, 0.45, 0.78],
	adSun: [0.98, 0.78, 0.18],
	adCoral: [0.92, 0.38, 0.32],
	adMint: [0.4, 0.78, 0.62],
	adNight: [0.1, 0.1, 0.2],
	terracotta: [0.72, 0.42, 0.3],
	cream: [0.9, 0.84, 0.72],
	umbrellaA: [0.85, 0.2, 0.18],
	umbrellaB: [0.15, 0.42, 0.66],
	kioskOrange: [0.86, 0.45, 0.12],
	kioskBlue: [0.12, 0.3, 0.55],
	booth: [0.86, 0.86, 0.82],
	boothGlass: [0.35, 0.45, 0.5],
} satisfies Record<string, Rgb>;

export interface DistrictGeometry {
	/** Everything, vertex coloured: one material. */
	props: MeshData;
	/** What stops a car or a person (not the flush pads): positions and indices, world space. */
	collider: { positions: number[]; indices: number[] };
}

export interface Builder {
	mesh: MeshData;
	collider: { positions: number[]; indices: number[] };
}

/** A box at `centre` (world), `size` along its own axes, turned `yaw` degrees about Y. */
export function box(b: Builder, centre: Vec3, size: Vec3, colour: Rgb, yaw = 0, solid = false): void {
	const radians = (yaw * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const turn = (x: number, z: number): [number, number] => [x * cos + z * sin, -x * sin + z * cos];
	const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
	const faces: [Vec3, Vec3, Vec3][] = [
		[[1, 0, 0], [0, 0, -1], [0, 1, 0]],
		[[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
		[[0, 1, 0], [1, 0, 0], [0, 0, -1]],
		[[0, -1, 0], [1, 0, 0], [0, 0, 1]],
		[[0, 0, 1], [1, 0, 0], [0, 1, 0]],
		[[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
	];
	const mesh = b.mesh;
	for (const [n, u, v] of faces) {
		const base = mesh.positions.length / 3;
		const [nx, nz] = turn(n[0], n[2]);
		for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			const lx = (n[0] + u[0] * su + v[0] * sv) * hx;
			const ly = (n[1] + u[1] * su + v[1] * sv) * hy;
			const lz = (n[2] + u[2] * su + v[2] * sv) * hz;
			const [wx, wz] = turn(lx, lz);
			mesh.positions.push(centre[0] + wx, centre[1] + ly, centre[2] + wz);
			mesh.normals.push(nx, n[1], nz);
			mesh.uvs.push((su + 1) / 2, (sv + 1) / 2);
			mesh.colors!.push(colour[0], colour[1], colour[2], 1);
		}
		mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	if (!solid) return;
	// The collider: the same eight corners, twelve triangles.
	const c = b.collider;
	const first = c.positions.length / 3;
	for (const [sx, sy, sz] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
		const [wx, wz] = turn(sx * hx, sz * hz);
		c.positions.push(centre[0] + wx, centre[1] + sy * hy, centre[2] + wz);
	}
	for (const [a, bb, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) {
		c.indices.push(first + a, first + bb, first + cc, first + a, first + cc, first + d);
	}
}

/** A flat pad from `rect`, its top at PAD_TOP: paving or asphalt, in tiles of `tile` metres. */
export function pad(b: Builder, rect: Rect, tile: number, colour: (i: number, j: number) => Rgb): void {
	const thickness = 0.03;
	for (let x = rect.minX, i = 0; x < rect.maxX - 1e-6; x += tile, i++) {
		for (let z = rect.minZ, j = 0; z < rect.maxZ - 1e-6; z += tile, j++) {
			const w = Math.min(tile, rect.maxX - x);
			const d = Math.min(tile, rect.maxZ - z);
			box(b, [x + w / 2, PAD_TOP - thickness / 2, z + d / 2], [w, thickness, d], colour(i, j));
		}
	}
}

/** A park bench facing `yaw` (0 = the sitter looks towards +Z): slatted seat and back, iron legs. */
export function bench(b: Builder, x: number, y: number, z: number, yaw: number): void {
	const at = (lx: number, ly: number, lz: number): Vec3 => {
		const r = (yaw * Math.PI) / 180;
		return [x + lx * Math.cos(r) + lz * Math.sin(r), y + ly, z - lx * Math.sin(r) + lz * Math.cos(r)];
	};
	for (const lx of [-0.7, 0.7]) box(b, at(lx, 0.22, 0), [0.06, 0.44, 0.5], COLOURS.iron, yaw);
	for (const lz of [-0.15, 0, 0.15]) box(b, at(0, 0.45, lz), [1.6, 0.04, 0.11], COLOURS.wood, yaw);
	for (const ly of [0.62, 0.76]) box(b, at(0, ly, -0.24), [1.6, 0.1, 0.04], COLOURS.wood, yaw);
	// One solid block for the lot, so nothing walks through it.
	box(b, at(0, 0.4, -0.02), [1.6, 0.8, 0.5], COLOURS.wood, yaw, true);
}

/** A litter bin: a green drum on a post. */
export function bin(b: Builder, x: number, y: number, z: number): void {
	box(b, [x, y + 0.42, z], [0.46, 0.7, 0.46], COLOURS.bin, 0, true);
	box(b, [x, y + 0.8, z], [0.5, 0.06, 0.5], COLOURS.iron);
}

/** A planter: a stone box of soil with a clipped hedge. */
export function planter(b: Builder, x: number, z: number, size = 2.4): void {
	box(b, [x, PAD_TOP + 0.25, z], [size, 0.5, size], COLOURS.coping, 0, true);
	box(b, [x, PAD_TOP + 0.52, z], [size - 0.25, 0.06, size - 0.25], COLOURS.soil);
	box(b, [x, PAD_TOP + 0.9, z], [size - 0.5, 0.7, size - 0.5], COLOURS.hedge);
}

/** A hedge from (x0, z0) to (x1, z1), along one axis. */
export function hedge(b: Builder, x0: number, z0: number, x1: number, z1: number, height = 1.1, width = 0.9): void {
	const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
	const length = Math.abs(alongX ? x1 - x0 : z1 - z0);
	const centre: Vec3 = [(x0 + x1) / 2, LAWN_Y + height / 2, (z0 + z1) / 2];
	box(b, centre, alongX ? [length, height, width] : [width, height, length], COLOURS.hedge, 0, true);
	// A lighter clipped top.
	box(b, [centre[0], LAWN_Y + height + 0.02, centre[2]], alongX ? [length - 0.1, 0.04, width - 0.1] : [width - 0.1, 0.04, length - 0.1], COLOURS.hedgeLight);
}

/** A low garden wall with a coping, from (x0, z0) to (x1, z1) along one axis. */
export function wall(b: Builder, x0: number, z0: number, x1: number, z1: number): void {
	const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
	const length = Math.abs(alongX ? x1 - x0 : z1 - z0);
	const cx = (x0 + x1) / 2;
	const cz = (z0 + z1) / 2;
	box(b, [cx, LAWN_Y + 0.35, cz], alongX ? [length, 0.7, 0.3] : [0.3, 0.7, length], COLOURS.wall, 0, true);
	box(b, [cx, LAWN_Y + 0.73, cz], alongX ? [length + 0.06, 0.06, 0.4] : [0.4, 0.06, length + 0.06], COLOURS.coping);
}

/** A newsstand: a green kiosk, a striped awning over the counter, papers on the rack. */
export function newsstand(b: Builder, x: number, z: number, yaw: number, body: Rgb = COLOURS.kioskGreen, awning: Rgb = COLOURS.awningRed): void {
	const r = (yaw * Math.PI) / 180;
	const at = (lx: number, ly: number, lz: number): Vec3 => [x + lx * Math.cos(r) + lz * Math.sin(r), PAD_TOP + ly, z - lx * Math.sin(r) + lz * Math.cos(r)];
	box(b, at(0, 1.2, 0), [2.4, 2.4, 1.8], body, yaw, true);
	box(b, at(0, 2.5, 0), [2.7, 0.15, 2.1], COLOURS.iron, yaw);
	for (let k = 0; k < 6; k++) box(b, at(-1.125 + k * 0.45, 2.2, 1.2), [0.45, 0.12, 0.7], k % 2 ? COLOURS.awningWhite : awning, yaw);
	box(b, at(0, 0.95, 0.95), [2.2, 0.1, 0.25], COLOURS.wood, yaw);
	for (let k = 0; k < 4; k++) box(b, at(-0.8 + k * 0.53, 1.05, 0.98), [0.4, 0.05, 0.3], COLOURS.paper, yaw);
}

/** A bus shelter facing `yaw`: posts, a roof, a panelled back with an advert, a bench, a flag sign. */
export function busShelter(b: Builder, x: number, z: number, yaw: number): void {
	const r = (yaw * Math.PI) / 180;
	const at = (lx: number, ly: number, lz: number): Vec3 => [x + lx * Math.cos(r) + lz * Math.sin(r), PAVEMENT_Y + ly, z - lx * Math.sin(r) + lz * Math.cos(r)];
	for (const lx of [-1.6, 1.6]) for (const lz of [-0.6, 0.6]) box(b, at(lx, 1.2, lz), [0.08, 2.4, 0.08], COLOURS.shelterFrame, yaw, true);
	box(b, at(0, 2.45, 0), [3.6, 0.1, 1.6], COLOURS.shelterFrame, yaw);
	box(b, at(0, 1.25, -0.62), [3.2, 2.0, 0.04], COLOURS.shelterPanel, yaw, true);
	box(b, at(1.0, 1.35, -0.6), [1.0, 1.4, 0.06], COLOURS.advert, yaw);
	box(b, at(-1.6, 1.25, 0), [0.04, 2.0, 1.2], COLOURS.shelterPanel, yaw);
	box(b, at(-0.4, 0.45, -0.35), [1.8, 0.06, 0.4], COLOURS.wood, yaw);
	box(b, at(2.1, 1.4, 0.4), [0.08, 2.8, 0.08], COLOURS.iron, yaw, true);
	box(b, at(2.1, 2.5, 0.4), [0.5, 0.5, 0.05], COLOURS.signBlue, yaw);
	box(b, at(2.1, 2.5, 0.43), [0.36, 0.14, 0.02], COLOURS.signWhite, yaw);
}

/** A signpost: a pole and two arms pointing the ways. */
export function signpost(b: Builder, x: number, z: number): void {
	box(b, [x, PAD_TOP + 1.4, z], [0.1, 2.8, 0.1], COLOURS.iron, 0, true);
	box(b, [x + 0.55, PAD_TOP + 2.45, z], [1.0, 0.24, 0.05], COLOURS.signBlue);
	box(b, [x, PAD_TOP + 2.1, z + 0.55], [0.05, 0.24, 1.0], COLOURS.signBlue);
}

/** A post-and-rail fence along X at `z`, from `x0` to `x1`: posts every 2.5 m, two rails. */
export function fence(b: Builder, x0: number, x1: number, z: number, height = 1.3): void {
	const length = x1 - x0;
	const posts = Math.max(2, Math.round(length / 2.5) + 1);
	for (let k = 0; k < posts; k++) box(b, [x0 + (length * k) / (posts - 1), LAWN_Y + height / 2, z], [0.12, height, 0.12], COLOURS.fencePost);
	for (const y of [0.45, height - 0.15]) box(b, [(x0 + x1) / 2, LAWN_Y + y, z], [length, 0.08, 0.05], COLOURS.fenceRail);
	// One solid sheet for the lot: nobody climbs onto the line, and no car drives through.
	box(b, [(x0 + x1) / 2, LAWN_Y + height / 2, z], [length, height, 0.1], COLOURS.fenceRail, 0, true);
}

/**
 * A billboard on two legs facing `yaw` (0 = +Z): a framed 6 × 3 m panel, its advert in blocks of
 * colour on both faces (a sky, a sun, a band of lettering).
 */
export function billboard(b: Builder, x: number, z: number, yaw: number, palette: readonly Rgb[]): void {
	const r = (yaw * Math.PI) / 180;
	const at = (lx: number, ly: number, lz: number): Vec3 => [x + lx * Math.cos(r) + lz * Math.sin(r), LAWN_Y + ly, z - lx * Math.sin(r) + lz * Math.cos(r)];
	for (const lx of [-2, 2]) box(b, at(lx, 2.2, 0), [0.25, 4.4, 0.25], COLOURS.billboardFrame, yaw, true);
	box(b, at(0, 5.6, 0), [6.3, 3.3, 0.25], COLOURS.billboardFrame, yaw);
	for (const face of [1, -1]) {
		const lz = face * 0.135;
		box(b, at(0, 5.95, lz), [6, 2.4, 0.02], palette[0], yaw);
		box(b, at(1.6, 6.3, lz * 1.08), [1.3, 1.3, 0.02], palette[1], yaw);
		box(b, at(-0.8, 4.6, lz * 1.08), [4.2, 0.6, 0.02], palette[2], yaw);
		for (let k = 0; k < 6; k++) box(b, at(-2.6 + k * 0.55, 4.6, lz * 1.16), [0.35, 0.3, 0.02], COLOURS.signWhite, yaw);
	}
}

/** A café table under a sunshade, with two chairs. */
export function cafeTable(b: Builder, x: number, z: number, shade: Rgb): void {
	box(b, [x, PAD_TOP + 0.37, z], [0.08, 0.74, 0.08], COLOURS.iron, 0, true);
	box(b, [x, PAD_TOP + 0.75, z], [0.8, 0.04, 0.8], COLOURS.cream);
	box(b, [x, PAD_TOP + 1.3, z], [0.05, 1.1, 0.05], COLOURS.iron);
	box(b, [x, PAD_TOP + 2.0, z], [2.2, 0.08, 2.2], shade);
	box(b, [x, PAD_TOP + 2.1, z], [1.4, 0.12, 1.4], shade);
	for (const side of [-1, 1]) {
		box(b, [x + side * 0.7, PAD_TOP + 0.23, z], [0.45, 0.46, 0.45], COLOURS.iron);
		box(b, [x + side * 0.9, PAD_TOP + 0.65, z], [0.06, 0.45, 0.45], COLOURS.iron);
	}
}

/** A car-park pay booth: a little white hut with a window band and a flat roof. */
export function booth(b: Builder, x: number, z: number): void {
	box(b, [x, PAD_TOP + 1.15, z], [1.6, 2.3, 1.6], COLOURS.booth, 0, true);
	box(b, [x, PAD_TOP + 1.6, z], [1.64, 0.7, 1.64], COLOURS.boothGlass);
	box(b, [x, PAD_TOP + 2.38, z], [2.0, 0.16, 2.0], COLOURS.iron);
}
