"use client";

import { Container, Entity } from "@playcanvas/react";
import { Collision, RigidBody, Script } from "@playcanvas/react/components";
import { useApp, useMaterial, useModel } from "@playcanvas/react/hooks";
import { BLEND_NORMAL, Entity as PlayCanvasEntity, MeshInstance, StandardMaterial, type Material, type Mesh } from "playcanvas";
import { memo, useEffect, useMemo, useState } from "react";

import { ORION_ASSET_PATHS } from "@/engine/orion/assets/AssetPaths";
import { OrionSkinnedCharacterAnimation } from "@/engine/orion/player/OrionSkinnedCharacterAnimation";
import { DRIVER_NAME, driverSeatLocal } from "@/engine/orion/traffic/Carjack";
import { carHalfHeight, getCarMeshes } from "@/engine/orion/traffic/CarMeshes";
import { OrionVehicle } from "@/engine/orion/traffic/OrionVehicle";
import { OrionVehicleModel } from "@/engine/orion/traffic/OrionVehicleModel";
import { pickVehicleModel, VEHICLE_MODEL_BASE, type VehicleModelSpec } from "@/engine/orion/traffic/VehicleModels";
import { ROAD_TOP_Y } from "@/engine/orion/traffic/TrafficSignals";
import { ORION_VEHICLES, VEHICLE_SHAPES, type VehicleSpawn, type VehicleStyle } from "@/engine/orion/traffic/Vehicles";

export interface VehicleMaterials {
	body: Material;
	glass: Material;
	brakeOn: Material;
	brakeOff: Material;
	flashRed: Material;
	flashBlue: Material;
	flashOff: Material;
}

/**
 * Materials every car shares. Paint lives in vertex colours, so one body material serves all.
 *
 * Car paint is a dielectric base coat under a clear lacquer, not a metal. With metalness on,
 * the base colour went into tinted reflections instead of diffuse, which turned white paint a
 * flat grey — the same tone as the road and the sky, so white cars all but disappeared.
 */
export function useVehicleMaterials(): VehicleMaterials {
	const glass = useGlassMaterial();
	return {
		body: useMaterial({ diffuse: "#ffffff", diffuseVertexColor: true, gloss: 0.6, metalness: 0, useMetalness: true, clearCoat: 1, clearCoatGloss: 0.9 }),
		glass,
		brakeOn: useMaterial({ diffuse: "#ff3030", emissive: "#ff1f1f", emissiveIntensity: 3, gloss: 0.8 }),
		brakeOff: useMaterial({ diffuse: "#6a0f0f", emissive: "#3a0000", emissiveIntensity: 1, gloss: 0.8 }),
		flashRed: useMaterial({ diffuse: "#ff2020", emissive: "#ff1a1a", emissiveIntensity: 5 }),
		flashBlue: useMaterial({ diffuse: "#2050ff", emissive: "#1a4dff", emissiveIntensity: 5 }),
		flashOff: useMaterial({ diffuse: "#2a2a30", gloss: 0.7 }),
	};
}

/**
 * Tinted but see-through, so the driver inside shows. Built by hand because `useMaterial`
 * silently drops `blendType` and `depthWrite`, which left the windows opaque.
 */
