"use client";

import { Entity } from "@playcanvas/react";
import { Collision, Render, RigidBody } from "@playcanvas/react/components";
import { useApp, useMaterial, useTexture } from "@playcanvas/react/hooks";
import type { Texture } from "playcanvas";
import { memo, useEffect, useState } from "react";
import { ORION_BUILDING_MAP, type BuildingPlacement } from "@/engine/orion/buildings/Buildings";
import { CityBuilding } from "./CityBuilding";
import { paintPaving, PAVING_TILE_METRES } from "@/engine/orion/world/GroundTextures";
import { useNearby } from "./useNearby";
import { getVisibleRoadSegments, ROAD_GEOMETRY } from "@/engine/orion/roads/RoadNetwork";
import { ORION_MATERIALS } from "@/engine/orion/rendering/Materials";
import { ORION_GROUND_TEXTURES } from "@/engine/orion/assets/AssetPaths";
import { Ocean } from "./Ocean";
import { MissionHostiles, Pedestrians } from "./Pedestrians";
import { Airfield } from "./Airfield";
import { Highways } from "./Highways";
import { Hospitals } from "./Hospital";
import { MilitaryBase } from "./MilitaryBase";
import { Mountains } from "./Mountains";
import { StateTerrain } from "./StateTerrain";
import { Estates } from "./Estates";
import { StreetDressing } from "./StreetDressing";
import { WaypointBeacon } from "./WaypointBeacon";
import { StreetFurniture } from "./StreetFurniture";
import { FireEngines, GarageVehicles, MissionVehicles, Vehicles } from "./Vehicles";
import { MissionRuntime } from "./MissionRuntime";
import { DistanceCulling } from "./useDistanceCull";
import { Police } from "./Police";
import { Railway } from "./Railway";
import { POLICE_STATION } from "@/engine/orion/police/Police";
import { HOSPITAL_REPLACED_BUILDINGS } from "@/engine/orion/world/Hospitals";

/** World-space size (units) that one tile of a ground PBR texture represents. */
const ASPHALT_TEXTURE_UNIT = 3;
const CONCRETE_TEXTURE_UNIT = PAVING_TILE_METRES;
/**
 * The grass photo is dry and straw-coloured; multiplied by this it reads as a watered lawn, as
 * the verges and lots of a seaside city are kept.
 */
const LAWN_TINT = "#a9d07e";
const TERRAIN_TEXTURE_UNIT = 22;

/**
 * Only buildings within this radius of the player are mounted. The city defines ~390
 * placements; rendering them all at once is what made the world stutter.
 */
const { surfaceY: ROAD_SURFACE_Y, thickness: ROAD_THICKNESS, axisEpsilon: ROAD_AXIS_EPSILON, pavementWidth: PAVEMENT_WIDTH, pavementLift: PAVEMENT_LIFT } = ROAD_GEOMETRY;

/**
 * The terrain plane (see StateTerrain). Buildings, plots and trees stand on it; placed at y = 0
 * they floated 0.65 m over the grass with daylight under their plinths.
 */
const GROUND_Y = -0.65;

const BUILDING_RENDER_RADIUS = 170;
/** A mounted building stays until it's this far away, so boundaries don't thrash. */
const BUILDING_UNMOUNT_RADIUS = 215;
/**
 * Culling re-evaluates on a timer; the scene only re-renders when the set actually changes. Each
 * sample admits a few new buildings at most (nearest first): a building arrives with its model and
 * collider in one frame, and a dozen arriving together at speed made a visible hitch. Sampled
 * often, the few-at-a-time still keeps ahead of the car (the set leans along the road at speed).
 */
const CULL_SAMPLE_MS = 150;
const BUILDINGS_PER_SAMPLE = 3;

const CULLABLE_BUILDINGS = ORION_BUILDING_MAP.filter((placement) => (
	!POLICE_STATION.replacesBuildings.includes(placement.id) && !HOSPITAL_REPLACED_BUILDINGS.includes(placement.id)
));
const buildingPosition = (placement: BuildingPlacement): readonly [number, number] => [placement.position[0], placement.position[2]];

