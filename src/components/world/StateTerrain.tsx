"use client";

import { Entity } from "@playcanvas/react";
import { useApp, useMaterial } from "@playcanvas/react/hooks";
import { Mesh, MeshInstance, Entity as PlayCanvasEntity, type GraphicsDevice, type Material } from "playcanvas";
import { memo, useEffect, useRef, useState } from "react";

import { ORION_LAND } from "@/engine/orion/world/StateOutline";

/** Top of the land surface; roads and buildings are laid out relative to this. */
const LAND_Y = -0.65;
/** How far the beach runs out from the coastline, and how deep it ends up. */
const BEACH_WIDTH = 26;
const BEACH_END_Y = -2.8;

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
	const sand = useMaterial({ diffuse: "#c2ad85", gloss: 0.12 });
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const landInstances = useRef<MeshInstance[]>([]);
	const materialRef = useRef(material);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const landMeshes = ORION_LAND.map((land) => buildLandMesh(device, land.centre, land.points, textureUnit));
		const beachMeshes = ORION_LAND.map((land) => buildBeachMesh(device, land.points, textureUnit));

		const holder = new PlayCanvasEntity("state-terrain-geometry");
		const lands = landMeshes.map((mesh) => new MeshInstance(mesh, materialRef.current));
		const beaches = beachMeshes.map((mesh) => new MeshInstance(mesh, sand));
		holder.addComponent("render", { meshInstances: [...lands, ...beaches], receiveShadows: true, castShadows: false });
		// The collision component accepts a render resource; a plain `{ meshes }` is all it reads.
		holder.addComponent("collision", { type: "mesh", render: { meshes: [...landMeshes, ...beachMeshes] } as never });
		holder.addComponent("rigidbody", { type: "static" });
		root.addChild(holder);
		landInstances.current = lands;

		return () => {
			holder.destroy();
			for (const mesh of [...landMeshes, ...beachMeshes]) mesh.destroy();
			landInstances.current = [];
		};
		// Geometry is built once; material swaps are handled separately below.
	}, [app, root, sand, textureUnit]);

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

function buildBeachMesh(device: GraphicsDevice, points: readonly [number, number][], unit: number): Mesh {
	const count = points.length;
	const positions: number[] = [];
	const uvs: number[] = [];
	for (let i = 0; i < count; i++) {
		const [x, z] = points[i];
		const [px, pz] = points[(i - 1 + count) % count];
		const [nx, nz] = points[(i + 1) % count];
		// Outward normal of the coastline at this point (the outline runs anticlockwise).
		let ox = nz - pz;
		let oz = -(nx - px);
		const length = Math.hypot(ox, oz) || 1;
		ox /= length;
		oz /= length;
		positions.push(x, LAND_Y, z, x + ox * BEACH_WIDTH, BEACH_END_Y, z + oz * BEACH_WIDTH);
		uvs.push(x / unit, z / unit, (x + ox * BEACH_WIDTH) / unit, (z + oz * BEACH_WIDTH) / unit);
	}
	const indices: number[] = [];
	for (let i = 0; i < count; i++) {
		const inner = i * 2;
		const outer = inner + 1;
		const nextInner = ((i + 1) % count) * 2;
		const nextOuter = nextInner + 1;
		indices.push(inner, nextInner, outer, outer, nextInner, nextOuter);
	}
	return finishMesh(device, positions, uvs, indices);
}

function finishMesh(device: GraphicsDevice, positions: number[], uvs: number[], indices: number[]): Mesh {
	const normals = computeNormals(positions, indices);
	const mesh = new Mesh(device);
	mesh.setPositions(positions);
	mesh.setNormals(normals);
	mesh.setUvs(0, uvs);
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
