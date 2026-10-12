"use client";

import { Entity } from "@playcanvas/react";
import { Collision, RigidBody } from "@playcanvas/react/components";
import { useApp } from "@playcanvas/react/hooks";
import {
	calculateTangents,
	Entity as PlayCanvasEntity,
	Mesh,
	MeshInstance,
	PRIMITIVE_TRIANGLES,
	SEMANTIC_TANGENT,
	type GraphicsDevice,
	type StandardMaterial,
} from "playcanvas";
import { memo, useEffect, useMemo, useState } from "react";

import type { BuildingPlacement } from "@/engine/orion/buildings/Buildings";
import { designBuilding } from "@/engine/orion/buildings/CityBuildingDesign";
import { cityBuildingMaterials } from "@/engine/orion/buildings/CityBuildingMaterials";
import { buildCityBuilding } from "@/engine/orion/buildings/CityBuildingMesh";
import { hashString } from "@/engine/orion/rendering/CanvasTextures";
import type { MeshData } from "@/engine/orion/world/MeshData";

/** With tangents, which the facades' normal maps need. */
function meshWithTangents(device: GraphicsDevice, data: MeshData): Mesh {
	const mesh = new Mesh(device);
	mesh.setPositions(data.positions);
	mesh.setNormals(data.normals);
	mesh.setUvs(0, data.uvs);
	if (data.colors) mesh.setColors(data.colors);
	mesh.setVertexStream(SEMANTIC_TANGENT, calculateTangents(data.positions, data.normals, data.uvs, data.indices), 4);
	mesh.setIndices(data.indices);
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}

/**
 * One building of the city, built from its lot (see CityBuildingDesign / CityBuildingMesh): three
 * meshes on the shared building materials, and a box to bump into.
 */
export const CityBuilding = memo(function CityBuilding({ placement, groundY }: Readonly<{ placement: BuildingPlacement; groundY: number }>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const spec = useMemo(() => designBuilding(placement, hashString(placement.id)), [placement]);
	const geometry = useMemo(() => buildCityBuilding(spec), [spec]);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const materials = cityBuildingMaterials(device);
		const parts: [MeshData, StandardMaterial | null][] = [
			[geometry.wall, materials.wall[spec.style]],
			[geometry.ground, spec.ground ? materials.ground[spec.ground] : null],
			[geometry.trim, materials.trim],
		];
		const meshes: Mesh[] = [];
		const instances: MeshInstance[] = [];
		for (const [data, material] of parts) {
			if (!material || data.indices.length === 0) continue;
			const mesh = meshWithTangents(device, data);
			meshes.push(mesh);
			instances.push(new MeshInstance(mesh, material));
		}
		const body = new PlayCanvasEntity("building-geometry");
		body.addComponent("render", { meshInstances: instances, castShadows: true, receiveShadows: true });
		root.addChild(body);
		return () => {
			body.destroy();
			for (const mesh of meshes) mesh.destroy();
		};
	}, [app, root, geometry, spec]);

	const [x, , z] = placement.position;
	const height = geometry.height;
	return (
		<Entity ref={setRoot} name={placement.id} position={[x, groundY, z]} rotation={placement.rotation}>
			<Entity name="building-collider" position={[0, height / 2, 0]}>
				<Collision type="box" halfExtents={[geometry.width / 2, height / 2, geometry.depth / 2]} />
				<RigidBody type="static" friction={0.8} restitution={0} />
			</Entity>
		</Entity>
	);
});
