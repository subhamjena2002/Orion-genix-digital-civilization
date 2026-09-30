import { describe, expect, it } from "vitest";

import { pavedHeightAt } from "../roads/RoadNetwork";
import {
	AIRFIELD_BOUNDS,
	AIRFIELD_FENCE,
	AIRFIELD_LABELS,
	AIRFIELD_LAYOUT,
	AIRFIELD_LIGHTS,
	AIRFIELD_MARKINGS,
	AIRFIELD_SURFACES,
	AIRFIELD_VEHICLES,
	buildShelterMesh,
	CONTROL_TOWER,
	RUNWAY,
	SHELTER,
	SHELTERS,
	STANDS,
	WINDSOCK,
	type Surface,
} from "./Airfield";
import { HIGHWAYS, projectOnto } from "./Highways";
import { AIRFIELD_GATE, BASE_BOUNDS, BASE_LAYOUT } from "./MilitaryBase";
import { LAND_Y, terrainHeightAt } from "./Mountains";
import { isOnLand } from "./StateOutline";

const flatLand = (x: number, z: number) => isOnLand(x, z) && Math.abs(terrainHeightAt(x, z) - LAND_Y) < 1e-6;
const edges = (surface: Surface) => ({
	minX: surface.x - surface.width / 2,
	maxX: surface.x + surface.width / 2,
	minZ: surface.z - surface.depth / 2,
	maxZ: surface.z + surface.depth / 2,
});
const onSurface = (x: number, z: number, margin = 0) => AIRFIELD_SURFACES.some((surface) => {
	const e = edges(surface);
	return x >= e.minX - margin && x <= e.maxX + margin && z >= e.minZ - margin && z <= e.maxZ + margin;
});
const insideFence = (x: number, z: number) => x > AIRFIELD_BOUNDS.minX && x < AIRFIELD_BOUNDS.maxX && z > AIRFIELD_BOUNDS.minZ && z < AIRFIELD_BOUNDS.maxZ;

