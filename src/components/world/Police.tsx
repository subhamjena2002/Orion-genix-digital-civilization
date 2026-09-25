"use client";

import { Container, Entity } from "@playcanvas/react";
import { Collision, Render, RigidBody, Script } from "@playcanvas/react/components";
import { useApp, useMaterial, useModel } from "@playcanvas/react/hooks";
import { ADDRESS_CLAMP_TO_EDGE, Texture, type Entity as PlayCanvasEntity, type Material } from "playcanvas";
import { memo, useEffect, useMemo, useState } from "react";

import { OrionPoliceOfficer } from "@/engine/orion/police/OrionPoliceOfficer";
import { OFFICER_POSTS, PARKED_PATROL_CARS, POLICE_STATION, POLICE_UNIFORM, type OfficerPost } from "@/engine/orion/police/Police";
import { PAVEMENT_TOP_Y } from "@/engine/orion/roads/RoadNetwork";
import { ParkedVehicle } from "./Vehicles";

type Vec3 = [number, number, number];

const OFFICER_MODELS = {
	man: { path: "/models/characters/orion-citizen/orion-citizen-casual.glb", nativeHeight: 4.74 },
	woman: { path: "/models/characters/orion-citizen/citizen-woman-a.glb", nativeHeight: 1.8 },
} as const;
const HUMAN_HEIGHT = 1.8;
/** The compound sits on the terrain, a step below pavement level. */
const GROUND_Y = -0.65;
const LOT_THICKNESS = 0.06;

export const Police = memo(function Police() {
	return (
		<>
			<PoliceStation />
			{OFFICER_POSTS.map((post) => <Officer key={post.id} post={post} />)}
		</>
	);
});

function Officer({ post }: Readonly<{ post: OfficerPost }>) {
	const spec = OFFICER_MODELS[post.model];
	const { asset } = useModel(spec.path);
	const [cap, setCap] = useState<PlayCanvasEntity | null>(null);
	const capMaterial = useMaterial({ diffuse: POLICE_UNIFORM.cap, gloss: 0.2 });
	const bandMaterial = useMaterial({ diffuse: POLICE_UNIFORM.capBand, gloss: 0.3 });
	const peakMaterial = useMaterial({ diffuse: "#1a1a1a", gloss: 0.6 });
	if (!asset) return null;

	const scale = HUMAN_HEIGHT / spec.nativeHeight;
	return (
		<Entity name={post.id} position={[post.position[0], PAVEMENT_TOP_Y, post.position[1]]}>
			<Entity name="officer-model" scale={[scale, scale, scale]}>
				<Container asset={asset} />
			</Entity>
			{/* Peaked cap: crown, coloured band and a black peak at the front (+Z). */}
			<Entity ref={setCap} name="police-cap">
				<Entity position={[0, 0.02, 0]} scale={[0.25, 0.07, 0.27]}>
					<Render type="cylinder" material={capMaterial} />
				</Entity>
				<Entity position={[0, -0.03, 0]} scale={[0.23, 0.04, 0.25]}>
					<Render type="cylinder" material={bandMaterial} />
				</Entity>
				<Entity position={[0, -0.05, 0.13]} scale={[0.2, 0.015, 0.1]}>
					<Render type="box" material={peakMaterial} />
				</Entity>
			</Entity>
			{/* Mounted once the cap exists, so the script can drive it from its first frame. */}
			{cap ? <Script script={OrionPoliceOfficer} asset={asset} yaw={post.yaw} seed={post.seed} cap={cap} /> : null}
		</Entity>
	);
}

/**
 * A two-storey station in the blue-and-cream style common to Indian police buildings, with a
 * bilingual sign, a flag, a roof beacon and a parking lot for the patrol cars.
 */
