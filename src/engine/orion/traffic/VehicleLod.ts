import {
	BLEND_NONE,
	Entity,
	MeshInstance,
	SEMANTIC_COLOR,
	SEMANTIC_NORMAL,
	SEMANTIC_POSITION,
	StandardMaterial,
	TYPE_FLOAT32,
	TYPE_UINT8,
	type AppBase,
	type GraphicsDevice,
	type Mat4,
	type Material,
	type Mesh,
	type Texture,
} from "playcanvas";

import { timeSlicer } from "../rendering/FrameBudget";
import { prewarmMeshInstances } from "../rendering/ModelPrewarm";
import { buildMesh, compactGeometry, isMergeable, mergeGeometry, type MergedGeometry, type MergedStream } from "../rendering/MeshMerge";
import { LOD_PROFILES, lodErrorBudget } from "../rendering/lod/LodPolicy";
import type { SimplifyInput, SimplifyLevel } from "../rendering/lod/Simplify";
import { keepVisible } from "../rendering/lod/HiddenSurface";
import { simplifyInBackground, visibilityInBackground } from "../rendering/lod/SimplifyClient";
import { shadowOnlyLayer } from "../rendering/ShadowOnlyLayer";
import { averageColour, releasedAverageColour } from "../rendering/TextureBudget";
import { BRAKE_LIGHT_MATERIAL, HEADLIGHT_MATERIAL, SIREN_MATERIAL } from "./VehicleModels";
/** At LOD2 and LOD3 a material simplified below this is a speck, not worth its draw call. */
const MIN_FAR_TRIANGLES = 6;
/**
 * How much a vertex colour difference (0–1 per channel) counts against geometric error when
 * simplifying. Code-built vehicles carry their part colours and baked occlusion in the vertices
 * (scripts/vehicle-kit.mjs); judged on shape alone, flat panels lost the vertices holding that
 * shading and came out blotched or darkened (the truck's cargo box most of all, Phase 3.1).
 * 0.5 cut colour error 2–4x for 10–20% more triangles; 1 bought a little more for up to 42% more.
 */
const COLOUR_WEIGHT = 0.5;
/** Most milliseconds of LOD building in one go before letting the browser draw (see buildLods). */
const LOD_SLICE_MS = 8;
/** The player's camera (OrionCanvas), where the flat paint is prewarmed. */
const PREWARM_CAMERA = "third-person-camera";

interface Group {
	material: Material;
	instances: MeshInstance[];
}

type GroupKind = "flat" | "glass" | "light";

interface LodMeshes {
	/** LOD1 and LOD2: a mesh (or null where simplification pruned the group away) per group. */
	shaped: (Mesh | null)[][];
	/** LOD3's single vertex-coloured mesh for everything opaque. */
	flat: Mesh | null;
	/** LOD3's glass and lamps, which keep their own materials. */
	flatExtras: { group: number; mesh: Mesh }[];
	/** Triangles per level, LOD0 first, for profiling. */
	triangles: number[];
}

/**
 * What every paint of a model shares: LOD1, LOD2, LOD3's glass and lamps, and LOD3's body before
 * it's painted. A fleet-painted model used to be simplified again for every paint (each costing
 * worker jobs and main-thread mesh building), though only the body's vertex colours differ.
 */
interface SharedLods {
	shaped: (Mesh | null)[][];
	flatExtras: { group: number; mesh: Mesh }[];
	/** LOD3's body, simplified, with only its own vertex colours; and each vertex's group. */
	flatTemplate: { geometry: MergedGeometry; groupOf: Uint16Array } | null;
	triangles: number[];
}

const sharedCache = new Map<string, { signature: string; promise: Promise<SharedLods | null> }>();
const paintedCache = new Map<string, { signature: string; promise: Promise<LodMeshes | null> }>();
let flatMaterial: StandardMaterial | null = null;

