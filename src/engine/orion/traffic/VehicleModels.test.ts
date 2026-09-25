import { describe, expect, it } from "vitest";

import { HIDDEN_BRAND_NODE, HIDDEN_MATERIAL, VEHICLE_MODELS } from "./VehicleModels";

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

	it("leaves ordinary bodywork alone", () => {
		// A hide rule that ate these would take chunks out of a car.
		for (const name of ["M_CarPaint", "car_paint_v3_03", "M_Chrome", "miragegt_solid_s", "M_SkidPlate", "mirage", "M_Rubber"]) {
			expect(HIDDEN_MATERIAL.test(name), name).toBe(false);
		}
	});
});
