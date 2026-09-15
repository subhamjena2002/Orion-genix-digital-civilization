import type { Vector3Tuple } from "../properties/Properties";
import type { WorldBounds } from "./WorldModel";
import { ORION_DISTRICTS } from "./WorldModel";

export type ChunkLodLevel = 0 | 1 | 2;

export interface WorldChunkDefinition {
	id: string;
	regionId: string;
	districtId: string;
	bounds: WorldBounds;
	center: Vector3Tuple;
	assetIds: readonly string[];
	priority: number;
}

export class WorldChunkManager {
	private readonly chunks: readonly WorldChunkDefinition[];
	private readonly loaded = new Set<string>();

	public constructor(chunks: readonly WorldChunkDefinition[]) {
		this.chunks = chunks;
	}

	public getActiveChunks(position: Vector3Tuple, loadRadius = 90): readonly WorldChunkDefinition[] {
		return this.chunks.filter((chunk) => {
			const dx = chunk.center[0] - position[0];
			const dz = chunk.center[2] - position[2];
			return Math.hypot(dx, dz) <= loadRadius;
		});
	}

	public update(position: Vector3Tuple, loadRadius = 90): readonly WorldChunkDefinition[] {
		const active = this.getActiveChunks(position, loadRadius);
		this.loaded.clear();
		active.forEach((chunk) => this.loaded.add(chunk.id));
		return active;
	}

	public isLoaded(chunkId: string): boolean {
		return this.loaded.has(chunkId);
	}
}

export const ORION_WORLD_CHUNKS: readonly WorldChunkDefinition[] = ORION_DISTRICTS.map((district, index) => ({
	id: `chunk-${district.id}`,
	regionId: "north-region",
	districtId: district.id,
	bounds: district.bounds,
	center: district.bounds.center,
	assetIds: [`terrain-${district.id}`, `roads-${district.id}`, `buildings-${district.id}`],
	priority: index === 0 ? 100 : 50,
}));