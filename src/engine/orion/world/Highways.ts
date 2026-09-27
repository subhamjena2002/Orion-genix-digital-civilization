import { ROAD_TOP_Y } from "../traffic/TrafficSignals";

/**
 * The expressways that leave the city: where they run, how high, and which stretches are
 * bridges or tunnels. Pure geometry — the meshes (HighwayMeshes), the terrain they cut through
 * (Mountains) and the map all read it from here, so they always agree.
 *
 * A route is a list of control points joined by straights and large-radius curves, sampled
 * every few metres. Heights are given per control point as the rise above the city's road
 * surface and eased between them, so gradients change smoothly (vertical curves) rather than
 * kinking at each point.
 */

export interface HighwayPoint {
	x: number;
	z: number;
	/** Height of the road surface above the city's roads, in metres. */
	rise: number;
}

export type HighwaySpanKind = "bridge" | "tunnel";
export type BridgeStyle = "cable-stayed" | "viaduct";

export interface HighwaySpanDef {
	kind: HighwaySpanKind;
	/** Where the span starts and ends, as points on (or next to) the route. */
	from: readonly [number, number];
	to: readonly [number, number];
	style?: BridgeStyle;
}

export interface HighwayDef {
	id: string;
	name: string;
	points: readonly HighwayPoint[];
	/** Curve radius at the corners, in metres. */
	cornerRadius: number;
	spans: readonly HighwaySpanDef[];
	/** A turning circle at the far end (the route is a spur, not a through road). */
	endPlaza: boolean;
}

export interface HighwaySample {
	x: number;
	/** Absolute height of the road surface. */
	y: number;
	z: number;
	/** Unit direction of travel (away from the city). */
	dirX: number;
	dirZ: number;
	/** Distance along the route from its start. */
	distance: number;
}

export interface HighwaySpan {
	kind: HighwaySpanKind;
	style: BridgeStyle;
	/** Distances along the route. */
	from: number;
	to: number;
}

export interface Highway {
	id: string;
	name: string;
	samples: readonly HighwaySample[];
	length: number;
	spans: readonly HighwaySpan[];
	endPlaza: boolean;
}

/** Cross-section: two lanes each way either side of a median barrier, with hard shoulders. */
export const HIGHWAY_GEOMETRY = {
	laneWidth: 3.6,
	lanesEachWay: 2,
	/** Median, barrier included. */
	median: 1.2,
	shoulder: 1.6,
	/** Road surface to the edge of the deck/embankment top. */
	get halfWidth(): number {
		return this.median / 2 + this.lanesEachWay * this.laneWidth + this.shoulder;
	},
	sampleSpacing: 4,
	/** Road to the top of the tunnel's side walls, where the arch begins. */
	tunnelWallHeight: 5,
	/** The arch's rise above the walls. */
	tunnelArchRise: 3.5,
	/** Rock over the tunnel crown, at least. */
	tunnelCover: 4,
	/** Radius of the turning circle at a spur's end, to the kerb. */
	plazaRadius: 18,
} as const;

/** The city's road surface: every route starts level with it. */
export const HIGHWAY_BASE_Y = ROAD_TOP_Y;

/**
 * Ghats Expressway: west out of the main arterial, through the Ghat ridge in a tunnel, then
 * climbing onto a viaduct along the valley to a lookout on the north-west cape.
 *
 * Sea Link: east from the city's second street across the strait to Tara Isle on a
 * cable-stayed bridge, cresting mid-span for the shipping channel.
 */
export const HIGHWAY_DEFS: readonly HighwayDef[] = [
	{
		id: "ghats-expressway",
		name: "Ghats Expressway",
		cornerRadius: 140,
		endPlaza: true,
		points: [
			{ x: -396, z: 0, rise: 0 },
			{ x: -440, z: 0, rise: 0 },
			{ x: -500, z: -25, rise: 0 },
			{ x: -690, z: -190, rise: 0 },
			{ x: -735, z: -265, rise: 5 },
			{ x: -768, z: -340, rise: 10 },
			{ x: -800, z: -410, rise: 11 },
		],
		spans: [
			{ kind: "tunnel", from: [-527, -52], to: [-671, -171] },
			{ kind: "bridge", style: "viaduct", from: [-724, -250], to: [-778, -362] },
		],
	},
	{
		id: "sea-link",
		name: "Sea Link",
		cornerRadius: 220,
		endPlaza: true,
		points: [
			{ x: 396, z: -160, rise: 0 },
			{ x: 470, z: -160, rise: 0 },
			{ x: 560, z: -172, rise: 3 },
			{ x: 640, z: -212, rise: 5.5 },
			{ x: 775, z: -286, rise: 9 },
			{ x: 916, z: -362, rise: 5.5 },
			{ x: 965, z: -382, rise: 3 },
		],
		spans: [
			{ kind: "bridge", style: "cable-stayed", from: [632, -208], to: [920, -364] },
		],
	},
];

