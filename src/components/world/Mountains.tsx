"use client";

import { Entity } from "@playcanvas/react";
import { useApp, useMaterial } from "@playcanvas/react/hooks";
import { MeshInstance, Entity as PlayCanvasEntity, type Material, type Mesh, type Texture } from "playcanvas";
import { memo, useEffect, useRef, useState } from "react";

import { buildMassifMeshes, MASSIFS } from "@/engine/orion/world/Mountains";

import { compileUpFront, toCollisionMesh, toMesh } from "./WorldMesh";

/** Metres per repeat of the ground texture on the slopes (the plain uses the same). */
const TEXTURE_UNIT = 22;

interface MountainTextures {
	grassDiffuse: Texture | null;
	grassNormal: Texture | null;
	/** Grey grit and stone; at mountain scale it reads as weathered rock. */
	rockDiffuse: Texture | null;
	rockNormal: Texture | null;
}

/**
 * The hills and mountains (see engine/world/Mountains): each range a solid, shadow-casting
 * patch of terrain with concrete portals where the Ghats Expressway tunnels through.
 *
 * The slopes use the plain's grass-and-rock ground texture, tinted greener on the gentle
 * slopes and paler towards the summits; cliffs and cuttings are grey stone with strata.
 */
export const Mountains = memo(function Mountains({ grassDiffuse, grassNormal, rockDiffuse, rockNormal }: Readonly<MountainTextures>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const slope = useMaterial(grassDiffuse
		? { diffuse: "#ffffff", diffuseMap: grassDiffuse, diffuseVertexColor: true, gloss: 0.08, ...(grassNormal ? { normalMap: grassNormal, bumpiness: 0.9 } : {}) }
		: { diffuse: "#8b9170", diffuseVertexColor: true, gloss: 0.08 });
	const rock = useMaterial(rockDiffuse
		? { diffuse: "#c9bda9", diffuseMap: rockDiffuse, diffuseVertexColor: true, gloss: 0.18, ...(rockNormal ? { normalMap: rockNormal, bumpiness: 1.4 } : {}) }
		: { diffuse: "#8e877b", diffuseVertexColor: true, gloss: 0.18 });
	const concrete = useMaterial({ diffuse: "#9e988c", gloss: 0.22 });
	const slopeInstances = useRef<MeshInstance[]>([]);
	const rockInstances = useRef<MeshInstance[]>([]);
	const slopeRef = useRef<Material>(slope);
	const rockRef = useRef<Material>(rock);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const meshes: Mesh[] = [];
		const holders: PlayCanvasEntity[] = [];
		const instances: MeshInstance[] = [];
		const rocks: MeshInstance[] = [];
		for (const massif of MASSIFS) {
			const data = buildMassifMeshes(massif, TEXTURE_UNIT);
			const holder = new PlayCanvasEntity(`massif-${massif.id}`);
			// In the scene before the body is made: a static body stays where it's created.
			root.addChild(holder);
			const terrain = toMesh(device, data.terrain);
			const collision = [toCollisionMesh(device, data.terrain)];
			meshes.push(terrain, ...collision);
			const parts = [new MeshInstance(terrain, slopeRef.current)];
			instances.push(parts[0]);
			if (data.rock.indices.length) {
				const rockMesh = toMesh(device, data.rock);
				const rockCollision = toCollisionMesh(device, data.rock);
				meshes.push(rockMesh, rockCollision);
				collision.push(rockCollision);
				const instance = new MeshInstance(rockMesh, rockRef.current);
				parts.push(instance);
				rocks.push(instance);
			}
			if (data.portals.indices.length) {
				const portals = toMesh(device, data.portals);
				meshes.push(portals);
				parts.push(new MeshInstance(portals, concrete));
				const portalCollision = toCollisionMesh(device, data.portals);
				meshes.push(portalCollision);
				collision.push(portalCollision);
			}
			holder.addComponent("render", { meshInstances: parts, castShadows: true, receiveShadows: true });
			// A render resource is all the collision component reads for a mesh shape.
			holder.addComponent("collision", { type: "mesh", render: { meshes: collision } as never });
			holder.addComponent("rigidbody", { type: "static", friction: 0.9 });
			holders.push(holder);
		}
		slopeInstances.current = instances;
		rockInstances.current = rocks;
		const stopCompiling = compileUpFront(app, holders.flatMap((holder) => holder.render?.meshInstances ?? []));
		return () => {
			stopCompiling();
			for (const holder of holders) holder.destroy();
			for (const mesh of meshes) mesh.destroy();
			slopeInstances.current = [];
			rockInstances.current = [];
		};
	}, [app, root, concrete]);

	useEffect(() => {
		// The textures stream in after the first render, which swaps the materials.
		slopeRef.current = slope;
		rockRef.current = rock;
		for (const instance of slopeInstances.current) instance.material = slope;
		for (const instance of rockInstances.current) instance.material = rock;
		// The textured versions are new shaders: compile them now, not at first sight.
		if (app) return compileUpFront(app, [...slopeInstances.current, ...rockInstances.current]);
	}, [app, slope, rock]);

	return <Entity ref={setRoot} name="mountains" />;
});