/** Builds StandardMaterial props for a real PBR ground surface, falling back to flat color while it streams in. */
function pbrGroundMaterialProps(
	fallbackColor: string,
	diffuse: Texture | null,
	normal: Texture | null,
	tiling: [number, number],
	gloss: number,
	tint = "#ffffff",
) {
	if (!diffuse) return { diffuse: fallbackColor, gloss };
	return {
		diffuse: tint,
		diffuseMap: diffuse,
		diffuseMapTiling: tiling,
		...(normal ? { normalMap: normal, normalMapTiling: tiling, bumpiness: 0.6 } : {}),
		gloss,
	};
}

/** The pavement's slabs, painted once (see GroundTextures). */
function usePaving(): { diffuse: Texture; normal: Texture } | null {
	const app = useApp();
	const [paving, setPaving] = useState<{ diffuse: Texture; normal: Texture } | null>(null);
	useEffect(() => {
		if (!app) return;
		const made = paintPaving(app.graphicsDevice);
		// Painted on a canvas once the device exists: an effect-derived resource by nature.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setPaving(made);
		return () => {
			made.diffuse.destroy();
			made.normal.destroy();
			setPaving(null);
		};
	}, [app]);
	return paving;
}

export function DistrictScene() {
	const { asset: asphaltDiffuseAsset } = useTexture(ORION_GROUND_TEXTURES.asphalt.diffuse);
	const { asset: asphaltNormalAsset } = useTexture(ORION_GROUND_TEXTURES.asphalt.normal);
	const { asset: grassDiffuseAsset } = useTexture(ORION_GROUND_TEXTURES.grass.diffuse);
	const { asset: grassNormalAsset } = useTexture(ORION_GROUND_TEXTURES.grass.normal);

	const asphaltDiffuse = (asphaltDiffuseAsset?.resource as Texture | undefined) ?? null;
	const asphaltNormal = (asphaltNormalAsset?.resource as Texture | undefined) ?? null;
	const paving = usePaving();
	const pavementDiffuse = paving?.diffuse ?? null;
	const pavementNormal = paving?.normal ?? null;
	const grassDiffuse = (grassDiffuseAsset?.resource as Texture | undefined) ?? null;
	const grassNormal = (grassNormalAsset?.resource as Texture | undefined) ?? null;

	const terrain = useMaterial(pbrGroundMaterialProps(
		ORION_MATERIALS.terrain.baseColor, grassDiffuse, grassNormal, [1, 1], 0.06, LAWN_TINT,
	));
	const roadMarking = useMaterial({ diffuse: "#b5a477", gloss: 0.25 });
	const visibleRoads = getVisibleRoadSegments();

	const nearbyBuildings = useNearby(CULLABLE_BUILDINGS, buildingPosition, BUILDING_RENDER_RADIUS, BUILDING_UNMOUNT_RADIUS, CULL_SAMPLE_MS, BUILDINGS_PER_SAMPLE);

	return (
		<>
			<Ocean />
			<StateTerrain material={terrain} textureUnit={TERRAIN_TEXTURE_UNIT} />
			<Mountains grassDiffuse={grassDiffuse} grassNormal={grassNormal} rockDiffuse={asphaltDiffuse} rockNormal={asphaltNormal} />
			<Highways asphaltDiffuse={asphaltDiffuse} asphaltNormal={asphaltNormal} grassDiffuse={grassDiffuse} grassNormal={grassNormal} />

			{visibleRoads.map((segment) => (
				<RoadVisual
					key={segment.id}
					segment={segment}
					asphaltDiffuse={asphaltDiffuse}
					asphaltNormal={asphaltNormal}
					pavementDiffuse={pavementDiffuse}
					pavementNormal={pavementNormal}
					marking={roadMarking}
				/>
			))}


			{nearbyBuildings.map((placement) => (
				<CityBuilding key={placement.id} placement={placement} groundY={GROUND_Y} />
			))}

			{/* Clear of the arterial: it is 14 wide plus 2m pavements, so nothing inside +/-9. */}

			<StreetFurniture />
			<StreetDressing />
			<WaypointBeacon />
			<MissionRuntime />
			<DistanceCulling />
			<Estates asphalt={asphaltDiffuse} asphaltNormal={asphaltNormal} paving={pavementDiffuse} pavingNormal={pavementNormal} />
			<Railway />
			<Pedestrians />
			<Vehicles />
			<Police />
			<Hospitals />
			<FireEngines />
			<MissionVehicles />
			<MissionHostiles />
			<GarageVehicles />
			<MilitaryBase asphaltDiffuse={asphaltDiffuse} asphaltNormal={asphaltNormal} />
			<Airfield asphaltDiffuse={asphaltDiffuse} asphaltNormal={asphaltNormal} />

		</>
	);
}


