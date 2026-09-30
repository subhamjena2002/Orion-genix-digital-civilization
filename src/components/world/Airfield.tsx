"use client";

import { Entity } from "@playcanvas/react";
import { Collision, Render, RigidBody } from "@playcanvas/react/components";
import { useApp, useMaterial } from "@playcanvas/react/hooks";
import {
	ADDRESS_CLAMP_TO_EDGE,
	Color,
	Entity as PlayCanvasEntity,
	MeshInstance,
	StandardMaterial,
	Texture,
	Vec2,
	type AppBase,
	type Material,
	type Mesh,
} from "playcanvas";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import {
	AIRFIELD_LABELS,
	AIRFIELD_LIGHTS,
	AIRFIELD_MARKINGS,
	AIRFIELD_SURFACES,
	AIRFIELD_VEHICLES,
	buildShelterMesh,
	CONTROL_TOWER,
	SHELTERS,
	STANDS,
	WINDSOCK,
	type Paint,
	type PaintedLabel,
	type Surface,
	type SurfaceKind,
} from "@/engine/orion/world/Airfield";
import { addQuad, addVertex, emptyMesh } from "@/engine/orion/world/MeshData";

import { Jet } from "./Jet";
import { ParkedVehicle } from "./Vehicles";
import { compileUpFront, toCollisionMesh, toMesh } from "./WorldMesh";

type Vec3Tuple = [number, number, number];

/** The terrain plane, and paving laid on it (as at the base). */
const GROUND_Y = -0.65;
const PAD_THICKNESS = 0.06;
const GROUND_TOP = GROUND_Y + PAD_THICKNESS;
/**
 * Paint stands 3 cm proud of the paving: any closer and, a few hundred metres down the
 * runway, the depth buffer can't tell them apart and the stripes flicker.
 */
const PAINT_TOP = GROUND_TOP + 0.03;
const PAINT_THICKNESS = 0.01;
/** Metres per repeat of the asphalt texture on the paving. */
const PAVING_UNIT = 6;
const SHELTER_TEXTURE_UNIT = 5;
/** Stands with a jet on them, and how far the jet's centre of mass sits east of the stand's mark (its nose wheel on the stop bar). */
const JET_STANDS = STANDS.slice(0, 2);
const JET_ON_STAND = 1.5;

const SURFACE_COLOURS: Readonly<Record<SurfaceKind, string>> = {
	runway: "#6f6f6f",
	shoulder: "#a39f95",
	blastPad: "#858585",
	taxiway: "#878787",
	apron: "#b9b3a7",
	shelterApron: "#b9b3a7",
};

const PAINT_COLOURS: Readonly<Record<Paint, string>> = { white: "#ecebe4", yellow: "#e2b126" };

/**
 * The airfield beside the army base (see engine/world/Airfield): runway, taxiway, apron and
 * shelters as solid paving, painted and lit, with a control tower and a windsock.
 *
 * The paint, lights and painted numbers go into one static batch; the shelters share one mesh.
 */
