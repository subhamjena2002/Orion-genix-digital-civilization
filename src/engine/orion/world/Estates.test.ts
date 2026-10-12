import { describe, expect, it } from "vitest";

import { buildHouse, type HouseType } from "../buildings/HouseMesh";
import { pavedHeightAt } from "../roads/RoadNetwork";
import { buildEstateRoadMeshes } from "./EstateRoadMesh";
import { distanceToPath, ESTATE_NAMES, ESTATE_PAVEMENT, ESTATE_ROAD_WIDTH, ESTATE_ROADS, estateDressing, HOUSE_LOTS, smoothPath } from "./Estates";
import type { MeshData } from "./MeshData";
import { LAND_Y, terrainHeightAt } from "./Mountains";
import { isOnLand } from "./StateOutline";

function checkMesh(mesh: MeshData): void {
	const vertices = mesh.positions.length / 3;
	expect(mesh.normals.length).toBe(mesh.positions.length);
	expect(mesh.uvs.length / 2).toBe(vertices);
	expect(mesh.indices.length % 3).toBe(0);
	expect(mesh.indices.every((index) => index >= 0 && index < vertices)).toBe(true);
	expect(mesh.positions.every(Number.isFinite)).toBe(true);
}

/** Share of triangles wound to face their normals (front faces are the drawn ones). */
function facingShare(mesh: MeshData): number {
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
	return total === 0 ? 1 : good / total;
}

describe("estates", () => {
	it("fills the empty land with houses in every estate", () => {
		expect(HOUSE_LOTS.length).toBeGreaterThan(60);
		for (const estate of ESTATE_NAMES) {
			expect(HOUSE_LOTS.filter((lot) => lot.estate === estate.id).length).toBeGreaterThanOrEqual(5);
		}
		const types = new Set(HOUSE_LOTS.map((lot) => lot.type));
		expect(types).toEqual(new Set<HouseType>(["bungalow", "mansion", "villa"]));
	});

	it("builds every house on dry, flat land, off the roads and clear of each other", () => {
		for (const lot of HOUSE_LOTS) {
			expect(isOnLand(lot.x, lot.z)).toBe(true);
			expect(terrainHeightAt(lot.x, lot.z)).toBeLessThan(LAND_Y + 0.2);
			for (const road of ESTATE_ROADS) {
				expect(distanceToPath(road.points, lot.x, lot.z)).toBeGreaterThan(ESTATE_ROAD_WIDTH / 2 + ESTATE_PAVEMENT + lot.depth / 2);
			}
			expect(pavedHeightAt(lot.x, lot.z)).toBeNull();
			for (const other of HOUSE_LOTS) {
				if (other === lot) continue;
				expect(Math.hypot(other.x - lot.x, other.z - lot.z)).toBeGreaterThan((Math.min(lot.width, other.width)) / 2);
			}
		}
	});

	it("turns every house to face its street", () => {
		for (const lot of HOUSE_LOTS) {
			const yaw = (lot.yaw * Math.PI) / 180;
			const ahead = [lot.x + Math.sin(yaw) * 20, lot.z + Math.cos(yaw) * 20] as const;
			const behind = [lot.x - Math.sin(yaw) * 20, lot.z - Math.cos(yaw) * 20] as const;
			const nearest = (x: number, z: number) => Math.min(...ESTATE_ROADS.map((road) => distanceToPath(road.points, x, z)));
			expect(nearest(ahead[0], ahead[1])).toBeLessThan(nearest(behind[0], behind[1]));
		}
	});

	it("smooths a street through its control points", () => {
		const path = smoothPath([[0, 0], [40, 0], [40, 40]], 4);
		expect(path[0]).toEqual([0, 0]);
		expect(path[path.length - 1]).toEqual([40, 40]);
		for (let i = 1; i < path.length - 1; i++) {
			expect(Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])).toBeCloseTo(4, 0);
		}
	});

	it("lines the estate streets with palms and lamps, off the city's roads", () => {
		const items = estateDressing();
		expect(items.length).toBeGreaterThan(60);
		for (const item of items) expect(pavedHeightAt(item.x, item.z)).toBeNull();
	});

	it("builds the streets as upward-facing surfaces with kerbs", () => {
		const { asphalt, pavement } = buildEstateRoadMeshes();
		checkMesh(asphalt);
		checkMesh(pavement);
		expect(asphalt.indices.length).toBeGreaterThan(100);
		expect(facingShare(asphalt)).toBe(1);
		expect(facingShare(pavement)).toBe(1);
	});
});

describe("houses", () => {
	for (const type of ["bungalow", "mansion", "villa"] as const) {
		it(`builds a sound ${type}`, () => {
			const house = buildHouse({ type, width: 20, depth: 14, pool: true, seed: 42, frontGarden: 8, backGarden: 13 });
			for (const mesh of [...Object.values(house.walls), house.trim, house.tiles, house.water]) {
				checkMesh(mesh!);
				expect(facingShare(mesh!)).toBeGreaterThan(0.99);
			}
			expect(house.water.indices.length).toBeGreaterThan(0);
			if (type !== "villa") expect(house.tiles.indices.length).toBeGreaterThan(0);
			// Nothing outside the lot (house, gardens and hedges).
			for (let i = 0; i < house.trim.positions.length; i += 3) {
				expect(Math.abs(house.trim.positions[i])).toBeLessThanOrEqual(20 / 2 + 4 + 0.5);
				expect(house.trim.positions[i + 2]).toBeLessThanOrEqual(14 / 2 + 8 + 0.5);
				expect(house.trim.positions[i + 2]).toBeGreaterThanOrEqual(-(14 / 2 + 13) - 0.5);
			}
		});
	}
});
