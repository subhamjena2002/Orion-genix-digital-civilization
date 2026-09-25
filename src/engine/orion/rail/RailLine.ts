import { ORION_ROAD_SEGMENTS } from "../roads/RoadNetwork";

/**
 * The city's rail loop: a closed circuit the train runs round without ever reversing.
 *
 * One source of truth for the route — the track laid in the world, the train on it, the level
 * crossings and their barriers, the buildings cleared to make room, and the line on the map all
 * read it from here.
 *
 * It runs through the built-up area rather than round the outside, on the mid-block corridors
 * between the road grid lines, so it is part of the city the player drives in. The corners are
 * curved, not mitred: a carriage is 22 m long and has to stay on the rails through them.
 */

export interface RailPoint {
	x: number;
	z: number;
}

/**
 * The corners, in the order the train travels. The last leg closes back to the first corner.
 * These sit 40 m off the road grid (which is on multiples of 80), i.e. down the middle of a
 * block, so the line never runs along a carriageway.
 */
export const RAIL_CORNERS: readonly RailPoint[] = [
	{ x: 200, z: -120 },
	{ x: 200, z: 120 },
	{ x: -200, z: 120 },
	{ x: -200, z: -120 },
];

/**
 * Curve radius at each corner. Tight for a railway, but it has to turn inside a city block —
 * and it has to leave the straights long enough to still meet every road they cross.
 */
export const RAIL_CORNER_RADIUS = 25;
/** Distance between the two rails (standard gauge) and the width of the track bed. */
export const RAIL_GAUGE = 1.435;
export const RAIL_BED_WIDTH = 5;
/** Top of the rails: on the ground, low enough to drive a car over at a crossing. */
export const RAIL_TOP_Y = -0.5;
/** Nothing may be built within this of the centreline — buildings inside it are cleared. */
export const RAIL_CLEARANCE = 7;

interface RailSegmentBase {
	length: number;
	/** Distance from the start of the loop to the beginning of this segment. */
	startsAt: number;
}

export interface RailStraight extends RailSegmentBase {
	kind: "straight";
	from: RailPoint;
	to: RailPoint;
	/** Unit direction along the segment. */
	dx: number;
	dz: number;
}

export interface RailArc extends RailSegmentBase {
	kind: "arc";
	centreX: number;
	centreZ: number;
	radius: number;
	/** Angle of the arc's first point about its centre, as atan2(z - centreZ, x - centreX). */
	startAngle: number;
	/** +1 if that angle grows along the direction of travel, -1 if it shrinks. */
	direction: 1 | -1;
}

export type RailSegment = RailStraight | RailArc;

function headingOf(dx: number, dz: number): number {
	return Math.atan2(dx, dz) * (180 / Math.PI);
}

/**
 * Lays straights between the corners and an arc through each of them, in travel order.
 *
 * Each corner eats `tangent` metres off both of its legs and replaces them with the arc, so the
 * track stays continuous: every segment starts exactly where the last one ended, pointing the
 * same way.
 */
