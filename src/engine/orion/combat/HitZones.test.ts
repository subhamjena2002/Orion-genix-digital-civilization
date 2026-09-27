import { describe, expect, it } from "vitest";

import { bodyZone, dropsOnLegHit, zoneDamage } from "./HitZones";

describe("HitZones", () => {
	it("splits a standing body into legs, torso and head by hit height", () => {
		// Feet at y = 2, 1.8 m tall.
		expect(bodyZone(2.3, 2, 1.8)).toBe("legs");
		expect(bodyZone(2.8, 2, 1.8)).toBe("legs");
		expect(bodyZone(3.0, 2, 1.8)).toBe("torso");
		expect(bodyZone(3.4, 2, 1.8)).toBe("torso");
		expect(bodyZone(3.65, 2, 1.8)).toBe("head");
	});

	it("makes a pistol head shot lethal on a full-health person, and a leg shot not", () => {
		expect(zoneDamage(30, "bullet", "head")).toBeGreaterThanOrEqual(100);
		expect(zoneDamage(30, "bullet", "legs")).toBeLessThan(30);
		expect(zoneDamage(30, "bullet", "torso")).toBeGreaterThan(30);
	});

	it("leaves whole-body damage alone", () => {
		expect(zoneDamage(80, "explosive", "head")).toBe(80);
		expect(zoneDamage(40, "impact", "legs")).toBe(40);
	});

	it("only drops people for gunshot wounds to the legs", () => {
		expect(dropsOnLegHit("bullet")).toBe(true);
		expect(dropsOnLegHit("buckshot")).toBe(true);
		expect(dropsOnLegHit("melee")).toBe(false);
		expect(dropsOnLegHit("explosive")).toBe(false);
	});
});
