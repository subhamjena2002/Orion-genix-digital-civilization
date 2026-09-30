/**
 * Turns the downloaded fighter model into the game's jet:
 *
 *   node scripts/prepare-jet.mjs <source.glb> <out.glb>
 *
 * The source ("Fictional Fighter/Bomber Aircraft", see CREDITS.md) is 1,752 separate meshes
 * under 4,145 nodes: drawn as-is that's well over a thousand draw calls for one aircraft. Here
 * every mesh is baked into model space (metres, Y up, nose along +Z, +X to the pilot's left, the
 * body frame the game uses) and merged, one mesh per material, into:
 *
 *   body                 everything that doesn't move
 *   canopy, airbrake     each pivoting on its hinge (modelled open; the game closes them)
 *   gear-nose, gear-left, gear-right   each leg with its doors, pivoting at the top of the leg
 *   missile-1 … missile-4              outer left, outer right, inner left, inner right
 *   interior             the cockpit (a third of the triangles): drawn only close up
 *   engine-core          the engines' insides, seen only up the nozzles
 *   lod1, lod2           the whole jet as it stands parked, simplified for distance (about 15% and
 *                        3% of the triangles, cockpit and engine insides left out)
 *
 * A part's node sits at its pivot and its vertices are relative to it, so turning or scaling the
 * node moves the part about the right point. Geometry, UVs, materials and textures are unchanged
 * (the distant versions are simplified copies of the same geometry).
 */

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
	console.error("usage: node scripts/prepare-jet.mjs <source.glb> <out.glb>");
	process.exit(1);
}

const PREFIX = "MiG_33_FullOpen0721:";

/** Movable parts: which source nodes (by name, subtree included) go in each, and its pivot. */
const PARTS = [
	{ name: "canopy", nodes: ["Canopy_R"], pivot: "rear-bottom" },
	{ name: "airbrake", nodes: ["AirBrake"], pivot: "front-bottom" },
	{ name: "gear-nose", nodes: ["FrontGear", "FrontGear_Door"], pivot: "top" },
	{ name: "gear-left", nodes: ["MainGear_L", "MainGear_L_Door_F", "MainGear_L_Door_R"], pivot: "top" },
	{ name: "gear-right", nodes: ["MainGear_R", "MainGear_R_Door_F", "MainGear_R_Door_R"], pivot: "top" },
	{ name: "missile-1", nodes: ["R73_L1"], pivot: "centre" },
	{ name: "missile-2", nodes: ["R73_R1"], pivot: "centre" },
	{ name: "missile-3", nodes: ["R73_L3"], pivot: "centre" },
	{ name: "missile-4", nodes: ["R73_R3"], pivot: "centre" },
	{ name: "interior", nodes: ["Interior"], pivot: "origin" },
	// Both engines' cores: the names repeat, once per engine.
	{ name: "engine-core", nodes: ["flameholder", "RD_33main"], pivot: "origin", repeated: true },
];

/** Left out of the distant versions: nothing of them shows from outside at that range. */
const NOT_IN_LODS = new Set(["interior", "engine-core"]);
/**
 * The distant versions show the jet as it stands parked: the airbrake shut (degrees about the
 * part's X axis, as JET_GEOMETRY.airbrakeClosed), everything else as modelled.
 */
const PARKED_TURN = { airbrake: -45 };
/**
 * Share of the triangles each distant version aims for, and the most the surface may move (m).
 * Texture seams may be collapsed across ("Permissive"): a little stretching of the paint doesn't
 * show at the distances these are drawn at, and without it the seams alone held them at 2-3x.
 */
const LODS = [
	{ name: "lod1", ratio: 0.12, error: 0.05 },
	{ name: "lod2", ratio: 0.03, error: 0.35 },
];

/**
 * National insignia painted out of the colour maps: the model carries red stars (a real air
 * force's roundel) on its wings and fins. Boxes in texture pixels (x0, y0, x1, y1) around each
 * star, found by their colour; each is refilled by blending the paint around it.
 */
const INSIGNIA = {
	body1: [[109, 769, 131, 792], [508, 767, 530, 790], [236, 113, 257, 135], [384, 112, 405, 134]],
	body2: [[267, 857, 289, 880], [401, 854, 423, 877]],
};
/** Beyond the red, the star's white edging. */
const INSIGNIA_MARGIN = 8;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(source);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

// ---- Which part each mesh node belongs to ------------------------------------------------------

