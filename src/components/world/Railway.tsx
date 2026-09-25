"use client";

import { Container, Entity } from "@playcanvas/react";
import { Script } from "@playcanvas/react/components";
import { useApp, useModel } from "@playcanvas/react/hooks";
import { Color, Entity as PlayCanvasEntity, MeshInstance, StandardMaterial, type GraphicsDevice, type Mesh } from "playcanvas";
import { memo, useEffect, useMemo, useState } from "react";

import { OrionBarrier } from "@/engine/orion/rail/OrionBarrier";
import { carriageFitName, carriageName, OrionTrain } from "@/engine/orion/rail/OrionTrain";
import { RAIL_CROSSINGS, type LevelCrossing } from "@/engine/orion/rail/RailLine";
import { BARRIER, BARRIER_GROUND_Y, buildBarrierLamps, buildBarrierPost, buildBoom, buildTrack } from "@/engine/orion/rail/RailMeshes";
import { CARRIAGE_COUNT } from "@/engine/orion/rail/RailTraffic";
import { useNearby } from "./useNearby";

/**
 * The railway in the world: the track itself, the barriers at every level crossing, and the
 * train going round.
 *
 * The route, the crossings and the train's rules all live in engine/orion/rail; this only
 * mounts them. Track geometry is built once per graphics device and shared, so re-rendering
 * here never rebuilds a kilometre of rail.
 */

const TRAIN_MODEL = "/models/rail/metro-train.glb";
/**
 * Where the train starts its first lap: on the north side, heading west, a few seconds short of
 * the player's spawn — so the first thing it does is run past them.
 */
const TRAIN_START_DISTANCE = 330;

/**
 * Barriers only exist near the player; the track and the train are always there.
 *
 * The loop has a crossing every 80 m, so a generous radius mounts nearly all sixteen of them at
 * once — ninety-odd mesh instances, all casting shadows, for booms the player cannot see. A
 * crossing is visible from well inside 90 m, and a driver needs to see the boom in time to stop
 * from about 35 m.
 */
const CROSSING_RENDER_RADIUS = 90;
const CROSSING_UNMOUNT_RADIUS = 130;
const CROSSING_SAMPLE_MS = 500;

const crossingPosition = (crossing: LevelCrossing): readonly [number, number] => [crossing.x, crossing.z];

export const Railway = memo(function Railway() {
	const nearbyCrossings = useNearby(RAIL_CROSSINGS, crossingPosition, CROSSING_RENDER_RADIUS, CROSSING_UNMOUNT_RADIUS, CROSSING_SAMPLE_MS);
	return (
		<Entity name="railway">
			<Track />
			{nearbyCrossings.map((crossing) => (
				<Entity key={crossing.id} name={crossing.id}>
					<Barrier crossing={crossing} side={1} />
					<Barrier crossing={crossing} side={-1} />
				</Entity>
			))}
			<Train />
		</Entity>
	);
});

/** Ballast, sleepers and rails for the whole loop, in chunks the renderer can cull. */
const Track = memo(function Track() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		if (!app || !root) return;
		const bedMaterial = flatMaterial("#ffffff", 0.06, true);
		const railMaterial = new StandardMaterial();
		railMaterial.diffuse = new Color(0.38, 0.36, 0.34);
		railMaterial.gloss = 0.78;
		railMaterial.metalness = 1;
		railMaterial.useMetalness = true;
		railMaterial.update();

		const chunks = trackFor(app.graphicsDevice);
		const parts: PlayCanvasEntity[] = [];
		chunks.forEach((chunk, index) => {
			const part = new PlayCanvasEntity(`track-${index}`);
			part.addComponent("render", {
				meshInstances: [new MeshInstance(chunk.bed, bedMaterial), new MeshInstance(chunk.rails, railMaterial)],
				castShadows: false,
				receiveShadows: true,
			});
			root.addChild(part);
			parts.push(part);
		});
		// The meshes are cached per device and shared, so only the entities and materials go.
		return () => {
			for (const part of parts) part.destroy();
			bedMaterial.destroy();
			railMaterial.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="rail-track" />;
});

/**
 * One boom and its post, on the left of the traffic approaching from `side` (India keeps left),
 * reaching from the kerb to just past the centre of the road.
 */