function PoliceStation() {
	const [cx, cz] = POLICE_STATION.position;
	const [width, depth] = POLICE_STATION.footprint;
	const wall = useMaterial({ diffuse: "#efe6d2", gloss: 0.18 });
	const blue = useMaterial({ diffuse: "#1b3f94", gloss: 0.35 });
	const stone = useMaterial({ diffuse: "#8d8a82", gloss: 0.12 });
	const glass = useMaterial({ diffuse: "#1a2630", gloss: 0.9, metalness: 0.3, useMetalness: true });
	const door = useMaterial({ diffuse: "#23324f", gloss: 0.4 });
	const asphalt = useMaterial({ diffuse: "#34373a", gloss: 0.15 });
	const lotPaint = useMaterial({ diffuse: "#e8e6df", gloss: 0.2 });
	const pole = useMaterial({ diffuse: "#c9cbcc", gloss: 0.7, metalness: 0.6, useMetalness: true });
	const saffron = useMaterial({ diffuse: "#ff9933", gloss: 0.1 });
	const white = useMaterial({ diffuse: "#ffffff", gloss: 0.1 });
	const green = useMaterial({ diffuse: "#138808", gloss: 0.1 });
	const chakra = useMaterial({ diffuse: "#000080", gloss: 0.1 });
	const beacon = useMaterial({ diffuse: "#2050ff", emissive: "#1a4dff", emissiveIntensity: 3 });
	const sign = useSignMaterial();

	const groundFloor = 3.6;
	const upperFloor = 3.4;
	const plinth = 0.5;
	const front = depth / 2;
	const floorBase = GROUND_Y + plinth;
	const totalHeight = groundFloor + upperFloor;
	const windowColumns = [-6, -3.6, 3.6, 6];

	const [lotX, lotZ] = POLICE_STATION.lot.position;
	const [lotWidth, lotDepth] = POLICE_STATION.lot.size;

	return (
		<>
			<Entity name="police-station" position={[cx, 0, cz]}>
				<Box position={[0, GROUND_Y + plinth / 2, 0]} scale={[width + 1, plinth, depth + 1]} material={stone} />
				<Entity name="station-body" position={[0, floorBase + totalHeight / 2, 0]} scale={[width, totalHeight, depth]}>
					<Render type="box" material={wall} castShadows receiveShadows />
					{/* Primitive colliders ignore entity scale, so the size is passed explicitly. */}
					<Collision type="box" halfExtents={[width / 2, totalHeight / 2, depth / 2]} />
					<RigidBody type="static" />
				</Entity>
				<Box position={[0, floorBase + groundFloor, 0]} scale={[width + 0.3, 0.35, depth + 0.3]} material={blue} />
				<Box position={[0, floorBase + totalHeight + 0.3, 0]} scale={[width + 0.4, 0.6, depth + 0.4]} material={blue} />
				<Box position={[0, floorBase + 0.3, 0]} scale={[width + 0.1, 0.6, depth + 0.1]} material={blue} />

				{windowColumns.flatMap((x) => [floorBase + 1.9, floorBase + groundFloor + 1.7].map((y) => (
					<Box key={`${x}-${y}`} position={[x, y, front + 0.03]} scale={[1.5, 1.4, 0.08]} material={glass} />
				)))}
				{[-4.5, -1.5, 1.5, 4.5].map((z) => [-1, 1].map((side) => (
					<Box key={`side-${side}-${z}`} position={[side * (width / 2 + 0.03), floorBase + groundFloor + 1.7, z]} scale={[0.08, 1.4, 1.5]} material={glass} />
				)))}

				{/* Entrance portico. */}
				<Box position={[0, floorBase + 1.3, front + 0.04]} scale={[2.2, 2.6, 0.1]} material={door} />
				<Box position={[0, floorBase + 3.05, front + 1.3]} scale={[4.6, 0.25, 2.8]} material={blue} />
				{[-2, 2].map((x) => (
					<Entity key={x} position={[x, floorBase + 1.5, front + 2.4]} scale={[0.3, 3, 0.3]}>
						<Render type="cylinder" material={wall} castShadows />
						<Collision type="cylinder" radius={0.15} height={3} />
						<RigidBody type="static" />
					</Entity>
				))}
				<Box position={[0, GROUND_Y + 0.2, front + 1.6]} scale={[5, 0.4, 3.2]} material={stone} />

				{/* Sign over the portico. */}
				<Box position={[0, floorBase + groundFloor + upperFloor * 0.2, front + 0.12]} scale={[9, 1.3, 0.12]} material={sign} />

				{/* Roof beacon. */}
				<Box position={[0, floorBase + totalHeight + 0.8, 0]} scale={[0.6, 0.4, 0.6]} material={beacon} />

				{/* Flag. */}
				<Entity position={[width / 2 + 1.5, GROUND_Y + 4, front + 0.5]} scale={[0.1, 8, 0.1]}>
					<Render type="cylinder" material={pole} castShadows />
					<Collision type="cylinder" radius={0.05} height={8} />
					<RigidBody type="static" />
				</Entity>
				{([[saffron, 0.4], [white, 0], [green, -0.4]] as [Material, number][]).map(([material, offset]) => (
					<Box key={offset} position={[width / 2 + 2.55, GROUND_Y + 7.3 + offset, front + 0.5]} scale={[2, 0.4, 0.03]} material={material} />
				))}
				<Entity position={[width / 2 + 2.55, GROUND_Y + 7.3, front + 0.52]} rotation={[90, 0, 0]} scale={[0.3, 0.01, 0.3]}>
					<Render type="cylinder" material={chakra} />
				</Entity>
			</Entity>

			<Entity name="police-lot" position={[lotX, 0, lotZ]}>
				<Entity position={[0, GROUND_Y + LOT_THICKNESS / 2, 0]} scale={[lotWidth, LOT_THICKNESS, lotDepth]}>
					<Render type="box" material={asphalt} castShadows receiveShadows />
					{/* Solid, so cars parked or driven here stand on the asphalt rather than the terrain under it. */}
					<Collision type="box" halfExtents={[lotWidth / 2, LOT_THICKNESS / 2, lotDepth / 2]} />
					<RigidBody type="static" friction={0.9} />
				</Entity>
				{[-6.75, -2.25, 2.25, 6.75].map((x) => (
					<Box key={x} position={[x, GROUND_Y + 0.07, -1]} scale={[0.12, 0.02, 6]} material={lotPaint} />
				))}
			</Entity>

			{/* Real cars: the player can get in and drive them off (see ParkedVehicle). */}
			{PARKED_PATROL_CARS.map((car, index) => (
				<ParkedVehicle
					key={car.id}
					vehicle={{ id: car.id, style: "police", colour: "#f4f4f2", seed: 9001 + index, speedFactor: 1 }}
					home={{ x: car.position[0], z: car.position[1], yaw: car.yaw, ground: GROUND_Y + LOT_THICKNESS }}
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

/** "POLICE STATION / पुलिस थाना" painted onto a canvas and used as a lit sign texture. */
function useSignMaterial(): Material {
	const app = useApp();
	const texture = useMemo(() => {
		if (!app || typeof document === "undefined") return null;
		const canvas = document.createElement("canvas");
		canvas.width = 1024;
		canvas.height = 148;
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.fillStyle = "#1b3f94";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = "#ffffff";
		context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
		context.fillStyle = "#1b3f94";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.font = "bold 58px Arial, sans-serif";
		context.fillText("POLICE STATION", canvas.width / 2, 50);
		context.font = "bold 44px 'Nirmala UI', 'Noto Sans Devanagari', 'Mangal', sans-serif";
		context.fillStyle = "#8a1c1c";
		context.fillText("पुलिस थाना", canvas.width / 2, 108);

		const signTexture = new Texture(app.graphicsDevice, {
			width: canvas.width,
			height: canvas.height,
			addressU: ADDRESS_CLAMP_TO_EDGE,
			addressV: ADDRESS_CLAMP_TO_EDGE,
			mipmaps: true,
		});
		signTexture.setSource(canvas);
		return signTexture;
	}, [app]);

	useEffect(() => () => texture?.destroy(), [texture]);

	return useMaterial(texture
		? { diffuse: "#ffffff", diffuseMap: texture, emissive: "#ffffff", emissiveMap: texture, emissiveIntensity: 0.35, gloss: 0.3 }
		: { diffuse: "#ffffff" });
}