export const Airfield = memo(function Airfield({ asphaltDiffuse, asphaltNormal }: Readonly<{ asphaltDiffuse: Texture | null; asphaltNormal: Texture | null }>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const surfaces = useSurfaceMaterials(asphaltDiffuse, asphaltNormal);
	const white = useMaterial({ diffuse: PAINT_COLOURS.white, gloss: 0.3 });
	const yellow = useMaterial({ diffuse: PAINT_COLOURS.yellow, gloss: 0.3 });
	const whiteLight = useMaterial({ diffuse: "#fff4cf", emissive: "#fff4cf", emissiveIntensity: 1.5 });
	const greenLight = useMaterial({ diffuse: "#5dff84", emissive: "#5dff84", emissiveIntensity: 1.5 });
	const blueLight = useMaterial({ diffuse: "#5d86ff", emissive: "#5d86ff", emissiveIntensity: 1.5 });
	const labels = usePaintedLabels(app);
	// Weathered concrete: the asphalt's grain for relief, but its dark colour would make the
	// arches read as tunnel mouths.
	const shelterConcrete = useMaterial(asphaltNormal
		? { diffuse: "#aaa596", normalMap: asphaltNormal, bumpiness: 0.7, gloss: 0.15 }
		: { diffuse: "#aaa596", gloss: 0.15 });
	const concrete = useMaterial({ diffuse: "#bdb7aa", gloss: 0.2 });
	const darkConcrete = useMaterial({ diffuse: "#6d6a63", gloss: 0.2 });
	const glass = useMaterial({ diffuse: "#1c2b35", gloss: 0.9, metalness: 0.4, useMetalness: true });
	const windsockCloth = useMaterial({ diffuse: "#e8641c", gloss: 0.1 });
	const sign = useStationSign();
	const shelterMaterial = useRef<Material>(shelterConcrete);

	// Paint, painted numbers and lights: one static batch.
	useEffect(() => {
		if (!app || !root) return;
		const batcher = app.batcher;
		const group = batcher?.addGroup("airfield", false, 200) ?? null;
		const holder = new PlayCanvasEntity("airfield-paint");
		root.addChild(holder);
		const place = (entity: PlayCanvasEntity, position: Vec3Tuple, scale: Vec3Tuple, yaw: number) => {
			holder.addChild(entity);
			entity.setLocalPosition(...position);
			entity.setLocalEulerAngles(0, yaw, 0);
			entity.setLocalScale(...scale);
		};
		const batchGroupId = group?.id ?? -1;
		const paint = { white, yellow };
		for (const marking of AIRFIELD_MARKINGS) {
			const entity = new PlayCanvasEntity("paint");
			entity.addComponent("render", { type: "box", material: paint[marking.paint], castShadows: false, receiveShadows: true, batchGroupId });
			place(entity, [marking.x, PAINT_TOP - PAINT_THICKNESS / 2, marking.z], [marking.width, PAINT_THICKNESS, marking.depth], marking.yaw);
		}
		const lights = { white: whiteLight, green: greenLight, blue: blueLight };
		for (const light of AIRFIELD_LIGHTS) {
			const entity = new PlayCanvasEntity("light");
			entity.addComponent("render", { type: "box", material: lights[light.colour], castShadows: false, receiveShadows: false, batchGroupId });
			place(entity, [light.x, GROUND_TOP + 0.18, light.z], [0.28, 0.36, 0.28], 0);
		}
		const quad = labelQuad(app);
		const labelInstances: MeshInstance[] = [];
		for (const label of AIRFIELD_LABELS) {
			const material = labels.get(`${label.paint}:${label.text}`);
			if (!material) continue;
			const entity = new PlayCanvasEntity(`label-${label.text}`);
			const instance = new MeshInstance(quad, material);
			labelInstances.push(instance);
			entity.addComponent("render", { meshInstances: [instance], castShadows: false, receiveShadows: true, batchGroupId });
			place(entity, [label.x, PAINT_TOP + 0.004, label.z], [label.width, 1, label.height], LABEL_YAW[label.up]);
		}
		return () => {
			holder.destroy();
			quad.destroy();
			if (group && batcher) batcher.removeGroup(group.id);
		};
	}, [app, root, white, yellow, whiteLight, greenLight, blueLight, labels]);

	// The shelters: one arch mesh, solid, each on its own apron.
	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const data = buildShelterMesh(SHELTER_TEXTURE_UNIT);
		const meshes: Mesh[] = [toMesh(device, data), toCollisionMesh(device, data)];
		const [mesh, collision] = meshes;
		const holders: PlayCanvasEntity[] = [];
		const instances: MeshInstance[] = [];
		for (const shelter of SHELTERS) {
			const holder = new PlayCanvasEntity(shelter.id);
			// In the scene and in place before the body is made: a static body stays where it's created.
			root.addChild(holder);
			holder.setPosition(shelter.backX, GROUND_TOP, shelter.z);
			const instance = new MeshInstance(mesh, shelterMaterial.current);
			instances.push(instance);
			holder.addComponent("render", { meshInstances: [instance], castShadows: true, receiveShadows: true });
			holder.addComponent("collision", { type: "mesh", render: { meshes: [collision] } as never });
			holder.addComponent("rigidbody", { type: "static", friction: 0.8 });
			holders.push(holder);
		}
		const stopCompiling = compileUpFront(app, instances);
		return () => {
			stopCompiling();
			for (const holder of holders) holder.destroy();
			for (const each of meshes) each.destroy();
		};
	}, [app, root]);

	useEffect(() => {
		// The texture streams in after the first render, which swaps the material.
		shelterMaterial.current = shelterConcrete;
		if (!root) return;
		for (const shelter of SHELTERS) {
			const holder = root.findByName(shelter.id) as PlayCanvasEntity | null;
			for (const instance of holder?.render?.meshInstances ?? []) instance.material = shelterConcrete;
		}
	}, [root, shelterConcrete]);

	const tower = CONTROL_TOWER;
	const block = tower.block;
	const cabBottom = GROUND_Y + tower.height + 0.4;

	return (
		<Entity ref={setRoot} name="airfield">
			{AIRFIELD_SURFACES.map((surface) => (
				<Entity key={surface.id} name={`airfield-${surface.id}`} position={[surface.x, GROUND_Y + PAD_THICKNESS / 2, surface.z]} scale={[surface.width, PAD_THICKNESS, surface.depth]}>
					<Render type="box" material={surfaces.get(surface.id) ?? concrete} receiveShadows castShadows={false} />
					<Collision type="box" halfExtents={[surface.width / 2, PAD_THICKNESS / 2, surface.depth / 2]} />
					<RigidBody type="static" friction={0.9} />
				</Entity>
			))}

			{/* The control tower: a concrete shaft, a gallery, the glass cab and a mast. */}
			<Solid position={[tower.x, GROUND_Y + tower.height / 2, tower.z]} scale={[tower.shaft, tower.height, tower.shaft]} material={concrete} />
			<Box position={[tower.x, GROUND_Y + tower.height + 0.2, tower.z]} scale={[tower.cab + 2, 0.4, tower.cab + 2]} material={darkConcrete} />
			<Box position={[tower.x, cabBottom + tower.cabHeight / 2, tower.z]} scale={[tower.cab, tower.cabHeight, tower.cab]} material={glass} />
			{[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
				<Box key={`${sx}${sz}`} position={[tower.x + sx * (tower.cab / 2 - 0.1), cabBottom + tower.cabHeight / 2, tower.z + sz * (tower.cab / 2 - 0.1)]} scale={[0.35, tower.cabHeight, 0.35]} material={darkConcrete} />
			)))}
			<Box position={[tower.x, cabBottom + tower.cabHeight + 0.3, tower.z]} scale={[tower.cab + 1.5, 0.6, tower.cab + 1.5]} material={darkConcrete} />
			<Box position={[tower.x + 2.5, cabBottom + tower.cabHeight + 3, tower.z + 2.5]} scale={[0.15, 5, 0.15]} material={darkConcrete} />

			{/* The operations block at its foot, with a band of windows and the station's name. */}
			<Solid position={[block.x, GROUND_Y + block.height / 2, block.z]} scale={[block.width, block.height, block.depth]} material={concrete} />
			<Box position={[block.x, GROUND_Y + 2, block.z + block.depth / 2 + 0.03]} scale={[block.width - 2, 1.3, 0.05]} material={glass} />
			<Entity position={[block.x, GROUND_Y + block.height - 0.75, block.z + block.depth / 2 + 0.04]} rotation={[0, 180, 0]} scale={[block.width - 3, 0.9, 0.04]}>
				<Render type="box" material={sign} castShadows={false} receiveShadows />
			</Entity>

			{/* The windsock, blowing out over the runway. */}
			<Box position={[WINDSOCK.x, GROUND_Y + WINDSOCK.height / 2, WINDSOCK.z]} scale={[0.12, WINDSOCK.height, 0.12]} material={darkConcrete} />
			<Entity position={[WINDSOCK.x - 1.8, GROUND_Y + WINDSOCK.height - 0.5, WINDSOCK.z]} rotation={[0, 0, 90]} scale={[1.1, 3.5, 1.1]}>
				<Render type="cone" material={windsockCloth} castShadows receiveShadows />
			</Entity>

			{/* Jets on their stands, nose east towards the taxiway. */}
			{JET_STANDS.map((stand) => (
				<Jet key={stand.number} x={stand.x + JET_ON_STAND} z={stand.z} ground={GROUND_TOP} heading={90} />
			))}

			{AIRFIELD_VEHICLES.map((vehicle, index) => (
				<ParkedVehicle
					key={vehicle.id}
					vehicle={{ id: vehicle.id, style: vehicle.style, colour: "#d9d6cc", seed: 9151 + index * 17, speedFactor: 1 }}
					home={{ x: vehicle.x, z: vehicle.z, yaw: vehicle.yaw, ground: GROUND_TOP }}
				/>
			))}
		</Entity>
	);
});

