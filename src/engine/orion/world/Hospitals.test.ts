import { describe, expect, it } from "vitest";

import { ORION_BUILDING_MAP } from "../buildings/Buildings";
import { POLICE_STATION } from "../police/Police";
import { pavedHeightAt } from "../roads/RoadNetwork";
import { VEHICLE_MODELS } from "../traffic/VehicleModels";
import { ORION_VEHICLES } from "../traffic/Vehicles";
import { HOSPITALS } from "./Hospitals";

describe("hospitals", () => {
	it("replace real grid buildings that no other compound has taken", () => {
		const ids = new Set(ORION_BUILDING_MAP.map((building) => building.id));
		const taken = new Set(POLICE_STATION.replacesBuildings);
		for (const hospital of HOSPITALS) {
			for (const id of hospital.replacesBuildings) {
				expect(ids.has(id), id).toBe(true);
				expect(taken.has(id), id).toBe(false);
				taken.add(id);
			}
		}
	});

	it("park every ambulance inside its bay and off the road", () => {
		for (const hospital of HOSPITALS) {
			const [bx, bz] = hospital.bay.position;
			const [width, depth] = hospital.bay.size;
			for (const ambulance of hospital.ambulances) {
				const [x, z] = ambulance.position;
				expect(Math.abs(x - bx), ambulance.id).toBeLessThan(width / 2 - 1);
				expect(Math.abs(z - bz), ambulance.id).toBeLessThan(depth / 2);
				expect(pavedHeightAt(x, z), ambulance.id).toBeNull();
			}
		}
	});

	it("keep ambulances and fire engines out of ordinary traffic", () => {
		const styles = new Set(ORION_VEHICLES.map((vehicle) => vehicle.style));
		expect(styles.has("ambulance")).toBe(false);
		expect(styles.has("fireTruck")).toBe(false);
		// And every style that does drive around has a real model to show.
		for (const style of styles) expect(VEHICLE_MODELS.some((model) => model.styles.includes(style)), style).toBe(true);
	});
});
