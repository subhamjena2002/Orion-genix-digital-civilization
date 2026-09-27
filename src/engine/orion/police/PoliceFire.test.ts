import { describe, expect, it } from "vitest";

import { FIRE_FROM_STARS, policeGun, RIFLES_FROM_STARS } from "./PoliceFire";

describe("police guns", () => {
	it("carries pistols up to three stars and assault rifles from four", () => {
		expect(policeGun(2).weapon).toBe("pistol");
		expect(policeGun(3).weapon).toBe("pistol");
		expect(policeGun(4).weapon).toBe("rifle");
		expect(policeGun(5).weapon).toBe("rifle");
		expect(RIFLES_FROM_STARS).toBe(4);
		expect(FIRE_FROM_STARS).toBe(2);
	});

	it("gets faster, harder-hitting and more accurate with the stars", () => {
		const pistol = policeGun(2);
		const rifle = policeGun(5);
		expect(rifle.interval).toBeLessThan(pistol.interval);
		expect(rifle.damage).toBeGreaterThan(pistol.damage);
		expect(rifle.accuracy).toBeGreaterThan(pistol.accuracy);
		expect(rifle.range).toBeGreaterThan(pistol.range);
	});
});
