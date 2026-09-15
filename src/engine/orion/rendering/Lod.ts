import type { LodAssetSet } from "../assets/AssetRegistry";

export type LodLevel = 0 | 1 | 2;

export interface LodPolicy {
	nearDistance: number;
	mediumDistance: number;
	farDistance: number;
}

export const ORION_DEFAULT_LOD_POLICY: LodPolicy = {
	nearDistance: 35,
	mediumDistance: 100,
	farDistance: 240,
};

export function resolveLod(distance: number, policy = ORION_DEFAULT_LOD_POLICY): LodLevel {
	if (distance <= policy.nearDistance) return 0;
	if (distance <= policy.mediumDistance) return 1;
	return 2;
}

export function resolveLodAsset(assets: LodAssetSet, level: LodLevel): string | null {
	return [assets.lod0, assets.lod1, assets.lod2][level] ?? assets.lod0 ?? assets.lod1 ?? assets.lod2;
}