function Box({ position, scale, material }: Readonly<{ position: Vec3Tuple; scale: Vec3Tuple; material: Material }>) {
	return (
		<Entity position={position} scale={scale}>
			<Render type="box" material={material} castShadows receiveShadows />
		</Entity>
	);
}

/** A box you can't walk or drive through. */
function Solid({ position, scale, material }: Readonly<{ position: Vec3Tuple; scale: Vec3Tuple; material: Material }>) {
	return (
		<Entity position={position} scale={scale}>
			<Render type="box" material={material} castShadows receiveShadows />
			<Collision type="box" halfExtents={[scale[0] / 2, scale[1] / 2, scale[2] / 2]} />
			<RigidBody type="static" />
		</Entity>
	);
}

/** Paving, one material per surface so the asphalt keeps its scale on every size of slab. */
function useSurfaceMaterials(diffuse: Texture | null, normal: Texture | null): ReadonlyMap<string, StandardMaterial> {
	const materials = useMemo(() => new Map(AIRFIELD_SURFACES.map((surface) => [surface.id, surfaceMaterial(surface, diffuse, normal)])), [diffuse, normal]);
	// Destroyed a frame later, once the slabs have taken the new set.
	useEffect(() => () => {
		requestAnimationFrame(() => {
			for (const material of materials.values()) material.destroy();
		});
	}, [materials]);
	return materials;
}