/** Groups a car's visible parts by material and vertex layout, in hierarchy order. */
export function groupByMaterial(instances: readonly MeshInstance[]): Group[] {
	const groups = new Map<string, Group>();
	for (const instance of instances) {
		if (!instance.visible || !instance.material || !isMergeable(instance)) continue;
		const key = `${instance.material.id}|${instance.mesh.vertexBuffer.format.batchingHash}`;
		let group = groups.get(key);
		if (!group) groups.set(key, (group = { material: instance.material, instances: [] }));
		group.instances.push(instance);
	}
	return [...groups.values()];
}

function signatureOf(groups: readonly Group[]): string {
	return groups.map((group) => `${group.instances.length}:${group.instances.reduce((sum, instance) => sum + instance.mesh.vertexBuffer.numVertices, 0)}`).join(",");
}

function kindOf(material: Material): GroupKind {
	const name = material.name ?? "";
	if (BRAKE_LIGHT_MATERIAL.test(name) || HEADLIGHT_MATERIAL.test(name) || SIREN_MATERIAL.test(name)) return "light";
	return material.blendType !== BLEND_NONE ? "glass" : "flat";
}

/**
 * Builds (or fetches from the cache) the simplified meshes for a car.
 *
 * `modelKey` identifies the model and `paint` a fleet-painted car's paint ("" for a model that
 * keeps its own). The levels are simplified once per model; another paint only recolours LOD3's
 * body. `frame` is the world transform of the entity the LOD meshes will hang under at identity;
 * `radius` is the car's bounding radius in metres and `worldScale` metres per model unit.
 */
export function requestVehicleLods(
	device: GraphicsDevice,
	modelKey: string,
	paint: string,
	groups: readonly Group[],
	frame: Mat4,
	radius: number,
	worldScale: number,
): Promise<LodMeshes | null> {
	const signature = signatureOf(groups);
	const key = `${modelKey}|${paint}`;
	const painted = paintedCache.get(key);
	if (painted && painted.signature === signature) return painted.promise;
	let shared = sharedCache.get(modelKey);
	if (!shared || shared.signature !== signature) {
		const promise = buildShared(device, groups, frame, radius, worldScale).catch((error: unknown) => {
			console.warn("Vehicle LOD build failed; the car keeps full detail at every distance.", error);
			return null;
		});
		sharedCache.set(modelKey, (shared = { signature, promise }));
	}
	const promise = shared.promise.then((levels) => (levels ? paintLevels(device, levels, groups) : null));
	paintedCache.set(key, { signature, promise });
	return promise;
}

/** One paint's levels: the shared ones, and LOD3's body coloured by this car's materials. */
function paintLevels(device: GraphicsDevice, levels: SharedLods, groups: readonly Group[]): LodMeshes {
	const flat = levels.flatTemplate ? buildMesh(device, paintedFlat(levels.flatTemplate, groups)) : null;
	// The cache owns it for the page's lifetime, so no car's removal can free it.
	flat?.incRefCount();
	return { shaped: levels.shaped, flat, flatExtras: levels.flatExtras, triangles: levels.triangles };
}

/** The LOD3 body template with each vertex's own colour times its group's material colour. */
function paintedFlat(template: NonNullable<SharedLods["flatTemplate"]>, groups: readonly Group[]): MergedGeometry {
	const { geometry, groupOf } = template;
	const colourByGroup = new Map<number, readonly [number, number, number]>();
	const streams = geometry.streams.map((stream) => {
		if (stream.semantic !== SEMANTIC_COLOR) return stream;
		const own = stream.data as unknown as Uint8Array;
		const colours = new Uint8Array(own.length);
		for (let v = 0; v < geometry.vertexCount; v++) {
			const group = groupOf[v];
			let colour = colourByGroup.get(group);
			if (!colour) colourByGroup.set(group, (colour = colourOf(groups[group].material)));
			for (let c = 0; c < 3; c++) colours[v * 4 + c] = Math.round(own[v * 4 + c] * colour[c]);
			colours[v * 4 + 3] = 255;
		}
		return { ...stream, data: colours as unknown as Float32Array };
	});
	return { ...geometry, streams };
}

