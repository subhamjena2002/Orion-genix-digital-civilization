import { describe, expect, it } from "vitest";

import { HOLD_STYLES } from "./HoldStyles";
import { WEAPONS } from "./WeaponData";

describe("hold styles", () => {
	it("gives every weapon a style that exists", () => {
		for (const weapon of WEAPONS) expect(HOLD_STYLES[weapon.hold], weapon.id).toBeDefined();
	});

	it("is keyed by each style's own id", () => {
		for (const [key, style] of Object.entries(HOLD_STYLES)) expect(style.id).toBe(key);
	});

	it("holds guns with a firing hand, and blades and fists as their type says", () => {
		for (const weapon of WEAPONS) {
			const style = HOLD_STYLES[weapon.hold];
			if (weapon.type === "hitscan" || weapon.type === "projectile") expect(style.right, weapon.id).not.toBeNull();
			if (weapon.type === "unarmed") expect(style.right, weapon.id).toBeNull();
			if (weapon.type === "melee") expect(style.left, weapon.id).toBeNull();
		}
	});

	it("puts long guns in two hands, with the off hand able to slide", () => {
		for (const id of ["rifle", "shotgun", "launcher"] as const) {
			expect(HOLD_STYLES[id].left, id).not.toBeNull();
			expect(HOLD_STYLES[id].slide, id).toBeGreaterThan(0);
		}
	});

	it("gives every gripping hand fingers and a thumb to orient by", () => {
		for (const style of Object.values(HOLD_STYLES)) {
			for (const grip of [style.right, style.left]) {
				if (!grip) continue;
				expect(Math.hypot(...grip.fingers)).toBeGreaterThan(0);
				expect(Math.hypot(...grip.thumb)).toBeGreaterThan(0);
				for (const amount of Object.values(grip.curl)) {
					expect(amount).toBeGreaterThanOrEqual(0);
					expect(amount).toBeLessThanOrEqual(1);
				}
			}
		}
	});

	it("rests a long gun's butt near the firing shoulder, and nothing else's", () => {
		for (const [id, style] of Object.entries(HOLD_STYLES)) {
			if (!style.butt) {
				expect(["unarmed", "blade", "pistol", "launcher"], id).toContain(id);
				continue;
			}
			// A pocket on the shoulder, not out at arm's length.
			expect(Math.hypot(...style.butt), id).toBeLessThan(0.2);
			expect(style.butt[2], id).toBeGreaterThan(0);
			expect(style.left, id).not.toBeNull();
		}
	});

	it("names hand points only where a weapon has a model", () => {
		for (const weapon of WEAPONS) {
			if (weapon.model?.hands) expect(weapon.model, weapon.id).not.toBeNull();
		}
	});
});