function buildSegments(corners: readonly RailPoint[], radius: number): RailSegment[] {
	const count = corners.length;
	const directions = corners.map((corner, index) => {
		const next = corners[(index + 1) % count];
		const length = Math.hypot(next.x - corner.x, next.z - corner.z);
		return { dx: (next.x - corner.x) / length, dz: (next.z - corner.z) / length };
	});

	// Where each corner's arc begins and ends, and which way it curves.
	const arcs = corners.map((corner, index) => {
		const into = directions[(index - 1 + count) % count];
		const out = directions[index];
		const turn = Math.acos(Math.max(-1, Math.min(1, into.dx * out.dx + into.dz * out.dz)));
		const tangent = radius * Math.tan(turn / 2);
		const startX = corner.x - into.dx * tangent;
		const startZ = corner.z - into.dz * tangent;
		// The centre is square to the incoming direction, on the side the track turns towards.
		const direction: 1 | -1 = into.dx * out.dz - into.dz * out.dx >= 0 ? 1 : -1;
		const centreX = startX + (direction > 0 ? -into.dz : into.dz) * radius;
		const centreZ = startZ + (direction > 0 ? into.dx : -into.dx) * radius;
		return {
			centreX,
			centreZ,
			radius,
			startAngle: Math.atan2(startZ - centreZ, startX - centreX),
			direction,
			length: radius * turn,
			start: { x: startX, z: startZ },
			end: { x: corner.x + out.dx * tangent, z: corner.z + out.dz * tangent },
		};
	});

	const segments: RailSegment[] = [];
	let travelled = 0;
	// Distance 0 is where the first corner's arc lets go of the track, heading down leg 0.
	for (let i = 0; i < count; i++) {
		const from = arcs[i].end;
		const arc = arcs[(i + 1) % count];
		const length = Math.hypot(arc.start.x - from.x, arc.start.z - from.z);
		if (length > 1e-6) {
			segments.push({ kind: "straight", from, to: arc.start, dx: directions[i].dx, dz: directions[i].dz, length, startsAt: travelled });
			travelled += length;
		}
		if (arc.length > 1e-6) {
			segments.push({
				kind: "arc",
				centreX: arc.centreX,
				centreZ: arc.centreZ,
				radius: arc.radius,
				startAngle: arc.startAngle,
				direction: arc.direction,
				length: arc.length,
				startsAt: travelled,
			});
			travelled += arc.length;
		}
	}
	return segments;
}

export const RAIL_SEGMENTS: readonly RailSegment[] = buildSegments(RAIL_CORNERS, RAIL_CORNER_RADIUS);
/** The straight runs. Level crossings are found along these; the corners sit mid-block. */
export const RAIL_STRAIGHTS: readonly RailStraight[] = RAIL_SEGMENTS.filter((segment): segment is RailStraight => segment.kind === "straight");
/** Once round. The train's distance wraps at this, so it runs for ever. */
export const RAIL_LENGTH = RAIL_SEGMENTS.reduce((total, segment) => total + segment.length, 0);

export interface RailPose {
	x: number;
	z: number;
	/** Heading in degrees about Y, 0 = +Z, the same convention the vehicles use. */
	heading: number;
}

/** Wraps a distance into one lap of the loop. */
export function railWrap(distance: number): number {
	const wrapped = distance % RAIL_LENGTH;
	return wrapped < 0 ? wrapped + RAIL_LENGTH : wrapped;
}

function segmentAt(along: number): RailSegment {
	let segment = RAIL_SEGMENTS[0];
	for (const candidate of RAIL_SEGMENTS) {
		if (along >= candidate.startsAt) segment = candidate;
	}
	return segment;
}

/** Where a point `distance` round the loop is, and which way the track points there. */
export function railPoseAt(distance: number): RailPose {
	const along = railWrap(distance);
	const segment = segmentAt(along);
	const travelled = along - segment.startsAt;
	if (segment.kind === "straight") {
		return {
			x: segment.from.x + segment.dx * travelled,
			z: segment.from.z + segment.dz * travelled,
			heading: headingOf(segment.dx, segment.dz),
		};
	}
	const angle = segment.startAngle + segment.direction * (travelled / segment.radius);
	return {
		x: segment.centreX + Math.cos(angle) * segment.radius,
		z: segment.centreZ + Math.sin(angle) * segment.radius,
		heading: headingOf(-segment.direction * Math.sin(angle), segment.direction * Math.cos(angle)),
	};
}

/** How far `to` is ahead of `from` in the direction of travel (always 0..RAIL_LENGTH). */
export function railAhead(from: number, to: number): number {
	return railWrap(to - from);
}

/** The loop as a list of points, for drawing it as one line (the map). */
export function railPolyline(step = 8): RailPoint[] {
	const points: RailPoint[] = [];
	for (let along = 0; along < RAIL_LENGTH; along += step) {
		const pose = railPoseAt(along);
		points.push({ x: pose.x, z: pose.z });
	}
	points.push(points[0]);
	return points;
}

