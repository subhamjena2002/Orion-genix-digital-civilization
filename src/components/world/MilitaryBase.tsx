"use client";

import { Entity } from "@playcanvas/react";
import { Collision, Render, RigidBody } from "@playcanvas/react/components";
import { useApp, useMaterial, useModel } from "@playcanvas/react/hooks";
import {
	ADDRESS_CLAMP_TO_EDGE,
	Entity as PlayCanvasEntity,
	Quat,
	type StandardMaterial,
	Texture,
	Vec3,
	type ContainerResource,
	type Material,
	type RenderComponent,
} from "playcanvas";
import { memo, useEffect, useMemo, useState } from "react";

import { addSolidBody, localBounds } from "@/engine/orion/rendering/ModelBounds";
import { AIRFIELD_LAYOUT } from "@/engine/orion/world/Airfield";
import {
	ACCESS_ROAD,
	BASE,
	BASE_LAYOUT,
	BASE_PADS,
	BASE_VEHICLES,
	HELIPAD,
	MILITARY_KIT_NODES,
	WALK_THROUGH_PIECES,
	type BasePiece,
} from "@/engine/orion/world/MilitaryBase";

import { Gunship } from "./Gunship";
import { ParkedVehicle } from "./Vehicles";

type Vec3Tuple = [number, number, number];

const KIT = "/models/military/military-base-kit.glb";
/** The terrain plane, and the yard laid a hair above it. */
const GROUND_Y = -0.65;
const YARD_THICKNESS = 0.04;
const PAD_THICKNESS = 0.06;
const GROUND_TOP = GROUND_Y + PAD_THICKNESS;

/**
 * The army base (see engine/world/MilitaryBase): walls, towers, barracks, tents and props from
 * one modular kit, placed per the layout, on a dusty yard with paved parade ground, motor pool
 * and helipad, reached from the city by its own road.
 *
 * Every kit piece goes into one static batch, so the whole compound costs a draw call per
 * material rather than one per wall panel.
 */
