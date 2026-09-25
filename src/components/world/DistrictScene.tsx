"use client";

import { Container, Entity } from "@playcanvas/react";
import { Collision, Render, RigidBody } from "@playcanvas/react/components";
import { useMaterial, useModel, useTexture } from "@playcanvas/react/hooks";
import type { PropertyRecord } from "@/engine/orion/properties/Properties";
import type { Entity as PlayCanvasEntity, Texture } from "playcanvas";
import { memo, useCallback, useEffect, useState } from "react";
import { getBuildingDefinition, ORION_BUILDING_MAP, resolveBuildingScale, type BuildingPlacement, type YardProp } from "@/engine/orion/buildings/Buildings";
import { useNearby } from "./useNearby";
import { getVisibleRoadSegments, ROAD_GEOMETRY } from "@/engine/orion/roads/RoadNetwork";
import { ORION_MATERIALS } from "@/engine/orion/rendering/Materials";
import { addSolidBody } from "@/engine/orion/rendering/ModelBounds";
import { ORION_GROUND_TEXTURES } from "@/engine/orion/assets/AssetPaths";
import { IntersectionShowcase, SHOWCASE_POSITION } from "./IntersectionShowcase";
import { Ocean } from "./Ocean";
import { Pedestrians } from "./Pedestrians";
import { StateTerrain } from "./StateTerrain";
import { StreetFurniture } from "./StreetFurniture";
import { Vehicles } from "./Vehicles";
import { Police } from "./Police";
import { Railway } from "./Railway";
import { POLICE_STATION } from "@/engine/orion/police/Police";

/** World-space size (units) that one tile of a ground PBR texture represents. */
const ASPHALT_TEXTURE_UNIT = 3;
const CONCRETE_TEXTURE_UNIT = 3;
const TERRAIN_TEXTURE_UNIT = 22;

/**
 * Only buildings within this radius of the player are mounted. The city defines ~390
 * placements; rendering them all at once is what made the world stutter.
 */
const { surfaceY: ROAD_SURFACE_Y, thickness: ROAD_THICKNESS, axisEpsilon: ROAD_AXIS_EPSILON, pavementWidth: PAVEMENT_WIDTH, pavementLift: PAVEMENT_LIFT } = ROAD_GEOMETRY;

const BUILDING_RENDER_RADIUS = 170;
/** A mounted building stays until it's this far away, so boundaries don't thrash. */
const BUILDING_UNMOUNT_RADIUS = 215;
const SHOWCASE_RENDER_RADIUS = 400;
const SHOWCASE_UNMOUNT_RADIUS = 460;
/** Culling re-evaluates on a timer; the scene only re-renders when the set actually changes. */
const CULL_SAMPLE_MS = 400;

const CULLABLE_BUILDINGS = ORION_BUILDING_MAP.filter((placement) => !POLICE_STATION.replacesBuildings.includes(placement.id));
const buildingPosition = (placement: BuildingPlacement): readonly [number, number] => [placement.position[0], placement.position[2]];
const SHOWCASE_ITEMS = [SHOWCASE_POSITION] as const;
const showcasePosition = (position: typeof SHOWCASE_POSITION): readonly [number, number] => [position[0], position[2]];
const STREET_TREES: readonly [number, number, number][] = [[-14, 0, -10.5], [14, 0, -10.5], [-14, 0, 10.5], [14, 0, 10.5]];

/** Builds StandardMaterial props for a real PBR ground surface, falling back to flat color while it streams in. */
function pbrGroundMaterialProps(
	fallbackColor: string,
	diffuse: Texture | null,
	normal: Texture | null,
	tiling: [number, number],
	gloss: number,
) {
	if (!diffuse) return { diffuse: fallbackColor, gloss };
	return {
		diffuse: "#ffffff",
		diffuseMap: diffuse,
		diffuseMapTiling: tiling,
		...(normal ? { normalMap: normal, normalMapTiling: tiling, bumpiness: 0.6 } : {}),
		gloss,
	};
}

interface DistrictSceneProps {
	properties: readonly PropertyRecord[];
	onSelectProperty: (propertyId: string) => void;
}

