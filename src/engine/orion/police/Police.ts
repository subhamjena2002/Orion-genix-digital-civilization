import { ROAD_GRID, roadWidthAt } from "../roads/RoadNetwork";

/**
 * Where the police are: one station compound near the city centre, and traffic police posted
 * at the main arterial junctions.
 */
export const POLICE_STATION = {
	/** Ground-floor centre; the front (entrance) faces +Z, onto the arterial at z = 0. */
	position: [35, -17] as [number, number],
	footprint: [16, 12] as [number, number],
	/** Parking lot beside the station for the parked patrol cars. */
	lot: { position: [57, -17] as [number, number], size: [20, 12] as [number, number] },
	/** Grid buildings this compound replaces. */
	replacesBuildings: ["building-012", "building-013"] as readonly string[],
} as const;

export interface OfficerPost {
	id: string;
	position: [number, number];
	/** Facing, degrees about Y (0 = +Z). */
	yaw: number;
	/** Men and women officers use different models. */
	model: "man" | "woman";
	seed: number;
}

/** The two nearest-the-front strips of the compound, between the building and the pavement. */
const FRONT_Z = POLICE_STATION.position[1] + POLICE_STATION.footprint[1] / 2 + 0.8;

const STATION_POSTS: OfficerPost[] = [
	{ id: "officer-station-gate-left", position: [31, FRONT_Z], yaw: 0, model: "man", seed: 11 },
	{ id: "officer-station-gate-right", position: [39, FRONT_Z], yaw: 0, model: "woman", seed: 12 },
	{ id: "officer-station-lot", position: [57, FRONT_Z], yaw: 20, model: "man", seed: 13 },
];

/** Arterial junctions that get a traffic constable. */
const TRAFFIC_JUNCTIONS: readonly [number, number][] = [
	[0, 0], [160, 0], [-160, 0], [0, -160], [0, 160], [160, -160], [-160, 160], [320, 0],
];

/** How far past the junction box the constable stands, clear of the zebra and signal pole. */
const POST_SETBACK = 5;
/** Near the back of the 2 m pavement, leaving the walking line free. */
const POST_INSET = 1.85;

const TRAFFIC_POSTS: OfficerPost[] = TRAFFIC_JUNCTIONS
	.filter(([x, z]) => ROAD_GRID.xs.includes(x) && ROAD_GRID.zs.includes(z))
	.map(([x, z], index) => ({
		id: `officer-traffic-${index + 1}`,
		// On the east pavement of the north–south road, just south of the junction.
		position: [x + roadWidthAt(x) / 2 + POST_INSET, z + roadWidthAt(z) / 2 + POST_SETBACK],
		// Facing the junction, turned slightly towards the road.
		yaw: 200,
		model: index % 3 === 2 ? "woman" : "man",
		seed: 100 + index,
	}));

export const OFFICER_POSTS: readonly OfficerPost[] = [...STATION_POSTS, ...TRAFFIC_POSTS];

/** Parked patrol cars in the station lot, nose towards the road. */
export const PARKED_PATROL_CARS: readonly { id: string; position: [number, number]; yaw: number }[] = [
	{ id: "patrol-parked-1", position: [52.5, -18], yaw: 0 },
	{ id: "patrol-parked-2", position: [57, -18], yaw: 0 },
];

/** Khaki: the standard Indian police uniform colour. */
export const POLICE_UNIFORM = {
	khaki: "#a8935f",
	belt: "#3b2a1c",
	cap: "#8e7a4c",
	capBand: "#7a1f1f",
	skin: ["#8d5a3b", "#a9724a", "#6f4526", "#b07f52"],
	hair: "#141010",
} as const;