const partOf = new Map();
for (const part of PARTS) {
	for (const wanted of part.nodes) {
		const found = root.listNodes().filter((node) => node.getName() === PREFIX + wanted);
		if (part.repeated ? found.length === 0 : found.length !== 1) throw new Error(`expected ${part.repeated ? "some" : "one"} node ${wanted}, found ${found.length}`);
		for (const node of found) {
			node.traverse((child) => {
				if (!partOf.has(child)) partOf.set(child, part.name);
			});
		}
	}
}

// ---- Bake ----------------------------------------------------------------------------------------

const transformPoint = (m, x, y, z) => [
	m[0] * x + m[4] * y + m[8] * z + m[12],
	m[1] * x + m[5] * y + m[9] * z + m[13],
	m[2] * x + m[6] * y + m[10] * z + m[14],
];
const transformVector = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];

/** Inverse-transpose of the upper 3x3, for normals, as a column-major 4x4. */
function normalMatrix(m) {
	const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
	const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	const inv = [
		(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
		(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
		(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
	];
	// Transposed inverse, laid out column-major.
	return { matrix: [inv[0], inv[1], inv[2], 0, inv[3], inv[4], inv[5], 0, inv[6], inv[7], inv[8], 0, 0, 0, 0, 1], det };
}

const normalise = (v) => {
	const length = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / length, v[1] / length, v[2] / length];
};

/** Per part, per material: the merged vertex streams. */
const groups = new Map();
const group = (part, material, semantics) => {
	const key = `${part}\u0000${material.getName()}`;
	if (!groups.has(key)) groups.set(key, { part, material, semantics, position: [], normal: [], tangent: [], uv0: [], uv1: [], index: [] });
	return groups.get(key);
};

for (const node of root.listNodes()) {
	const mesh = node.getMesh();
	if (!mesh) continue;
	const world = node.getWorldMatrix();
	const { matrix: nm, det } = normalMatrix(world);
	const mirrored = det < 0;
	for (const primitive of mesh.listPrimitives()) {
		if (primitive.getMode() !== 4) throw new Error("only triangle lists are handled");
		const semantics = primitive.listSemantics().sort().join(",");
		const out = group(partOf.get(node) ?? "body", primitive.getMaterial(), semantics);
		if (out.semantics !== semantics) throw new Error(`mixed vertex layouts in ${out.part} / ${primitive.getMaterial().getName()}`);
		const base = out.position.length / 3;
		const position = primitive.getAttribute("POSITION");
		const normal = primitive.getAttribute("NORMAL");
		const tangent = primitive.getAttribute("TANGENT");
		const uv0 = primitive.getAttribute("TEXCOORD_0");
		const uv1 = primitive.getAttribute("TEXCOORD_1");
		const p = [0, 0, 0];
		const t4 = [0, 0, 0, 0];
		const t2 = [0, 0];
		for (let v = 0; v < position.getCount(); v++) {
			position.getElement(v, p);
			out.position.push(...transformPoint(world, p[0], p[1], p[2]));
			normal.getElement(v, p);
			out.normal.push(...normalise(transformVector(nm, p[0], p[1], p[2])));
			if (tangent) {
				tangent.getElement(v, t4);
				out.tangent.push(...normalise(transformVector(world, t4[0], t4[1], t4[2])), mirrored ? -t4[3] : t4[3]);
			}
			if (uv0) out.uv0.push(...uv0.getElement(v, t2));
			if (uv1) out.uv1.push(...uv1.getElement(v, t2));
		}
		const indices = primitive.getIndices();
		const count = indices ? indices.getCount() : position.getCount();
		for (let k = 0; k < count; k += 3) {
			const a = indices ? indices.getScalar(k) : k;
			const b = indices ? indices.getScalar(k + 1) : k + 1;
			const c = indices ? indices.getScalar(k + 2) : k + 2;
			// A mirrored transform turns the triangles inside out: wind them back.
			if (mirrored) out.index.push(base + a, base + c, base + b);
			else out.index.push(base + a, base + b, base + c);
		}
	}
}

// ---- Pivots --------------------------------------------------------------------------------------

function boundsOf(name) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const g of groups.values()) {
		if (g.part !== name) continue;
		for (let i = 0; i < g.position.length; i += 3) {
			for (let k = 0; k < 3; k++) {
				min[k] = Math.min(min[k], g.position[i + k]);
				max[k] = Math.max(max[k], g.position[i + k]);
			}
		}
	}
	return { min, max };
}

