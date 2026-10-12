import { pavedHeightAt } from "../roads/RoadNetwork";
import { distanceToPath, ESTATE_PAVEMENT, ESTATE_ROAD_WIDTH, ESTATE_ROAD_Y, ESTATE_ROADS, TURNING_CIRCLE_RADIUS, type EstateRoad, type Point } from "./Estates";
import type { MeshData } from "./MeshData";
import { LAND_Y } from "./Mountains";

/**
 * The estate streets as meshes: asphalt down the middle, a kerbed pavement either side, and a
 * turning circle at each dead end. Where a street meets another (or the city's), its pavement
 * stops at the other's kerb rather than running across the junction. Pure, so it's testable.
 */

export interface EstateRoadMeshes {
	asphalt: MeshData;
	/** Pavement tops and kerb faces. */
	pavement: MeshData;
}

/** Pavement stands this far proud of the asphalt. */
const KERB = 0.035;
/** Metres per repeat of the asphalt and paving textures. */
const ASPHALT_TILE = 3;
const PAVING_TILE = 2;
const CIRCLE_SEGMENTS = 28;

function empty(): MeshData {
	return { positions: [], normals: [], uvs: [], indices: [] };
}

function vertex(target: MeshData, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
	const index = target.positions.length / 3;
	target.positions.push(x, y, z);
	target.normals.push(nx, ny, nz);
	target.uvs.push(u, v);
	return index;
}

/** A triangle of existing vertices, wound to face along its vertices' normal (front faces only draw). */
function triangle(target: MeshData, i0: number, i1: number, i2: number): void {
	const p = target.positions;
	const n = target.normals;
	const [ax, ay, az] = [p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2]];
	const e1 = [p[i1 * 3] - ax, p[i1 * 3 + 1] - ay, p[i1 * 3 + 2] - az];
	const e2 = [p[i2 * 3] - ax, p[i2 * 3 + 1] - ay, p[i2 * 3 + 2] - az];
	const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
	const facing = cross[0] * n[i0 * 3] + cross[1] * n[i0 * 3 + 1] + cross[2] * n[i0 * 3 + 2];
	if (facing >= 0) target.indices.push(i0, i1, i2);
	else target.indices.push(i0, i2, i1);
}

/** A flat quad facing up, its corners in order round it (either way). */
function upQuad(target: MeshData, a: Point, b: Point, c: Point, d: Point, y: number, tile: number): void {
	const i = [a, b, c, d].map(([x, z]) => vertex(target, x, y, z, 0, 1, 0, x / tile, z / tile));
	triangle(target, i[0], i[1], i[2]);
	triangle(target, i[0], i[2], i[3]);
}

/** A vertical face from a to b (seen from the side its normal points to), y0 up to y1. */
function wall(target: MeshData, a: Point, b: Point, y0: number, y1: number, nx: number, nz: number, tile: number): void {
	const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
	const i0 = vertex(target, a[0], y0, a[1], nx, 0, nz, 0, 0);
	const i1 = vertex(target, b[0], y0, b[1], nx, 0, nz, length / tile, 0);
	const i2 = vertex(target, b[0], y1, b[1], nx, 0, nz, length / tile, (y1 - y0) / tile);
	const i3 = vertex(target, a[0], y1, a[1], nx, 0, nz, 0, (y1 - y0) / tile);
	triangle(target, i0, i1, i2);
	triangle(target, i0, i2, i3);
}

/** Per-vertex left normal along a polyline (averaged at the joints). */
function sideNormals(points: readonly Point[]): Point[] {
	return points.map((_, i) => {
		const a = points[Math.max(0, i - 1)];
		const b = points[Math.min(points.length - 1, i + 1)];
		const dx = b[0] - a[0];
		const dz = b[1] - a[1];
		const length = Math.hypot(dx, dz) || 1;
		return [-dz / length, dx / length];
	});
}

function onCityRoad(x: number, z: number): boolean {
	return pavedHeightAt(x, z) !== null;
}

function nearOtherRoad(road: EstateRoad, x: number, z: number, margin: number): boolean {
	return ESTATE_ROADS.some((other) => other !== road && distanceToPath(other.points, x, z) < ESTATE_ROAD_WIDTH / 2 + margin);
}