async function buildShared(device: GraphicsDevice, groups: readonly Group[], frame: Mat4, radius: number, worldScale: number): Promise<SharedLods | null> {
	if (groups.length === 0) return null;
	// Done a group at a time, letting the browser draw between slices: a car's whole set of
	// levels built in one go took 100–330 ms of the main thread (measured, Phase 2.3).
	const slice = timeSlicer(LOD_SLICE_MS);
	const merged: MergedGeometry[] = [];
	for (const group of groups) {
		merged.push(mergeGeometry(group.instances, frame));
		await slice();
	}

	// Hidden layers (the shell under the paint, the engine, the chassis) go first. Without this,
	// independently simplified layers drift apart and inner ones show through the paint. Where
	// it can't be done, the car keeps full detail at every distance rather than risk that.
	const visibility = await visibilityInBackground(merged.map((geometry, index) => ({
		positions: packedPositions(geometry),
		indices: geometry.indices,
		occluder: groups[index].material.blendType === BLEND_NONE,
	})));
	if (!visibility) return null;
	const geometries = merged.map((geometry, index) => ({ ...geometry, indices: keepVisible(geometry.indices, visibility[index]) }));
	const profile = LOD_PROFILES.vehicle;
	// The simplifier works in model units, the budget is in metres.
	const errorAt = (level: number) => lodErrorBudget(level, profile, radius) / Math.max(worldScale, 1e-6);
	// Colours are kept only where the material draws them.
	const toInput = (geometry: MergedGeometry, group: number): SimplifyInput => ({
		positions: packedPositions(geometry),
		indices: geometry.indices,
		...(drawsVertexColour(groups[group].material) ? colourAttributes(geometry) : {}),
	});

	// LOD1 keeps every panel edge in place, so materials meet exactly as modelled. LOD2 lets
	// edges move within its budget (under a pixel), which is what lets a car built from
	// thousands of separate panels simplify at all, and prunes specks.
	const shapedLevels: SimplifyLevel[] = [
		{ error: errorAt(1), prune: false, lockBorder: true },
		{ error: errorAt(2), prune: true, lockBorder: false, minTriangles: MIN_FAR_TRIANGLES },
	];
	const simplified = await simplifyInBackground(geometries.map((geometry, group) => toInput(geometry, group)), shapedLevels);
	const shaped: (Mesh | null)[][] = [];
	for (const level of simplified) {
		const meshes: (Mesh | null)[] = [];
		for (let group = 0; group < level.length; group++) {
			const indices = level[group];
			meshes.push(indices.length > 0 ? buildMesh(device, compactGeometry(geometries[group], indices)) : null);
			await slice();
		}
		shaped.push(meshes);
	}

	// LOD3 joins every opaque material into one vertex-coloured mesh before simplifying, so the
	// seams between materials no longer hold edges in place. Its colours are each vertex's own
	// here; each paint's material colours go on afterwards (paintedFlat).
	const flatGroups: number[] = [];
	const extraGroups: number[] = [];
	groups.forEach((group, index) => (kindOf(group.material) === "flat" ? flatGroups : extraGroups).push(index));
	const flatSource = flatGroups.length > 0
		? concatenate(flatGroups.map((index) => withFlatColour(geometries[index], [1, 1, 1])))
		: null;
	const sourceGroupOf = new Uint16Array(flatSource?.vertexCount ?? 0);
	let filled = 0;
	for (const index of flatGroups) {
		sourceGroupOf.fill(index, filled, filled + geometries[index].vertexCount);
		filled += geometries[index].vertexCount;
	}
	const farLevel: SimplifyLevel = { error: errorAt(3), prune: true, lockBorder: false, minTriangles: MIN_FAR_TRIANGLES };
	const [farBody] = flatSource
		? await simplifyInBackground([{ positions: packedPositions(flatSource), indices: flatSource.indices }], [{ ...farLevel, sloppy: true }])
		: [[]];
	const [farExtras] = await simplifyInBackground(extraGroups.map((group) => toInput(geometries[group], group)), [farLevel]);
	const bodyIndices = flatSource ? farBody[0] : null;
	const flatTemplate = flatSource && bodyIndices && bodyIndices.length > 0
		? { geometry: compactGeometry(flatSource, bodyIndices), groupOf: keptValues(sourceGroupOf, bodyIndices) }
		: null;
	const flatExtras: SharedLods["flatExtras"] = [];
	for (let extra = 0; extra < farExtras.length; extra++) {
		const indices = farExtras[extra];
		if (indices.length === 0) continue;
		flatExtras.push({ group: extraGroups[extra], mesh: buildMesh(device, compactGeometry(geometries[extraGroups[extra]], indices)) });
		await slice();
	}

	// The cache owns these for the page's lifetime, so no car's removal can free them.
	for (const mesh of [...shaped.flat(), ...flatExtras.map((extra) => extra.mesh)]) mesh?.incRefCount();

	const count = (meshes: (Mesh | null)[]) => meshes.reduce((sum, mesh) => sum + (mesh ? mesh.primitive[0].count / 3 : 0), 0);
	const triangles = [
		merged.reduce((sum, geometry) => sum + geometry.indices.length / 3, 0),
		count(shaped[0]),
		count(shaped[1]),
		(flatTemplate ? flatTemplate.geometry.indices.length / 3 : 0) + count(flatExtras.map((extra) => extra.mesh)),
	].map(Math.round);
	return { shaped, flatExtras, flatTemplate, triangles };
}

