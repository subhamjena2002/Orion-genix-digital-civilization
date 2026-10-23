import { describe, expect, it } from "vitest";

import type { MeshData } from "../world/MeshData";
import { ORION_BUILDING_MAP } from "./Buildings";
import { designBuilding } from "./CityBuildingDesign";
import { buildCityBuilding, type BuildingSpec } from "./CityBuildingMesh";
import { BAY_METRES, BAYS, FLOOR_METRES, GROUND_METRES } from "./FacadeTextures";

const BASE: BuildingSpec = {
	width: 12,
	depth: 12,
	style: "deco",
	ground: "shop",
	tiers: [{ floors: 4, inset: 0 }],
	tint: [1, 0.9, 0.8],
	groundTint: [1, 0.94, 0.86],
	trimTint: [1, 1, 1],
	accentTint: [0.2, 0.6, 0.6],
	cornice: true,
	canopy: true,
	fin: true,
	door: false,
	rooftop: 3,
	bayOffset: 1,
	floorOffset: 2,
	seed: 7,
};

function checkMesh(mesh: MeshData): void {
	const vertices = mesh.positions.length / 3;
	expect(mesh.normals.length).toBe(mesh.positions.length);
	expect(mesh.uvs.length / 2).toBe(vertices);
	expect(mesh.colors!.length / 4).toBe(vertices);
	expect(mesh.indices.length % 3).toBe(0);
	for (const index of mesh.indices) {
		expect(index).toBeGreaterThanOrEqual(0);
		expect(index).toBeLessThan(vertices);
	}
	for (const value of [...mesh.positions, ...mesh.uvs, ...mesh.colors!]) expect(Number.isFinite(value)).toBe(true);
}

/** Every triangle wound anticlockwise about its stated normal (so it faces out, not culled). */
function checkWinding(mesh: MeshData): void {
	const p = mesh.positions;
	for (let i = 0; i < mesh.indices.length; i += 3) {
		const [a, b, c] = [mesh.indices[i] * 3, mesh.indices[i + 1] * 3, mesh.indices[i + 2] * 3];
		const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
		const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
		const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
		const n = [mesh.normals[a], mesh.normals[a + 1], mesh.normals[a + 2]];
		const dot = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
		if (Math.hypot(...cross) > 1e-9) expect(dot).toBeGreaterThan(0);
	}
}

describe("buildCityBuilding", () => {
	it("makes valid, outward-facing meshes", () => {
		const geometry = buildCityBuilding(BASE);
		for (const mesh of [geometry.wall, geometry.ground, geometry.trim]) {
			checkMesh(mesh);
			checkWinding(mesh);
		}
		expect(geometry.wall.indices.length).toBeGreaterThan(0);
		expect(geometry.ground.indices.length).toBeGreaterThan(0);
		// The roof is part of the trim: something faces straight up at the top.
		const { positions, normals } = geometry.trim;
		let roofed = false;
		for (let i = 0; i < positions.length; i += 3) if (normals[i + 1] > 0.99 && Math.abs(positions[i + 1] - geometry.height) < 1e-6) roofed = true;
		expect(roofed).toBe(true);
	});

	it("stands a ground floor and whole storeys", () => {
		const geometry = buildCityBuilding(BASE);
		expect(geometry.height).toBeCloseTo(GROUND_METRES + 4 * FLOOR_METRES);
		const noShops = buildCityBuilding({ ...BASE, ground: null });
		expect(noShops.height).toBeCloseTo(4 * FLOOR_METRES);
		expect(noShops.ground.indices.length).toBe(0);
	});

	it("fits whole bays along each wall", () => {
		const geometry = buildCityBuilding({ ...BASE, width: 13, depth: 7 });
		const { uvs, normals } = geometry.wall;
		// Each side is one quad: the u span is its bays over the tile's.
		const spans = new Map<string, number>();
		for (let v = 0; v < uvs.length / 2; v += 4) {
			const key = `${normals[v * 3]},${normals[v * 3 + 2]}`;
			spans.set(key, Math.abs(uvs[(v + 1) * 2] - uvs[v * 2]));
		}
		expect(spans.get("0,1")).toBeCloseTo(Math.round(13 / BAY_METRES) / BAYS);
		expect(spans.get("1,0")).toBeCloseTo(Math.round(7 / BAY_METRES) / BAYS);
	});

	it("steps the upper tiers in", () => {
		const geometry = buildCityBuilding({ ...BASE, fin: false, tiers: [{ floors: 6, inset: 0 }, { floors: 4, inset: 2 }] });
		const { positions } = geometry.wall;
		let topHalfWidth = 0;
		let bottomHalfWidth = 0;
		const split = GROUND_METRES + 6 * FLOOR_METRES;
		for (let i = 0; i < positions.length; i += 3) {
			const x = Math.abs(positions[i]);
			if (positions[i + 1] > split + 0.1) topHalfWidth = Math.max(topHalfWidth, x);
			else bottomHalfWidth = Math.max(bottomHalfWidth, x);
		}
		expect(bottomHalfWidth).toBeCloseTo(6);
		expect(topHalfWidth).toBeCloseTo(4);
		expect(geometry.height).toBeCloseTo(GROUND_METRES + 10 * FLOOR_METRES);
	});

	it("keeps rooftop plant on the roof", () => {
		const geometry = buildCityBuilding({ ...BASE, cornice: false, canopy: false, fin: false, rooftop: 5 });
		const { positions } = geometry.trim;
		for (let i = 0; i < positions.length; i += 3) {
			expect(Math.abs(positions[i])).toBeLessThanOrEqual(6 + 0.06);
			expect(Math.abs(positions[i + 2])).toBeLessThanOrEqual(6 + 0.06);
		}
	});
});

