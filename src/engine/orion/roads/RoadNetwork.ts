import type { Vector3Tuple } from "../properties/Properties";
import { ORION_DISTRICTS } from "../world/WorldModel";

export type RoadType = "primary-arterial" | "secondary" | "local" | "alley" | "service" | "industrial" | "bridge" | "ramp" | "overpass" | "underpass" | "pedestrian-path" | "promenade";

export interface RoadSegment {
	id: string;
	type: RoadType;
	start: Vector3Tuple;
	end: Vector3Tuple;
	width: number;
	lanes: number;
	speedClass: "slow" | "urban" | "arterial" | "freight";
	districtId: string;
	connections: readonly string[];
	visible: boolean;
}

export interface IntersectionDefinition {
	id: string;
	type: "four-way" | "t" | "roundabout" | "merge";
	position: Vector3Tuple;
	connectedRoadIds: readonly string[];
}

/**
 * A single continuous city grid rather than per-district fragments.
 *
 * District centres sit on a regular 160-unit lattice, and each district's parcels reach
 * +/-59 from its centre. That leaves two clear corridors per axis — the district centreline
 * and the boundary halfway between centres — which lands on a uniform 80-unit spacing.
 * Every road therefore spans the full width (or height) of the city and crosses every
 * perpendicular road, so the network is genuinely interconnected: you can drive from any
 * point to any other without leaving the carriageway.
 */
/** Shared road geometry — the scene renders from these, pedestrians walk on them. */
export const ROAD_GEOMETRY = {
	/** Surface sits just proud of the terrain plane (y = -0.65) so it reads as laid, not stacked. */
	surfaceY: -0.63,
	thickness: 0.12,
	/** Separates the two grid axes vertically so crossings don't z-fight. */
	axisEpsilon: 0.008,
	/** 2.0 is the widest pavement that clears every building on the grid — 2.2 starts clipping. */
	pavementWidth: 2,
	/** Pavements sit a fraction above the asphalt — a kerb you can see but not trip over. */
	pavementLift: 0.03,
} as const;

/** Walkable surface height, i.e. the top of the pavement. */
export const PAVEMENT_TOP_Y = ROAD_GEOMETRY.surfaceY + ROAD_GEOMETRY.thickness / 2 + ROAD_GEOMETRY.pavementLift;

export const ROAD_GRID_SPACING = 80;
export const CITY_EXTENT_X = 400;
export const CITY_EXTENT_Z = 240;
/** Arterials sit on the district centrelines; the roads between them are secondary. */
const ARTERIAL_SPACING = 160;

function buildGridLines(limit: number): number[] {
	const lines: number[] = [];
	for (let value = -limit; value <= limit; value += ROAD_GRID_SPACING) lines.push(value);
	return lines;
}

const verticalLines = buildGridLines(CITY_EXTENT_X);
const horizontalLines = buildGridLines(CITY_EXTENT_Z);

function laneProfile(offset: number) {
	const arterial = offset % ARTERIAL_SPACING === 0;
	return {
		type: (arterial ? "primary-arterial" : "secondary") as RoadType,
		width: arterial ? 14 : 10,
		lanes: arterial ? 4 : 2,
		speedClass: (arterial ? "arterial" : "urban") as RoadSegment["speedClass"],
	};
}

function districtAt(x: number, z: number): string {
	const match = ORION_DISTRICTS.find((district) => (
		Math.abs(district.bounds.center[0] - x) <= ROAD_GRID_SPACING
		&& Math.abs(district.bounds.center[2] - z) <= ROAD_GRID_SPACING
	));
	return match?.id ?? "orion-city";
}

const cityRoads: readonly RoadSegment[] = [
	...verticalLines.map((x): RoadSegment => ({
		id: `road-ns-${x}`,
		...laneProfile(x),
		start: [x, 0, -CITY_EXTENT_Z],
		end: [x, 0, CITY_EXTENT_Z],
		districtId: districtAt(x, 0),
		connections: horizontalLines.map((z) => `road-ew-${z}`),
		visible: true,
	})),
	...horizontalLines.map((z): RoadSegment => ({
		id: `road-ew-${z}`,
		...laneProfile(z),
		start: [-CITY_EXTENT_X, 0, z],
		end: [CITY_EXTENT_X, 0, z],
		districtId: districtAt(0, z),
		connections: verticalLines.map((x) => `road-ns-${x}`),
		visible: true,
	})),
];

export const ORION_ROAD_SEGMENTS: readonly RoadSegment[] = cityRoads;

/** The junction lattice, exposed so pedestrians can navigate the network as a graph. */
export const ROAD_GRID = {
	xs: verticalLines,
	zs: horizontalLines,
} as const;

export function roadWidthAt(offset: number): number {
	return laneProfile(offset).width;
}

/**
 * Top of the paved surface at (x, z) — carriageway or pavement, matching the road visuals
 * (east–west roads sit a hair higher, and pavements run straight through junctions) — or null
 * off the road network.
 *
 * Needed because the road colliders don't follow the visual boxes (a primitive collider
 * ignores its entity's scale), so a physics probe finds the terrain beneath the asphalt.
 */
export function pavedHeightAt(x: number, z: number): number | null {
	const roadTop = ROAD_GEOMETRY.surfaceY + ROAD_GEOMETRY.thickness / 2;
	const pavement = ROAD_GEOMETRY.pavementWidth;
	let height: number | null = null;
	const check = (across: number, along: number, lines: readonly number[], extent: number, lift: number) => {
		if (Math.abs(along) > extent) return;
		for (const line of lines) {
			const half = roadWidthAt(line) / 2;
			const distance = Math.abs(across - line);
			if (distance > half + pavement) continue;
			const top = lift + (distance <= half ? roadTop : PAVEMENT_TOP_Y);
			height = height === null ? top : Math.max(height, top);
		}
	};
	check(x, z, verticalLines, CITY_EXTENT_Z, 0);
	check(z, x, horizontalLines, CITY_EXTENT_X, ROAD_GEOMETRY.axisEpsilon);
	return height;
}

/**
 * The outside corner of the pavement at a junction. `sideX`/`sideZ` (+/-1) pick which of the
 * four corners, and holding them constant lets a pedestrian follow one continuous kerb line
 * across the whole city, turning cleanly at every junction.
 */
export function pavementCorner(x: number, z: number, sideX: number, sideZ: number): [number, number, number] {
	const inset = ROAD_GEOMETRY.pavementWidth / 2;
	return [
		x + sideX * (roadWidthAt(x) / 2 + inset),
		PAVEMENT_TOP_Y,
		z + sideZ * (roadWidthAt(z) / 2 + inset),
	];
}

/** Every crossing of the grid is a real four-way junction. */
export const ORION_INTERSECTIONS: readonly IntersectionDefinition[] = verticalLines.flatMap((x) => (
	horizontalLines.map((z): IntersectionDefinition => ({
		id: `intersection-${x}-${z}`,
		type: "four-way",
		position: [x, 0, z],
		connectedRoadIds: [`road-ns-${x}`, `road-ew-${z}`],
	}))
));

export function getVisibleRoadSegments(): readonly RoadSegment[] {
	return ORION_ROAD_SEGMENTS.filter((segment) => segment.visible);
}