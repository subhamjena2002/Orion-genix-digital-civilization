import { describe, expect, it } from "vitest";

import { CITY_EXTENT_X, CITY_EXTENT_Z, pavedHeightAt } from "../roads/RoadNetwork";
import { HIGHWAYS, projectOnto } from "./Highways";
import { ACCESS_ROAD, BASE, BASE_BOUNDS, BASE_LAYOUT, BASE_PADS, BASE_VEHICLES, HELIPAD, MILITARY_KIT_NODES } from "./MilitaryBase";
import { LAND_Y, terrainHeightAt } from "./Mountains";
import { isOnLand } from "./StateOutline";

const inside = (x: number, z: number, margin = 0) => (
	x >= BASE_BOUNDS.minX + margin && x <= BASE_BOUNDS.maxX - margin && z >= BASE_BOUNDS.minZ + margin && z <= BASE_BOUNDS.maxZ - margin
);

describe("military base", () => {
	it("stands on open, flat land south of the city, clear of roads, hills and the sea", () => {
		for (const [x, z] of [[BASE_BOUNDS.minX, BASE_BOUNDS.minZ], [BASE_BOUNDS.maxX, BASE_BOUNDS.minZ], [BASE_BOUNDS.minX, BASE_BOUNDS.maxZ], [BASE_BOUNDS.maxX, BASE_BOUNDS.maxZ]]) {
			expect(isOnLand(x, z)).toBe(true);
			// Well back from the beach, too.
			expect(isOnLand(x, z + 40)).toBe(true);
		}
		expect(BASE_BOUNDS.minZ).toBeGreaterThan(CITY_EXTENT_Z + 40);
		expect(Math.max(Math.abs(BASE_BOUNDS.minX), Math.abs(BASE_BOUNDS.maxX))).toBeLessThan(CITY_EXTENT_X);
		for (let x = BASE_BOUNDS.minX; x <= BASE_BOUNDS.maxX; x += 10) {
			for (let z = BASE_BOUNDS.minZ; z <= BASE_BOUNDS.maxZ; z += 10) {
				expect(terrainHeightAt(x, z)).toBeCloseTo(LAND_Y, 5);
				expect(pavedHeightAt(x, z)).toBeNull();
				for (const highway of HIGHWAYS) expect(Math.abs(projectOnto(highway, x, z).lateral) > 30 || projectOnto(highway, x, z).beyondEnds).toBe(true);
			}
		}
	});

	it("walls the whole perimeter except the gate, which faces the city", () => {
		const walls = BASE_LAYOUT.filter((placement) => placement.piece === "wall");
		const north = walls.filter((wall) => wall.z === BASE_BOUNDS.minZ);
		const south = walls.filter((wall) => wall.z === BASE_BOUNDS.maxZ);
		expect(south.length).toBeGreaterThan(40);
		// The gate is a gap in the north wall on the centreline, and nothing but it.
		const [cx] = BASE.centre;
		expect(north.some((wall) => Math.abs(wall.x - cx) < BASE.gateWidth / 2)).toBe(false);
		expect(south.length - north.length).toBeGreaterThanOrEqual(3);
		expect(south.length - north.length).toBeLessThanOrEqual(5);
		// The access road reaches the gate from the city.
		expect(ACCESS_ROAD.fromZ).toBeLessThan(ACCESS_ROAD.toZ);
		expect(ACCESS_ROAD.toZ).toBeGreaterThan(BASE_BOUNDS.minZ);
		expect(pavedHeightAt(ACCESS_ROAD.x, ACCESS_ROAD.fromZ - 1)).not.toBeNull();
	});

	it("keeps everything inside the walls (bar the gate's barriers and sandbags)", () => {
		for (const placement of BASE_LAYOUT) {
			if (placement.piece === "wall") continue;
			const outsideGate = Math.abs(placement.x - BASE.centre[0]) < 12 && placement.z < BASE_BOUNDS.minZ + 1;
			expect(inside(placement.x, placement.z, 1) || outsideGate, `${placement.piece} at ${placement.x},${placement.z}`).toBe(true);
		}
		for (const pad of BASE_PADS) expect(inside(pad.x, pad.z)).toBe(true);
		expect(inside(HELIPAD.x, HELIPAD.z, HELIPAD.radius)).toBe(true);
		for (const vehicle of BASE_VEHICLES) expect(inside(vehicle.x, vehicle.z, 3)).toBe(true);
	});

	it("keeps the helipad's rotor disc clear: nothing within reach of the blades", () => {
		for (const placement of BASE_LAYOUT) {
			expect(Math.hypot(placement.x - HELIPAD.x, placement.z - HELIPAD.z), `${placement.piece} at ${placement.x},${placement.z}`).toBeGreaterThan(HELIPAD.radius + 1.5);
		}
	});

	it("names a kit node for every piece it uses", () => {
		for (const placement of BASE_LAYOUT) expect(MILITARY_KIT_NODES[placement.piece].length).toBeGreaterThan(0);
	});
});