/** Sharp corners replaced by circular arcs, sampled as a dense 2D polyline. */
function filletedPath(points: readonly HighwayPoint[], radius: number, spacing: number): [number, number][] {
	const out: [number, number][] = [[points[0].x, points[0].z]];
	for (let i = 1; i < points.length - 1; i++) {
		const prev = points[i - 1];
		const corner = points[i];
		const next = points[i + 1];
		const inX = corner.x - prev.x;
		const inZ = corner.z - prev.z;
		const outX = next.x - corner.x;
		const outZ = next.z - corner.z;
		const inLength = Math.hypot(inX, inZ);
		const outLength = Math.hypot(outX, outZ);
		const ax = inX / inLength;
		const az = inZ / inLength;
		const bx = outX / outLength;
		const bz = outZ / outLength;
		const turn = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
		if (turn < 1e-3) {
			out.push([corner.x, corner.z]);
			continue;
		}
		// Tangent length for the requested radius, capped so neighbouring curves never overlap.
		const tangent = Math.min(radius * Math.tan(turn / 2), 0.45 * inLength, 0.45 * outLength);
		const r = tangent / Math.tan(turn / 2);
		const startX = corner.x - ax * tangent;
		const startZ = corner.z - az * tangent;
		// Left of travel is (-az, ax); the centre is on the side the road turns towards.
		const side = ax * bz - az * bx > 0 ? 1 : -1;
		const centreX = startX - az * r * side;
		const centreZ = startZ + ax * r * side;
		const startAngle = Math.atan2(startZ - centreZ, startX - centreX);
		const steps = Math.max(2, Math.ceil((r * turn) / spacing));
		for (let step = 0; step <= steps; step++) {
			const angle = startAngle + side * turn * (step / steps);
			out.push([centreX + Math.cos(angle) * r, centreZ + Math.sin(angle) * r]);
		}
	}
	const last = points[points.length - 1];
	out.push([last.x, last.z]);
	return out;
}

/** The polyline resampled at an even spacing, with the distance along it. */
function resample(path: readonly [number, number][], spacing: number): { x: number; z: number; distance: number }[] {
	const out = [{ x: path[0][0], z: path[0][1], distance: 0 }];
	let travelled = 0;
	let nextAt = spacing;
	for (let i = 1; i < path.length; i++) {
		const [x0, z0] = path[i - 1];
		const [x1, z1] = path[i];
		const length = Math.hypot(x1 - x0, z1 - z0);
		if (length < 1e-6) continue;
		while (nextAt <= travelled + length) {
			const t = (nextAt - travelled) / length;
			out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, distance: nextAt });
			nextAt += spacing;
		}
		travelled += length;
	}
	const [endX, endZ] = path[path.length - 1];
	if (travelled - out[out.length - 1].distance > spacing * 0.25) out.push({ x: endX, z: endZ, distance: travelled });
	else Object.assign(out[out.length - 1], { x: endX, z: endZ, distance: travelled });
	return out;
}

function nearestDistance(samples: readonly { x: number; z: number; distance: number }[], x: number, z: number): number {
	let best = Infinity;
	let distance = 0;
	for (const sample of samples) {
		const d = (sample.x - x) ** 2 + (sample.z - z) ** 2;
		if (d < best) {
			best = d;
			distance = sample.distance;
		}
	}
	return distance;
}

/** Half-length of the rounding at each change of grade, metres. */
const VERTICAL_CURVE = 24;

