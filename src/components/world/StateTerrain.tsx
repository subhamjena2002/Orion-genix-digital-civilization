"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import { BLEND_NORMAL, Color, Mesh, MeshInstance, Entity as PlayCanvasEntity, StandardMaterial, Vec2, type GraphicsDevice, type Material } from "playcanvas";
import { memo, useEffect, useRef, useState } from "react";

import { FOAM_TILE_METRES, paintFoam, paintSand, SAND_TILE_METRES } from "@/engine/orion/world/BeachTextures";
import { ORION_OCEAN } from "@/engine/orion/world/Ocean";
import { ORION_LAND } from "@/engine/orion/world/StateOutline";

/** Top of the land surface; roads and buildings are laid out relative to this. */
const LAND_Y = -0.65;
/**
 * The beach in rings out from the coastline: dry sand, damp, the wet band at the waterline, then
 * on under the sea down to the seabed (seen through the water, it turns the shallows turquoise).
 * Each ring: distance out (m), height, and the sand's tint there (wet sand is darker).
 */
const BEACH_RINGS: readonly { out: number; y: number; shade: readonly [number, number, number] }[] = [
	{ out: 0, y: LAND_Y, shade: [1, 1, 1] },
	{ out: 4.2, y: -1.0, shade: [0.93, 0.91, 0.87] },
	{ out: 6.6, y: ORION_OCEAN.level + 0.02, shade: [0.7, 0.64, 0.54] },
	// Under the water the sand loses its colour to the sea's as it deepens (the water absorbs it),
	// ending at the seabed's own dark blue so the slope meets it without an edge.
	{ out: 14, y: -1.8, shade: [0.55, 0.74, 0.72] },
	{ out: 30, y: -3.2, shade: [0.2, 0.42, 0.52] },
	{ out: 95, y: -9.4, shade: [0.015, 0.09, 0.16] },
];
/** The surf: a strip of foam across the waterline. */
const FOAM_FROM = 5.4;
const FOAM_TO = 10.5;
const FOAM_Y = ORION_OCEAN.level + 0.035;

interface StateTerrainProps {
	/** Ground material. UVs are world units divided by `textureUnit`, so it tiles evenly. */
	material: Material;
	textureUnit: number;
}

/**
 * The state's land: an irregular mainland and islands, each ringed by a beach that slopes
 * down under the waterline. The same geometry is the physics collider, so walking off the
 * coast carries the player down the sand and into deep water, where drowning takes over.
 */
export const StateTerrain = memo(function StateTerrain({ material, textureUnit }: Readonly<StateTerrainProps>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const landInstances = useRef<MeshInstance[]>([]);
	const materialRef = useRef(material);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const landMeshes = ORION_LAND.map((land) => buildLandMesh(device, land.centre, land.points, textureUnit));
		const beachMeshes = ORION_LAND.map((land) => buildBeachMesh(device, land.points));
		const foamMeshes = ORION_LAND.map((land) => buildFoamMesh(device, land.points));
		const sandMaps = paintSand(device);
		const foamMap = paintFoam(device);
		const sand = new StandardMaterial();
		sand.name = "beach-sand";
		sand.diffuseMap = sandMaps.diffuse;
		sand.diffuseVertexColor = true;
		sand.normalMap = sandMaps.normal;
		sand.bumpiness = 0.8;
		sand.useMetalness = true;
		sand.metalness = 0;
		sand.gloss = 0.22;
		sand.update();
		const foam = new StandardMaterial();
		foam.name = "surf-foam";
		foam.diffuse = new Color(1, 1, 1);
		foam.emissive = new Color(0.35, 0.37, 0.38);
		foam.opacityMap = foamMap;
		foam.opacityMapChannel = "a";
		foam.blendType = BLEND_NORMAL;
		foam.depthWrite = false;
		foam.gloss = 0.5;
		foam.update();

		const holder = new PlayCanvasEntity("state-terrain-geometry");
		const lands = landMeshes.map((mesh) => new MeshInstance(mesh, materialRef.current));
		const beaches = beachMeshes.map((mesh) => new MeshInstance(mesh, sand));
		holder.addComponent("render", { meshInstances: [...lands, ...beaches], receiveShadows: true, castShadows: false });
		const surf = new PlayCanvasEntity("surf");
		surf.addComponent("render", { meshInstances: foamMeshes.map((mesh) => new MeshInstance(mesh, foam)), receiveShadows: false, castShadows: false });
		root.addChild(surf);
		// The surf washes up and back: the foam slides across the strip and breathes.
		let time = 0;
		const offset = new Vec2();
		const wash = (dt: number) => {
			time += dt;
			offset.set(time * 0.012, Math.sin(time * 0.7) * 0.12);
			foam.opacityMapOffset = offset;
			foam.opacity = 0.75 + Math.sin(time * 0.7 + 1.2) * 0.2;
			foam.update();
		};
		app.on("update", wash);
		// The collision component accepts a render resource; a plain `{ meshes }` is all it reads.
		holder.addComponent("collision", { type: "mesh", render: { meshes: [...landMeshes, ...beachMeshes] } as never });
		holder.addComponent("rigidbody", { type: "static" });
		root.addChild(holder);
		landInstances.current = lands;

		return () => {
			app.off("update", wash);
			holder.destroy();
			surf.destroy();
			for (const mesh of [...landMeshes, ...beachMeshes, ...foamMeshes]) mesh.destroy();
			sand.destroy();
			foam.destroy();
			sandMaps.diffuse.destroy();
			sandMaps.normal.destroy();
			foamMap.destroy();
			landInstances.current = [];
		};
		// Geometry is built once; material swaps are handled separately below.
	}, [app, root, textureUnit]);

	useEffect(() => {
		// The ground texture streams in after first render, which swaps the material.
		materialRef.current = material;
		applyMaterial(landInstances.current, material);
	}, [material]);

	return <Entity ref={setRoot} name="state-terrain" />;
});

