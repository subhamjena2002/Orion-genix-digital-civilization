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