export const MilitaryBase = memo(function MilitaryBase({ asphaltDiffuse, asphaltNormal }: Readonly<{ asphaltDiffuse: Texture | null; asphaltNormal: Texture | null }>) {
	const app = useApp();
	const { asset } = useModel(KIT);
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		const resource = asset?.resource as ContainerResource | undefined;
		if (!app || !root || !resource?.instantiateRenderEntity) return;
		const kit = resource.instantiateRenderEntity();
		toneDownMirrorMetal(kit);
		const templates = buildTemplates(kit);
		const batcher = app.batcher;
		const group = batcher?.addGroup("military-base", false, 400) ?? null;
		const cleanups: (() => void)[] = [];
		const placed: PlayCanvasEntity[] = [];
		// The airfield's wall, towers and lamps come from the same kit, into the same batch.
		for (const placement of [...BASE_LAYOUT, ...AIRFIELD_LAYOUT]) {
			const template = templates.get(placement.piece);
			if (!template) continue;
			const holder = new PlayCanvasEntity(`base-${placement.piece}`);
			// In the scene first: a static body stays where it's created (see ModelBounds).
			root.addChild(holder);
			holder.setPosition(placement.x, GROUND_TOP, placement.z);
			holder.setEulerAngles(0, placement.yaw, 0);
			// Each node keeps its own transform and sits under copies of its kit parents, so no
			// transform is ever flattened (some carry a stretched or mirrored scale that doesn't
			// survive it); the offset re-centres the piece on the holder.
			const offset = new PlayCanvasEntity("offset");
			offset.setLocalPosition(template.offset);
			for (const part of template.parts) offset.addChild(buildPart(part));
			holder.addChild(offset);
			for (const render of holder.findComponents("render") as RenderComponent[]) {
				render.castShadows = true;
				render.receiveShadows = true;
				if (group) render.batchGroupId = group.id;
			}
			if (!WALK_THROUGH_PIECES.has(placement.piece)) cleanups.push(addSolidBody(holder, false));
			placed.push(holder);
		}
		return () => {
			for (const cleanup of cleanups) cleanup();
			for (const holder of placed) holder.destroy();
			// Last: the pieces were cloned from it and share its meshes.
			kit.destroy();
			if (group && batcher) batcher.removeGroup(group.id);
		};
	}, [app, root, asset]);

	const yard = useMaterial(asphaltDiffuse
		? { diffuse: "#c9b894", diffuseMap: asphaltDiffuse, diffuseMapTiling: [30, 24], gloss: 0.06, ...(asphaltNormal ? { normalMap: asphaltNormal, normalMapTiling: [30, 24], bumpiness: 0.5 } : {}) }
		: { diffuse: "#8f8468", gloss: 0.06 });
	const asphalt = useMaterial(asphaltDiffuse
		? { diffuse: "#9a9a9a", diffuseMap: asphaltDiffuse, diffuseMapTiling: [8, 8], gloss: 0.18, ...(asphaltNormal ? { normalMap: asphaltNormal, normalMapTiling: [8, 8], bumpiness: 0.6 } : {}) }
		: { diffuse: "#3a3c3e", gloss: 0.18 });
	const concrete = useMaterial({ diffuse: "#a7a298", gloss: 0.2 });
	const paint = useMaterial({ diffuse: "#e8e3d2", gloss: 0.3 });
	const gatePaint = useMaterial({ diffuse: "#4b5a3a", gloss: 0.3 });
	const sign = useBaseSign();

	const [cx, cz] = BASE.centre;
	const gateZ = cz - BASE.size[1] / 2;
	const roadLength = ACCESS_ROAD.toZ - ACCESS_ROAD.fromZ;

	return (
		<Entity ref={setRoot} name="military-base">
			{BASE_PADS.map((pad) => {
				const thickness = pad.kind === "yard" ? YARD_THICKNESS : PAD_THICKNESS;
				return (
					<Entity key={pad.id} name={`base-${pad.id}`} position={[pad.x, GROUND_Y + thickness / 2, pad.z]} scale={[pad.width, thickness, pad.depth]}>
						<Render type="box" material={pad.kind === "yard" ? yard : pad.kind === "asphalt" ? asphalt : concrete} receiveShadows castShadows={false} />
						<Collision type="box" halfExtents={[pad.width / 2, thickness / 2, pad.depth / 2]} />
						<RigidBody type="static" friction={0.9} />
					</Entity>
				);
			})}

			{/* The access road from the city, with edge lines. */}
			<Entity name="base-access-road" position={[ACCESS_ROAD.x, GROUND_Y + PAD_THICKNESS / 2, ACCESS_ROAD.fromZ + roadLength / 2]} scale={[ACCESS_ROAD.width, PAD_THICKNESS, roadLength]}>
				<Render type="box" material={asphalt} receiveShadows castShadows={false} />
				<Collision type="box" halfExtents={[ACCESS_ROAD.width / 2, PAD_THICKNESS / 2, roadLength / 2]} />
				<RigidBody type="static" friction={0.9} />
			</Entity>
			{[-1, 1].map((side) => (
				<Box key={side} position={[ACCESS_ROAD.x + side * (ACCESS_ROAD.width / 2 - 0.3), GROUND_TOP + 0.005, ACCESS_ROAD.fromZ + roadLength / 2]} scale={[0.15, 0.01, roadLength]} material={paint} />
			))}

			{/* The helipad: a concrete disc with an H. */}
			<Entity name="base-helipad" position={[HELIPAD.x, GROUND_Y + PAD_THICKNESS / 2 + 0.01, HELIPAD.z]} scale={[HELIPAD.radius * 2, PAD_THICKNESS, HELIPAD.radius * 2]}>
				<Render type="cylinder" material={concrete} receiveShadows castShadows={false} />
				{/* Solid, so what lands on it rests on its surface rather than the yard beneath. */}
				<Collision type="cylinder" radius={HELIPAD.radius} height={PAD_THICKNESS} />
				<RigidBody type="static" friction={0.9} />
			</Entity>
			<Gunship x={HELIPAD.x} z={HELIPAD.z} ground={GROUND_Y + PAD_THICKNESS + 0.01} heading={180} />
			<Box position={[HELIPAD.x - 2.2, GROUND_TOP + 0.02, HELIPAD.z]} scale={[0.9, 0.01, 6]} material={paint} />
			<Box position={[HELIPAD.x + 2.2, GROUND_TOP + 0.02, HELIPAD.z]} scale={[0.9, 0.01, 6]} material={paint} />
			<Box position={[HELIPAD.x, GROUND_TOP + 0.02, HELIPAD.z]} scale={[3.5, 0.01, 0.9]} material={paint} />

			{/* The gate arch: two pillars and a beam carrying the base's name. */}
			{[-1, 1].map((side) => (
				<Entity key={side} position={[cx + side * (BASE.gateWidth / 2 + 0.6), GROUND_Y + 3, gateZ]} scale={[1, 6, 1]}>
					<Render type="box" material={gatePaint} castShadows receiveShadows />
					<Collision type="box" halfExtents={[0.5, 3, 0.5]} />
					<RigidBody type="static" />
				</Entity>
			))}
			<Box position={[cx, GROUND_Y + 6.4, gateZ]} scale={[BASE.gateWidth + 2.2, 0.8, 0.8]} material={gatePaint} />
			<Box position={[cx, GROUND_Y + 6.4, gateZ - 0.42]} scale={[BASE.gateWidth, 0.7, 0.04]} material={sign} />

			{BASE_VEHICLES.map((vehicle, index) => (
				<ParkedVehicle
					key={vehicle.id}
					vehicle={{ id: vehicle.id, style: vehicle.style, colour: "#4b5a3a", seed: 7331 + index * 13, speedFactor: 1 }}
					home={{ x: vehicle.x, z: vehicle.z, yaw: vehicle.yaw, ground: GROUND_TOP }}
				/>
			))}
		</Entity>
	);
});

