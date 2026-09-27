import { HIGHWAY_GEOMETRY, spanAt, type Highway, type HighwaySample, type HighwaySpan } from "./Highways";
import { addQuad, addVertex, emptyMesh, type MeshData } from "./MeshData";
import { isOnLand } from "./StateOutline";
import { LAND_Y, terrainHeightAt, tunnelOpeningTop } from "./Mountains";

/**
 * The expressways as geometry: the road surface and its markings, barriers, embankments,
 * bridge decks, piers and pylons with their stay cables, and tunnel linings.
 *
 * All in world space. Each part is its own mesh so the component can give it a material, and
 * the solid parts come in a second, simpler form for physics.
 */

export interface HighwayMeshSet {
	road: MeshData;
	markingsWhite: MeshData;
	markingsYellow: MeshData;
	/** Barriers, bridge deck sides, piers and pylons. */
	concrete: MeshData;
	/** Embankment slopes. */
	embankment: MeshData;
	cables: MeshData;
	tunnelLining: MeshData;
	tunnelLights: MeshData;
	/** What cars and people collide with: road, embankments, tall barrier walls, tunnel walls, piers. */
	collision: MeshData;
}

const G = HIGHWAY_GEOMETRY;
/** Barriers stop short of the city junction the route leaves from. */
const BARRIER_START = 22;
/** Embankments fall at 1 in 1.5. */
const EMBANKMENT_SLOPE = 1 / 1.5;
const BARRIER_HEIGHT = 0.9;
/** Invisible extension of the barrier walls for physics: car sweeps test well above the kerb. */
const BARRIER_COLLIDER_HEIGHT = 2.2;
const DECK_DEPTH = 1.8;
const SEABED_Y = -12;
const VIADUCT_PIER_SPACING = 30;
const PYLON_HEIGHT = 50;
const CABLES_PER_FAN = 9;

function left(sample: HighwaySample): [number, number] {
	return [-sample.dirZ, sample.dirX];
}

/** Point `lateral` metres to the left of the sample (negative for the right). */
function offset(sample: HighwaySample, lateral: number): [number, number] {
	const [lx, lz] = left(sample);
	return [sample.x + lx * lateral, sample.z + lz * lateral];
}

function inSpan(highway: Highway, sample: HighwaySample, kind: HighwaySpan["kind"]): boolean {
	return spanAt(highway, sample.distance)?.kind === kind;
}

/**
 * A strip following the route between two lateral offsets at a height above the road, facing
 * up. `include` picks which sample-to-sample pieces are drawn (for dashes and spans).
 */
function strip(
	mesh: MeshData,
	samples: readonly HighwaySample[],
	from: number,
	to: number,
	lift: number,
	include: (a: HighwaySample, b: HighwaySample) => boolean = () => true,
	textureUnit = 8,
): void {
	// Always faces up: given the other way round, the right-hand carriageway's markings were
	// wound face-down and culled, so that side of every highway had no lines at all.
	if (from > to) [from, to] = [to, from];
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1];
		const b = samples[i];
		if (!include(a, b)) continue;
		const corners = [
			[a, from], [b, from], [b, to], [a, to],
		].map(([sample, lateral]) => {
			const s = sample as HighwaySample;
			const [x, z] = offset(s, lateral as number);
			return addVertex(mesh, x, s.y + lift, z, 0, 1, 0, (lateral as number) / textureUnit, s.distance / textureUnit);
		});
		// Facing up: the strip runs forward with `from` to the right of `to` when from < to.
		addQuad(mesh, corners[0], corners[3], corners[2], corners[1]);
	}
}

/**
 * A wall-like profile swept along the route. `profile` is a list of (lateral, height) points
 * across the section; each consecutive pair becomes a face, lit by its own normal. Faces point
 * outwards when the profile runs anticlockwise with +lateral to the right and up at the top
 * (for a closed shape: down the −lateral side, across the bottom, up the +lateral side).
 */
