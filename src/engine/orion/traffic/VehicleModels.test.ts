import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ALL_MISSIONS } from "../missions/MissionCatalog";
import { missionSpawns } from "../missions/MissionDirector";
import { HIDDEN_BRAND_NODE, HIDDEN_MATERIAL, modelKey, pickVehicleModel, VEHICLE_MODELS } from "./VehicleModels";
import type { VehicleStyle } from "./Vehicles";

/**
 * Models in the tree that are recognisably a real manufacturer's car — now none.
 *
 * Hiding the badges is not enough to ship one: the body itself is a registered design. The two
 * that used to be here have been taken out of the build (see reference-assets/README.md), so
 * this list is empty and the test below keeps it that way. Adding one back has to be a decision
 * somebody makes on purpose rather than a file dropped in a folder.
 */
const KNOWN_BRAND_DERIVATIVES: readonly string[] = [];

describe("vehicle models", () => {
	it("ships no model that copies a real manufacturer's car", () => {
		const flagged = VEHICLE_MODELS.filter((model) => model.realBrandDerivative).map((model) => model.file).sort();
		expect(flagged).toEqual([...KNOWN_BRAND_DERIVATIVES].sort());
	});

	it("credits and licences every model", () => {
		for (const model of VEHICLE_MODELS) {
			expect(model.credit.author, model.file).toBeTruthy();
			expect(model.credit.licence, model.file).toBeTruthy();
			expect(model.credit.source, model.file).toBeTruthy();
		}
	});

	it("hides the brand marks a real model carries", () => {
		// Read out of the two branded GLBs before they were taken out of the build. Kept as known
		// examples: any of these rendering on a car means a trademark is driving round the city.
		const marks = [
			"gemballa_logo", "gemballa_logo.001", "miragegt_badge_emissive", "miragegt_interior_badge",
			"M_Badge", "M_Badge.001", "M_Label", "M_Label.001", "M_Label_0",
		];
		for (const name of marks) expect(HIDDEN_MATERIAL.test(name), name).toBe(true);
		for (const node of ["Plane_gemballa logo_0", "HoodBadge_Badge_224", "BumperRBadge_Chrome_42"]) {
			expect(HIDDEN_BRAND_NODE.test(node), node).toBe(true);
		}
	});

	it("gives every car a mission spawns or rewards a real model", () => {
		const styles = new Set<string>();
		for (const mission of ALL_MISSIONS) {
			for (const spawn of missionSpawns(mission)) if (spawn.type === "vehicle") styles.add(spawn.style);
			const choiceRewards = mission.objectives.flatMap((objective) => (objective.kind === "choice" ? objective.options.map((option) => option.reward ?? {}) : []));
			for (const vehicle of [mission.reward, ...choiceRewards].flatMap((reward) => reward.vehicles ?? [])) styles.add(vehicle.style);
		}
		for (const style of styles) expect(pickVehicleModel(style as VehicleStyle, 1), style).not.toBeNull();
	});

	it("ships each plain-paint picture, and keeps variants of one file apart", () => {
		for (const model of VEHICLE_MODELS) {
			if (typeof model.paintMap === "string") expect(existsSync(`public/models/vehicles/${model.paintMap}`), model.paintMap).toBe(true);
		}
		const keys = VEHICLE_MODELS.map(modelKey);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("leaves ordinary bodywork alone", () => {
		// A hide rule that ate these would take chunks out of a car.
		for (const name of ["M_CarPaint", "car_paint_v3_03", "M_Chrome", "miragegt_solid_s", "M_SkidPlate", "mirage", "M_Rubber"]) {
			expect(HIDDEN_MATERIAL.test(name), name).toBe(false);
		}
	});
});