describe("designBuilding", () => {
	it("is the same every time for a lot", () => {
		const placement = ORION_BUILDING_MAP[5];
		expect(designBuilding(placement, 123)).toEqual(designBuilding(placement, 123));
	});

	it("designs every lot in the city into a sound building", () => {
		for (const [index, placement] of ORION_BUILDING_MAP.entries()) {
			const spec = designBuilding(placement, index * 7919 + 1);
			expect(spec.tiers.length).toBeGreaterThan(0);
			expect(spec.width).toBeLessThanOrEqual(placement.footprint[0]);
			expect(spec.depth).toBeLessThanOrEqual(placement.footprint[1]);
			const geometry = buildCityBuilding(spec);
			expect(geometry.height).toBeGreaterThan(2.5);
			expect(geometry.height).toBeLessThan(140);
			if (placement.districtKind === "suburban") expect(spec.ground).toBeNull();
		}
	});

	it("varies the street", () => {
		const styles = new Set(ORION_BUILDING_MAP.map((placement, index) => designBuilding(placement, index + 1).style));
		expect(styles.size).toBeGreaterThanOrEqual(5);
	});
});

describe("shopfronts along a street", () => {
	it("never show the same front twice in a row: neighbours along it, or behind them across a block", () => {
		const shops = ORION_BUILDING_MAP.map((placement, index) => ({ placement, spec: designBuilding(placement, index + 1) })).filter(({ spec }) => spec.ground === "shop");
		let pairs = 0;
		for (const [i, a] of shops.entries()) {
			for (const b of shops.slice(i + 1)) {
				const dx = Math.abs(a.placement.position[0] - b.placement.position[0]);
				const dz = Math.abs(a.placement.position[2] - b.placement.position[2]);
				if (Math.hypot(dx, dz) > 19) continue;
				pairs++;
				expect([a.spec.bayOffset, a.spec.groundTint].join(), `${a.placement.id}/${b.placement.id}`).not.toBe([b.spec.bayOffset, b.spec.groundTint].join());
			}
		}
		expect(pairs).toBeGreaterThan(10);
	});
});

describe("the building map", () => {
	it("never stands two buildings on the same ground", () => {
		for (const [i, a] of ORION_BUILDING_MAP.entries()) {
			for (const b of ORION_BUILDING_MAP.slice(i + 1)) {
				// Each footprint as its inscribed square: a real overlap, not a near miss at a corner.
				const reach = (Math.min(...a.footprint) + Math.min(...b.footprint)) / 2;
				const apart = Math.abs(a.position[0] - b.position[0]) >= reach || Math.abs(a.position[2] - b.position[2]) >= reach;
				expect(apart, `${a.id} and ${b.id}`).toBe(true);
			}
		}
	});
});