function sweep(mesh: MeshData, samples: readonly HighwaySample[], profile: readonly [number, number][], include: (a: HighwaySample, b: HighwaySample) => boolean): void {
	for (let k = 1; k < profile.length; k++) {
		const [l0, h0] = profile[k - 1];
		const [l1, h1] = profile[k];
		// Normal in the section plane: perpendicular to the edge, then turned into world space.
		const edgeL = l1 - l0;
		const edgeH = h1 - h0;
		const length = Math.hypot(edgeL, edgeH) || 1;
		const nLateral = edgeH / length;
		const nUp = -edgeL / length;
		for (let i = 1; i < samples.length; i++) {
			const a = samples[i - 1];
			const b = samples[i];
			if (!include(a, b)) continue;
			const corners = [[a, l0, h0], [b, l0, h0], [b, l1, h1], [a, l1, h1]].map(([sample, lateral, height]) => {
				const s = sample as HighwaySample;
				const [x, z] = offset(s, lateral as number);
				const [lx, lz] = left(s);
				return addVertex(mesh, x, s.y + (height as number), z, lx * nLateral, nUp, lz * nLateral, s.distance / 4, (height as number) / 4);
			});
			addQuad(mesh, corners[0], corners[1], corners[2], corners[3]);
		}
	}
}

/** A box-section prism (pier, pylon leg) between two heights, centred on (x, z). */
function prism(mesh: MeshData, x: number, z: number, halfA: number, halfB: number, dirX: number, dirZ: number, bottom: number, top: number, sides = 8): void {
	const lx = -dirZ;
	const lz = dirX;
	for (let k = 0; k < sides; k++) {
		const a0 = (k / sides) * Math.PI * 2;
		const a1 = ((k + 1) / sides) * Math.PI * 2;
		const point = (angle: number): [number, number] => [
			x + dirX * Math.cos(angle) * halfA + lx * Math.sin(angle) * halfB,
			z + dirZ * Math.cos(angle) * halfA + lz * Math.sin(angle) * halfB,
		];
		const [x0, z0] = point(a0);
		const [x1, z1] = point(a1);
		const mid = (a0 + a1) / 2;
		const nx = dirX * Math.cos(mid) + lx * Math.sin(mid);
		const nz = dirZ * Math.cos(mid) + lz * Math.sin(mid);
		const i0 = addVertex(mesh, x0, bottom, z0, nx, 0, nz, k / sides, bottom / 4);
		const i1 = addVertex(mesh, x1, bottom, z1, nx, 0, nz, (k + 1) / sides, bottom / 4);
		const i2 = addVertex(mesh, x1, top, z1, nx, 0, nz, (k + 1) / sides, top / 4);
		const i3 = addVertex(mesh, x0, top, z0, nx, 0, nz, k / sides, top / 4);
		addQuad(mesh, i0, i3, i2, i1);
	}
	// Cap on top.
	const centre = addVertex(mesh, x, top, z, 0, 1, 0, 0.5, 0.5);
	for (let k = 0; k < sides; k++) {
		const a0 = (k / sides) * Math.PI * 2;
		const a1 = ((k + 1) / sides) * Math.PI * 2;
		const p0 = addVertex(mesh, x + dirX * Math.cos(a0) * halfA + lx * Math.sin(a0) * halfB, top, z + dirZ * Math.cos(a0) * halfA + lz * Math.sin(a0) * halfB, 0, 1, 0, 0, 0);
		const p1 = addVertex(mesh, x + dirX * Math.cos(a1) * halfA + lx * Math.sin(a1) * halfB, top, z + dirZ * Math.cos(a1) * halfA + lz * Math.sin(a1) * halfB, 0, 1, 0, 1, 0);
		mesh.indices.push(centre, p1, p0);
	}
}

/** A cable: two crossed ribbons, so it reads from any side. */
function cable(mesh: MeshData, from: readonly [number, number, number], to: readonly [number, number, number], width: number): void {
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const dz = to[2] - from[2];
	const length = Math.hypot(dx, dy, dz) || 1;
	// Two directions perpendicular to the cable.
	const flat = Math.hypot(dx, dz) || 1;
	const side: [number, number, number] = [-dz / flat, 0, dx / flat];
	const up: [number, number, number] = [
		(dy * side[2] - dz * side[1]) / length,
		(dz * side[0] - dx * side[2]) / length,
		(dx * side[1] - dy * side[0]) / length,
	];
	for (const across of [side, up]) {
		const h = width / 2;
		const [ax, ay, az] = across;
		const n: [number, number, number] = across === side ? up : side;
		const i0 = addVertex(mesh, from[0] - ax * h, from[1] - ay * h, from[2] - az * h, n[0], n[1], n[2], 0, 0);
		const i1 = addVertex(mesh, to[0] - ax * h, to[1] - ay * h, to[2] - az * h, n[0], n[1], n[2], 0, 1);
		const i2 = addVertex(mesh, to[0] + ax * h, to[1] + ay * h, to[2] + az * h, n[0], n[1], n[2], 1, 1);
		const i3 = addVertex(mesh, from[0] + ax * h, from[1] + ay * h, from[2] + az * h, n[0], n[1], n[2], 1, 0);
		addQuad(mesh, i0, i1, i2, i3);
		addQuad(mesh, i0, i3, i2, i1);
	}
}

