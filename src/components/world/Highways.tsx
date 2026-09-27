"use client";

import { Entity } from "@playcanvas/react";
import { useApp, useMaterial } from "@playcanvas/react/hooks";
import { BLEND_NONE, MeshInstance, Entity as PlayCanvasEntity, type Material, type Mesh, type Texture } from "playcanvas";
import { memo, useEffect, useRef, useState } from "react";

import { buildHighwayMeshes, type HighwayMeshSet } from "@/engine/orion/world/HighwayMeshes";
import { HIGHWAYS } from "@/engine/orion/world/Highways";

import { compileUpFront, toCollisionMesh, toMesh } from "./WorldMesh";

interface HighwayTextures {
	asphaltDiffuse: Texture | null;
	asphaltNormal: Texture | null;
	grassDiffuse: Texture | null;
	grassNormal: Texture | null;
}

type Part = Exclude<keyof HighwayMeshSet, "collision">;

/** Walls, piers, pylons and cables cast shadows; the road, paint and slopes only receive them. */
const CASTS_SHADOW: ReadonlySet<Part> = new Set<Part>(["concrete", "cables", "tunnelLining"]);

/**
 * The expressways out of the city (see engine/world/Highways): road, markings, barriers,
 * embankments, the Sea Link's cable-stayed bridge, the Ghats viaduct and the tunnel's lit
 * lining. Built once; the road and embankment materials follow the ground textures as they
 * stream in.
 */
export const Highways = memo(function Highways({ asphaltDiffuse, asphaltNormal, grassDiffuse, grassNormal }: Readonly<HighwayTextures>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const road = useMaterial(asphaltDiffuse
		? { diffuse: "#ffffff", diffuseMap: asphaltDiffuse, gloss: 0.32, ...(asphaltNormal ? { normalMap: asphaltNormal, bumpiness: 0.6 } : {}) }
		: { diffuse: "#4d4e50", gloss: 0.3 });
	const embankment = useMaterial(grassDiffuse
		? { diffuse: "#e8efd8", diffuseMap: grassDiffuse, gloss: 0.06, ...(grassNormal ? { normalMap: grassNormal, bumpiness: 0.8 } : {}) }
		: { diffuse: "#7b8260", gloss: 0.06 });
	const white = useMaterial({ diffuse: "#e7e5de", gloss: 0.35 });
	const yellow = useMaterial({ diffuse: "#d7b24a", gloss: 0.35 });
	const concrete = useMaterial({ diffuse: "#a7a298", gloss: 0.24 });
	const steel = useMaterial({ diffuse: "#d8dbdd", metalness: 0.6, gloss: 0.55, useMetalness: true });
	const lining = useMaterial({ diffuse: "#cfc9ba", gloss: 0.45 });
	// Tunnel lamps: lit by themselves, bright enough to bloom.
	const lamps = useMaterial({ diffuse: "#000000", emissive: "#ffe9c2", emissiveIntensity: 6, useLighting: false, blendType: BLEND_NONE });

	const materialsRef = useRef<Record<Part, Material> | null>(null);
	const instances = useRef<{ part: Part; instance: MeshInstance }[]>([]);

	useEffect(() => {
		// Textures stream in after the first render, which swaps some of these materials.
		materialsRef.current = { road, markingsWhite: white, markingsYellow: yellow, concrete, embankment, cables: steel, tunnelLining: lining, tunnelLights: lamps };
		for (const { part, instance } of instances.current) instance.material = materialsRef.current[part];
		// The textured versions are new shaders: compile them now, not at first sight.
		if (app) return compileUpFront(app, instances.current.map((entry) => entry.instance));
	}, [app, road, white, yellow, concrete, embankment, steel, lining, lamps]);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const meshes: Mesh[] = [];
		const holders: PlayCanvasEntity[] = [];
		const made: { part: Part; instance: MeshInstance }[] = [];
		for (const highway of HIGHWAYS) {
			const set = buildHighwayMeshes(highway);
			const holder = new PlayCanvasEntity(`highway-${highway.id}`);
			// In the scene before the body is made: a static body stays where it's created.
			root.addChild(holder);
			const parts: MeshInstance[] = [];
			const materials = materialsRef.current;
			if (!materials) continue;
			for (const part of Object.keys(materials) as Part[]) {
				const data = set[part];
				if (!data.indices.length) continue;
				const mesh = toMesh(device, data);
				meshes.push(mesh);
				const instance = new MeshInstance(mesh, materials[part]);
				parts.push(instance);
				made.push({ part, instance });
			}
			const collision = toCollisionMesh(device, set.collision);
			meshes.push(collision);
			holder.addComponent("render", { meshInstances: parts, receiveShadows: true });
			// After the component, which applies its own castShadows to every instance.
			for (const { part, instance } of made) if (parts.includes(instance)) instance.castShadow = CASTS_SHADOW.has(part);
			holder.addComponent("collision", { type: "mesh", render: { meshes: [collision] } as never });
			holder.addComponent("rigidbody", { type: "static", friction: 0.9 });
			holders.push(holder);
		}
		instances.current = made;
		const stopCompiling = compileUpFront(app, made.map((entry) => entry.instance));
		return () => {
			stopCompiling();
			for (const holder of holders) holder.destroy();
			for (const mesh of meshes) mesh.destroy();
			instances.current = [];
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="highways" />;
});
