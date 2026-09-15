export type AssetAvailability = "available" | "planned" | "unavailable";

export interface RegisteredAsset {
	id: string;
	category: string;
	assetPath: string | null;
	source: string;
	license: string;
	originalFilename: string | null;
	availability: AssetAvailability;
}

export interface LodAssetSet {
	lod0: string | null;
	lod1: string | null;
	lod2: string | null;
}