export interface LevelCrossing {
	id: string;
	/** Where the road centreline meets the track centreline. */
	x: number;
	z: number;
	roadId: string;
	roadWidth: number;
	/** Heading of the track through the crossing (degrees about Y). */
	heading: number;
	/** How far round the loop the crossing sits. */
	distance: number;
}

/**
 * Where the loop meets a road, worked out by intersecting the two rather than listed by hand, so
 * moving either keeps the crossings in the right places. Only the straights are considered: the
 * corner arcs sit in the middle of a block, clear of the grid.
 */
function findCrossings(): LevelCrossing[] {
	const crossings: LevelCrossing[] = [];
	RAIL_STRAIGHTS.forEach((leg, legIndex) => {
		const railAlongX = Math.abs(leg.dx) > Math.abs(leg.dz);
		for (const road of ORION_ROAD_SEGMENTS) {
			const roadAlongX = road.start[0] !== road.end[0];
			// Only a road running across the track makes a crossing; one alongside it doesn't.
			if (roadAlongX === railAlongX) continue;
			const x = railAlongX ? road.start[0] : leg.from.x;
			const z = railAlongX ? leg.from.z : road.start[2];
			const withinRail = railAlongX
				? x >= Math.min(leg.from.x, leg.to.x) && x <= Math.max(leg.from.x, leg.to.x)
				: z >= Math.min(leg.from.z, leg.to.z) && z <= Math.max(leg.from.z, leg.to.z);
			const withinRoad = roadAlongX
				? x >= Math.min(road.start[0], road.end[0]) && x <= Math.max(road.start[0], road.end[0])
				: z >= Math.min(road.start[2], road.end[2]) && z <= Math.max(road.start[2], road.end[2]);
			if (!withinRail || !withinRoad) continue;
			crossings.push({
				// A road crosses both the east and the west leg, so the leg is part of the name.
				id: `crossing-${road.id}-leg${legIndex}`,
				x, z,
				roadId: road.id,
				roadWidth: road.width,
				heading: headingOf(leg.dx, leg.dz),
				distance: leg.startsAt + Math.hypot(x - leg.from.x, z - leg.from.z),
			});
		}
	});
	return crossings.sort((a, b) => a.distance - b.distance);
}

export const RAIL_CROSSINGS: readonly LevelCrossing[] = findCrossings();

/** How far a point is from the track centreline, ignoring height. */
export function distanceFromRail(x: number, z: number): number {
	let nearest = Infinity;
	for (const segment of RAIL_SEGMENTS) {
		const distance = segment.kind === "straight" ? distanceFromStraight(segment, x, z) : distanceFromArc(segment, x, z);
		nearest = Math.min(nearest, distance);
	}
	return nearest;
}

function distanceFromStraight(leg: RailStraight, x: number, z: number): number {
	const toPointX = x - leg.from.x;
	const toPointZ = z - leg.from.z;
	const along = Math.max(0, Math.min(leg.length, toPointX * leg.dx + toPointZ * leg.dz));
	return Math.hypot(toPointX - leg.dx * along, toPointZ - leg.dz * along);
}

function distanceFromArc(arc: RailArc, x: number, z: number): number {
	const offX = x - arc.centreX;
	const offZ = z - arc.centreZ;
	const sweep = arc.length / arc.radius;
	// How far round the arc the point lies. Past the end of the sweep it is nearest to an end
	// of the arc instead, not to the circle it was cut from.
	const turned = arc.direction * (Math.atan2(offZ, offX) - arc.startAngle);
	const wrapped = ((turned % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
	if (wrapped <= sweep) return Math.abs(Math.hypot(offX, offZ) - arc.radius);
	const start = railPoseAt(arc.startsAt);
	const end = railPoseAt(arc.startsAt + arc.length);
	return Math.min(Math.hypot(x - start.x, z - start.z), Math.hypot(x - end.x, z - end.z));
}

/**
 * Whether a footprint of this size at (x, z) stands on the line. Buildings that do are left out
 * of the city rather than having a train run through them.
 */
export function railBlocks(x: number, z: number, width: number, depth: number): boolean {
	return distanceFromRail(x, z) < RAIL_CLEARANCE + Math.max(width, depth) / 2;
}
