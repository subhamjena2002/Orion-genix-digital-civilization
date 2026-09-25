import { describe, expect, it } from "vitest";

import {
	BLAST_DAMAGE,
	BLAST_PUSH,
	BLAST_RADIUS,
	BURNING_BELOW,
	blastAt,
	burnDown,
	conditionOf,
	crashDamage,
	damageEffect,
	FIRE_DRAIN_PER_SECOND,
	powerFactor,
	SMOKING_BELOW,
	SMOULDER_SECONDS,
	WRECK_FIRE_SECONDS,
} from "./VehicleDamage";

describe("crashDamage", () => {
	it("ignores parking-speed knocks", () => {
		expect(crashDamage(0)).toBe(0);
		expect(crashDamage(2.5)).toBe(0);
	});

	it("grows with the square of the change in velocity", () => {
		const light = crashDamage(8);
		const heavy = crashDamage(16);
		expect(light).toBeGreaterThan(0);
		expect(heavy).toBeGreaterThan(light * 2);
	});

	it("writes a car off in one catastrophic hit, and never more than that", () => {
		expect(crashDamage(28.5)).toBeCloseTo(100);
		expect(crashDamage(200)).toBe(100);
	});
});

describe("powerFactor", () => {
	it("keeps full power until the car starts smoking", () => {
		expect(powerFactor(100)).toBe(1);
		expect(powerFactor(SMOKING_BELOW)).toBe(1);
	});

	it("fades power as the engine fails, without ever stalling completely", () => {
		expect(powerFactor(SMOKING_BELOW / 2)).toBeLessThan(1);
		expect(powerFactor(0)).toBeGreaterThan(0);
		expect(powerFactor(-20)).toBe(powerFactor(0));
	});
});

describe("conditionOf", () => {
	it("walks from sound through smoking and burning to wrecked", () => {
		expect(conditionOf(100, false)).toBe("sound");
		expect(conditionOf(SMOKING_BELOW - 1, false)).toBe("smoking");
		expect(conditionOf(BURNING_BELOW - 1, false)).toBe("burning");
		expect(conditionOf(0, false)).toBe("burning");
		expect(conditionOf(50, true)).toBe("wrecked");
	});
});

describe("blastAt", () => {
	it("is strongest at the centre and falls off to nothing at the radius", () => {
		expect(blastAt(0)).toEqual({ damage: BLAST_DAMAGE, push: BLAST_PUSH });
		const halfway = blastAt(BLAST_RADIUS / 2);
		expect(halfway.damage).toBeCloseTo(BLAST_DAMAGE / 2);
		expect(blastAt(BLAST_RADIUS)).toEqual({ damage: 0, push: 0 });
		expect(blastAt(BLAST_RADIUS * 3)).toEqual({ damage: 0, push: 0 });
	});
});

describe("burnDown", () => {
	it("leaves a car that isn't on fire alone", () => {
		expect(burnDown(100, 1)).toBe(100);
		expect(burnDown(BURNING_BELOW, 1)).toBe(BURNING_BELOW);
		expect(burnDown(0, 1)).toBe(0);
	});

	it("eats a burning car at a steady rate, stopping at zero", () => {
		expect(burnDown(15, 1)).toBeCloseTo(15 - FIRE_DRAIN_PER_SECOND);
		expect(burnDown(1, 10)).toBe(0);
		expect(burnDown(10, 0)).toBe(10);
	});

	it("always brings a burning car to zero, so every fire ends in an explosion", () => {
		let integrity = BURNING_BELOW - 0.01;
		let seconds = 0;
		while (integrity > 0 && seconds < 60) {
			integrity = burnDown(integrity, 1 / 60);
			seconds += 1 / 60;
		}
		expect(integrity).toBe(0);
		expect(seconds).toBeCloseTo(BURNING_BELOW / FIRE_DRAIN_PER_SECOND, 0);
	});
});

describe("damageEffect", () => {
	it("gives off nothing while the car is sound", () => {
		expect(damageEffect(100, false, 0)).toBeNull();
	});

	it("smokes more heavily the closer the car gets to catching fire", () => {
		const light = { ...damageEffect(SMOKING_BELOW - 1, false, 0)! };
		const heavy = { ...damageEffect(BURNING_BELOW + 1, false, 0)! };
		expect(light.stage).toBe("smoking");
		expect(heavy.stage).toBe("smoking");
		expect(heavy.severity).toBeGreaterThan(light.severity);
	});

	it("burns below the fire threshold", () => {
		expect(damageEffect(BURNING_BELOW - 1, false, 0)).toEqual({ stage: "burning", severity: 1 });
	});

	it("follows an explosion with a dying wreck fire, then smoulders, then stops", () => {
		expect(damageEffect(0, true, 0)?.stage).toBe("wreck-fire");
		const early = damageEffect(0, true, 1)!.severity;
		const late = damageEffect(0, true, WRECK_FIRE_SECONDS - 1)!.severity;
		expect(late).toBeLessThan(early);
		expect(damageEffect(0, true, WRECK_FIRE_SECONDS + 1)?.stage).toBe("smouldering");
		expect(damageEffect(0, true, WRECK_FIRE_SECONDS + SMOULDER_SECONDS + 1)).toBeNull();
	});

	it("keeps severity within 0..1", () => {
		for (const integrity of [-10, 0, 5, 21.9, 22, 40, 59.9, 60, 100]) {
			const effect = damageEffect(integrity, false, 0);
			if (effect) {
				expect(effect.severity).toBeGreaterThanOrEqual(0);
				expect(effect.severity).toBeLessThanOrEqual(1);
			}
		}
	});
});