function Barrier({ crossing, side }: Readonly<{ crossing: LevelCrossing; side: 1 | -1 }>) {
	const app = useApp();
	const [post, setPost] = useState<PlayCanvasEntity | null>(null);
	const [boom, setBoom] = useState<PlayCanvasEntity | null>(null);
	// Each barrier flashes its own lamps, so each needs its own material.
	const lamp = useMemo(() => flatMaterial("#3a0806", 0.6, false), []);
	useEffect(() => () => lamp.destroy(), [lamp]);

	const radians = (crossing.heading * Math.PI) / 180;
	// Along the track, and along the road that crosses it.
	const trackX = Math.sin(radians);
	const trackZ = Math.cos(radians);
	const roadX = Math.cos(radians);
	const roadZ = -Math.sin(radians);
	const kerb = crossing.roadWidth / 2 + BARRIER.kerbClearance;
	const boomLength = kerb + BARRIER.overhang;

	useEffect(() => {
		if (!app || !post || !boom) return;
		const device = app.graphicsDevice;
		const hardware = flatMaterial("#ffffff", 0.35, true);
		const postPart = renderPart(post, "barrier-post", postFor(device), hardware);
		// Two 17 cm emissive cubes on top of a post: their shadows are invisible and they were
		// costing a shadow draw each.
		const lampPart = renderPart(post, "barrier-lamps", lampsFor(device), lamp, false);
		lampPart.setLocalPosition(0, BARRIER.lampHeight, 0);
		const boomPart = renderPart(boom, "barrier-boom", boomFor(device, boomLength), hardware);
		return () => {
			postPart.destroy();
			lampPart.destroy();
			boomPart.destroy();
			hardware.destroy();
		};
	}, [app, post, boom, lamp, boomLength]);

	return (
		<Entity
			name={`barrier-${side > 0 ? "a" : "b"}`}
			position={[
				crossing.x + roadX * side * BARRIER.setback + trackX * side * kerb,
				BARRIER_GROUND_Y,
				crossing.z + roadZ * side * BARRIER.setback + trackZ * side * kerb,
			]}
			// Turned so the boom's own +X reaches back across the carriageway.
			rotation={[0, crossing.heading + side * 90, 0]}
		>
			<Entity ref={setPost} name="barrier-post-parts" />
			<Entity ref={setBoom} name="boom" position={[0, BARRIER.pivotHeight, 0]} />
			<Script script={OrionBarrier} crossing={crossing} lamp={lamp} phase={side > 0 ? 0 : 1} />
		</Entity>
	);
}

/** The train: three carriages, each instancing the same set and showing one third of it. */
function Train() {
	const { asset, error } = useModel(TRAIN_MODEL);
	if (error || !asset) return null;
	return (
		<Entity name="orion-train">
			{Array.from({ length: CARRIAGE_COUNT }, (_, index) => (
				<Entity key={index} name={carriageName(index)}>
					<Entity name={carriageFitName(index)}>
						<Container asset={asset} />
					</Entity>
				</Entity>
			))}
			<Script script={OrionTrain} front={TRAIN_START_DISTANCE} />
		</Entity>
	);
}

function renderPart(parent: PlayCanvasEntity, name: string, mesh: Mesh, material: StandardMaterial, castShadows = true): PlayCanvasEntity {
	const part = new PlayCanvasEntity(name);
	part.addComponent("render", { meshInstances: [new MeshInstance(mesh, material)], castShadows, receiveShadows: true });
	parent.addChild(part);
	return part;
}

function flatMaterial(diffuse: string, gloss: number, vertexColour: boolean): StandardMaterial {
	const material = new StandardMaterial();
	material.diffuse = new Color().fromString(diffuse);
	material.gloss = gloss;
	material.diffuseVertexColor = vertexColour;
	material.update();
	return material;
}

/**
 * Geometry is per graphics device and never changes, so it is built once and kept. A few dozen
 * boxes a metre is still a kilometre of track to generate — not something to redo on a re-render.
 *
 * Every cached mesh takes a reference of its own (`keep`). A MeshInstance increments the mesh's
 * reference count when it is created and frees the mesh when destroying the last instance of it,
 * so without this the first level crossing to fall out of range took the shared post, lamp and
 * boom meshes down with it — and the next crossing to mount got a mesh whose vertex buffer had
 * already gone. That is the "Cannot read properties of undefined (reading 'impl')" crash.
 */
const trackCache = new WeakMap<GraphicsDevice, ReturnType<typeof buildTrack>>();
const postCache = new WeakMap<GraphicsDevice, Mesh>();
const lampsCache = new WeakMap<GraphicsDevice, Mesh>();
const boomCache = new WeakMap<GraphicsDevice, Map<number, Mesh>>();

/** Takes the cache's own reference, so destroying every instance can't free the mesh. */
function keep(mesh: Mesh): Mesh {
	mesh.incRefCount();
	return mesh;
}

function trackFor(device: GraphicsDevice) {
	let chunks = trackCache.get(device);
	if (!chunks) {
		chunks = buildTrack(device);
		for (const chunk of chunks) {
			keep(chunk.bed);
			keep(chunk.rails);
		}
		trackCache.set(device, chunks);
	}
	return chunks;
}

function postFor(device: GraphicsDevice): Mesh {
	let mesh = postCache.get(device);
	if (!mesh) {
		mesh = keep(buildBarrierPost(device));
		postCache.set(device, mesh);
	}
	return mesh;
}

function lampsFor(device: GraphicsDevice): Mesh {
	let mesh = lampsCache.get(device);
	if (!mesh) {
		mesh = keep(buildBarrierLamps(device));
		lampsCache.set(device, mesh);
	}
	return mesh;
}

function boomFor(device: GraphicsDevice, length: number): Mesh {
	let byLength = boomCache.get(device);
	if (!byLength) {
		byLength = new Map();
		boomCache.set(device, byLength);
	}
	let mesh = byLength.get(length);
	if (!mesh) {
		mesh = keep(buildBoom(device, length));
		byLength.set(length, mesh);
	}
	return mesh;
}