function groundBelow(x: number, z: number): number {
	return isOnLand(x, z) ? terrainHeightAt(x, z) : SEABED_Y;
}

/** Samples within [from, to] (distance), with the end samples included. */
function samplesIn(highway: Highway, from: number, to: number): HighwaySample[] {
	return highway.samples.filter((sample) => sample.distance >= from - 1e-6 && sample.distance <= to + 1e-6);
}

function sampleAt(highway: Highway, distance: number): HighwaySample {
	let best = highway.samples[0];
	for (const sample of highway.samples) if (Math.abs(sample.distance - distance) < Math.abs(best.distance - distance)) best = sample;
	return best;
}

export function buildHighwayMeshes(highway: Highway): HighwayMeshSet {
	const set: HighwayMeshSet = {
		road: emptyMesh(),
		markingsWhite: emptyMesh(),
		markingsYellow: emptyMesh(),
		concrete: emptyMesh(),
		embankment: emptyMesh(),
		cables: emptyMesh(),
		tunnelLining: emptyMesh(),
		tunnelLights: emptyMesh(),
		collision: emptyMesh(),
	};
	const samples = highway.samples;
	const halfWidth = G.halfWidth;
	const all = () => true;
	const afterStart = (a: HighwaySample) => a.distance >= BARRIER_START;
	const notTunnel = (a: HighwaySample, b: HighwaySample) => !inSpan(highway, a, "tunnel") || !inSpan(highway, b, "tunnel");
	const notBridgeOrTunnel = (a: HighwaySample, b: HighwaySample) => notTunnel(a, b) && !(inSpan(highway, a, "bridge") && inSpan(highway, b, "bridge"));

	// Road surface, full width.
	strip(set.road, samples, -halfWidth, halfWidth, 0, all);
	strip(set.collision, samples, -halfWidth, halfWidth, 0, all);

	// Markings: solid edge lines, dashed lane lines, yellow lines either side of the median.
	const edge = G.median / 2 + G.lanesEachWay * G.laneWidth;
	const lane = G.median / 2 + G.laneWidth;
	const dashed = (a: HighwaySample) => Math.floor(a.distance / 12) % 3 === 0 && a.distance > 8;
	for (const sign of [-1, 1]) {
		strip(set.markingsWhite, samples, sign * (edge - 0.1), sign * (edge + 0.1), 0.02, all);
		strip(set.markingsWhite, samples, sign * (lane - 0.08), sign * (lane + 0.08), 0.02, dashed);
		strip(set.markingsYellow, samples, sign * (G.median / 2 - 0.02), sign * (G.median / 2 + 0.13), 0.02, (a) => afterStart(a));
	}

	// Median barrier (New Jersey profile) and parapets along both edges.
	const jersey = (centre: number, facing: 1 | -1 | 0): [number, number][] => {
		if (facing === 0) return [[centre - 0.3, 0], [centre - 0.22, 0.25], [centre - 0.1, BARRIER_HEIGHT], [centre + 0.1, BARRIER_HEIGHT], [centre + 0.22, 0.25], [centre + 0.3, 0]];
		// A parapet: sloped face towards the road, flat back to the edge.
		const inner = centre - facing * 0.25;
		return facing > 0
			? [[inner - 0.05, 0], [inner + 0.03, 0.25], [inner + 0.15, BARRIER_HEIGHT + 0.1], [centre + 0.25, BARRIER_HEIGHT + 0.1], [centre + 0.25, -0.05]]
			: [[centre - 0.25, -0.05], [centre - 0.25, BARRIER_HEIGHT + 0.1], [inner - 0.15, BARRIER_HEIGHT + 0.1], [inner - 0.03, 0.25], [inner + 0.05, 0]];
	};
	const barrierRun = (a: HighwaySample, b: HighwaySample) => afterStart(a) && b.distance >= BARRIER_START;
	// The profiles run from −lateral to +lateral; swept the other way round so they face outwards.
	sweep(set.concrete, samples, jersey(0, 0).reverse(), barrierRun);
	sweep(set.concrete, samples, jersey(halfWidth - 0.25, 1).reverse(), (a, b) => barrierRun(a, b) && notTunnel(a, b));
	sweep(set.concrete, samples, jersey(-(halfWidth - 0.25), -1).reverse(), (a, b) => barrierRun(a, b) && notTunnel(a, b));
	for (const lateral of [0, halfWidth - 0.1, -(halfWidth - 0.1)]) {
		const wall: [number, number][] = [[lateral, -0.2], [lateral, BARRIER_COLLIDER_HEIGHT]];
		sweep(set.collision, samples, wall, (a, b) => barrierRun(a, b) && (lateral === 0 || notTunnel(a, b)));
		sweep(set.collision, samples, [...wall].reverse() as [number, number][], (a, b) => barrierRun(a, b) && (lateral === 0 || notTunnel(a, b)));
	}

	// Embankments: from the road edge down to the plain, wherever the road is on the ground.
	for (const sign of [-1, 1] as const) {
		for (let i = 1; i < samples.length; i++) {
			const a = samples[i - 1];
			const b = samples[i];
			if (!notBridgeOrTunnel(a, b)) continue;
			const corners: number[] = [];
			for (const [s, outer] of [[a, false], [b, false], [b, true], [a, true]] as [HighwaySample, boolean][]) {
				const drop = Math.max(0.02, s.y - LAND_Y);
				const lateral = sign * (halfWidth + (outer ? drop / EMBANKMENT_SLOPE : 0));
				const [x, z] = offset(s, lateral);
				const [lx, lz] = left(s);
				const slopeN = Math.hypot(1, EMBANKMENT_SLOPE);
				corners.push(addVertex(set.embankment, x, outer ? LAND_Y - 0.02 : s.y, z, (lx * sign * EMBANKMENT_SLOPE) / slopeN, 1 / slopeN, (lz * sign * EMBANKMENT_SLOPE) / slopeN, lateral / 22, s.distance / 22));
			}
			if (sign > 0) addQuad(set.embankment, corners[0], corners[3], corners[2], corners[1]);
			else addQuad(set.embankment, corners[0], corners[1], corners[2], corners[3]);
		}
	}
	for (const span of highway.spans) {
		if (span.kind === "bridge") buildBridge(highway, span, set);
		else buildTunnel(highway, span, set);
	}
	if (highway.endPlaza) buildPlaza(highway, set);
	appendMesh(set.collision, set.embankment);
	return set;
}

