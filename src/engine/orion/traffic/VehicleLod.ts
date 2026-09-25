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

import { buildMesh, compactGeometry, isMergeable, mergeGeometry, type MergedGeometry, type MergedStream } from "../rendering/MeshMerge";
import { LOD_PROFILES, lodErrorBudget } from "../rendering/lod/LodPolicy";
import type { SimplifyLevel } from "../rendering/lod/Simplify";
import { keepVisible } from "../rendering/lod/HiddenSurface";
import { simplifyInBackground, visibilityInBackground } from "../rendering/lod/SimplifyClient";
import { shadowOnlyLayer } from "../rendering/ShadowOnlyLayer";
import { BRAKE_LIGHT_MATERIAL, HEADLIGHT_MATERIAL, SIREN_MATERIAL } from "./VehicleModels";

/**
 * Levels of detail for detailed (GLB) cars.
 *
 * LOD0 is the car as loaded: merged body plus separately moving wheels, doors and windows.
 * The simplified levels are the whole car in its rest pose, simplified per material with an
 * error budget below about half a pixel at the size each level switches in:
 *
 *   LOD1  every material kept, ~1.5 cm error        (traffic from ~25 m at 1080p)
 *   LOD2  every material kept, small pieces pruned  (~60 m)
 *   LOD3  one vertex-coloured mesh for the opaque body, plus glass and lamps (~150 m):
 *         a handful of draw calls instead of ~80, still the car's shape and colours.
 *
 * Meshes are built once per model (and paint, where the fleet recolours it) off the main
 * thread, then shared; each car only adds mesh instances using its own materials.
 */

/** Simplified levels after LOD0. */
export const VEHICLE_SIMPLIFIED_LEVELS = 3;
/** At LOD2 and LOD3 a material simplified below this is a speck, not worth its draw call. */
const MIN_FAR_TRIANGLES = 6;

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

const cache = new Map<string, { signature: string; promise: Promise<LodMeshes | null> }>();
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
 * `cacheKey` identifies the model and, for fleet-painted cars, the paint. `frame` is the world
 * transform of the entity the LOD meshes will hang under at identity; `radius` is the car's
 * bounding radius in metres and `worldScale` metres per model unit.
 */
export function requestVehicleLods(
	device: GraphicsDevice,
	cacheKey: string,
	groups: readonly Group[],
	frame: Mat4,
	radius: number,
	worldScale: number,
): Promise<LodMeshes | null> {
	const signature = signatureOf(groups);
	const cached = cache.get(cacheKey);
	if (cached && cached.signature === signature) return cached.promise;
	const promise = buildLods(device, groups, frame, radius, worldScale).catch((error: unknown) => {
		console.warn("Vehicle LOD build failed; the car keeps full detail at every distance.", error);
		return null;
	});
	cache.set(cacheKey, { signature, promise });
	return promise;
}