function surfaceMaterial(surface: Surface, diffuse: Texture | null, normal: Texture | null): StandardMaterial {
	const material = new StandardMaterial();
	material.name = `airfield-${surface.id}`;
	material.diffuse = new Color().fromString(SURFACE_COLOURS[surface.kind]);
	material.gloss = surface.kind === "runway" || surface.kind === "taxiway" ? 0.18 : 0.12;
	const tiling = new Vec2(surface.width / PAVING_UNIT, surface.depth / PAVING_UNIT);
	if (diffuse) {
		material.diffuseMap = diffuse;
		material.diffuseMapTiling = tiling;
	}
	if (normal) {
		material.normalMap = normal;
		material.normalMapTiling = tiling;
		material.bumpiness = 0.6;
	}
	material.update();
	return material;
}

/** Turns a label's quad (tops of the characters towards -z) so its tops point `up`. */
const LABEL_YAW: Readonly<Record<PaintedLabel["up"], number>> = { north: 0, south: 180, east: -90, west: 90 };

/**
 * A unit square on the ground, facing up, the texture's top edge towards -z and its left edge
 * towards -x, so it reads the right way round from above.
 */
function labelQuad(app: AppBase): Mesh {
	const data = emptyMesh();
	// A canvas texture's top row is at v = 0.
	const topLeft = addVertex(data, -0.5, 0, -0.5, 0, 1, 0, 0, 0);
	const bottomLeft = addVertex(data, -0.5, 0, 0.5, 0, 1, 0, 0, 1);
	const bottomRight = addVertex(data, 0.5, 0, 0.5, 0, 1, 0, 1, 1);
	const topRight = addVertex(data, 0.5, 0, -0.5, 0, 1, 0, 1, 0);
	addQuad(data, topLeft, bottomLeft, bottomRight, topRight);
	return toMesh(app.graphicsDevice, data);
}

