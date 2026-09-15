import type { RegisteredAsset } from "../assets/AssetRegistry";

export type VegetationCategory = "street-tree" | "park-tree" | "mature-tree" | "young-tree" | "shrub" | "grass" | "flower" | "hedge" | "planter";

export interface VegetationDefinition extends RegisteredAsset {
	category: VegetationCategory;
	instanceable: boolean;
	heightRange: [number, number];
}

const plannedVegetation = (id: string, category: VegetationCategory, heightRange: [number, number]): VegetationDefinition => ({
	id,
	category,
	assetPath: null,
	source: "unassigned local asset",
	license: "unverified",
	originalFilename: null,
	availability: "unavailable",
	instanceable: true,
	heightRange,
});

export const ORION_VEGETATION: readonly VegetationDefinition[] = [
	plannedVegetation("vegetation-street-tree", "street-tree", [4, 7]),
	plannedVegetation("vegetation-park-tree", "park-tree", [6, 12]),
	plannedVegetation("vegetation-mature-tree", "mature-tree", [8, 16]),
	plannedVegetation("vegetation-young-tree", "young-tree", [2, 5]),
	plannedVegetation("vegetation-shrub", "shrub", [0.4, 1.4]),
	plannedVegetation("vegetation-grass", "grass", [0.1, 0.4]),
	plannedVegetation("vegetation-flowers", "flower", [0.2, 0.8]),
	plannedVegetation("vegetation-hedge", "hedge", [0.8, 2]),
	plannedVegetation("vegetation-planter", "planter", [0.5, 1.2]),
];