/** Painted steel the kit marks fully metallic, as metal shows only by what it reflects. */
const PAINTED_METAL = /Corrugated_Shipping_Container/;

/**
 * The containers' camouflage paint is authored as bare metal: under our sky, a dark mirror that
 * reads as a black box. Painted steel is mostly paint.
 */
function toneDownMirrorMetal(kit: PlayCanvasEntity) {
	for (const render of kit.findComponents("render") as RenderComponent[]) {
		for (const instance of render.meshInstances) {
			const material = instance.material as StandardMaterial;
			if (!PAINTED_METAL.test(material.name) || material.metalness === 0.3) continue;
			material.metalness = 0.3;
			material.update();
		}
	}
}

interface Frame {
	position: Vec3;
	rotation: Quat;
	scale: Vec3;
}

interface PiecePart {
	node: PlayCanvasEntity;
	/** The node's parents within the kit, outermost first, as their local transforms. */
	parents: Frame[];
}

interface PieceTemplate {
	parts: PiecePart[];
	/** Moves the piece's footprint centre to the origin and its base onto y = 0. */
	offset: Vec3;
}

/**
 * For each piece, its kit nodes and the chain of parents above them in the kit, plus the offset
 * that re-bases the piece to stand on the origin (the kit lays its pieces out in a row, each at
 * its own spot).
 */
function buildTemplates(kit: PlayCanvasEntity): Map<BasePiece, PieceTemplate> {
	const templates = new Map<BasePiece, PieceTemplate>();
	for (const [piece, names] of Object.entries(MILITARY_KIT_NODES) as [BasePiece, readonly string[]][]) {
		const nodes = names.map((name) => kit.findByName(name) as PlayCanvasEntity | null).filter((node): node is PlayCanvasEntity => node !== null);
		if (nodes.length === 0) continue;
		const parts = nodes.map((node) => ({ node, parents: parentsWithin(kit, node) }));
		// Measure the piece where it stands in the kit.
		const probe = new PlayCanvasEntity("probe");
		for (const part of parts) probe.addChild(buildPart(part));
		const bounds = localBounds(probe);
		probe.destroy();
		if (!bounds) continue;
		templates.set(piece, { parts, offset: new Vec3(-bounds.center.x, -(bounds.center.y - bounds.halfExtents.y), -bounds.center.z) });
	}
	return templates;
}

/**
 * The kit root counts too: it's the file's own top node (Sketchfab's, turning Z-up to Y-up),
 * not a wrapper, and without it every piece lies on its side.
 */
function parentsWithin(kit: PlayCanvasEntity, node: PlayCanvasEntity): Frame[] {
	const parents: Frame[] = [];
	for (let parent = node.parent as PlayCanvasEntity | null; parent; parent = parent === kit ? null : parent.parent as PlayCanvasEntity | null) {
		parents.unshift({ position: parent.getLocalPosition().clone(), rotation: parent.getLocalRotation().clone(), scale: parent.getLocalScale().clone() });
	}
	return parents;
}

/** A copy of the part: its node's clone under fresh copies of its parents. */
function buildPart(part: PiecePart): PlayCanvasEntity {
	const top = new PlayCanvasEntity("frame");
	let inner = top;
	part.parents.forEach((frame, index) => {
		const entity = index === 0 ? top : new PlayCanvasEntity("frame");
		entity.setLocalPosition(frame.position);
		entity.setLocalRotation(frame.rotation);
		entity.setLocalScale(frame.scale);
		if (entity !== top) inner.addChild(entity);
		inner = entity;
	});
	inner.addChild(part.node.clone() as PlayCanvasEntity);
	return top;
}

function Box({ position, scale, material }: Readonly<{ position: Vec3Tuple; scale: Vec3Tuple; material: Material }>) {
	return (
		<Entity position={position} scale={scale}>
			<Render type="box" material={material} castShadows={false} receiveShadows />
		</Entity>
	);
}

/** "ORION ARMY BASE / सेना छावनी", painted on a canvas as the gate's sign. */
function useBaseSign(): Material {
	const app = useApp();
	const texture = useMemo(() => {
		if (!app || typeof document === "undefined") return null;
		const canvas = document.createElement("canvas");
		canvas.width = 1024;
		canvas.height = 96;
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.fillStyle = "#2f3a24";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = "#e9dfb8";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.font = "bold 44px Arial, sans-serif";
		context.fillText("ORION ARMY BASE", canvas.width * 0.36, 50);
		context.font = "bold 40px 'Nirmala UI', 'Noto Sans Devanagari', 'Mangal', sans-serif";
		context.fillText("सेना छावनी", canvas.width * 0.8, 50);
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
		? { diffuse: "#ffffff", diffuseMap: texture, emissive: "#ffffff", emissiveMap: texture, emissiveIntensity: 0.25, gloss: 0.3 }
		: { diffuse: "#2f3a24" });
}