/** The painted numbers, one material per paint and text; see-through round the characters. */
function usePaintedLabels(app: AppBase | null): ReadonlyMap<string, StandardMaterial> {
	const materials = useMemo(() => {
		const out = new Map<string, StandardMaterial>();
		if (!app || typeof document === "undefined") return out;
		for (const label of AIRFIELD_LABELS) {
			const key = `${label.paint}:${label.text}`;
			if (out.has(key)) continue;
			const texture = paintTexture(app, 512, Math.round(512 * label.height / label.width), (context, width, height) => {
				context.fillStyle = "#ffffff";
				context.textAlign = "center";
				context.textBaseline = "middle";
				context.font = `bold ${Math.round(height * 0.95)}px Arial, sans-serif`;
				context.fillText(label.text, width / 2, height / 2 + height * 0.04, width * 0.96);
			});
			if (!texture) continue;
			const material = new StandardMaterial();
			material.name = `airfield-label-${key}`;
			material.diffuse = new Color().fromString(PAINT_COLOURS[label.paint]);
			material.diffuseMap = texture;
			material.opacityMap = texture;
			material.opacityMapChannel = "a";
			material.alphaTest = 0.5;
			material.gloss = 0.3;
			material.update();
			out.set(key, material);
		}
		return out;
	}, [app]);
	useEffect(() => () => {
		for (const material of materials.values()) {
			material.diffuseMap?.destroy();
			material.destroy();
		}
	}, [materials]);
	return materials;
}

/** "ORION AIR FORCE STATION / वायु सेना स्टेशन", painted on a canvas for the operations block. */
function useStationSign(): Material {
	const app = useApp();
	const texture = useMemo(() => (app ? paintTexture(app, 1024, 72, (context, width, height) => {
		context.fillStyle = "#26323b";
		context.fillRect(0, 0, width, height);
		context.fillStyle = "#e9e4d2";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.font = "bold 36px Arial, sans-serif";
		context.fillText("ORION AIR FORCE STATION", width * 0.35, height / 2 + 2);
		context.font = "bold 34px 'Nirmala UI', 'Noto Sans Devanagari', 'Mangal', sans-serif";
		context.fillText("वायु सेना स्टेशन", width * 0.8, height / 2 + 2);
	}) : null), [app]);
	useEffect(() => () => texture?.destroy(), [texture]);
	return useMaterial(texture
		? { diffuse: "#ffffff", diffuseMap: texture, emissive: "#ffffff", emissiveMap: texture, emissiveIntensity: 0.2, gloss: 0.3 }
		: { diffuse: "#26323b" });
}

function paintTexture(app: AppBase, width: number, height: number, draw: (context: CanvasRenderingContext2D, width: number, height: number) => void): Texture | null {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) return null;
	draw(context, width, height);
	const texture = new Texture(app.graphicsDevice, {
		width,
		height,
		addressU: ADDRESS_CLAMP_TO_EDGE,
		addressV: ADDRESS_CLAMP_TO_EDGE,
		mipmaps: true,
		anisotropy: 8,
	});
	texture.setSource(canvas);
	return texture;
}