export function DistrictScene({ properties, onSelectProperty }: Readonly<DistrictSceneProps>) {
	const { asset: asphaltDiffuseAsset } = useTexture(ORION_GROUND_TEXTURES.asphalt.diffuse);
	const { asset: asphaltNormalAsset } = useTexture(ORION_GROUND_TEXTURES.asphalt.normal);
	const { asset: pavementDiffuseAsset } = useTexture(ORION_GROUND_TEXTURES.pavement.diffuse);
	const { asset: pavementNormalAsset } = useTexture(ORION_GROUND_TEXTURES.pavement.normal);
	const { asset: grassDiffuseAsset } = useTexture(ORION_GROUND_TEXTURES.grass.diffuse);
	const { asset: grassNormalAsset } = useTexture(ORION_GROUND_TEXTURES.grass.normal);

	const asphaltDiffuse = (asphaltDiffuseAsset?.resource as Texture | undefined) ?? null;
	const asphaltNormal = (asphaltNormalAsset?.resource as Texture | undefined) ?? null;
	const pavementDiffuse = (pavementDiffuseAsset?.resource as Texture | undefined) ?? null;
	const pavementNormal = (pavementNormalAsset?.resource as Texture | undefined) ?? null;
	const grassDiffuse = (grassDiffuseAsset?.resource as Texture | undefined) ?? null;
	const grassNormal = (grassNormalAsset?.resource as Texture | undefined) ?? null;

	const terrain = useMaterial(pbrGroundMaterialProps(
		ORION_MATERIALS.terrain.baseColor, grassDiffuse, grassNormal, [1, 1], 0.06,
	));
	const roadMarking = useMaterial({ diffuse: "#b5a477", gloss: 0.25 });
	const parcel = useMaterial({ diffuse: "#465047", gloss: 0.1 });
	const line = useMaterial({ diffuse: "#b5a477", gloss: 0.2 });
	const quietLine = useMaterial({ diffuse: "#69766c", gloss: 0.16 });
	const treeTrunk = useMaterial({ diffuse: "#443a30", gloss: 0.08 });
	const treeCrown = useMaterial({ diffuse: "#63715d", gloss: 0.1 });
	const building = useMaterial({ diffuse: "#9b9890", gloss: 0.28 });
	const towerBuilding = useMaterial({ diffuse: "#77878a", gloss: 0.34 });
	const warehouse = useMaterial({ diffuse: "#6f685b", gloss: 0.24 });
	const suburbanBuilding = useMaterial({ diffuse: "#7e897c", gloss: 0.22 });
	const plannedBuilding = useMaterial({ diffuse: "#596862", gloss: 0.2 });
	const roof = useMaterial({ diffuse: "#353b3b", gloss: 0.34 });
	const window = useMaterial({ diffuse: "#7da0a2", gloss: 0.42 });
	const entrance = useMaterial({ diffuse: "#c6a16c", gloss: 0.3 });
	const visibleRoads = getVisibleRoadSegments();

	const nearbyBuildings = useNearby(CULLABLE_BUILDINGS, buildingPosition, BUILDING_RENDER_RADIUS, BUILDING_UNMOUNT_RADIUS, CULL_SAMPLE_MS);
	// The showcase is a 109-mesh model; keep it out of the scene (and the shadow pass)
	// entirely until the player is near it.
	const showcaseVisible = useNearby(SHOWCASE_ITEMS, showcasePosition, SHOWCASE_RENDER_RADIUS, SHOWCASE_UNMOUNT_RADIUS, CULL_SAMPLE_MS).length > 0;

	return (
		<>
			<Ocean />
			<StateTerrain material={terrain} textureUnit={TERRAIN_TEXTURE_UNIT} />

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

			{properties.map((property) => (
				<Parcel
					key={property.id}
					propertyId={property.id}
					x={property.position[0]}
					z={property.position[2]}
					material={parcel}
					line={property.id === "property-001" ? line : quietLine}
					ready={property.id === "property-001"}
					onSelect={onSelectProperty}
				/>
			))}

			{nearbyBuildings.map((placement) =>
				placement.renderMode === "asset" ? (
					<HeroBuildingVisual
						key={placement.id}
						placement={placement}
						material={building}
						roof={roof}
						window={window}
						entrance={entrance}
					/>
				) : (
					<BuildingVisual
						key={placement.id}
						placement={placement}
						material={placement.status === "planned" ? plannedBuilding : getBuildingMaterial(placement.districtKind, building, towerBuilding, warehouse, suburbanBuilding)}
						roof={roof}
						window={window}
						entrance={entrance}
					/>
				)
			)}

			{/* Clear of the arterial: it is 14 wide plus 2m pavements, so nothing inside +/-9. */}
			{STREET_TREES.map((position) => (
				<Tree key={position.join(",")} position={position} trunk={treeTrunk} crown={treeCrown} />
			))}

			<StreetFurniture />
			<Railway />
			<Pedestrians />
			<Vehicles />
			<Police />

			{showcaseVisible ? <IntersectionShowcase /> : null}
		</>
	);
}