/**
 * `values` (one per source vertex) for the vertices `indices` keep, in the order
 * compactGeometry numbers them: first use first.
 */
export function keptValues(values: Uint16Array, indices: Uint32Array): Uint16Array {
	const seen = new Uint8Array(values.length);
	const kept: number[] = [];
	for (const vertex of indices) {
		if (seen[vertex]) continue;
		seen[vertex] = 1;
		kept.push(values[vertex]);
	}
	return Uint16Array.from(kept);
}

/** One car's simplified levels, and the shadow stand-in used with LOD2. */
export interface LodEntities {
	/** LOD1, LOD2, LOD3. */
	levels: Entity[];
	/** Casts LOD2's shadow in one draw (see ShadowOnlyLayer); null if it couldn't be set up. */
	shadowProxy: Entity | null;
}

/**
 * One car's LOD entities, hung under `parent` (the model root) and switched off. Mesh instances
 * use the car's own materials, in the same group order the meshes were built from.
 *
 * At LOD2 the car is 60–150 m away and its shadow falls in the far cascade, whose texels are
 * ~10 cm: the one-mesh LOD3 body casts the same shadow there as forty material groups, so LOD2
 * draws without casting and the stand-in casts for it.
 */
export function createLodEntities(app: AppBase, parent: Entity, meshes: LodMeshes, groups: readonly Group[]): LodEntities {
	const levels: Entity[] = [];
	const shadowLayer = meshes.flat ? shadowOnlyLayer(app) : null;
	const make = (name: string, instances: MeshInstance[], castShadows: boolean, layers?: number[]) => {
		const entity = new Entity(name);
		entity.addComponent("render", { meshInstances: instances, castShadows, receiveShadows: true, ...(layers ? { layers } : {}) });
		entity.enabled = false;
		parent.addChild(entity);
		return entity;
	};
	meshes.shaped.forEach((level, index) => {
		const instances: MeshInstance[] = [];
		level.forEach((mesh, group) => {
			if (mesh) instances.push(new MeshInstance(mesh, groups[group].material));
		});
		levels.push(make(`car-lod${index + 1}`, instances, !(index === 1 && shadowLayer)));
	});
	const flat: MeshInstance[] = [];
	if (meshes.flat) flat.push(new MeshInstance(meshes.flat, sharedFlatMaterial()));
	for (const extra of meshes.flatExtras) flat.push(new MeshInstance(extra.mesh, groups[extra.group].material));
	levels.push(make("car-lod3", flat, true));
	if (meshes.flat) warmFlatMaterial(app, meshes.flat);
	const shadowProxy = shadowLayer && meshes.flat
		? make("car-lod2-shadow", [new MeshInstance(meshes.flat, sharedFlatMaterial())], true, [shadowLayer.id])
		: null;
	return { levels, shadowProxy };
}

