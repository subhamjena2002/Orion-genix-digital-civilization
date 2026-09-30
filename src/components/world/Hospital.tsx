"use client";

import { Entity } from "@playcanvas/react";
import { Collision, Render, RigidBody } from "@playcanvas/react/components";
import { useApp, useMaterial } from "@playcanvas/react/hooks";
import { ADDRESS_CLAMP_TO_EDGE, Texture, type Material } from "playcanvas";
import { memo, useEffect, useMemo } from "react";

import { HOSPITALS, type HospitalDef } from "@/engine/orion/world/Hospitals";

import { ParkedVehicle } from "./Vehicles";

type Vec3 = [number, number, number];

/** The compound sits on the terrain, a step below pavement level (as the police station does). */
const GROUND_Y = -0.65;
const BAY_THICKNESS = 0.06;

/**
 * The hospitals (see engine/world/Hospitals): a two-storey block in white with a green band,
 * a canopy over the entrance, a lit red cross on the roof and the name in English and Hindi,
 * and an ambulance bay beside it where the ambulances wait.
 */
export const Hospitals = memo(function Hospitals() {
	return (
		<>
			{HOSPITALS.map((hospital) => <Hospital key={hospital.id} hospital={hospital} />)}
		</>
	);
});

function Hospital({ hospital }: Readonly<{ hospital: HospitalDef }>) {
	const [cx, cz] = hospital.position;
	const [width, depth] = hospital.footprint;
	const wall = useMaterial({ diffuse: "#f3f4f1", gloss: 0.22 });
	const band = useMaterial({ diffuse: "#1f7a5a", gloss: 0.35 });
	const stone = useMaterial({ diffuse: "#9a978f", gloss: 0.12 });
	const glass = useMaterial({ diffuse: "#1c2a33", gloss: 0.9, metalness: 0.3, useMetalness: true });
	const door = useMaterial({ diffuse: "#dfe9ee", gloss: 0.8, opacity: 1 });
	const cross = useMaterial({ diffuse: "#d11a1a", emissive: "#ff2020", emissiveIntensity: 2.2, gloss: 0.4 });
	const crossBack = useMaterial({ diffuse: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6, gloss: 0.3 });
	const asphalt = useMaterial({ diffuse: "#34373a", gloss: 0.15 });
	const paint = useMaterial({ diffuse: "#f0d34a", gloss: 0.2 });
	const sign = useHospitalSign(hospital.name);

	const plinth = 0.5;
	const groundFloor = 3.8;
	const upperFloor = 3.4;
	const floorBase = GROUND_Y + plinth;
	const totalHeight = groundFloor + upperFloor;
	const front = depth / 2;
	const windowColumns = [-7, -4.6, -2.2, 2.2, 4.6, 7];
	const [bx, bz] = hospital.bay.position;
	const [bayWidth, bayDepth] = hospital.bay.size;
	// Built with the entrance towards +Z, then turned to face the road.
	const turn: Vec3 = [0, hospital.facing > 0 ? 0 : 180, 0];

	return (
		<>
			<Entity name={hospital.id} position={[cx, 0, cz]} rotation={turn}>
				<Box position={[0, GROUND_Y + plinth / 2, 0]} scale={[width + 1, plinth, depth + 1]} material={stone} />
				<Entity name="hospital-body" position={[0, floorBase + totalHeight / 2, 0]} scale={[width, totalHeight, depth]}>
					<Render type="box" material={wall} castShadows receiveShadows />
					{/* Primitive colliders ignore entity scale, so the size is passed explicitly. */}
					<Collision type="box" halfExtents={[width / 2, totalHeight / 2, depth / 2]} />
					<RigidBody type="static" />
				</Entity>
				{/* Green bands at the floor line and the parapet. */}
				<Box position={[0, floorBase + groundFloor, 0]} scale={[width + 0.3, 0.3, depth + 0.3]} material={band} />
				<Box position={[0, floorBase + totalHeight + 0.3, 0]} scale={[width + 0.4, 0.6, depth + 0.4]} material={band} />

				{windowColumns.flatMap((x) => [floorBase + 1.9, floorBase + groundFloor + 1.7].map((y) => (
					<Box key={`${x}-${y}`} position={[x, y, front + 0.03]} scale={[1.6, 1.4, 0.08]} material={glass} />
				)))}
				{[-3.5, 0, 3.5].map((z) => [-1, 1].map((side) => (
					<Box key={`side-${side}-${z}`} position={[side * (width / 2 + 0.03), floorBase + groundFloor + 1.7, z]} scale={[0.08, 1.4, 1.6]} material={glass} />
				)))}

				{/* Entrance: glass doors under a wide canopy on two posts, a ramp up to them. */}
				<Box position={[0, floorBase + 1.3, front + 0.04]} scale={[3, 2.6, 0.1]} material={door} />
				<Box position={[0, floorBase + 3.1, front + 1.8]} scale={[7, 0.25, 3.8]} material={band} />
				{[-3.2, 3.2].map((x) => (
					<Entity key={x} position={[x, floorBase + 1.55, front + 3.4]} scale={[0.3, 3.1, 0.3]}>
						<Render type="cylinder" material={wall} castShadows />
						<Collision type="cylinder" radius={0.15} height={3.1} />
						<RigidBody type="static" />
					</Entity>
				))}
				<Box position={[0, GROUND_Y + 0.2, front + 2]} scale={[6, 0.4, 4]} material={stone} />

				{/* Name over the canopy, and the red cross high on the front and on the roof. */}
				<Box position={[0, floorBase + groundFloor + upperFloor * 0.25, front + 0.12]} scale={[10, 1.3, 0.12]} material={sign} />
				<Box position={[width / 2 - 2, floorBase + groundFloor + upperFloor * 0.55, front + 0.1]} scale={[1.8, 1.8, 0.1]} material={crossBack} />
				<Box position={[width / 2 - 2, floorBase + groundFloor + upperFloor * 0.55, front + 0.17]} scale={[1.4, 0.45, 0.06]} material={cross} />
				<Box position={[width / 2 - 2, floorBase + groundFloor + upperFloor * 0.55, front + 0.17]} scale={[0.45, 1.4, 0.06]} material={cross} />
				<Box position={[0, floorBase + totalHeight + 1.4, 0]} scale={[2.6, 0.5, 0.5]} material={cross} />
				<Box position={[0, floorBase + totalHeight + 1.4, 0]} scale={[0.5, 0.5, 2.6]} material={cross} />
			</Entity>

			{/* The ambulance bay: asphalt, a painted AMBULANCE box per bay, and the ambulances. */}
			<Entity name={`${hospital.id}-bay`} position={[bx, 0, bz]}>
				<Entity position={[0, GROUND_Y + BAY_THICKNESS / 2, 0]} scale={[bayWidth, BAY_THICKNESS, bayDepth]}>
					<Render type="box" material={asphalt} castShadows receiveShadows />
					{/* Solid, so parked and driven cars stand on it rather than the terrain under it. */}
					<Collision type="box" halfExtents={[bayWidth / 2, BAY_THICKNESS / 2, bayDepth / 2]} />
					<RigidBody type="static" friction={0.9} />
				</Entity>
			</Entity>
			{hospital.ambulances.map((ambulance) => {
				const [ax, az] = ambulance.position;
				return (
					<Entity key={`${ambulance.id}-lines`} position={[ax, GROUND_Y + BAY_THICKNESS + 0.005, az]} rotation={[0, ambulance.yaw, 0]}>
						{[-1.6, 1.6].map((x) => <Box key={x} position={[x, 0, 0]} scale={[0.14, 0.01, 7.4]} material={paint} />)}
						<Box position={[0, 0, -3.65]} scale={[3.34, 0.01, 0.14]} material={paint} />
					</Entity>
				);
			})}
			{hospital.ambulances.map((ambulance, index) => (
				<ParkedVehicle
					key={ambulance.id}
					vehicle={{ id: ambulance.id, style: "ambulance", colour: "#ffffff", seed: 4201 + index * 17 + hospital.id.length, speedFactor: 1 }}
					home={{ x: ambulance.position[0], z: ambulance.position[1], yaw: ambulance.yaw, ground: GROUND_Y + BAY_THICKNESS }}
				/>
			))}
		</>
	);
}

