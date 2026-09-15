import type { Vector3Tuple } from "../properties/Properties";

export interface TerrainStagingConfig {
	position: Vector3Tuple;
	scale: Vector3Tuple;
}

export const ORION_STAGING_TERRAIN: TerrainStagingConfig = {
	position: [0, -0.5, 0],
	scale: [56, 1, 56],
};