let flatWarmth: "cold" | "warming" | "warm" = "cold";

/**
 * Whether the flat paint's shaders are built. Until then a car goes no further than LOD1: LOD3
 * draws with it and LOD2's shadow stand-in casts with it, and its first sight linked the shader in
 * one 280–370 ms frame (measured, Phase 2.3).
 */
export function flatMaterialWarm(): boolean {
	return flatWarmth === "warm";
}

/** Builds the flat paint's shaders once, from the first car whose LOD3 has a flat body. */
function warmFlatMaterial(app: AppBase, mesh: Mesh) {
	if (flatWarmth !== "cold") return;
	flatWarmth = "warming";
	const camera = app.root.findByName(PREWARM_CAMERA) as Entity | null;
	if (!camera) {
		// No camera to draw it at: the first LOD3 builds it, as before.
		flatWarmth = "warm";
		return;
	}
	void prewarmMeshInstances(app, camera, [new MeshInstance(mesh, sharedFlatMaterial())])
		.catch(() => undefined)
		.finally(() => {
			flatWarmth = "warm";
		});
}

/** Car paint, flattened: colour comes from the vertices, lacquer from the material. */
function sharedFlatMaterial(): StandardMaterial {
	if (flatMaterial) return flatMaterial;
	flatMaterial = new StandardMaterial();
	flatMaterial.name = "car-lod-flat";
	flatMaterial.diffuseVertexColor = true;
	flatMaterial.useMetalness = true;
	flatMaterial.metalness = 0;
	flatMaterial.gloss = 0.62;
	flatMaterial.clearCoat = 0.5;
	flatMaterial.clearCoatGloss = 0.85;
	flatMaterial.update();
	return flatMaterial;
}

function packedPositions(geometry: MergedGeometry): Float32Array {
	const stream = geometry.streams.find((candidate) => candidate.semantic === SEMANTIC_POSITION)!;
	if (stream.components === 3) return stream.data;
	const packed = new Float32Array(geometry.vertexCount * 3);
	for (let i = 0; i < geometry.vertexCount; i++) {
		packed[i * 3] = stream.data[i * stream.components];
		packed[i * 3 + 1] = stream.data[i * stream.components + 1];
		packed[i * 3 + 2] = stream.data[i * stream.components + 2];
	}
	return packed;
}

function drawsVertexColour(material: Material): boolean {
	return material instanceof StandardMaterial && material.diffuseVertexColor;
}

/** The vertex colours (RGB, 0–1) for the simplifier to keep, if `geometry` has any. */
function colourAttributes(geometry: MergedGeometry): Pick<SimplifyInput, "attributes" | "attributeWeights"> {
	const colour = geometry.streams.find((stream) => stream.semantic === SEMANTIC_COLOR);
	if (!colour) return {};
	const scale = colour.dataType === TYPE_UINT8 ? 1 / 255 : 1;
	const attributes = new Float32Array(geometry.vertexCount * 3);
	for (let i = 0; i < geometry.vertexCount; i++) {
		for (let c = 0; c < 3; c++) attributes[i * 3 + c] = colour.data[i * colour.components + c] * scale;
	}
	return { attributes, attributeWeights: [COLOUR_WEIGHT, COLOUR_WEIGHT, COLOUR_WEIGHT] };
}

/**
 * Positions and normals of `geometry`, with every vertex painted `colour` (sRGB, 0–1) — times
 * the vertex colours it already has. Models built in code (scripts/build-vehicles.mjs) carry
 * their trims' and metals' colours in the vertices under one white material; painted flat,
 * those all came out white at this level.
 */
