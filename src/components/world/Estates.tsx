"use client";

import { Entity } from "@playcanvas/react";
import { Collision, RigidBody } from "@playcanvas/react/components";
import { useApp } from "@playcanvas/react/hooks";
import {
	calculateTangents,
	Color,
	Entity as PlayCanvasEntity,
	Mesh,
	MeshInstance,
	PRIMITIVE_TRIANGLES,
	SEMANTIC_TANGENT,
	StandardMaterial,
	type GraphicsDevice,
	type Texture,
} from "playcanvas";
import { memo, useEffect, useMemo, useState } from "react";

import { cityBuildingMaterials } from "@/engine/orion/buildings/CityBuildingMaterials";
import type { FacadeStyle } from "@/engine/orion/buildings/FacadeTextures";
import { buildHouse } from "@/engine/orion/buildings/HouseMesh";
import { buildEstateRoadMeshes } from "@/engine/orion/world/EstateRoadMesh";
import { HOUSE_LOTS, SAFEHOUSE_LOT, type HouseLot } from "@/engine/orion/world/Estates";
import type { MeshData } from "@/engine/orion/world/MeshData";
import { LAND_Y } from "@/engine/orion/world/Mountains";
import { useNearby } from "./useNearby";

/** Houses are mounted within this radius of the player (and kept until a little further). */
const HOUSE_RADIUS = 220;
const HOUSE_UNMOUNT_RADIUS = 270;
const HOUSE_SAMPLE_MS = 150;
const HOUSES_PER_SAMPLE = 3;
/** Front and back garden depths the estate layout leaves (see Estates). */
const FRONT_GARDEN = 8;
const BACK_GARDEN = 13;

function toMesh(device: GraphicsDevice, data: MeshData, tangents: boolean): Mesh {
	const mesh = new Mesh(device);
	mesh.setPositions(data.positions);
	mesh.setNormals(data.normals);
	mesh.setUvs(0, data.uvs);
	if (data.colors?.length) mesh.setColors(data.colors);
	if (tangents) mesh.setVertexStream(SEMANTIC_TANGENT, calculateTangents(data.positions, data.normals, data.uvs, data.indices), 4);
	const wide = data.positions.length / 3 > 65535;
	mesh.setIndices(wide ? new Uint32Array(data.indices) : new Uint16Array(data.indices));
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}

function surfaceMaterial(name: string, diffuse: Texture | null, normal: Texture | null, fallback: string, gloss: number): StandardMaterial {
	const material = new StandardMaterial();
	material.name = name;
	material.useMetalness = true;
	material.metalness = 0;
	material.gloss = gloss;
	if (diffuse) material.diffuseMap = diffuse;
	else material.diffuse = new Color().fromString(fallback);
	if (normal) {
		material.normalMap = normal;
		material.bumpiness = 0.6;
	}
	material.update();
	return material;
}

/** The estate streets: one mesh for the asphalt, one for pavements and kerbs, solid to drive on. */
const EstateRoads = memo(function EstateRoads({ asphalt, asphaltNormal, paving, pavingNormal }: Readonly<{
	asphalt: Texture | null;
	asphaltNormal: Texture | null;
	paving: Texture | null;
	pavingNormal: Texture | null;
}>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const geometry = useMemo(() => buildEstateRoadMeshes(), []);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const road = surfaceMaterial("estate-asphalt", asphalt, asphaltNormal, "#3a3b3d", 0.12);
		const kerb = surfaceMaterial("estate-pavement", paving, pavingNormal, "#c8c4bc", 0.18);
		const asphaltMesh = toMesh(device, geometry.asphalt, Boolean(asphaltNormal));
		const pavementMesh = toMesh(device, geometry.pavement, Boolean(pavingNormal));
		const entity = new PlayCanvasEntity("estate-roads");
		entity.addComponent("render", {
			meshInstances: [new MeshInstance(asphaltMesh, road), new MeshInstance(pavementMesh, kerb)],
			castShadows: false,
			receiveShadows: true,
		});
		// Drivable and walkable: the surfaces themselves are the collider.
		const collider = new PlayCanvasEntity("estate-roads-collider");
		collider.addComponent("collision", { type: "mesh", render: { meshes: [asphaltMesh, pavementMesh] } as never });
		collider.addComponent("rigidbody", { type: "static", friction: 0.9 });
		root.addChild(entity);
		root.addChild(collider);
		return () => {
			collider.destroy();
			entity.destroy();
			asphaltMesh.destroy();
			pavementMesh.destroy();
			road.destroy();
			kerb.destroy();
		};
	}, [app, root, geometry, asphalt, asphaltNormal, paving, pavingNormal]);

	return <Entity ref={setRoot} name="estate-streets" />;
});

/** One house and its garden, on the shared building materials. */
const EstateHouse = memo(function EstateHouse({ lot }: Readonly<{ lot: HouseLot }>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const geometry = useMemo(() => buildHouse({
		type: lot.type, width: lot.width, depth: lot.depth, pool: lot.pool, seed: lot.seed, frontGarden: FRONT_GARDEN, backGarden: BACK_GARDEN,
	}), [lot]);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const materials = cityBuildingMaterials(device);
		const meshes: Mesh[] = [];
		const instances: MeshInstance[] = [];
		const add = (data: MeshData | undefined, material: StandardMaterial, tangents: boolean) => {
			if (!data || data.indices.length === 0) return;
			const mesh = toMesh(device, data, tangents);
			meshes.push(mesh);
			instances.push(new MeshInstance(mesh, material));
		};
		for (const [style, data] of Object.entries(geometry.walls) as [FacadeStyle, MeshData][]) add(data, materials.wall[style], true);
		add(geometry.trim, materials.trim, true);
		add(geometry.tiles, materials.tiles, true);
		add(geometry.water, materials.water, false);
		const body = new PlayCanvasEntity("house-geometry");
		body.addComponent("render", { meshInstances: instances, castShadows: true, receiveShadows: true });
		root.addChild(body);
		return () => {
			body.destroy();
			for (const mesh of meshes) mesh.destroy();
		};
	}, [app, root, geometry]);

	const { solid } = geometry;
	return (
		<Entity ref={setRoot} name={lot.id} position={[lot.x, LAND_Y, lot.z]} rotation={[0, lot.yaw, 0]}>
			<Entity name="house-collider" position={[solid.x, solid.height / 2, solid.z]}>
				<Collision type="box" halfExtents={[solid.width / 2, solid.height / 2, solid.depth / 2]} />
				<RigidBody type="static" friction={0.8} restitution={0} />
			</Entity>
		</Entity>
	);
});

const lotPosition = (lot: HouseLot): readonly [number, number] => [lot.x, lot.z];
/** Every lot but the safehouse's, which has its own villa (see Safehouse). */
const GENERATED_LOTS = HOUSE_LOTS.filter((lot) => lot.id !== SAFEHOUSE_LOT);

/**
 * The residential estates round the city (see world/Estates): their streets always, their houses
 * as the player comes near.
 */
export const Estates = memo(function Estates(props: Readonly<{
	asphalt: Texture | null;
	asphaltNormal: Texture | null;
	paving: Texture | null;
	pavingNormal: Texture | null;
}>) {
	const nearby = useNearby(GENERATED_LOTS, lotPosition, HOUSE_RADIUS, HOUSE_UNMOUNT_RADIUS, HOUSE_SAMPLE_MS, HOUSES_PER_SAMPLE);
	return (
		<>
			<EstateRoads {...props} />
			{nearby.map((lot) => <EstateHouse key={lot.id} lot={lot} />)}
		</>
	);
});