const pivots = new Map([["body", [0, 0, 0]]]);
for (const part of PARTS) {
	const { min, max } = boundsOf(part.name);
	const mid = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
	const pivot = {
		"rear-bottom": [mid[0], min[1], min[2]],
		"front-bottom": [mid[0], min[1], max[2]],
		top: [mid[0], max[1], mid[2]],
		centre: mid,
		origin: [0, 0, 0],
	}[part.pivot];
	pivots.set(part.name, pivot.map((v) => Math.round(v * 1000) / 1000));
}

// ---- Rebuild the scene ---------------------------------------------------------------------------

const oldScenes = root.listScenes();
const oldNodes = root.listNodes();
const oldMeshes = root.listMeshes();
const oldAccessors = root.listAccessors();

const scene = doc.createScene("jet");
const jet = doc.createNode("jet");
scene.addChild(jet);
const partNodes = new Map();
for (const name of ["body", ...PARTS.map((part) => part.name)]) {
	const node = doc.createNode(name).setTranslation(pivots.get(name));
	jet.addChild(node);
	partNodes.set(name, node);
}

const accessor = (type, array) => doc.createAccessor().setBuffer(buffer).setType(type).setArray(array);
let triangles = 0;
for (const g of groups.values()) {
	const [px, py, pz] = pivots.get(g.part);
	const position = new Float32Array(g.position.length);
	for (let i = 0; i < g.position.length; i += 3) {
		position[i] = g.position[i] - px;
		position[i + 1] = g.position[i + 1] - py;
		position[i + 2] = g.position[i + 2] - pz;
	}
	const primitive = doc.createPrimitive()
		.setMaterial(g.material)
		.setAttribute("POSITION", accessor("VEC3", position))
		.setAttribute("NORMAL", accessor("VEC3", new Float32Array(g.normal)))
		.setIndices(accessor("SCALAR", new Uint32Array(g.index)));
	if (g.tangent.length) primitive.setAttribute("TANGENT", accessor("VEC4", new Float32Array(g.tangent)));
	if (g.uv0.length) primitive.setAttribute("TEXCOORD_0", accessor("VEC2", new Float32Array(g.uv0)));
	if (g.uv1.length) primitive.setAttribute("TEXCOORD_1", accessor("VEC2", new Float32Array(g.uv1)));
	const node = partNodes.get(g.part);
	const mesh = node.getMesh() ?? doc.createMesh(g.part);
	mesh.addPrimitive(primitive);
	node.setMesh(mesh);
	triangles += g.index.length / 3;
}

// ---- Paint out the insignia ---------------------------------------------------------------------

for (const material of root.listMaterials()) {
	const boxes = INSIGNIA[material.getName()];
	const texture = material.getBaseColorTexture();
	if (!boxes || !texture) continue;
	const { data, info } = await sharp(Buffer.from(texture.getImage())).raw().toBuffer({ resolveWithObject: true });
	const { width, height, channels } = info;
	const at = (x, y, c) => data[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * channels + c];
	for (const [bx0, by0, bx1, by1] of boxes) {
		const x0 = bx0 - INSIGNIA_MARGIN;
		const y0 = by0 - INSIGNIA_MARGIN;
		const x1 = bx1 + INSIGNIA_MARGIN;
		const y1 = by1 + INSIGNIA_MARGIN;
		// Average of a 3-pixel strip just outside each edge, then a blend of the two interpolations.
		const strip = (x, y, dx, dy, c) => (at(x, y, c) + at(x + dx, y + dy, c) + at(x + 2 * dx, y + 2 * dy, c)) / 3;
		const fill = [];
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const u = (x - x0) / (x1 - x0);
				const v = (y - y0) / (y1 - y0);
				const pixel = [];
				for (let c = 0; c < channels; c++) {
					const across = strip(x0 - 1, y, -1, 0, c) * (1 - u) + strip(x1 + 1, y, 1, 0, c) * u;
					const down = strip(x, y0 - 1, 0, -1, c) * (1 - v) + strip(x, y1 + 1, 0, 1, c) * v;
					pixel.push(Math.round((across + down) / 2));
				}
				fill.push([x, y, pixel]);
			}
		}
		for (const [x, y, pixel] of fill) for (let c = 0; c < channels; c++) data[(y * width + x) * channels + c] = pixel[c];
	}
	texture.setImage(new Uint8Array(await sharp(data, { raw: { width, height, channels } }).png().toBuffer())).setMimeType("image/png");
}

// ---- Distant versions ----------------------------------------------------------------------------

const DEG = Math.PI / 180;