function withFlatColour(geometry: MergedGeometry, colour: readonly [number, number, number]): MergedGeometry {
	const position = geometry.streams.find((stream) => stream.semantic === SEMANTIC_POSITION)!;
	const normal = geometry.streams.find((stream) => stream.semantic === SEMANTIC_NORMAL);
	const own = geometry.streams.find((stream) => stream.semantic === SEMANTIC_COLOR);
	// Unsigned bytes normalised to 0–1, or floats.
	const ownScale = own && own.dataType === TYPE_UINT8 ? 1 / 255 : 1;
	const colours = new Uint8Array(geometry.vertexCount * 4);
	for (let i = 0; i < geometry.vertexCount; i++) {
		for (let c = 0; c < 3; c++) {
			const tint = own ? Math.min(1, own.data[i * own.components + c] * ownScale) : 1;
			colours[i * 4 + c] = Math.round(colour[c] * tint * 255);
		}
		colours[i * 4 + 3] = 255;
	}
	const streams: MergedStream[] = [
		{ ...position, components: 3, data: packedPositions(geometry) },
		normal
			? { ...normal, components: 3, data: packed3(normal, geometry.vertexCount) }
			: { semantic: SEMANTIC_NORMAL, components: 3, dataType: TYPE_FLOAT32, normalize: false, data: new Float32Array(geometry.vertexCount * 3).fill(0) },
		{ semantic: SEMANTIC_COLOR, components: 4, dataType: TYPE_UINT8, normalize: true, data: colours as unknown as Float32Array },
	];
	return { streams, indices: geometry.indices, vertexCount: geometry.vertexCount };
}

function packed3(stream: MergedStream, count: number): Float32Array {
	if (stream.components === 3) return stream.data;
	const packed = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		for (let c = 0; c < 3; c++) packed[i * 3 + c] = stream.data[i * stream.components + c];
	}
	return packed;
}

/** Joins geometries with identical stream layouts into one. */
function concatenate(parts: readonly MergedGeometry[]): MergedGeometry {
	const vertexCount = parts.reduce((sum, part) => sum + part.vertexCount, 0);
	const indexCount = parts.reduce((sum, part) => sum + part.indices.length, 0);
	const streams = parts[0].streams.map((stream, index) => {
		const ArrayType = stream.data.constructor as new (length: number) => Float32Array;
		const data = new ArrayType(vertexCount * stream.components);
		let offset = 0;
		for (const part of parts) {
			data.set(part.streams[index].data, offset);
			offset += part.vertexCount * stream.components;
		}
		return { ...stream, data };
	});
	const indices = new Uint32Array(indexCount);
	let vertexBase = 0;
	let indexOffset = 0;
	for (const part of parts) {
		for (let i = 0; i < part.indices.length; i++) indices[indexOffset + i] = part.indices[i] + vertexBase;
		indexOffset += part.indices.length;
		vertexBase += part.vertexCount;
	}
	return { streams, indices, vertexCount };
}

const textureAverages = new WeakMap<Texture, readonly [number, number, number]>();

/** The colour a material reads as from a distance: its tint times its texture's average. */
function colourOf(material: Material): readonly [number, number, number] {
	if (!(material instanceof StandardMaterial)) return [0.5, 0.5, 0.5];
	const tint = material.diffuse;
	const texture = averageOf(material.diffuseMap);
	return [tint.r * texture[0], tint.g * texture[1], tint.b * texture[2]];
}

function averageOf(texture: Texture | null): readonly [number, number, number] {
	if (!texture) return [1, 1, 1];
	const cached = textureAverages.get(texture);
	if (cached) return cached;
	// Once a model texture is on the GPU its bitmap is let go (TextureBudget), its average kept.
	// Unreadable (e.g. compressed) textures fall back to a mid grey.
	const source = texture.getSource(0) as CanvasImageSource | null;
	const average = (source ? averageColour(source) : releasedAverageColour(texture)) ?? [0.6, 0.6, 0.6];
	textureAverages.set(texture, average);
	return average;
}
