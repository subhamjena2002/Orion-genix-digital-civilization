"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import {
	calculateTangents,
	Color,
	CULLFACE_NONE,
	Entity as PlayCanvasEntity,
	Mesh,
	MeshInstance,
	PRIMITIVE_TRIANGLES,
	SEMANTIC_TANGENT,
	StandardMaterial,
	type GraphicsDevice,
	type Texture,
} from "playcanvas";
import { memo, useEffect, useState } from "react";

import { makeCanvas, normalsFromHeight, rgb, seededRandom, textureFromCanvas, textureFromPixels } from "@/engine/orion/rendering/CanvasTextures";
import { ORION_ACTIVE_TIME_OF_DAY } from "@/engine/orion/rendering/Environment";
import { estateDressing } from "@/engine/orion/world/Estates";
import { LAND_Y } from "@/engine/orion/world/Mountains";
import { downtownTrees } from "@/engine/orion/world/DowntownCore";
import { spawnDistrictTrees } from "@/engine/orion/world/SpawnDistrict";
import { buildDressingChunks, dressingCollider, parkGroves, streetDressing } from "@/engine/orion/world/StreetDressing";
import { ORION_PARCELS } from "@/engine/orion/world/WorldModel";
import type { MeshData } from "@/engine/orion/world/MeshData";

/** Phones get a sparser street: every palm is a few hundred triangles and a shadow. */
const PHONE_SPACING = 27;

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

/** Ringed palm bark: leaf scars round the trunk, a little diagonal, in grey-brown. */
function paintBark(device: GraphicsDevice): { diffuse: Texture; normal: Texture } {
	const width = 64;
	const height = 256;
	const colour = makeCanvas(width, height);
	const relief = makeCanvas(width, height);
	const random = seededRandom(9001);
	colour.fillStyle = "#8b7d68";
	colour.fillRect(0, 0, width, height);
	relief.fillStyle = "#808080";
	relief.fillRect(0, 0, width, height);
	for (let y = 0; y < height; y += 16) {
		const tone = 0.85 + random() * 0.25;
		colour.fillStyle = rgb(120 * tone, 108 * tone, 90 * tone);
		colour.fillRect(0, y, width, 10);
		// The ring's lip catches the light; the groove under it doesn't.
		colour.fillStyle = rgb(170 * tone, 158 * tone, 136 * tone);
		colour.fillRect(0, y, width, 3);
		colour.fillStyle = "rgba(40,32,24,0.55)";
		colour.fillRect(0, y + 10, width, 6);
		relief.fillStyle = "#d0d0d0";
		relief.fillRect(0, y, width, 4);
		relief.fillStyle = "#a0a0a0";
		relief.fillRect(0, y + 4, width, 6);
		relief.fillStyle = "#303030";
		relief.fillRect(0, y + 10, width, 6);
	}
	for (let i = 0; i < 400; i++) {
		colour.fillStyle = `rgba(${random() < 0.5 ? "30,25,20" : "220,210,190"},0.12)`;
		colour.fillRect(random() * width, random() * height, 2, 1 + random() * 4);
	}
	const normals = normalsFromHeight(relief, 4);
	return {
		diffuse: textureFromCanvas(device, colour, { name: "palm-bark", srgb: true }),
		normal: textureFromPixels(device, normals.width, normals.height, normals.pixels, { name: "palm-bark-normal", srgb: false }),
	};
}

/**
 * A frond: a rib down the middle (u = 0.5) from the crown (v = 0) to the tip, with leaflets
 * sweeping out and towards the tip on both sides; transparent between them.
 */
function paintFrond(device: GraphicsDevice): Texture {
	const width = 128;
	const height = 512;
	const context = makeCanvas(width, height);
	const random = seededRandom(4242);
	context.clearRect(0, 0, width, height);
	context.lineCap = "round";
	for (let y = 6; y < height - 4; y += 7) {
		const t = y / height;
		for (const side of [-1, 1]) {
			const reach = (width / 2 - 2) * (0.75 + random() * 0.25);
			const sweep = 26 + 30 * t;
			const tone = 0.8 + random() * 0.35;
			context.strokeStyle = rgb(78 * tone, 128 * tone, 52 * tone);
			context.lineWidth = 3.2 - t * 1.4;
			context.beginPath();
			context.moveTo(width / 2, y);
			context.quadraticCurveTo(width / 2 + side * reach * 0.5, y + sweep * 0.3, width / 2 + side * reach, y + sweep);
			context.stroke();
		}
	}
	context.strokeStyle = "#8e9a52";
	context.lineWidth = 5;
	context.beginPath();
	context.moveTo(width / 2, 0);
	context.lineTo(width / 2, height);
	context.stroke();
	return textureFromCanvas(device, context, { name: "palm-frond", srgb: true, anisotropy: 4 });
}

