import { describe, expect, it } from "vitest";

import { ROOF_NODE, roofPose } from "./FoldingRoof";
import { VEHICLE_MODELS } from "./VehicleModels";

const roadster = VEHICLE_MODELS.find((model) => model.styles.includes("roadster"));
const spec = roadster?.foldingRoof;

describe("the convertible's folding roof", () => {
	it("is on the roadster, and only there", () => {
		expect(spec).toBeDefined();
		expect(VEHICLE_MODELS.filter((model) => model.foldingRoof).length).toBe(1);
	});

	it("is closed at 0 and fully stowed at 1", () => {
		if (!spec) return;
		for (const value of Object.values(roofPose(0, spec))) expect(Math.abs(value)).toBe(0);
		expect(roofPose(1, spec)).toEqual({ paneDrop: spec.paneDrop, rearTurn: spec.rearTurn, frontTurn: spec.frontTurn, stow: spec.stow });
	});

	it("drops the windows before the top folds, and folds the top before it sinks", () => {
		if (!spec) return;
		const early = roofPose(0.2, spec);
		expect(early.paneDrop).toBeCloseTo(spec.paneDrop * 0.8, 0);
		expect(Math.abs(early.rearTurn)).toBe(0);
		const mid = roofPose(0.6, spec);
		expect(mid.paneDrop).toBe(spec.paneDrop);
		expect(Math.abs(mid.rearTurn)).toBeGreaterThan(0);
		expect(mid.stow).toBe(0);
	});

	it("moves its own nodes and nothing else", () => {
		for (const name of ["roof-rear", "roof-front", "roof-pane-left", "roof-pane-right"]) expect(ROOF_NODE.test(name), name).toBe(true);
		for (const name of ["rear-glass", "door-left", "roof", "trunk"]) expect(ROOF_NODE.test(name), name).toBe(false);
	});
});
