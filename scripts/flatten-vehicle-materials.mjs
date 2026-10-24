/**
 * Collapses a vehicle GLB's plain materials into one shared "flat_surface" material, in place.
 *
 *   node scripts/flatten-vehicle-materials.mjs public/models/vehicles/orion-sedan-2026.glb [...]
 *
 * The Blender-built cars (blender/build_car_2026.py) come out with about 25 materials, and the
 * game draws one call per material per car (mergeRigidParts and the batcher both group by
 * material), so a street of them was three times the draws of the older fleet. As in
 * build-vehicles.mjs (flattenMaterials), every plain opaque material — trims, interior, metals,
 * tyres — gets its colour baked into the vertex colours and its roughness and metalness into a
 * texel of a tiny palette (glTF's metallic-roughness texture: green roughness, blue metalness),
 * picked per primitive by its texture coordinate. Each keeps its exact finish; only clear coat on
 * trims is lost. Paint, glass, lamps, sirens and anything emissive keep their own materials: the
 * game finds and changes those by name.
 *
 * Running it again on a flattened file does nothing.
 */
import { readFile, writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { png } from "./vehicle-kit.mjs";

// Kept in step with src/engine/orion/traffic/VehicleModels.ts and OrionVehicleModel.ts.
const PAINT_MATERIAL = /paint|body|carpaint|car_paint|exterior|chassis/i;
const BRAKE_LIGHT_MATERIAL = /brake(?![ _.-]?(?:rotor|disc|disk|caliper|pad))|tail.?light|rear.?light|stop.?light|taillamp/i;
const HEADLIGHT_MATERIAL = /head.?light|front.?light|headlamp/i;
const SIREN_MATERIAL = /siren|beacon|light.?bar|police.?light/i;
const INDICATOR_MATERIAL = /^indicator_(left|right)$/;
const SHARED_NAME = "flat_surface";
const NEAREST = 9728;

function flattenable(material) {
	const name = material.getName();
	if (PAINT_MATERIAL.test(name) || BRAKE_LIGHT_MATERIAL.test(name) || HEADLIGHT_MATERIAL.test(name)) return false;
	if (SIREN_MATERIAL.test(name) || INDICATOR_MATERIAL.test(name)) return false;
	if (material.getAlphaMode() !== "OPAQUE" || material.getEmissiveFactor().some((v) => v > 0)) return false;
	return !material.getBaseColorTexture() && !material.getMetallicRoughnessTexture() && !material.getNormalTexture()
		&& !material.getOcclusionTexture() && !material.getEmissiveTexture();
}

async function flatten(path) {
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const doc = await io.readBinary(new Uint8Array(await readFile(path)));
	const root = doc.getRoot();
	if (root.listMaterials().some((material) => material.getName() === SHARED_NAME)) {
		console.log(`${path}: already flattened`);
		return;
	}
	const before = root.listMaterials().length;
	const flat = root.listMaterials().filter(flattenable);
	if (flat.length < 2) {
		console.log(`${path}: nothing to flatten`);
		return;
	}

	// One texel per distinct finish.
	const finishes = [];
	const texelOf = new Map();
	for (const material of flat) {
		const roughness = Math.round(material.getRoughnessFactor() * 255);
		const metallic = Math.round(material.getMetallicFactor() * 255);
		const key = `${roughness}|${metallic}`;
		if (!finishes.includes(key)) finishes.push(key);
		texelOf.set(material, finishes.indexOf(key));
	}
	const pixels = finishes.flatMap((key) => {
		const [roughness, metallic] = key.split("|").map(Number);
		return [255, roughness, metallic, 255];
	});
	const buffer = root.listBuffers()[0];
	const palette = doc.createTexture(`${SHARED_NAME}_finishes`).setMimeType("image/png").setImage(png(finishes.length, 1, pixels));
	const shared = doc.createMaterial(SHARED_NAME).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(1);
	shared.setMetallicRoughnessTexture(palette);
	shared.getMetallicRoughnessTextureInfo().setMinFilter(NEAREST).setMagFilter(NEAREST);

	for (const mesh of root.listMeshes()) {
		for (const primitive of mesh.listPrimitives()) {
			const material = primitive.getMaterial();
			const count = primitive.getAttribute("POSITION").getCount();
			const flattened = material && texelOf.has(material);
			const [r, g, b] = flattened ? material.getBaseColorFactor() : [1, 1, 1];
			const existing = primitive.getAttribute("COLOR_0");
			const colours = new Uint8Array(count * 4);
			for (let v = 0; v < count; v++) {
				// Over any colour already there (baked occlusion), as build-vehicles.mjs does.
				const base = existing ? existing.getElement(v, []) : [1, 1, 1, 1];
				colours[v * 4] = Math.round(255 * base[0] * r);
				colours[v * 4 + 1] = Math.round(255 * base[1] * g);
				colours[v * 4 + 2] = Math.round(255 * base[2] * b);
				colours[v * 4 + 3] = 255;
			}
			// Every primitive gets colours, so the vertex formats stay alike for merging.
			primitive.setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(colours).setNormalized(true).setBuffer(buffer));
			if (!flattened) continue;
			const u = Math.round(((texelOf.get(material) + 0.5) / finishes.length) * 255);
			const uvs = new Uint8Array(count * 2);
			for (let v = 0; v < count; v++) {
				uvs[v * 2] = u;
				uvs[v * 2 + 1] = 128;
			}
			primitive.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(uvs).setNormalized(true).setBuffer(buffer));
			primitive.setMaterial(shared);
		}
	}
	for (const material of flat) material.dispose();
	for (const accessor of root.listAccessors()) if (accessor.listParents().every((parent) => parent === root)) accessor.dispose();

	const glb = await io.writeBinary(doc);
	await writeFile(path, glb);
	console.log(`${path}: ${before} → ${root.listMaterials().length} materials, ${finishes.length} finishes, ${glb.byteLength} bytes`);
}

for (const path of process.argv.slice(2)) await flatten(path);
