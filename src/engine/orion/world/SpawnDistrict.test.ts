import { describe, expect, it } from "vitest";

import { ORION_BUILDING_MAP } from "../buildings/Buildings";
import { pavedHeightAt } from "../roads/RoadNetwork";
import { HOSPITALS } from "./Hospitals";
import { SPAWN_GARDEN, SPAWN_LOT, SPAWN_PARKED_CARS, SPAWN_PLAZA, spawnDistrictGeometry, spawnDistrictTrees, type Rect } from "./SpawnDistrict";
import { streetDressing } from "./StreetDressing";

const AREAS: [string, Rect][] = [["car park", SPAWN_LOT], ["plaza", SPAWN_PLAZA], ["garden", SPAWN_GARDEN]];

/** Every building's ground footprint as a box, generously (either way round). */
const buildings = ORION_BUILDING_MAP.map((building) => {
	const half = Math.max(...building.footprint) / 2;
	return { id: building.id, minX: building.position[0] - half, maxX: building.position[0] + half, minZ: building.position[2] - half, maxZ: building.position[2] + half };
});
const hospitalBoxes = HOSPITALS.flatMap((hospital) => [
	{ id: hospital.id, minX: hospital.position[0] - 10, maxX: hospital.position[0] + 10, minZ: hospital.position[1] - 7, maxZ: hospital.position[1] + 7 },
	{ id: `${hospital.id}-bay`, minX: hospital.bay.position[0] - hospital.bay.size[0] / 2, maxX: hospital.bay.position[0] + hospital.bay.size[0] / 2, minZ: hospital.bay.position[1] - hospital.bay.size[1] / 2, maxZ: hospital.bay.position[1] + hospital.bay.size[1] / 2 },
]);
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

describe("the spawn district's dressing", () => {
	it("lays the car park, plaza and garden on open ground: no road, pavement or building under them", () => {
		for (const [name, area] of AREAS) {
			for (let x = area.minX; x <= area.maxX; x += 1) {
				for (let z = area.minZ; z <= area.maxZ; z += 1) expect(pavedHeightAt(x, z), `${name} at ${x},${z}`).toBeNull();
			}
			for (const building of [...buildings, ...hospitalBoxes]) {
				expect(overlaps(area, building), `${name} overlaps ${building.id}`).toBe(false);
			}
		}
		for (const [a, first] of AREAS.entries()) for (const second of AREAS.slice(a + 1)) expect(overlaps(first[1], second[1])).toBe(false);
	});

	it("parks its cars inside the car park, a bay apart", () => {
		for (const car of SPAWN_PARKED_CARS) {
			expect(car.x - 1.2 > SPAWN_LOT.minX && car.x + 1.2 < SPAWN_LOT.maxX, car.id).toBe(true);
			expect(car.z - 2.5 >= SPAWN_LOT.minZ && car.z + 2.5 <= SPAWN_LOT.maxZ, car.id).toBe(true);
		}
		for (const [i, a] of SPAWN_PARKED_CARS.entries()) {
			for (const b of SPAWN_PARKED_CARS.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id}/${b.id}`).toBeGreaterThan(2.6);
		}
	});

	it("keeps the trees off the paving, out of the car park and out of buildings", () => {
		for (const tree of spawnDistrictTrees()) {
			if (tree.kind === "palm") expect(pavedHeightAt(tree.x, tree.z), `palm ${tree.x},${tree.z}`).toBeNull();
			const spot = { minX: tree.x - 0.5, maxX: tree.x + 0.5, minZ: tree.z - 0.5, maxZ: tree.z + 0.5 };
			expect(overlaps(spot, SPAWN_LOT)).toBe(false);
			for (const building of buildings) expect(overlaps(spot, building), `tree in ${building.id}`).toBe(false);
		}
	});

	it("puts the street furniture on the pavements, clear of the kerbside palms and lamps", () => {
		const { collider } = spawnDistrictGeometry();
		const kerbside = streetDressing();
		// Each solid piece's centre: what the bus shelter, benches and bins along the avenues stand on.
		for (let i = 0; i < collider.positions.length; i += 24) {
			let x = 0;
			let z = 0;
			for (let k = 0; k < 8; k++) {
				x += collider.positions[i + k * 3] / 8;
				z += collider.positions[i + k * 3 + 2] / 8;
			}
			const inArea = AREAS.some(([, area]) => x >= area.minX - 1.5 && x <= area.maxX + 1.5 && z >= area.minZ - 1.5 && z <= area.maxZ + 1.5);
			if (inArea) continue;
			// The back-yard hedges by the side roads: on the lawn, not their pavements.
			if (Math.abs(x) > 70 || Math.abs(z) > 70) {
				expect(pavedHeightAt(x, z), `hedge at ${x.toFixed(1)},${z.toFixed(1)}`).toBeNull();
				continue;
			}
			// Off the carriageways: on a pavement, or behind it on the lawn (the shelter's back).
			const onRoad = (Math.abs(x) < 7 && Math.abs(z) > 9) || (Math.abs(z) < 7 && Math.abs(x) > 9);
			expect(onRoad, `prop at ${x.toFixed(1)},${z.toFixed(1)} is in the road`).toBe(false);
			for (const post of kerbside) {
				expect(Math.hypot(post.x - x, post.z - z), `prop at ${x.toFixed(1)},${z.toFixed(1)} vs ${post.kind}`).toBeGreaterThan(0.8);
			}
		}
	});

	it("builds well-formed geometry: coloured vertices, whole triangles, a collider for what's solid", () => {
		const { props, collider } = spawnDistrictGeometry();
		const vertices = props.positions.length / 3;
		expect(props.colors!.length).toBe(vertices * 4);
		expect(props.normals.length).toBe(props.positions.length);
		expect(props.indices.length % 3).toBe(0);
		expect(Math.max(...props.indices)).toBeLessThan(vertices);
		expect(collider.indices.length % 3).toBe(0);
		expect(Math.max(...collider.indices)).toBeLessThan(collider.positions.length / 3);
		expect(collider.indices.length).toBeGreaterThan(0);
		// One draw: keep it within a 16-bit index buffer.
		expect(vertices).toBeLessThan(65536);
	});
});