function appendMesh(target: MeshData, source: MeshData): void {
	const offsetIndex = target.positions.length / 3;
	for (const value of source.positions) target.positions.push(value);
	for (const value of source.normals) target.normals.push(value);
	for (const value of source.uvs) target.uvs.push(value);
	for (const index of source.indices) target.indices.push(index + offsetIndex);
}

function buildBridge(highway: Highway, span: HighwaySpan, set: HighwayMeshSet): void {
	const deck = samplesIn(highway, span.from, span.to);
	const halfWidth = G.halfWidth + 0.3;
	const inDeck = () => true;
	// Deck slab: two sides and the underside.
	sweep(set.concrete, deck, [[-halfWidth, 0], [-halfWidth, -DECK_DEPTH], [halfWidth, -DECK_DEPTH], [halfWidth, 0]], inDeck);

	const pier = (distance: number, twin: boolean) => {
		const s = sampleAt(highway, distance);
		const bottomDeck = s.y - DECK_DEPTH;
		const columns = twin ? [-halfWidth * 0.55, halfWidth * 0.55] : [0];
		for (const lateral of columns) {
			const [x, z] = offset(s, lateral);
			const ground = groundBelow(x, z) - 0.5;
			if (bottomDeck - ground < 0.5) continue;
			prism(set.concrete, x, z, 1.1, 1.1, s.dirX, s.dirZ, ground, bottomDeck, 10);
			prism(set.collision, x, z, 1.1, 1.1, s.dirX, s.dirZ, ground, bottomDeck, 6);
		}
		// Pier cap under the deck.
		const [cx, cz] = offset(s, 0);
		prism(set.concrete, cx, cz, 1.4, halfWidth * 0.8, s.dirX, s.dirZ, bottomDeck - 1.2, bottomDeck, 4);
	};

	if (span.style === "cable-stayed") {
		const length = span.to - span.from;
		const towers = [span.from + length * 0.3, span.from + length * 0.7];
		for (const at of towers) {
			const s = sampleAt(highway, at);
			const [lx, lz] = left(s);
			const base = SEABED_Y;
			const top = s.y + PYLON_HEIGHT;
			const legs: [number, number][] = [];
			for (const sign of [-1, 1]) {
				const lateral = sign * (halfWidth + 1.6);
				const [x, z] = offset(s, lateral);
				legs.push([x, z]);
				// Legs lean in slightly towards the top, like an H pylon's.
				prism(set.concrete, x, z, 1.6, 1.3, s.dirX, s.dirZ, base, top, 4);
				prism(set.collision, x, z, 1.6, 1.3, s.dirX, s.dirZ, base, top, 4);
				// Stay cables fan out both ways to anchors along the deck edge.
				for (const direction of [-1, 1]) {
					for (let k = 0; k < CABLES_PER_FAN; k++) {
						const along = direction * (14 + k * 10);
						const anchor = sampleAt(highway, Math.max(span.from, Math.min(span.to, at + along)));
						const [ax, az] = offset(anchor, sign * (halfWidth - 0.1));
						const height = top - 3 - k * 2.2;
						cable(set.cables, [x - lx * sign * 0.2, height, z - lz * sign * 0.2], [ax, anchor.y + 1.1, az], 0.28);
					}
				}
			}
			// Cross beams: under the deck and near the top.
			for (const y of [s.y - DECK_DEPTH - 0.8, top - 7]) {
				const [cx, cz] = offset(s, 0);
				prism(set.concrete, cx, cz, 1.2, halfWidth + 1.6, s.dirX, s.dirZ, y - 1.4, y, 4);
			}
		}
		// Approach piers either side of the towers, clear of the main span.
		for (let d = span.from + 18; d < towers[0] - 25; d += 34) pier(d, true);
		for (let d = span.to - 18; d > towers[1] + 25; d -= 34) pier(d, true);
	} else {
		for (let d = span.from + VIADUCT_PIER_SPACING / 2; d < span.to - 5; d += VIADUCT_PIER_SPACING) pier(d, true);
	}
}