describe("airfield", () => {
	it("lays its runway and everything paved on flat, open land, clear of roads and highways", () => {
		for (const surface of AIRFIELD_SURFACES) {
			const e = edges(surface);
			for (let x = e.minX; x <= e.maxX; x += Math.min(5, surface.width)) {
				for (let z = e.minZ; z <= e.maxZ; z += Math.min(5, surface.depth)) {
					expect(flatLand(x, z), `${surface.id} at ${x},${z}`).toBe(true);
					expect(pavedHeightAt(x, z), `${surface.id} at ${x},${z}`).toBeNull();
					for (const highway of HIGHWAYS) {
						const p = projectOnto(highway, x, z);
						expect(p.beyondEnds || Math.abs(p.lateral) > 30).toBe(true);
					}
				}
			}
		}
		// Room either side of the runway, too: not paved to the water's edge.
		for (let z = RUNWAY.northZ - RUNWAY.blastPad; z <= RUNWAY.southZ + RUNWAY.blastPad; z += 5) {
			for (const side of [-1, 1]) expect(flatLand(RUNWAY.x + side * (RUNWAY.width / 2 + RUNWAY.shoulder + 8), z), `z ${z}`).toBe(true);
		}
		// Long enough for a jet to get off the ground in a map this size.
		expect(RUNWAY.southZ - RUNWAY.northZ).toBeGreaterThanOrEqual(500);
	});

	it("never lays one surface over another", () => {
		for (let i = 0; i < AIRFIELD_SURFACES.length; i++) {
			for (let j = i + 1; j < AIRFIELD_SURFACES.length; j++) {
				const a = edges(AIRFIELD_SURFACES[i]);
				const b = edges(AIRFIELD_SURFACES[j]);
				const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
				const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
				expect(overlapX > 1e-6 && overlapZ > 1e-6, `${AIRFIELD_SURFACES[i].id} over ${AIRFIELD_SURFACES[j].id}`).toBe(false);
			}
		}
	});

	it("stays out of the base but for the link through its east gate", () => {
		for (const surface of AIRFIELD_SURFACES) {
			const e = edges(surface);
			const intoBase = e.minX < BASE_BOUNDS.maxX && e.maxZ > BASE_BOUNDS.minZ && e.minZ < BASE_BOUNDS.maxZ;
			expect(intoBase, surface.id).toBe(surface.id === "gate-link");
		}
		const link = AIRFIELD_SURFACES.find((surface) => surface.id === "gate-link");
		expect(link).toBeDefined();
		// The gate is open where the link goes through...
		const eastWall = BASE_LAYOUT.filter((placement) => placement.piece === "wall" && placement.x === BASE_BOUNDS.maxX);
		expect(eastWall.some((wall) => Math.abs(wall.z - AIRFIELD_GATE.z) < AIRFIELD_GATE.width / 2)).toBe(false);
		expect(eastWall.length).toBeGreaterThan(30);
		// ...and nothing in the base stands in the way.
		for (const placement of BASE_LAYOUT) {
			if (placement.piece === "wall") continue;
			expect(placement.x > BASE_BOUNDS.maxX - 6 && Math.abs(placement.z - AIRFIELD_GATE.z) < AIRFIELD_GATE.width / 2 + 0.5, `${placement.piece} at ${placement.x},${placement.z}`).toBe(false);
		}
	});

	it("walls off the land side: every run starts at the base's wall and ends at the sea", () => {
		for (const run of AIRFIELD_FENCE) {
			const [sx, sz] = run[0];
			expect(sx).toBe(BASE_BOUNDS.maxX);
			expect([BASE_BOUNDS.minZ, BASE_BOUNDS.maxZ]).toContain(sz);
			const [ax, az] = run[run.length - 2];
			const [bx, bz] = run[run.length - 1];
			const length = Math.hypot(bx - ax, bz - az);
			expect(flatLand(bx, bz), `end ${bx},${bz}`).toBe(true);
			expect(isOnLand(bx + (bx - ax) / length * 4, bz + (bz - az) / length * 4), `beyond ${bx},${bz}`).toBe(false);
			for (let i = 1; i < run.length; i++) {
				const [px, pz] = run[i - 1];
				const [qx, qz] = run[i];
				for (let t = 0; t <= 1; t += 0.02) expect(flatLand(px + (qx - px) * t, pz + (qz - pz) * t)).toBe(true);
			}
		}
		// Panels follow on without gaps.
		const walls = AIRFIELD_LAYOUT.filter((placement) => placement.piece === "wall");
		expect(walls.length).toBeGreaterThan(200);
	});

	it("keeps everything inside the fence", () => {
		for (const surface of AIRFIELD_SURFACES) {
			if (surface.id === "gate-link") continue;
			const e = edges(surface);
			for (const [x, z] of [[e.minX, e.minZ], [e.maxX, e.maxZ]]) expect(insideFence(x, z), surface.id).toBe(true);
		}
		for (const placement of AIRFIELD_LAYOUT) {
			if (placement.piece !== "wall") expect(insideFence(placement.x, placement.z) && flatLand(placement.x, placement.z), `${placement.piece} at ${placement.x},${placement.z}`).toBe(true);
		}
		for (const [x, z] of [[CONTROL_TOWER.x, CONTROL_TOWER.z], [CONTROL_TOWER.block.x, CONTROL_TOWER.block.z], [WINDSOCK.x, WINDSOCK.z]]) expect(insideFence(x, z)).toBe(true);
		for (const vehicle of AIRFIELD_VEHICLES) expect(onSurface(vehicle.x, vehicle.z, -4), vehicle.id).toBe(true);
		for (const stand of STANDS) expect(onSurface(stand.x - 10, stand.z) && onSurface(stand.x + 10, stand.z), `stand ${stand.number}`).toBe(true);
		for (const shelter of SHELTERS) expect(flatLand(shelter.backX, shelter.z - SHELTER.width / 2) && flatLand(shelter.backX, shelter.z + SHELTER.width / 2)).toBe(true);
	});

	it("paints only on paving, and lights only beside it", () => {
		for (const marking of AIRFIELD_MARKINGS) expect(onSurface(marking.x, marking.z), `marking at ${marking.x},${marking.z}`).toBe(true);
		for (const label of AIRFIELD_LABELS) expect(onSurface(label.x, label.z), label.text).toBe(true);
		for (const light of AIRFIELD_LIGHTS) {
			expect(insideFence(light.x, light.z)).toBe(true);
			expect(onSurface(light.x, light.z, 1.5), `${light.colour} light at ${light.x},${light.z}`).toBe(true);
		}
		// Nothing stands out on the runway.
		for (const light of AIRFIELD_LIGHTS) expect(Math.abs(light.x - RUNWAY.x) > RUNWAY.width / 2 || light.z < RUNWAY.northZ || light.z > RUNWAY.southZ).toBe(true);
	});

	it("builds each shelter as an arch whose faces all look outward", () => {
		const mesh = buildShelterMesh(6);
		const p = mesh.positions;
		const n = mesh.normals;
		expect(mesh.indices.length).toBeGreaterThan(0);
		for (let i = 0; i < mesh.indices.length; i += 3) {
			const [a, b, c] = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
			const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
			const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
			const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
			const normal = [n[a * 3] + n[b * 3] + n[c * 3], n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]];
			expect(cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2]).toBeGreaterThan(0);
		}
		// The size it says.
		let maxY = 0;
		let maxZ = 0;
		let maxX = 0;
		for (let i = 0; i < p.length; i += 3) {
			maxX = Math.max(maxX, p[i]);
			maxY = Math.max(maxY, p[i + 1]);
			maxZ = Math.max(maxZ, Math.abs(p[i + 2]));
		}
		expect(maxX).toBeCloseTo(SHELTER.depth);
		expect(maxY).toBeCloseTo(SHELTER.height);
		expect(maxZ).toBeCloseTo(SHELTER.width / 2);
	});
});