interface DressingMaterials {
	bark: StandardMaterial;
	frond: StandardMaterial;
	metal: StandardMaterial;
	glass: StandardMaterial;
	textures: Texture[];
}

function makeMaterials(device: GraphicsDevice): DressingMaterials {
	const bark = paintBark(device);
	const frondTexture = paintFrond(device);

	const trunk = new StandardMaterial();
	trunk.name = "palm-trunk";
	trunk.diffuseMap = bark.diffuse;
	trunk.diffuseVertexColor = true;
	trunk.normalMap = bark.normal;
	trunk.bumpiness = 1;
	trunk.useMetalness = true;
	trunk.metalness = 0;
	trunk.gloss = 0.25;
	trunk.update();

	const frond = new StandardMaterial();
	frond.name = "palm-frond";
	frond.diffuseMap = frondTexture;
	frond.diffuseVertexColor = true;
	frond.opacityMap = frondTexture;
	frond.opacityMapChannel = "a";
	frond.alphaTest = 0.4;
	frond.alphaToCoverage = true;
	frond.cull = CULLFACE_NONE;
	frond.twoSidedLighting = true;
	frond.useMetalness = true;
	frond.metalness = 0;
	frond.gloss = 0.35;
	frond.update();

	const metal = new StandardMaterial();
	metal.name = "street-light-metal";
	metal.diffuseVertexColor = true;
	metal.useMetalness = true;
	metal.metalness = 0.4;
	metal.gloss = 0.55;
	metal.update();

	const night = ORION_ACTIVE_TIME_OF_DAY === "night";
	const glass = new StandardMaterial();
	glass.name = "street-light-glass";
	glass.diffuse = new Color(0.85, 0.82, 0.74);
	glass.gloss = 0.8;
	if (night) {
		// Sodium orange, bright enough to bloom into a halo.
		glass.emissive = new Color(1, 0.62, 0.25);
		glass.emissiveIntensity = 12;
	}
	glass.update();

	return { bark: trunk, frond, metal, glass, textures: [bark.diffuse, bark.normal, frondTexture] };
}

/**
 * Palms and street lights along every pavement (see world/StreetDressing), merged per chunk of
 * the city: a chunk out of view costs nothing, and the whole lot is a few dozen draw calls.
 */
export const StreetDressing = memo(function StreetDressing() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const phone = window.matchMedia?.("(pointer: coarse)").matches ?? false;
		// The city's kerbs and the estates' streets and gardens, merged chunk by chunk together.
		const parks = ORION_PARCELS.filter((parcel) => parcel.zoning === "park");
		const items = [...streetDressing(phone ? PHONE_SPACING : undefined), ...estateDressing(), ...parkGroves(parks, LAND_Y), ...spawnDistrictTrees(), ...downtownTrees()];
		const chunks = buildDressingChunks(items);
		const materials = makeMaterials(device);
		const meshes: Mesh[] = [];
		const holder = new PlayCanvasEntity("street-dressing-geometry");
		for (const chunk of chunks) {
			const instances: MeshInstance[] = [];
			const parts: [MeshData, StandardMaterial, boolean][] = [
				[chunk.trunks, materials.bark, true],
				[chunk.fronds, materials.frond, false],
				[chunk.metal, materials.metal, false],
				[chunk.glass, materials.glass, false],
			];
			for (const [data, material, tangents] of parts) {
				if (data.indices.length === 0) continue;
				const mesh = toMesh(device, data, tangents);
				meshes.push(mesh);
				instances.push(new MeshInstance(mesh, material));
			}
			const entity = new PlayCanvasEntity(`street-dressing-${chunk.x}-${chunk.z}`);
			entity.addComponent("render", { meshInstances: instances, castShadows: true, receiveShadows: true });
			holder.addChild(entity);
		}
		// Trunks and lamp posts are solid: a car that leaves the road stops against one instead of
		// driving through. One static mesh body for all of them (see dressingCollider).
		const collider = dressingCollider(items);
		const colliderMesh = new Mesh(device);
		colliderMesh.setPositions(collider.positions);
		colliderMesh.setIndices(collider.positions.length / 3 > 65535 ? new Uint32Array(collider.indices) : new Uint16Array(collider.indices));
		colliderMesh.update(PRIMITIVE_TRIANGLES);
		meshes.push(colliderMesh);
		const posts = new PlayCanvasEntity("street-dressing-posts");
		// The collision component only reads `meshes` from a render resource.
		posts.addComponent("collision", { type: "mesh", render: { meshes: [colliderMesh] } as never });
		posts.addComponent("rigidbody", { type: "static" });
		holder.addChild(posts);
		root.addChild(holder);
		return () => {
			holder.destroy();
			for (const mesh of meshes) mesh.destroy();
			for (const material of [materials.bark, materials.frond, materials.metal, materials.glass]) material.destroy();
			for (const texture of materials.textures) texture.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="street-dressing" />;
});