/**
 * A carriageway laid flush into the terrain, flanked by pavements and centre-lined.
 * Roads are drawn as one piece per grid line so junctions genuinely join up; the two axes
 * are separated by a hair of height so overlapping surfaces at crossings can't z-fight.
 */
const RoadVisual = memo(function RoadVisual({ segment, asphaltDiffuse, asphaltNormal, pavementDiffuse, pavementNormal, marking }: Readonly<{
	segment: ReturnType<typeof getVisibleRoadSegments>[number];
	asphaltDiffuse: Texture | null;
	asphaltNormal: Texture | null;
	pavementDiffuse: Texture | null;
	pavementNormal: Texture | null;
	marking: ReturnType<typeof useMaterial>;
}>) {
	const runsNorthSouth = segment.start[0] === segment.end[0];
	const centerX = (segment.start[0] + segment.end[0]) / 2;
	const centerZ = (segment.start[2] + segment.end[2]) / 2;
	const length = Math.hypot(segment.end[0] - segment.start[0], segment.end[2] - segment.start[2]);
	const y = ROAD_SURFACE_Y + (runsNorthSouth ? 0 : ROAD_AXIS_EPSILON);

	// A box's top face maps the texture's U along world X and V along Z, so the repeat counts
	// follow the axes, not the road: a north-south road runs along Z. Written as (length, width)
	// for every road, the north-south ones had the asphalt squashed across the carriageway and
	// stretched along it (streaks), and the paving crammed so tight it averaged to flat tan.
	const tiling = (unit: number, across: number): [number, number] => (
		runsNorthSouth ? [across / unit, length / unit] : [length / unit, across / unit]
	);
	const surface = useMaterial(pbrGroundMaterialProps(
		ORION_MATERIALS.asphalt.baseColor, asphaltDiffuse, asphaltNormal,
		tiling(ASPHALT_TEXTURE_UNIT, segment.width), 0.1,
	));
	const kerb = useMaterial(pbrGroundMaterialProps(
		ORION_MATERIALS.concrete.baseColor, pavementDiffuse, pavementNormal,
		tiling(CONCRETE_TEXTURE_UNIT, PAVEMENT_WIDTH), 0.15,
	));

	const along = (value: number): [number, number, number] => (
		runsNorthSouth ? [centerX + value, 0, centerZ] : [centerX, 0, centerZ + value]
	);
	const box = (across: number, thickness: number): [number, number, number] => (
		runsNorthSouth ? [across, thickness, length] : [length, thickness, across]
	);
	const pavementOffset = segment.width / 2 + PAVEMENT_WIDTH / 2;
	const carriageway = box(segment.width, ROAD_THICKNESS);
	const pavementSize = box(PAVEMENT_WIDTH, ROAD_THICKNESS);

	return (
		<Entity name={segment.id}>
			<Entity name="carriageway" position={[along(0)[0], y, along(0)[2]]} scale={carriageway}>
				{/* Flat ground: it can't throw a visible shadow, so it isn't drawn into the shadow map. */}
				<Render type="box" material={surface} receiveShadows castShadows={false} />
				{/* Primitive colliders ignore entity scale: without explicit extents this was a 1 m
				    cube at the middle of every road, an invisible kerb in the carriageway. */}
				<Collision type="box" halfExtents={[carriageway[0] / 2, carriageway[1] / 2, carriageway[2] / 2]} />
				<RigidBody type="static" friction={0.9} />
			</Entity>
			<Entity name="lane-line" position={[along(0)[0], y + ROAD_THICKNESS / 2, along(0)[2]]} scale={box(0.25, 0.02)}>
				<Render type="box" material={marking} castShadows={false} />
			</Entity>
			{[-pavementOffset, pavementOffset].map((offset) => {
				const position = along(offset);
				return (
					<Entity key={offset} name="pavement" position={[position[0], y + PAVEMENT_LIFT, position[2]]} scale={pavementSize}>
						<Render type="box" material={kerb} receiveShadows />
						{/* Solid like the carriageway: without it the player stood on the terrain under the
						    pavement, with the soles of their shoes buried in its surface. */}
						<Collision type="box" halfExtents={[pavementSize[0] / 2, pavementSize[1] / 2, pavementSize[2] / 2]} />
						<RigidBody type="static" friction={0.9} />
					</Entity>
				);
			})}
		</Entity>
	);
});