function getBuildingMaterial(
	districtKind: (typeof ORION_BUILDING_MAP)[number]["districtKind"],
	building: ReturnType<typeof useMaterial>,
	towerBuilding: ReturnType<typeof useMaterial>,
	warehouse: ReturnType<typeof useMaterial>,
	suburbanBuilding: ReturnType<typeof useMaterial>,
) {
	if (districtKind === "downtown" || districtKind === "financial" || districtKind === "high-density-residential") return towerBuilding;
	if (districtKind === "industrial" || districtKind === "logistics-port") return warehouse;
	if (districtKind === "suburban") return suburbanBuilding;
	return building;
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

	const surface = useMaterial(pbrGroundMaterialProps(
		ORION_MATERIALS.asphalt.baseColor, asphaltDiffuse, asphaltNormal,
		[length / ASPHALT_TEXTURE_UNIT, segment.width / ASPHALT_TEXTURE_UNIT], 0.1,
	));
	const kerb = useMaterial(pbrGroundMaterialProps(
		ORION_MATERIALS.concrete.baseColor, pavementDiffuse, pavementNormal,
		[length / CONCRETE_TEXTURE_UNIT, PAVEMENT_WIDTH / CONCRETE_TEXTURE_UNIT], 0.15,
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

const PARCEL_SIZE: [number, number, number] = [13, 0.22, 12];
const PARCEL_HALF_EXTENTS: [number, number, number] = [PARCEL_SIZE[0] / 2, PARCEL_SIZE[1] / 2, PARCEL_SIZE[2] / 2];

const Parcel = memo(function Parcel({ propertyId, x, z, material, line, ready, onSelect }: Readonly<{
	propertyId: string;
	x: number;
	z: number;
	material: ReturnType<typeof useMaterial>;
	line: ReturnType<typeof useMaterial>;
	ready: boolean;
	onSelect: (propertyId: string) => void;
}>) {
	const select = useCallback(() => onSelect(propertyId), [onSelect, propertyId]);
	return (
		<Entity name="parcel" position={[x, -0.25, z]} onClick={select}>
			<Entity name="parcel-surface" scale={PARCEL_SIZE}>
				<Render type="box" material={material} receiveShadows castShadows={false} />
				{/* Primitive colliders ignore entity scale, so the size is always passed explicitly. */}
				<Collision type="box" halfExtents={PARCEL_HALF_EXTENTS} />
				<RigidBody type="static" />
			</Entity>
			<Entity name="parcel-edge" position={[0, 0.14, 0]} scale={[13.3, 0.04, 0.12]}>
				<Render type="box" material={line} castShadows={false} />
			</Entity>
			{ready ? <Entity name="building-ready-marker" position={[0, 0.16, 0]} scale={[7, 0.04, 6]}><Render type="torus" material={line} castShadows={false} /></Entity> : null}
		</Entity>
	);
});

const Tree = memo(function Tree({ position, trunk, crown }: Readonly<{ position: [number, number, number]; trunk: ReturnType<typeof useMaterial>; crown: ReturnType<typeof useMaterial> }>) {
	return (
		<Entity name="street-tree" position={position}>
			<Entity name="tree-trunk" position={[0, 1.5, 0]} scale={[0.35, 3, 0.35]}>
				<Render type="cylinder" material={trunk} castShadows />
				{/* Primitive colliders ignore entity scale, so the size is given explicitly. */}
				<Collision type="cylinder" radius={0.175} height={3} />
				<RigidBody type="static" />
			</Entity>
			<Entity name="tree-crown" position={[0, 3.6, 0]} scale={[1.8, 1.8, 1.8]}>
				<Render type="sphere" material={crown} castShadows />
			</Entity>
		</Entity>
	);
});

const BuildingVisual = memo(function BuildingVisual({ placement, material, roof, window, entrance }: Readonly<{
	placement: (typeof ORION_BUILDING_MAP)[number];
	material: ReturnType<typeof useMaterial>;
	roof: ReturnType<typeof useMaterial>;
	window: ReturnType<typeof useMaterial>;
	entrance: ReturnType<typeof useMaterial>;
}>) {
	const [width, depth] = placement.footprint;
	const [x, , z] = placement.position;
	const windowWidth = Math.max(0.7, (width - 2.2) / 3);
	const entrancePosition = placement.entranceSide === "north"
		? [0, 0.9, -depth / 2 - 0.08] as [number, number, number]
		: [0, 0.9, depth / 2 + 0.08] as [number, number, number];

	return (
		<Entity name={placement.id} position={[x, 0, z]} rotation={placement.rotation}>
			<Entity name="building-body" position={[0, placement.height / 2, 0]} scale={[width, placement.height, depth]}>
				<Render type="box" material={material} castShadows receiveShadows />
				<Collision type="box" halfExtents={[width / 2, placement.height / 2, depth / 2]} />
				<RigidBody type="static" />
			</Entity>
			<Entity name="building-roof" position={[0, placement.height + 0.18, 0]} scale={[width + 0.35, 0.36, depth + 0.35]}>
				<Render type="box" material={roof} castShadows />
			</Entity>
			<Entity name="building-windows" position={[0, placement.height * 0.55, depth / 2 + 0.06]} scale={[windowWidth, Math.max(0.6, placement.height * 0.07), 0.08]}>
				<Render type="box" material={window} />
			</Entity>
			<Entity name="building-entrance" position={entrancePosition} scale={[1.1, 1.8, 0.12]}>
				<Render type="box" material={entrance} />
			</Entity>
		</Entity>
	);
});

const HeroBuildingVisual = memo(function HeroBuildingVisual({ placement, material, roof, window, entrance }: Readonly<{
	placement: (typeof ORION_BUILDING_MAP)[number];
	material: ReturnType<typeof useMaterial>;
	roof: ReturnType<typeof useMaterial>;
	window: ReturnType<typeof useMaterial>;
	entrance: ReturnType<typeof useMaterial>;
}>) {
	const definition = getBuildingDefinition(placement.buildingDefinitionId);
	const { asset, loading } = useModel(definition?.assetPath ?? "");
	const [x, , z] = placement.position;

	if (loading || !asset || !definition) {
		return <BuildingVisual placement={placement} material={material} roof={roof} window={window} entrance={entrance} />;
	}

	// Every kit model is origin-centred with its base at y=0, so a uniform fit-scale is all
	// that's needed. Collision follows the model's real rendered size, not the placeholder box.
	const scale = resolveBuildingScale(definition, placement.footprint);
	const [nativeWidth, nativeHeight, nativeDepth] = definition.nativeSize;
	const renderedHeight = nativeHeight * scale;

	return (
		<Entity name={placement.id} position={[x, 0, z]} rotation={placement.rotation}>
			<Entity name="building-model" scale={[scale, scale, scale]}>
				<Container asset={asset} />
			</Entity>
			{/* Half-extents are passed explicitly rather than inferred from entity scale, so the
			    solid volume always matches the rendered model and can't be walked through. */}
			<Entity name="building-collider" position={[0, renderedHeight / 2, 0]}>
				<Collision
					type="box"
					halfExtents={[(nativeWidth * scale) / 2, renderedHeight / 2, (nativeDepth * scale) / 2]}
				/>
				<RigidBody type="static" friction={0.8} restitution={0} />
			</Entity>
			{definition.yardProps.map((prop, index) => (
				<YardPropVisual key={`${prop.assetPath}-${index}`} prop={prop} />
			))}
		</Entity>
	);
});

/** Yard props flat enough to walk over; everything else (trees, planters) is solid. */
const WALK_OVER_PROP = /path|stone|grass|flower/i;

function YardPropVisual({ prop }: Readonly<{ prop: YardProp }>) {
	const { asset, loading } = useModel(prop.assetPath);
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	useEffect(() => {
		if (!root || !asset || WALK_OVER_PROP.test(prop.assetPath)) return;
		return addSolidBody(root, /tree/i.test(prop.assetPath));
	}, [root, asset, prop.assetPath]);
	if (loading || !asset) return null;
	return (
		<Entity ref={setRoot} position={prop.position} rotation={prop.rotation} scale={[prop.scale, prop.scale, prop.scale]}>
			<Container asset={asset} />
		</Entity>
	);
}