export function buildEstateRoadMeshes(): EstateRoadMeshes {
	const asphalt = empty();
	const pavement = empty();
	const half = ESTATE_ROAD_WIDTH / 2;
	const outer = half + ESTATE_PAVEMENT;
	const top = ESTATE_ROAD_Y;
	const kerbTop = top + KERB;

	ESTATE_ROADS.forEach((road, roadIndex) => {
		const points = road.points;
		const normals = sideNormals(points);
		// Streets that branch off another sit a hair lower, so where they overlap at the junction
		// the through street draws on top instead of flickering.
		const y = top - (road.startJoins || road.endJoins ? 0.003 * ((roadIndex % 3) + 1) : 0);
		const deadEnds: Point[] = [];
		if (!road.startJoins) deadEnds.push(points[0]);
		if (!road.endJoins) deadEnds.push(points[points.length - 1]);
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1];
			const b = points[i];
			const na = normals[i - 1];
			const nb = normals[i];
			const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
			if (onCityRoad(mid[0], mid[1])) continue;
			const left = (p: Point, n: Point, w: number): Point => [p[0] + n[0] * w, p[1] + n[1] * w];
			// Asphalt: left edge to right edge.
			upQuad(asphalt, left(a, na, half), left(b, nb, half), left(b, nb, -half), left(a, na, -half), y, ASPHALT_TILE);
			// Pavements, unless this stretch is a junction or runs into a turning circle.
			if (nearOtherRoad(road, mid[0], mid[1], ESTATE_PAVEMENT + 0.5)) continue;
			if (deadEnds.some(([x, z]) => Math.hypot(mid[0] - x, mid[1] - z) < TURNING_CIRCLE_RADIUS)) continue;
			for (const side of [1, -1]) {
				const inA = left(a, na, side * half);
				const inB = left(b, nb, side * half);
				const outA = left(a, na, side * outer);
				const outB = left(b, nb, side * outer);
				upQuad(pavement, outA, outB, inB, inA, kerbTop, PAVING_TILE);
				// Kerb face towards the road, and the outer edge down to the ground.
				const nx = (na[0] + nb[0]) / 2;
				const nz = (na[1] + nb[1]) / 2;
				wall(pavement, inA, inB, y, kerbTop, -side * nx, -side * nz, PAVING_TILE);
				wall(pavement, outA, outB, LAND_Y, kerbTop, side * nx, side * nz, PAVING_TILE);
			}
		}
		// Turning circles: an asphalt disc with a pavement ring round it.
		for (const [cx, cz] of deadEnds) {
			const centre = vertex(asphalt, cx, y + 0.001, cz, 0, 1, 0, cx / ASPHALT_TILE, cz / ASPHALT_TILE);
			const rim: number[] = [];
			for (let s = 0; s < CIRCLE_SEGMENTS; s++) {
				const angle = (s / CIRCLE_SEGMENTS) * Math.PI * 2;
				const x = cx + Math.cos(angle) * TURNING_CIRCLE_RADIUS;
				const z = cz + Math.sin(angle) * TURNING_CIRCLE_RADIUS;
				rim.push(vertex(asphalt, x, y + 0.001, z, 0, 1, 0, x / ASPHALT_TILE, z / ASPHALT_TILE));
			}
			for (let s = 0; s < CIRCLE_SEGMENTS; s++) triangle(asphalt, centre, rim[(s + 1) % CIRCLE_SEGMENTS], rim[s]);
			for (let s = 0; s < CIRCLE_SEGMENTS; s++) {
				const a0 = (s / CIRCLE_SEGMENTS) * Math.PI * 2;
				const a1 = ((s + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
				const ring = (angle: number, radius: number): Point => [cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius];
				const midAngle = (a0 + a1) / 2;
				const probe = ring(midAngle, TURNING_CIRCLE_RADIUS + ESTATE_PAVEMENT / 2);
				// The mouth where the street comes in stays open.
				if (distanceToPath(points, probe[0], probe[1]) < half) continue;
				upQuad(pavement, ring(a0, TURNING_CIRCLE_RADIUS), ring(a1, TURNING_CIRCLE_RADIUS), ring(a1, TURNING_CIRCLE_RADIUS + ESTATE_PAVEMENT), ring(a0, TURNING_CIRCLE_RADIUS + ESTATE_PAVEMENT), kerbTop, PAVING_TILE);
				const nx = Math.cos(midAngle);
				const nz = Math.sin(midAngle);
				wall(pavement, ring(a0, TURNING_CIRCLE_RADIUS), ring(a1, TURNING_CIRCLE_RADIUS), y, kerbTop, -nx, -nz, PAVING_TILE);
				wall(pavement, ring(a0, TURNING_CIRCLE_RADIUS + ESTATE_PAVEMENT), ring(a1, TURNING_CIRCLE_RADIUS + ESTATE_PAVEMENT), LAND_Y, kerbTop, nx, nz, PAVING_TILE);
			}
		}
	});
	return { asphalt, pavement };
}
