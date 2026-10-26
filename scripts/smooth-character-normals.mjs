/**
 * Smooth-shades the crowd's low-poly character models, in place.
 *
 *   node scripts/smooth-character-normals.mjs <file.glb>... [--angle 60]
 *
 * The citizen packs are exported flat-shaded: every triangle carries its own copy of each corner
 * with the face's normal, so faces, necks and arms read as facets in any light. This averages
 * each corner's normal with the corners at the same place whose normals are within `angle` of
 * its own, which smooths the curved surfaces and keeps creases sharper than that (collars,
 * hems, soles, the jaw line).
 *
 * Only NORMAL changes: positions, skinning, materials and animations are left exactly as they
 * are. Corners are matched across every primitive in the file, so seams between body parts
 * (head/body, body/legs) shade as one surface.
 */

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const args = process.argv.slice(2);
const angleAt = args.indexOf("--angle");
const angle = angleAt >= 0 ? Number(args.splice(angleAt, 2)[1]) : 60;
const files = args;
if (!files.length || !Number.isFinite(angle)) {
	console.error("usage: node scripts/smooth-character-normals.mjs <file.glb>... [--angle 60]");
	process.exit(1);
}
const minCos = Math.cos((angle * Math.PI) / 180);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const file of files) {
	const document = await io.read(file);
	const corners = [];
	for (const mesh of document.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const position = prim.getAttribute("POSITION");
			const normal = prim.getAttribute("NORMAL");
			if (!position || !normal) continue;
			corners.push({ position: position.getArray(), normal: normal.getArray(), accessor: normal });
		}
	}

	// Corners grouped by position, quantised finely enough that only true duplicates meet.
	const scale = 1e4;
	const groups = new Map();
	for (const [part, { position }] of corners.entries()) {
		for (let i = 0; i < position.length / 3; i++) {
			const key = `${Math.round(position[i * 3] * scale)},${Math.round(position[i * 3 + 1] * scale)},${Math.round(position[i * 3 + 2] * scale)}`;
			let group = groups.get(key);
			if (!group) groups.set(key, (group = []));
			group.push(part, i);
		}
	}

	let changed = 0;
	const smoothed = corners.map(({ normal }) => new Float32Array(normal));
	for (const group of groups.values()) {
		if (group.length < 4) continue;
		for (let a = 0; a < group.length; a += 2) {
			const na = corners[group[a]].normal;
			const ia = group[a + 1] * 3;
			let x = 0, y = 0, z = 0;
			for (let b = 0; b < group.length; b += 2) {
				const nb = corners[group[b]].normal;
				const ib = group[b + 1] * 3;
				if (na[ia] * nb[ib] + na[ia + 1] * nb[ib + 1] + na[ia + 2] * nb[ib + 2] < minCos) continue;
				x += nb[ib]; y += nb[ib + 1]; z += nb[ib + 2];
			}
			const length = Math.hypot(x, y, z);
			if (length < 1e-6) continue;
			const out = smoothed[group[a]];
			out[ia] = x / length; out[ia + 1] = y / length; out[ia + 2] = z / length;
			changed++;
		}
	}
	for (const [part, { accessor }] of corners.entries()) accessor.setArray(smoothed[part]);
	await io.write(file, document);
	console.log(`${file}: ${changed} corners smoothed (${angle}°)`);
}
