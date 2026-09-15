import { ORION_PROPERTIES } from "./properties/Properties";
import { ORION_BUILDING_REGISTRY } from "./buildings/Buildings";
import { ORION_RENDERING } from "./rendering/Renderer";
import { ORION_STAGING_TERRAIN } from "./terrain/Terrain";
import { ORION_CITY } from "./world/WorldModel";
import { ORION_WORLD_CHUNKS, WorldChunkManager } from "./world/WorldChunk";
import { ORION_ROAD_SEGMENTS, ORION_INTERSECTIONS } from "./roads/RoadNetwork";
import { ORION_VEHICLES } from "./vehicles/Vehicles";
import { ORION_CHARACTERS, ORION_PEDESTRIAN_SPAWN_POINTS } from "./characters/Characters";
import { ORION_AIRCRAFT } from "./aircraft/Aircraft";
import { ORION_WEAPONS } from "./weapons/Weapons";
import { ORION_PROPS } from "./props/Props";
import { ORION_VEGETATION } from "./vegetation/Vegetation";
import { ORION_BRIDGES } from "./infrastructure/Infrastructure";
import { ORION_INSTANCE_BATCHES } from "./rendering/Instancing";
import { ORION_DEFAULT_LOD_POLICY } from "./rendering/Lod";
import { ORION_ACTIVE_TIME_OF_DAY, ORION_ENVIRONMENT_PROFILES } from "./rendering/Environment";
import { ORION_MATERIALS } from "./rendering/Materials";
import { ORION_START_ADDRESS } from "./world/CityMap";
import { ORION_PUBLIC_SPACES } from "./publicspace/PublicSpaces";

export const ORION_CHUNK_MANAGER = new WorldChunkManager(ORION_WORLD_CHUNKS);

export const ORION_WORLD = {
	city: ORION_CITY,
	startAddress: ORION_START_ADDRESS,
	publicSpaces: ORION_PUBLIC_SPACES,
	properties: ORION_PROPERTIES,
	buildings: ORION_BUILDING_REGISTRY,
	roads: ORION_ROAD_SEGMENTS,
	intersections: ORION_INTERSECTIONS,
	bridges: ORION_BRIDGES,
	vehicles: ORION_VEHICLES,
	characters: ORION_CHARACTERS,
	pedestrianSpawnPoints: ORION_PEDESTRIAN_SPAWN_POINTS,
	aircraft: ORION_AIRCRAFT,
	weapons: ORION_WEAPONS,
	props: ORION_PROPS,
	vegetation: ORION_VEGETATION,
	instanceBatches: ORION_INSTANCE_BATCHES,
	lodPolicy: ORION_DEFAULT_LOD_POLICY,
	environment: ORION_ENVIRONMENT_PROFILES,
	activeTimeOfDay: ORION_ACTIVE_TIME_OF_DAY,
	materials: ORION_MATERIALS,
	chunks: ORION_WORLD_CHUNKS,
	terrain: ORION_STAGING_TERRAIN,
	rendering: ORION_RENDERING,
};
