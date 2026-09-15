import type { Vector3Tuple } from "../properties/Properties";

export type PublicSpaceType = "park" | "plaza" | "promenade" | "courtyard" | "playground";

export interface PublicSpaceDefinition {
	id: string;
	districtId: string;
	type: PublicSpaceType;
	position: Vector3Tuple;
	bounds: [number, number];
	assetIds: readonly string[];
	developmentState: "planned" | "active";
}

export const ORION_PUBLIC_SPACES: readonly PublicSpaceDefinition[] = [
	{ id: "public-space-north-pocket-park", districtId: "low-density-residential", type: "park", position: [0, 0, -12], bounds: [24, 16], assetIds: ["vegetation-park-tree", "prop-bench-standard", "prop-street-light-standard"], developmentState: "planned" },
	{ id: "public-space-downtown-civic-plaza", districtId: "civic-district", type: "plaza", position: [800, 0, 0], bounds: [60, 40], assetIds: ["prop-planter-standard", "prop-street-light-standard"], developmentState: "planned" },
	{ id: "public-space-waterfront-promenade", districtId: "waterfront", type: "promenade", position: [1180, 0, -45], bounds: [120, 12], assetIds: ["prop-bench-standard", "vegetation-street-tree"], developmentState: "planned" },
];