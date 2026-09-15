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

const cityRoads: readonly RoadSegment[] = ORION_DISTRICTS.flatMap((district) => {
	const [centerX, , centerZ] = district.bounds.center;
	const roadType: RoadType = district.kind === "waterfront" ? "promenade" : district.kind === "industrial" || district.kind === "logistics-port" ? "industrial" : "secondary";
	const width = roadType === "promenade" ? 6 : roadType === "industrial" ? 9 : 7;
	return [
		{ id: `road-${district.id}-north`, type: roadType, start: [centerX - 70, 0, centerZ - 45], end: [centerX + 70, 0, centerZ - 45], width, lanes: roadType === "promenade" ? 0 : 2, speedClass: roadType === "industrial" ? "freight" : "urban", districtId: district.id, connections: [], visible: true },
		{ id: `road-${district.id}-south`, type: roadType, start: [centerX - 70, 0, centerZ + 45], end: [centerX + 70, 0, centerZ + 45], width, lanes: roadType === "promenade" ? 0 : 2, speedClass: roadType === "industrial" ? "freight" : "urban", districtId: district.id, connections: [], visible: true },
		{ id: `road-${district.id}-west`, type: roadType, start: [centerX - 45, 0, centerZ - 70], end: [centerX - 45, 0, centerZ + 70], width, lanes: roadType === "promenade" ? 0 : 2, speedClass: roadType === "industrial" ? "freight" : "urban", districtId: district.id, connections: [], visible: true },
		{ id: `road-${district.id}-east`, type: roadType, start: [centerX + 45, 0, centerZ - 70], end: [centerX + 45, 0, centerZ + 70], width, lanes: roadType === "promenade" ? 0 : 2, speedClass: roadType === "industrial" ? "freight" : "urban", districtId: district.id, connections: [], visible: true },
	];
});

export const ORION_ROAD_SEGMENTS: readonly RoadSegment[] = [
	{ id: "road-north-district-arterial-001", type: "primary-arterial", start: [-70, 0, 0], end: [70, 0, 0], width: 10, lanes: 4, speedClass: "arterial", districtId: "low-density-residential", connections: ["intersection-north-district-001"], visible: true },
	...cityRoads,
];

export const ORION_INTERSECTIONS: readonly IntersectionDefinition[] = [
	{ id: "intersection-north-district-001", type: "four-way", position: [0, 0, 0], connectedRoadIds: ["road-north-district-arterial-001"] },
];

export function getVisibleRoadSegments(): readonly RoadSegment[] {
	return ORION_ROAD_SEGMENTS.filter((segment) => segment.visible);
}