function Box({ position, scale, material }: Readonly<{ position: Vec3; scale: Vec3; material: Material }>) {
	return (
		<Entity position={position} scale={scale}>
			<Render type="box" material={material} castShadows receiveShadows />
		</Entity>
	);
}

/** The hospital's name in English and Hindi, painted onto a canvas as a lit sign. */
function useHospitalSign(name: string): Material {
	const app = useApp();
	const texture = useMemo(() => {
		if (!app || typeof document === "undefined") return null;
		const canvas = document.createElement("canvas");
		canvas.width = 1024;
		canvas.height = 148;
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.fillStyle = "#1f7a5a";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = "#ffffff";
		context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillStyle = "#1f7a5a";
		context.font = "bold 56px Arial, sans-serif";
		context.fillText(name.toUpperCase(), canvas.width / 2, 50);
		context.font = "bold 44px 'Nirmala UI', 'Noto Sans Devanagari', 'Mangal', sans-serif";
		context.fillStyle = "#b31b1b";
		context.fillText("अस्पताल", canvas.width / 2, 108);
		const signTexture = new Texture(app.graphicsDevice, {
			width: canvas.width,
			height: canvas.height,
			addressU: ADDRESS_CLAMP_TO_EDGE,
			addressV: ADDRESS_CLAMP_TO_EDGE,
			mipmaps: true,
		});
		signTexture.setSource(canvas);
		return signTexture;
	}, [app, name]);

	useEffect(() => () => texture?.destroy(), [texture]);

	return useMaterial(texture
		? { diffuse: "#ffffff", diffuseMap: texture, emissive: "#ffffff", emissiveMap: texture, emissiveIntensity: 0.35, gloss: 0.3 }
		: { diffuse: "#ffffff" });
}