async function buildLods(device: GraphicsDevice, groups: readonly Group[], frame: Mat4, radius: number, worldScale: number): Promise<LodMeshes | null> {
	if (groups.length === 0) return null;
	const merged = groups.map((group) => mergeGeometry(group.instances, frame));

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
	const toInput = (geometry: MergedGeometry) => ({ positions: packedPositions(geometry), indices: geometry.indices });

	// LOD1 keeps every panel edge in place, so materials meet exactly as modelled. LOD2 lets
	// edges move within its budget (under a pixel), which is what lets a car built from
	// thousands of separate panels simplify at all, and prunes specks.
	const shapedLevels: SimplifyLevel[] = [
		{ error: errorAt(1), prune: false, lockBorder: true },
		{ error: errorAt(2), prune: true, lockBorder: false, minTriangles: MIN_FAR_TRIANGLES },
	];
	const simplified = await simplifyInBackground(geometries.map(toInput), shapedLevels);
	const shaped = simplified.map((level) => level.map((indices, group) => (
		indices.length > 0 ? buildMesh(device, compactGeometry(geometries[group], indices)) : null
	)));

	// LOD3 bakes each opaque material's colour into its vertices and joins them into one mesh
	// before simplifying, so the seams between materials no longer hold edges in place.
	const flatGroups: number[] = [];
	const extraGroups: number[] = [];
	groups.forEach((group, index) => (kindOf(group.material) === "flat" ? flatGroups : extraGroups).push(index));
	const flatSource = flatGroups.length > 0
		? concatenate(flatGroups.map((index) => withFlatColour(geometries[index], colourOf(groups[index].material))))
		: null;
	const farSources = [...(flatSource ? [flatSource] : []), ...extraGroups.map((index) => geometries[index])];
	const farLevel: SimplifyLevel = { error: errorAt(3), prune: true, lockBorder: false, minTriangles: MIN_FAR_TRIANGLES };
	const [farBody] = flatSource
		? await simplifyInBackground([toInput(flatSource)], [{ ...farLevel, sloppy: true }])
		: [[]];
	const [farExtras] = await simplifyInBackground(farSources.slice(flatSource ? 1 : 0).map(toInput), [farLevel]);
	const far = [...farBody, ...farExtras];
	let flat: Mesh | null = null;
	const flatExtras: LodMeshes["flatExtras"] = [];
	far.forEach((indices, source) => {
		if (indices.length === 0) return;
		const mesh = buildMesh(device, compactGeometry(farSources[source], indices));
		if (flatSource && source === 0) flat = mesh;
		else flatExtras.push({ group: extraGroups[source - (flatSource ? 1 : 0)], mesh });
	});

	const flatMesh = flat as Mesh | null;
	const all = [...shaped.flat(), flatMesh, ...flatExtras.map((extra) => extra.mesh)];
	// The cache owns these for the page's lifetime, so no car's removal can free them.
	for (const mesh of all) mesh?.incRefCount();

	const count = (meshes: (Mesh | null)[]) => meshes.reduce((sum, mesh) => sum + (mesh ? mesh.primitive[0].count / 3 : 0), 0);
	const triangles = [
		merged.reduce((sum, geometry) => sum + geometry.indices.length / 3, 0),
		count(shaped[0]),
		count(shaped[1]),
		count([flatMesh, ...flatExtras.map((extra) => extra.mesh)]),
	].map(Math.round);
	return { shaped, flat: flatMesh, flatExtras, triangles };
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
	const shadowProxy = shadowLayer && meshes.flat
		? make("car-lod2-shadow", [new MeshInstance(meshes.flat, sharedFlatMaterial())], true, [shadowLayer.id])
		: null;
	return { levels, shadowProxy };
}

export function lodTriangles(meshes: LodMeshes): readonly number[] {
	return meshes.triangles;
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

/** Positions and normals of `geometry`, with every vertex painted `colour` (sRGB, 0–1). */
function withFlatColour(geometry: MergedGeometry, colour: readonly [number, number, number]): MergedGeometry {
	const position = geometry.streams.find((stream) => stream.semantic === SEMANTIC_POSITION)!;
	const normal = geometry.streams.find((stream) => stream.semantic === SEMANTIC_NORMAL);
	const colours = new Uint8Array(geometry.vertexCount * 4);
	const r = Math.round(colour[0] * 255);
	const g = Math.round(colour[1] * 255);
	const b = Math.round(colour[2] * 255);
	for (let i = 0; i < geometry.vertexCount; i++) {
		colours[i * 4] = r;
		colours[i * 4 + 1] = g;
		colours[i * 4 + 2] = b;
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
	let average: readonly [number, number, number] = [0.6, 0.6, 0.6];
	try {
		const source = texture.getSource(0) as CanvasImageSource | null;
		if (source && typeof OffscreenCanvas !== "undefined") {
			const canvas = new OffscreenCanvas(8, 8);
			const context = canvas.getContext("2d");
			if (context) {
				context.drawImage(source, 0, 0, 8, 8);
				const pixels = context.getImageData(0, 0, 8, 8).data;
				let r = 0;
				let g = 0;
				let b = 0;
				for (let i = 0; i < pixels.length; i += 4) {
					r += pixels[i];
					g += pixels[i + 1];
					b += pixels[i + 2];
				}
				const count = (pixels.length / 4) * 255;
				average = [r / count, g / count, b / count];
			}
		}
	} catch {
		// Unreadable (e.g. compressed) textures fall back to a mid grey.
	}
	textureAverages.set(texture, average);
	return average;
}