/** Everything but the cockpit and engine cores, in the parked pose, merged per material. */
function parkedByMaterial() {
	const byMaterial = new Map();
	for (const g of groups.values()) {
		if (NOT_IN_LODS.has(g.part)) continue;
		const key = g.material.getName();
		if (!byMaterial.has(key)) byMaterial.set(key, { material: g.material, semantics: g.semantics, position: [], normal: [], tangent: [], uv0: [], uv1: [], index: [] });
		const out = byMaterial.get(key);
		if (out.semantics !== g.semantics) throw new Error(`mixed vertex layouts in ${key}`);
		const turn = (PARKED_TURN[g.part] ?? 0) * DEG;
		const c = Math.cos(turn);
		const s = Math.sin(turn);
		// A turn about X, as the engine applies a part's local X rotation.
		const rotate = (y, z) => [y * c - z * s, y * s + z * c];
		const [, py, pz] = pivots.get(g.part);
		const base = out.position.length / 3;
		for (let i = 0; i < g.position.length; i += 3) {
			const [y, z] = rotate(g.position[i + 1] - py, g.position[i + 2] - pz);
			out.position.push(g.position[i], y + py, z + pz);
			const [ny, nz] = rotate(g.normal[i + 1], g.normal[i + 2]);
			out.normal.push(g.normal[i], ny, nz);
		}
		for (let i = 0; i < g.tangent.length; i += 4) {
			const [ty, tz] = rotate(g.tangent[i + 1], g.tangent[i + 2]);
			out.tangent.push(g.tangent[i], ty, tz, g.tangent[i + 3]);
		}
		for (const value of g.uv0) out.uv0.push(value);
		for (const value of g.uv1) out.uv1.push(value);
		for (const index of g.index) out.index.push(base + index);
	}
	return byMaterial;
}

await MeshoptSimplifier.ready;
const parked = parkedByMaterial();
const lodTriangles = {};
for (const lod of LODS) {
	const node = doc.createNode(lod.name);
	jet.addChild(node);
	const mesh = doc.createMesh(lod.name);
	let count = 0;
	for (const source of parked.values()) {
		const positions = new Float32Array(source.position);
		const indices = new Uint32Array(source.index);
		const targetCount = Math.max(3, Math.floor((indices.length * lod.ratio) / 3) * 3);
		const [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, targetCount, lod.error, ["ErrorAbsolute", "Prune", "Permissive"]);
		if (simplified.length < 3) continue;
		// Only the vertices the simplified triangles still use.
		const remap = new Int32Array(positions.length / 3).fill(-1);
		const used = [];
		const index = new Uint32Array(simplified.length);
		for (let i = 0; i < simplified.length; i++) {
			const old = simplified[i];
			if (remap[old] < 0) {
				remap[old] = used.length;
				used.push(old);
			}
			index[i] = remap[old];
		}
		const pick = (stream, size) => {
			const out = new Float32Array(used.length * size);
			used.forEach((old, i) => {
				for (let k = 0; k < size; k++) out[i * size + k] = stream[old * size + k];
			});
			return out;
		};
		const primitive = doc.createPrimitive()
			.setMaterial(source.material)
			.setAttribute("POSITION", accessor("VEC3", pick(source.position, 3)))
			.setAttribute("NORMAL", accessor("VEC3", pick(source.normal, 3)))
			.setIndices(accessor("SCALAR", index));
		if (source.tangent.length) primitive.setAttribute("TANGENT", accessor("VEC4", pick(source.tangent, 4)));
		if (source.uv0.length) primitive.setAttribute("TEXCOORD_0", accessor("VEC2", pick(source.uv0, 2)));
		if (source.uv1.length) primitive.setAttribute("TEXCOORD_1", accessor("VEC2", pick(source.uv1, 2)));
		mesh.addPrimitive(primitive);
		count += index.length / 3;
	}
	node.setMesh(mesh);
	lodTriangles[lod.name] = count;
}

for (const node of oldNodes) node.dispose();
for (const mesh of oldMeshes) mesh.dispose();
for (const old of oldAccessors) old.dispose();
for (const old of oldScenes) old.dispose();
root.setDefaultScene(scene);
root.getAsset().extras = {
	...(root.getAsset().extras ?? {}),
	prepared: "scripts/prepare-jet.mjs: baked to metres, Y up, nose +Z; merged by material; parts split out",
};

await io.write(target, doc);
console.log(`wrote ${target}: ${groups.size} primitives, ${Math.round(triangles)} triangles`);
for (const [name, count] of Object.entries(lodTriangles)) console.log(`  ${name.padEnd(11)} ${count} triangles`);
for (const [name, pivot] of pivots) console.log(`  ${name.padEnd(11)} pivot ${pivot.join(", ")}`);