function useGlassMaterial(): Material {
	const app = useApp();
	const material = useMemo(() => {
		const glass = new StandardMaterial();
		glass.diffuse.fromString("#22313b");
		glass.gloss = 0.92;
		glass.opacity = 0.55;
		glass.blendType = BLEND_NORMAL;
		glass.depthWrite = false;
		glass.update();
		return glass;
	// Rebuilt per app instance (as useMaterial does), though the body doesn't read it.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [app]);
	useEffect(() => () => material.destroy(), [material]);
	return material;
}

/**
 * The traffic pool. Like pedestrians, cars are a fixed set that recycle themselves near the
 * player, so nothing mounts or unmounts while driving around.
 */
export const Vehicles = memo(function Vehicles() {
	const materials = useVehicleMaterials();
	return (
		<>
			{ORION_VEHICLES.map((vehicle) => <VehicleVisual key={vehicle.id} vehicle={vehicle} materials={materials} />)}
		</>
	);
});

/** Where a parked car lives: x, z, heading (degrees about Y) and the ground height there. */
export interface VehicleHome {
	x: number;
	z: number;
	yaw: number;
	ground: number;
}

/**
 * A car parked at a fixed spot with nobody in it (the police station's patrol cars). It's a
 * full car — the player can get in and drive it off — and goes back to its bay once it's been
 * left somewhere out of sight.
 */
export function ParkedVehicle({ vehicle, home }: Readonly<{ vehicle: VehicleSpawn; home: VehicleHome }>) {
	const materials = useVehicleMaterials();
	return <VehicleVisual vehicle={vehicle} materials={materials} home={home} />;
}

function VehicleVisual({ vehicle, materials, home }: Readonly<{ vehicle: VehicleSpawn; materials: VehicleMaterials; home?: VehicleHome }>) {
	const shape = VEHICLE_SHAPES[vehicle.style];
	const halfHeight = carHalfHeight(vehicle.style);
	const modelSpec = pickVehicleModel(vehicle.style, vehicle.seed);
	const position: [number, number, number] = home ? [home.x, home.ground + halfHeight, home.z] : [0, ROAD_TOP_Y + halfHeight, 0];

	return (
		<Entity name={vehicle.id} position={position}>
			<Collision type="box" halfExtents={[shape.width / 2, halfHeight, shape.length / 2]} />
			<RigidBody type="kinematic" />
			{/* The model stands on y = 0, so shift it down to the collision box centre. */}
			{modelSpec ? (
				<GlbCar spec={modelSpec} vehicle={vehicle} materials={materials} offsetY={-halfHeight} />
			) : (
				<CarModel style={vehicle.style} paint={vehicle.colour} materials={materials} offsetY={-halfHeight} />
			)}
			{home ? null : <CarDriver position={driverSeatLocal(vehicle.style)} />}
			<Script
				script={OrionVehicle}
				seed={vehicle.seed}
				style={vehicle.style}
				paint={vehicle.colour}
				maxSpeed={shape.maxSpeed * vehicle.speedFactor}
				halfLength={shape.length / 2}
				halfWidth={shape.width / 2}
				halfHeight={halfHeight}
				police={vehicle.style === "police"}
				homeX={home?.x ?? Number.NaN}
				homeZ={home?.z ?? 0}
				homeYaw={home?.yaw ?? 0}
				homeGround={home?.ground ?? 0}
				brakeOn={materials.brakeOn}
				brakeOff={materials.brakeOff}
				flashRedOn={materials.flashRed}
				flashBlueOn={materials.flashBlue}
				flashOff={materials.flashOff}
			/>
		</Entity>
	);
}

/** Same scale as the player: the citizen GLB's armature is authored 4.75 units tall. */
const DRIVER_SCALE = 1.8 / 4.75;

/** The person at the wheel, sitting until the player drags them out (see CarjackRig). */
function CarDriver({ position }: Readonly<{ position: [number, number, number] }>) {
	const { asset } = useModel(ORION_ASSET_PATHS.character);
	if (!asset) return null;
	return (
		<Entity name={DRIVER_NAME} position={position} scale={[DRIVER_SCALE, DRIVER_SCALE, DRIVER_SCALE]}>
			<Container asset={asset}>
				<Script script={OrionSkinnedCharacterAnimation} asset={asset} followPlayerAction={false} forcedState="Sitting" />
			</Container>
		</Entity>
	);
}

/**
 * A real car model. The procedural body stands in while the file loads, or if it fails to.
 */
function GlbCar({ spec, vehicle, materials, offsetY }: Readonly<{
	spec: VehicleModelSpec;
	vehicle: VehicleSpawn;
	materials: VehicleMaterials;
	offsetY: number;
}>) {
	const { asset, error } = useModel(`${VEHICLE_MODEL_BASE}/${spec.file}`);
	if (error || !asset) {
		return <CarModel style={vehicle.style} paint={vehicle.colour} materials={materials} offsetY={offsetY} />;
	}
	return (
		<Entity name="car-model" position={[0, offsetY, 0]}>
			<Entity name="car-model-fit">
				<Container asset={asset} />
			</Entity>
			<Script
				script={OrionVehicleModel}
				spec={spec}
				paint={vehicle.colour}
				police={vehicle.style === "police"}
				flashOff={materials.flashOff}
			/>
		</Entity>
	);
}

/**
 * A car from merged meshes: one draw call for the body, plus the brake lights and (police)
 * beacons as separately named children so OrionVehicle can switch their materials.
 */
export function CarModel({ style, paint, materials, offsetY = 0 }: Readonly<{
	style: VehicleStyle;
	paint: string;
	materials: VehicleMaterials;
	offsetY?: number;
}>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const { body, glass, brakeOff, flashOff } = materials;

	useEffect(() => {
		if (!app || !root) return;
		const meshes = getCarMeshes(app.graphicsDevice, style, paint);
		const parts: [string, Mesh | null, Material, boolean][] = [
			["car-body", meshes.body, body, true],
			["car-glass", meshes.glass, glass, false],
			["brake-light", meshes.brake, brakeOff, false],
			["beacon-red", meshes.beaconRed, flashOff, false],
			["beacon-blue", meshes.beaconBlue, flashOff, false],
		];
		const created: PlayCanvasEntity[] = [];
		for (const [name, mesh, material, castShadows] of parts) {
			if (!mesh) continue;
			const part = new PlayCanvasEntity(name);
			part.addComponent("render", { meshInstances: [new MeshInstance(mesh, material)], castShadows, receiveShadows: true });
			root.addChild(part);
			created.push(part);
		}
		// Meshes are shared between cars through the cache, so only the entities go here.
		return () => {
			for (const part of created) part.destroy();
		};
	}, [app, root, style, paint, body, glass, brakeOff, flashOff]);

	return <Entity ref={setRoot} name="car-model" position={[0, offsetY, 0]} />;
}
