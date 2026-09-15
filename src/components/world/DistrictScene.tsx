"use client";

import { Entity } from "@playcanvas/react";
import { Collision, Render, RigidBody } from "@playcanvas/react/components";
import { useMaterial } from "@playcanvas/react/hooks";
import type { PropertyRecord } from "@/engine/orion/properties/Properties";
import { ORION_BUILDING_MAP } from "@/engine/orion/buildings/Buildings";
import { getVisibleRoadSegments } from "@/engine/orion/roads/RoadNetwork";
import { ORION_MATERIALS } from "@/engine/orion/rendering/Materials";

interface DistrictSceneProps {
	properties: readonly PropertyRecord[];
}

export function DistrictScene({ properties }: Readonly<DistrictSceneProps>) {
	const terrain = useMaterial({ diffuse: ORION_MATERIALS.terrain.baseColor, gloss: 0.08 });
	const road = useMaterial({ diffuse: ORION_MATERIALS.asphalt.baseColor, gloss: 0.12 });
	const curb = useMaterial({ diffuse: ORION_MATERIALS.concrete.baseColor, gloss: 0.2 });
	const roadMarking = useMaterial({ diffuse: "#b5a477", gloss: 0.25 });
	const sidewalk = useMaterial({ diffuse: "#777875", gloss: 0.18 });
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

	return (
		<>
			<Entity name="district-terrain" position={[0, -0.65, 0]} scale={[800, 1, 520]}>
				<Render type="plane" material={terrain} receiveShadows />
			</Entity>
			<Entity name="city-ground-collider" position={[0, -1.05, 0]}>
				<Collision type="box" halfExtents={[400, 0.4, 260]} />
				<RigidBody type="static" />
			</Entity>

			{visibleRoads.map((segment) => <RoadSegmentVisual key={segment.id} segment={segment} material={road} />)}
			<StreetEdge position={[0, -0.32, -4.25]} material={curb} />
			<StreetEdge position={[0, -0.32, 4.25]} material={curb} />
			<Entity name="road-center-marking" position={[-15, -0.29, 0]} scale={[6, 0.04, 0.08]}>
				<Render type="box" material={roadMarking} />
			</Entity>
			<Entity name="road-center-marking" position={[0, -0.29, 0]} scale={[6, 0.04, 0.08]}>
				<Render type="box" material={roadMarking} />
			</Entity>
			<Entity name="road-center-marking" position={[15, -0.29, 0]} scale={[6, 0.04, 0.08]}>
				<Render type="box" material={roadMarking} />
			</Entity>

			<Sidewalk position={[0, -0.34, -5.2]} scale={[56, 0.22, 1.8]} material={sidewalk} />
			<Sidewalk position={[0, -0.34, 5.2]} scale={[56, 0.22, 1.8]} material={sidewalk} />

			{properties.map((property) => (
				<Parcel
					key={property.id}
					position={[property.position[0], -0.25, property.position[2]]}
					material={parcel}
					line={property.id === "property-001" ? line : quietLine}
					ready={property.id === "property-001"}
				/>
			))}

			{ORION_BUILDING_MAP.map((placement) => (
				<BuildingVisual
					key={placement.id}
					placement={placement}
					material={placement.status === "planned" ? plannedBuilding : getBuildingMaterial(placement.districtKind, building, towerBuilding, warehouse, suburbanBuilding)}
					roof={roof}
					window={window}
					entrance={entrance}
				/>
			))}

			<Tree position={[-11, 0, -5.8]} trunk={treeTrunk} crown={treeCrown} />
			<Tree position={[11, 0, -5.8]} trunk={treeTrunk} crown={treeCrown} />
			<Tree position={[-11, 0, 5.8]} trunk={treeTrunk} crown={treeCrown} />
			<Tree position={[11, 0, 5.8]} trunk={treeTrunk} crown={treeCrown} />
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

function RoadSegmentVisual({ segment, material }: Readonly<{ segment: ReturnType<typeof getVisibleRoadSegments>[number]; material: ReturnType<typeof useMaterial> }>) {
	const centerX = (segment.start[0] + segment.end[0]) / 2;
	const centerZ = (segment.start[2] + segment.end[2]) / 2;
	const length = Math.hypot(segment.end[0] - segment.start[0], segment.end[2] - segment.start[2]);
	return (
		<Entity name={segment.id} position={[centerX, -0.47, centerZ]} scale={[length, 0.14, segment.width]}>
			<Render type="box" material={material} receiveShadows />
			<Collision type="box" />
			<RigidBody type="static" />
		</Entity>
	);
}

function Sidewalk({ position, scale, material }: Readonly<{ position: [number, number, number]; scale: [number, number, number]; material: ReturnType<typeof useMaterial> }>) {
	return (
		<Entity name="sidewalk" position={position} scale={scale}>
			<Render type="box" material={material} receiveShadows />
			<Collision type="box" />
			<RigidBody type="static" />
		</Entity>
	);
}

function StreetEdge({ position, material }: Readonly<{ position: [number, number, number]; material: ReturnType<typeof useMaterial> }>) {
	return (
		<Entity name="street-curb" position={position} scale={[56, 0.16, 0.22]}>
			<Render type="box" material={material} receiveShadows />
			<Collision type="box" />
			<RigidBody type="static" />
		</Entity>
	);
}

function Parcel({ position, material, line, ready }: Readonly<{ position: [number, number, number]; material: ReturnType<typeof useMaterial>; line: ReturnType<typeof useMaterial>; ready: boolean }>) {
	return (
		<Entity name="parcel" position={position}>
			<Entity name="parcel-surface" scale={[13, 0.22, 12]}>
				<Render type="box" material={material} receiveShadows />
				<Collision type="box" />
				<RigidBody type="static" />
			</Entity>
			<Entity name="parcel-edge" position={[0, 0.14, 0]} scale={[13.3, 0.04, 0.12]}>
				<Render type="box" material={line} />
			</Entity>
			{ready ? <Entity name="building-ready-marker" position={[0, 0.16, 0]} scale={[7, 0.04, 6]}><Render type="torus" material={line} /></Entity> : null}
		</Entity>
	);
}

function Tree({ position, trunk, crown }: Readonly<{ position: [number, number, number]; trunk: ReturnType<typeof useMaterial>; crown: ReturnType<typeof useMaterial> }>) {
	return (
		<Entity name="street-tree" position={position}>
			<Entity name="tree-trunk" position={[0, 1.5, 0]} scale={[0.35, 3, 0.35]}>
				<Render type="cylinder" material={trunk} castShadows />
			</Entity>
			<Entity name="tree-crown" position={[0, 3.6, 0]} scale={[1.8, 1.8, 1.8]}>
				<Render type="sphere" material={crown} castShadows />
			</Entity>
		</Entity>
	);
}

function BuildingVisual({ placement, material, roof, window, entrance }: Readonly<{
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
				<Collision type="box" />
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
}