export function buildHighway(def: HighwayDef): Highway {
	const spacing = HIGHWAY_GEOMETRY.sampleSpacing;
	const flat = resample(filletedPath(def.points, def.cornerRadius, spacing / 2), spacing);
	// Each control point's height applies where the route passes closest to it.
	const stations = def.points.map((point, index) => ({
		at: index === 0 ? 0 : index === def.points.length - 1 ? flat[flat.length - 1].distance : nearestDistance(flat, point.x, point.z),
		rise: point.rise,
	}));
	// Straight grades between control points, then the changes of grade rounded off into
	// vertical curves (a moving average), so the steepest stretch is no steeper than its average.
	const linearRise = (distance: number): number => {
		for (let i = 1; i < stations.length; i++) {
			const a = stations[i - 1];
			const b = stations[i];
			if (distance <= b.at || i === stations.length - 1) {
				const t = b.at > a.at ? Math.max(0, Math.min(1, (distance - a.at) / (b.at - a.at))) : 1;
				return a.rise + (b.rise - a.rise) * t;
			}
		}
		return stations[stations.length - 1].rise;
	};
	let rises = flat.map((sample) => linearRise(sample.distance));
	const window = Math.round(VERTICAL_CURVE / spacing);
	for (let pass = 0; pass < 2; pass++) {
		rises = rises.map((_, index) => {
			let sum = 0;
			let count = 0;
			for (let k = -window; k <= window; k++) {
				sum += rises[Math.max(0, Math.min(rises.length - 1, index + k))];
				count++;
			}
			return sum / count;
		});
	}
	// Both ends stay exactly at their heights (the start meets the city's road).
	rises[0] = stations[0].rise;
	const samples: HighwaySample[] = flat.map((sample, index) => {
		const before = flat[Math.max(0, index - 1)];
		const after = flat[Math.min(flat.length - 1, index + 1)];
		const dx = after.x - before.x;
		const dz = after.z - before.z;
		const length = Math.hypot(dx, dz) || 1;
		return { x: sample.x, z: sample.z, y: HIGHWAY_BASE_Y + rises[index], dirX: dx / length, dirZ: dz / length, distance: sample.distance };
	});
	const spans = def.spans.map((span): HighwaySpan => {
		const a = nearestDistance(flat, span.from[0], span.from[1]);
		const b = nearestDistance(flat, span.to[0], span.to[1]);
		return { kind: span.kind, style: span.style ?? "viaduct", from: Math.min(a, b), to: Math.max(a, b) };
	});
	return { id: def.id, name: def.name, samples, length: samples[samples.length - 1].distance, spans, endPlaza: def.endPlaza };
}

export const HIGHWAYS: readonly Highway[] = HIGHWAY_DEFS.map(buildHighway);

export function spanAt(highway: Highway, distance: number): HighwaySpan | null {
	return highway.spans.find((span) => distance >= span.from && distance <= span.to) ?? null;
}

export interface HighwayProjection {
	highway: Highway;
	/** Distance along the route of the closest point. */
	distance: number;
	/** Signed distance to the side (positive to the left of travel). */
	lateral: number;
	/** Road surface height at the closest point. */
	y: number;
	/** Past either end of the route (the closest point is an end). */
	beyondEnds: boolean;
}

/** The closest point on a route to (x, z). */
export function projectOnto(highway: Highway, x: number, z: number): HighwayProjection {
	const samples = highway.samples;
	let best: HighwayProjection | null = null;
	let bestSquared = Infinity;
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1];
		const b = samples[i];
		const segX = b.x - a.x;
		const segZ = b.z - a.z;
		const lengthSquared = segX * segX + segZ * segZ || 1;
		const raw = ((x - a.x) * segX + (z - a.z) * segZ) / lengthSquared;
		const t = Math.max(0, Math.min(1, raw));
		const px = a.x + segX * t;
		const pz = a.z + segZ * t;
		const squared = (x - px) ** 2 + (z - pz) ** 2;
		if (squared >= bestSquared) continue;
		bestSquared = squared;
		const length = Math.sqrt(lengthSquared);
		// Left of travel is (-dirZ, dirX).
		const lateral = ((x - a.x) * -segZ + (z - a.z) * segX) / length;
		best = {
			highway,
			distance: a.distance + (b.distance - a.distance) * t,
			lateral,
			y: a.y + (b.y - a.y) * t,
			beyondEnds: (i === 1 && raw < 0) || (i === samples.length - 1 && raw > 1),
		};
	}
	return best!;
}

/** Road surface height of whichever route passes over (x, z), or null off every route. */
export function highwaySurfaceAt(x: number, z: number): number | null {
	for (const highway of HIGHWAYS) {
		const hit = projectOnto(highway, x, z);
		if (hit.beyondEnds) continue;
		if (Math.abs(hit.lateral) <= HIGHWAY_GEOMETRY.halfWidth) return hit.y;
	}
	return null;
}
