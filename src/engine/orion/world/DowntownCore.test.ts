import { describe, expect, it } from "vitest";

import { ORION_BUILDING_MAP } from "../buildings/Buildings";
import { distanceFromRail, RAIL_BED_WIDTH } from "../rail/RailLine";
import { pavedHeightAt } from "../roads/RoadNetwork";
import { DOWNTOWN_AREAS, DOWNTOWN_FENCES, DOWNTOWN_LOT, DOWNTOWN_PARKED_CARS, DOWNTOWN_RAIL, downtownGeometry, downtownTrees } from "./DowntownCore";
import type { Rect } from "./DistrictProps";
import { streetDressing } from "./StreetDressing";

const buildings = ORION_BUILDING_MAP.map((building) => {
	const half = Math.max(...building.footprint) / 2;
	return { id: building.id, minX: building.position[0] - half, maxX: building.position[0] + half, minZ: building.position[2] - half, maxZ: building.position[2] + half };
});
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Each solid piece's centre, from the collider (eight corners per box). */
function solidCentres(): [number, number][] {
	const { collider } = downtownGeometry();
	const centres: [number, number][] = [];
	for (let i = 0; i < collider.positions.length; i += 24) {
		let x = 0;
		let z = 0;
		for (let k = 0; k < 8; k++) {
			x += collider.positions[i + k * 3] / 8;
			z += collider.positions[i + k * 3 + 2] / 8;
		}
		centres.push([x, z]);
	}
	return centres;
}

describe("downtown's dressing", () => {
	it("lays the car park and the square on open ground, clear of roads, buildings and the line", () => {
		for (const [name, area] of DOWNTOWN_AREAS) {
			for (let x = area.minX; x <= area.maxX; x += 1) {
				for (let z = area.minZ; z <= area.maxZ; z += 1) {
					expect(pavedHeightAt(x, z), `${name} at ${x},${z}`).toBeNull();
					expect(distanceFromRail(x, z), `${name} at ${x},${z}`).toBeGreaterThan(DOWNTOWN_RAIL.clearance);
				}
			}
			for (const building of buildings) expect(overlaps(area, building), `${name} overlaps ${building.id}`).toBe(false);
		}
	});

	it("fences the line outside its bed, and leaves the avenue's level crossing open", () => {
		for (const z of [DOWNTOWN_FENCES.south, DOWNTOWN_FENCES.north]) {
			expect(Math.abs(z - DOWNTOWN_RAIL.z)).toBeGreaterThan(RAIL_BED_WIDTH / 2 + 2);
		}
		// The avenue at x = 0 (14 m of road, 2 m of pavement each side) stays clear.
		expect(DOWNTOWN_FENCES.from).toBeGreaterThan(9);
		for (const x of [DOWNTOWN_FENCES.from, DOWNTOWN_FENCES.to, -DOWNTOWN_FENCES.from, -DOWNTOWN_FENCES.to]) {
			expect(pavedHeightAt(x, DOWNTOWN_FENCES.south), `fence end ${x}`).toBeNull();
			expect(pavedHeightAt(x, DOWNTOWN_FENCES.north), `fence end ${x}`).toBeNull();
		}
	});

	it("keeps everything solid out of the roads and buildings, and off the line's clearance bar the fences", () => {
		const kerbside = streetDressing();
		for (const [x, z] of solidCentres()) {
			const onRoad = (Math.abs(x) < 7 && z > 80 && z < 240) || (Math.abs(z - 160) < 7 && Math.abs(x) > 9);
			expect(onRoad, `prop at ${x.toFixed(1)},${z.toFixed(1)} is in the road`).toBe(false);
			const spot = { minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 };
			for (const building of buildings) expect(overlaps(spot, building), `prop at ${x.toFixed(1)},${z.toFixed(1)} in ${building.id}`).toBe(false);
			const isFence = Math.abs(z - DOWNTOWN_FENCES.south) < 0.2 || Math.abs(z - DOWNTOWN_FENCES.north) < 0.2;
			if (!isFence) expect(distanceFromRail(x, z), `prop at ${x.toFixed(1)},${z.toFixed(1)} on the line`).toBeGreaterThan(DOWNTOWN_RAIL.clearance);
			for (const post of kerbside) expect(Math.hypot(post.x - x, post.z - z), `prop at ${x.toFixed(1)},${z.toFixed(1)} vs ${post.kind}`).toBeGreaterThan(0.8);
		}
	});

	it("parks its car in the car park, and keeps the trees off the paving, the line and the buildings", () => {
		for (const car of DOWNTOWN_PARKED_CARS) {
			expect(car.x > DOWNTOWN_LOT.minX + 1.2 && car.x < DOWNTOWN_LOT.maxX - 1.2, car.id).toBe(true);
			expect(car.z - 2.5 >= DOWNTOWN_LOT.minZ && car.z + 2.5 <= DOWNTOWN_LOT.maxZ, car.id).toBe(true);
		}
		for (const tree of downtownTrees()) {
			if (tree.kind === "palm") expect(pavedHeightAt(tree.x, tree.z), `palm ${tree.x},${tree.z}`).toBeNull();
			expect(distanceFromRail(tree.x, tree.z)).toBeGreaterThan(DOWNTOWN_RAIL.clearance);
			const spot = { minX: tree.x - 0.5, maxX: tree.x + 0.5, minZ: tree.z - 0.5, maxZ: tree.z + 0.5 };
			for (const building of buildings) expect(overlaps(spot, building), `tree in ${building.id}`).toBe(false);
		}
	});

	it("builds well-formed geometry within one 16-bit draw", () => {
		const { props, collider } = downtownGeometry();
		const vertices = props.positions.length / 3;
		expect(props.colors!.length).toBe(vertices * 4);
		expect(props.indices.length % 3).toBe(0);
		expect(Math.max(...props.indices)).toBeLessThan(vertices);
		expect(vertices).toBeLessThan(65536);
		expect(collider.indices.length % 3).toBe(0);
		expect(Math.max(...collider.indices)).toBeLessThan(collider.positions.length / 3);
	});
});