/** Tunnel half-width to the lining's walls. */
const TUNNEL_HALF = G.halfWidth + 0.6;

function buildTunnel(highway: Highway, span: HighwaySpan, set: HighwayMeshSet): void {
	const bore = samplesIn(highway, span.from, span.to);
	// The lining's section, left wall → arch → right wall, facing inwards.
	const profile: [number, number][] = [];
	profile.push([TUNNEL_HALF, -0.2]);
	const steps = 16;
	for (let k = 0; k <= steps; k++) {
		const v = TUNNEL_HALF - (k / steps) * TUNNEL_HALF * 2;
		const top = tunnelOpeningTop(0, v * 0.99999) ?? G.tunnelWallHeight;
		profile.push([v, top]);
	}
	profile.push([-TUNNEL_HALF, -0.2]);
	// sweep() lights the faces on their right; this order puts that on the inside.
	const inward = [...profile].reverse();
	sweep(set.tunnelLining, bore, inward, () => true);
	// The walls are solid, and so is the roof (a camera or a thrown body stays inside).
	sweep(set.collision, bore, inward, () => true);
	// Kerbs with a walkway along the walls.
	for (const sign of [-1, 1]) {
		const inner = sign * (G.halfWidth - 0.4);
		const outer = sign * TUNNEL_HALF;
		const kerb: [number, number][] = sign > 0 ? [[outer, 0.3], [inner, 0.3], [inner, 0]] : [[inner, 0], [inner, 0.3], [outer, 0.3]];
		sweep(set.concrete, bore, kerb, () => true);
	}
	// Two rows of light strips along the crown.
	const crown = G.tunnelWallHeight + G.tunnelArchRise - 0.08;
	for (const lateral of [-3.2, 3.2]) {
		for (let i = 1; i < bore.length; i++) {
			const a = bore[i - 1];
			const b = bore[i];
			if (Math.floor(a.distance / 4) % 2 !== 0) continue;
			const corners = [[a, lateral - 0.25], [b, lateral - 0.25], [b, lateral + 0.25], [a, lateral + 0.25]].map(([sample, lat]) => {
				const s = sample as HighwaySample;
				const [x, z] = offset(s, lat as number);
				return addVertex(set.tunnelLights, x, s.y + crown - Math.abs(lateral) * 0.05, z, 0, -1, 0, 0, 0);
			});
			// Facing down.
			addQuad(set.tunnelLights, corners[0], corners[1], corners[2], corners[3]);
		}
	}
}

