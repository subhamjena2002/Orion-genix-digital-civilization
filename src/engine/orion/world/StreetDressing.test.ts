import { describe, expect, it } from "vitest";

import { ROAD_GRID, roadWidthAt } from "../roads/RoadNetwork";
import type { MeshData } from "./MeshData";
import { appendTransformed, buildDressingChunks, lampGeometry, palmGeometry, streetDressing } from "./StreetDressing";

function checkMesh(mesh: MeshData): void {
	const vertices = mesh.positions.length / 3;
	expect(mesh.normals.length).toBe(mesh.positions.length);
	expect(mesh.uvs.length / 2).toBe(vertices);
	expect(mesh.indices.length % 3).toBe(0);
	expect(mesh.indices.every((index) => index >= 0 && index < vertices)).toBe(true);
	expect(mesh.positions.every(Number.isFinite)).toBe(true);
}

/** Triangles of a closed solid face the way their normals do. */
function outward(mesh: MeshData): number {
	const p = mesh.positions;
	let good = 0;
	let total = 0;
	for (let i = 0; i < mesh.indices.length; i += 3) {
		const [a, b, c] = [mesh.indices[i] * 3, mesh.indices[i + 1] * 3, mesh.indices[i + 2] * 3];
		const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
		const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
		const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
		if (Math.hypot(n[0], n[1], n[2]) < 1e-9) continue;
		total++;
		if (n[0] * mesh.normals[a] + n[1] * mesh.normals[a + 1] + n[2] * mesh.normals[a + 2] > 0) good++;
	}
	return good / total;
}

describe("streetDressing", () => {
	const items = streetDressing();

	it("lines the city with palms and lamps", () => {
		expect(items.length).toBeGreaterThan(400);
		const lamps = items.filter((item) => item.kind === "lamp").length;
		expect(lamps).toBeGreaterThan(items.length * 0.25);
		expect(lamps).toBeLessThan(items.length * 0.45);
	});

	it("keeps off the carriageway and out of junctions", () => {
		for (const item of items) {
			const onNs = ROAD_GRID.xs.some((x) => Math.abs(item.x - x) < roadWidthAt(x) / 2);
			const onEw = ROAD_GRID.zs.some((z) => Math.abs(item.z - z) < roadWidthAt(z) / 2);
			expect(onNs || onEw).toBe(false);
		}
	});
});

describe("geometry", () => {
	it("builds sound palms, facing out", () => {
		for (let variant = 0; variant < 4; variant++) {
			const palm = palmGeometry(variant);
			checkMesh(palm.trunk);
			checkMesh(palm.fronds);
			expect(outward(palm.trunk)).toBeGreaterThan(0.95);
			expect(palm.fronds.indices.length).toBeGreaterThan(0);
		}
	});

	it("builds a sound lamp reaching along +Z", () => {
		const lamp = lampGeometry();
		checkMesh(lamp.metal);
		checkMesh(lamp.glass);
		expect(outward(lamp.metal)).toBeGreaterThan(0.95);
		let reach = 0;
		for (let i = 2; i < lamp.glass.positions.length; i += 3) reach = Math.max(reach, lamp.glass.positions[i]);
		expect(reach).toBeGreaterThan(2);
	});

	it("turns copies the way an entity's yaw does", () => {
		const target: MeshData = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
		appendTransformed(target, { positions: [0, 0, 1], normals: [0, 0, 1], uvs: [0, 0], colors: [1, 1, 1, 1], indices: [] }, 10, 0, 0, 90);
		expect(target.positions[0]).toBeCloseTo(11);
		expect(target.positions[2]).toBeCloseTo(0);
		expect(target.normals[0]).toBeCloseTo(1);
	});

	it("merges into chunks without breaking the indices, quickly", () => {
		const started = performance.now();
		const chunks = buildDressingChunks(streetDressing());
		// Built once while the world loads (~0.2 s alone): this only catches a pathological slowdown,
		// with room for a busy test run.
		expect(performance.now() - started).toBeLessThan(2000);
		expect(chunks.length).toBeGreaterThan(4);
		for (const chunk of chunks) for (const mesh of [chunk.trunks, chunk.fronds, chunk.metal, chunk.glass]) checkMesh(mesh);
	});
});