function applyMaterial(instances: readonly MeshInstance[], material: Material) {
	for (const instance of instances) instance.material = material;
}

function buildLandMesh(device: GraphicsDevice, centre: [number, number], points: readonly [number, number][], unit: number): Mesh {
	const positions = [centre[0], LAND_Y, centre[1]];
	const uvs = [centre[0] / unit, centre[1] / unit];
	for (const [x, z] of points) {
		positions.push(x, LAND_Y, z);
		uvs.push(x / unit, z / unit);
	}
	const indices: number[] = [];
	const count = points.length;
	for (let i = 0; i < count; i++) {
		const a = 1 + i;
		const b = 1 + ((i + 1) % count);
		// Points run counter-clockwise when seen from above with +Z down the screen, so this
		// winding faces up.
		indices.push(0, b, a);
	}
	return finishMesh(device, positions, uvs, indices);
}

/** Outward unit normals of a coastline at each point (the outline runs anticlockwise). */
function coastNormals(points: readonly [number, number][]): [number, number][] {
	const count = points.length;
	return points.map((_, i) => {
		const [px, pz] = points[(i - 1 + count) % count];
		const [nx, nz] = points[(i + 1) % count];
		const ox = nz - pz;
		const oz = -(nx - px);
		const length = Math.hypot(ox, oz) || 1;
		return [ox / length, oz / length];
	});
}

/** Strips joining ring after ring of points round the coast, wound to face up. */
function ringIndices(count: number, rings: number): number[] {
	const indices: number[] = [];
	for (let r = 0; r < rings - 1; r++) {
		for (let i = 0; i < count; i++) {
			const inner = i * rings + r;
			const outer = inner + 1;
			const nextInner = ((i + 1) % count) * rings + r;
			const nextOuter = nextInner + 1;
			indices.push(inner, nextInner, outer, outer, nextInner, nextOuter);
		}
	}
	return indices;
}

function buildBeachMesh(device: GraphicsDevice, points: readonly [number, number][]): Mesh {
	const normals = coastNormals(points);
	const positions: number[] = [];
	const uvs: number[] = [];
	const colors: number[] = [];
	points.forEach(([x, z], i) => {
		const [ox, oz] = normals[i];
		for (const ring of BEACH_RINGS) {
			const px = x + ox * ring.out;
			const pz = z + oz * ring.out;
			positions.push(px, ring.y, pz);
			uvs.push(px / SAND_TILE_METRES, pz / SAND_TILE_METRES);
			colors.push(ring.shade[0], ring.shade[1], ring.shade[2], 1);
		}
	});
	return finishMesh(device, positions, uvs, ringIndices(points.length, BEACH_RINGS.length), colors);
}

/** The surf strip across the waterline: u runs along the shore, v from the sand (0) out to sea (1). */
function buildFoamMesh(device: GraphicsDevice, points: readonly [number, number][]): Mesh {
	const normals = coastNormals(points);
	const positions: number[] = [];
	const uvs: number[] = [];
	let along = 0;
	points.forEach(([x, z], i) => {
		if (i > 0) along += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
		const [ox, oz] = normals[i];
		positions.push(x + ox * FOAM_FROM, FOAM_Y, z + oz * FOAM_FROM, x + ox * FOAM_TO, FOAM_Y, z + oz * FOAM_TO);
		uvs.push(along / FOAM_TILE_METRES, 0, along / FOAM_TILE_METRES, 1);
	});
	return finishMesh(device, positions, uvs, ringIndices(points.length, 2));
}

function finishMesh(device: GraphicsDevice, positions: number[], uvs: number[], indices: number[], colors?: number[]): Mesh {
	const normals = computeNormals(positions, indices);
	const mesh = new Mesh(device);
	mesh.setPositions(positions);
	mesh.setNormals(normals);
	mesh.setUvs(0, uvs);
	if (colors) mesh.setColors(colors);
	mesh.setIndices(indices);
	mesh.update();
	return mesh;
}

function computeNormals(positions: number[], indices: number[]): number[] {
	const normals = new Array<number>(positions.length).fill(0);
	for (let i = 0; i < indices.length; i += 3) {
		const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
		const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
		const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
		const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
		for (const v of [a, b, c]) {
			normals[v] += n[0];
			normals[v + 1] += n[1];
			normals[v + 2] += n[2];
		}
	}
	for (let v = 0; v < normals.length; v += 3) {
		const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
		normals[v] /= length;
		normals[v + 1] /= length;
		normals[v + 2] /= length;
	}
	return normals;
}