function buildPlaza(highway: Highway, set: HighwayMeshSet): void {
	const end = highway.samples[highway.samples.length - 1];
	const radius = G.plazaRadius;
	const segments = 40;
	const centre = addVertex(set.road, end.x, end.y, end.z, 0, 1, 0, end.x / 8, end.z / 8);
	const collisionCentre = addVertex(set.collision, end.x, end.y, end.z, 0, 1, 0, 0, 0);
	const ring: number[] = [];
	const collisionRing: number[] = [];
	for (let k = 0; k <= segments; k++) {
		const angle = (k / segments) * Math.PI * 2;
		const x = end.x + Math.cos(angle) * radius;
		const z = end.z + Math.sin(angle) * radius;
		ring.push(addVertex(set.road, x, end.y, z, 0, 1, 0, x / 8, z / 8));
		collisionRing.push(addVertex(set.collision, x, end.y, z, 0, 1, 0, 0, 0));
	}
	for (let k = 0; k < segments; k++) {
		set.road.indices.push(centre, ring[k + 1], ring[k]);
		set.collision.indices.push(collisionCentre, collisionRing[k + 1], collisionRing[k]);
	}
	// A parapet round the lookout, open where the road comes in.
	const back = Math.atan2(-end.dirZ, -end.dirX);
	const gap = Math.asin(Math.min(1, (G.halfWidth + 1) / radius));
	for (let k = 0; k < segments; k++) {
		const a0 = (k / segments) * Math.PI * 2;
		const a1 = ((k + 1) / segments) * Math.PI * 2;
		const mid = (a0 + a1) / 2;
		const off = Math.abs(Math.atan2(Math.sin(mid - back), Math.cos(mid - back)));
		if (off < gap) continue;
		for (const [target, height] of [[set.concrete, BARRIER_HEIGHT + 0.1], [set.collision, BARRIER_COLLIDER_HEIGHT]] as [MeshData, number][]) {
			const p = (angle: number, r: number, y: number) => {
				const nx = Math.cos(angle);
				const nz = Math.sin(angle);
				return addVertex(target, end.x + nx * r, end.y + y, end.z + nz * r, -nx, 0, -nz, angle, y);
			};
			const i0 = p(a0, radius - 0.3, -0.05);
			const i1 = p(a1, radius - 0.3, -0.05);
			const i2 = p(a1, radius - 0.3, height);
			const i3 = p(a0, radius - 0.3, height);
			addQuad(target, i0, i3, i2, i1);
			addQuad(target, i0, i1, i2, i3);
		}
	}
	// And an embankment skirt round it.
	for (let k = 0; k < segments; k++) {
		const a0 = (k / segments) * Math.PI * 2;
		const a1 = ((k + 1) / segments) * Math.PI * 2;
		const drop = Math.max(0.02, end.y - LAND_Y);
		const outer = radius + drop / EMBANKMENT_SLOPE;
		const corners = [[a0, radius, end.y], [a1, radius, end.y], [a1, outer, LAND_Y - 0.02], [a0, outer, LAND_Y - 0.02]].map(([angle, r, y]) => {
			const nx = Math.cos(angle);
			const nz = Math.sin(angle);
			return addVertex(set.embankment, end.x + nx * r, y, end.z + nz * r, nx * 0.55, 0.83, nz * 0.55, (end.x + nx * r) / 22, (end.z + nz * r) / 22);
		});
		addQuad(set.embankment, corners[0], corners[1], corners[2], corners[3]);
	}
}
