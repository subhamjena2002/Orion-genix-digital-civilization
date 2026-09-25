import { describe, expect, it } from "vitest";

import { damageFor, Health, makeDamageEvent } from "./Damage";
import { explosionFalloff, inMeleeArc, rayCapsule, rayOrientedBox, raySphere, type Ray } from "./HitTests";
import { MeleeAttack } from "./MeleeAttack";
import { scatter } from "./Scatter";
import { SpatialGrid } from "./SpatialGrid";
import { RESERVED_SLOTS, validateWeapons, weaponById, weaponInSlot, WEAPONS } from "./WeaponData";
import { WeaponInventory } from "./WeaponInventory";

const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Ray => {
	const length = Math.hypot(dx, dy, dz);
	return { ox, oy, oz, dx: dx / length, dy: dy / length, dz: dz / length };
};

describe("Health", () => {
	it("dies once, at zero, and ignores damage after", () => {
		const health = new Health(100);
		expect(health.damage(60)).toBe(false);
		expect(health.damage(60)).toBe(true);
		expect(health.current).toBe(0);
		expect(health.damage(10)).toBe(false);
		expect(health.alive).toBe(false);
	});

	it("heals only the living, up to max", () => {
		const health = new Health(50);
		health.damage(20);
		health.heal(100);
		expect(health.current).toBe(50);
		health.damage(50);
		health.heal(10);
		expect(health.current).toBe(0);
	});

	it("ignores zero, negative and NaN damage", () => {
		const health = new Health(10);
		health.damage(0);
		health.damage(-5);
		health.damage(Number.NaN);
		expect(health.current).toBe(10);
	});
});

describe("damageFor", () => {
	it("lets bullets barely scratch cars while explosions hit them fully", () => {
		const event = makeDamageEvent();
		event.amount = 100;
		event.type = "bullet";
		expect(damageFor("vehicle", event)).toBeLessThan(25);
		expect(damageFor("person", event)).toBe(100);
		event.type = "explosive";
		expect(damageFor("vehicle", event)).toBe(100);
		event.type = "melee";
		expect(damageFor("vehicle", event)).toBe(0);
	});
});

describe("rayCapsule", () => {
	it("hits a standing person's body and reports the entry distance", () => {
		const t = rayCapsule(ray(-10, 1, 0, 1, 0, 0), 100, 0, 0, 0, 0.3, 1.8);
		expect(t).toBeCloseTo(9.7);
	});

	it("misses beside, above and beyond range", () => {
		expect(rayCapsule(ray(-10, 1, 1, 1, 0, 0), 100, 0, 0, 0, 0.3, 1.8)).toBe(-1);
		expect(rayCapsule(ray(-10, 2.5, 0, 1, 0, 0), 100, 0, 0, 0, 0.3, 1.8)).toBe(-1);
		expect(rayCapsule(ray(-10, 1, 0, 1, 0, 0), 5, 0, 0, 0, 0.3, 1.8)).toBe(-1);
	});

	it("hits the rounded head from above", () => {
		const t = rayCapsule(ray(0, 10, 0, 0, -1, 0), 100, 0, 0, 0, 0.3, 1.8);
		expect(t).toBeCloseTo(8.2);
	});

	it("doesn't hit behind the ray's origin", () => {
		expect(rayCapsule(ray(10, 1, 0, 1, 0, 0), 100, 0, 0, 0, 0.3, 1.8)).toBe(-1);
	});
});

describe("raySphere", () => {
	it("returns 0 when starting inside", () => {
		expect(raySphere(ray(0, 0, 0, 1, 0, 0), 10, 0, 0, 0, 1)).toBe(0);
	});
});

describe("rayOrientedBox", () => {
	it("hits a car side-on and end-on according to its heading", () => {
		// Car along +Z: 4.6 m long, 1.8 m wide, 1.4 m tall.
		expect(rayOrientedBox(ray(-10, 0.7, 0, 1, 0, 0), 100, 0, 0, 0, 0, 1, 0.9, 1.4, 2.3)).toBeCloseTo(9.1);
		expect(rayOrientedBox(ray(0, 0.7, -10, 0, 0, 1), 100, 0, 0, 0, 0, 1, 0.9, 1.4, 2.3)).toBeCloseTo(7.7);
		// Turned to face +X, the long side is now across the X ray.
		expect(rayOrientedBox(ray(-10, 0.7, 0, 1, 0, 0), 100, 0, 0, 0, 1, 0, 0.9, 1.4, 2.3)).toBeCloseTo(7.7);
	});

	it("misses over the roof and beyond range", () => {
		expect(rayOrientedBox(ray(-10, 2, 0, 1, 0, 0), 100, 0, 0, 0, 0, 1, 0.9, 1.4, 2.3)).toBe(-1);
		expect(rayOrientedBox(ray(-10, 0.7, 0, 1, 0, 0), 5, 0, 0, 0, 0, 1, 0.9, 1.4, 2.3)).toBe(-1);
	});
});

describe("inMeleeArc", () => {
	const arc = Math.cos((55 * Math.PI) / 180);
	it("hits in front within reach", () => {
		expect(inMeleeArc(0, 0, 0, 1, 0, 1.2, 0.3, 1.1, arc)).toBe(true);
	});
	it("misses behind, to the side and out of reach", () => {
		expect(inMeleeArc(0, 0, 0, 1, 0, -1, 0.3, 1.1, arc)).toBe(false);
		expect(inMeleeArc(0, 0, 0, 1, 1.2, 0.1, 0.3, 1.1, arc)).toBe(false);
		expect(inMeleeArc(0, 0, 0, 1, 0, 2, 0.3, 1.1, arc)).toBe(false);
	});
});

describe("explosionFalloff", () => {
	it("is full at the centre, fades out, and is zero at the edge", () => {
		expect(explosionFalloff(0, 8)).toBe(1);
		expect(explosionFalloff(5, 8)).toBeGreaterThan(0);
		expect(explosionFalloff(5, 8)).toBeLessThan(1);
		expect(explosionFalloff(8, 8)).toBe(0);
	});
});

describe("MeleeAttack", () => {
	const timing = { windup: 0.1, active: 0.1, recovery: 0.2, cooldown: 0.1 };

	it("opens the hit window only after the windup, and closes it", () => {
		const attack = new MeleeAttack(timing);
		expect(attack.start()).toBe(true);
		expect(attack.update(0.05)).toBe("windup");
		expect(attack.update(0.06)).toBe("active");
		expect(attack.update(0.1)).toBe("recovery");
		expect(attack.active).toBe(false);
	});

	it("hits each target at most once per swing", () => {
		const attack = new MeleeAttack(timing);
		attack.start();
		attack.update(0.12);
		expect(attack.canHit(7)).toBe(true);
		attack.markHit(7);
		attack.update(0.01);
		expect(attack.canHit(7)).toBe(false);
		expect(attack.canHit(8)).toBe(true);
	});

	it("won't start again until the cooldown is over", () => {
		const attack = new MeleeAttack(timing);
		attack.start();
		attack.update(0.45);
		expect(attack.phase).toBe("cooldown");
		expect(attack.start()).toBe(false);
		attack.update(0.1);
		expect(attack.phase).toBe("ready");
		expect(attack.start()).toBe(true);
	});

	it("doesn't skip the end of the window on a long frame", () => {
		const attack = new MeleeAttack(timing);
		attack.start();
		expect(attack.update(1)).toBe("ready");
	});
});

describe("SpatialGrid", () => {
	it("finds items in radius and follows them as they move", () => {
		const grid = new SpatialGrid<{ x: number; z: number; name: string }>(8);
		const a = { x: 1, z: 1, name: "a" };
		const b = { x: 30, z: 30, name: "b" };
		grid.update(a);
		grid.update(b);
		const out: typeof a[] = [];
		expect(grid.queryRadius(0, 0, 5, out).map((item) => item.name)).toEqual(["a"]);
		a.x = 29;
		a.z = 29;
		grid.update(a);
		expect(grid.queryRadius(0, 0, 5, out)).toEqual([]);
		expect(grid.queryRadius(30, 30, 3, out).map((item) => item.name).sort()).toEqual(["a", "b"]);
	});

	it("works across negative coordinates and removes items", () => {
		const grid = new SpatialGrid<{ x: number; z: number }>(8);
		const item = { x: -0.5, z: -0.5 };
		grid.update(item);
		expect(grid.queryRadius(0.5, 0.5, 2, []).length).toBe(1);
		grid.remove(item);
		expect(grid.queryRadius(0.5, 0.5, 2, []).length).toBe(0);
		expect(grid.size).toBe(0);
	});

	it("gathers segment candidates along the whole line, once each", () => {
		const grid = new SpatialGrid<{ x: number; z: number }>(8);
		const items = [0, 20, 40, 60].map((x) => ({ x, z: 0.5 }));
		for (const item of items) grid.update(item);
		const found = grid.querySegment(0, 0, 60, 0, 1, []);
		expect(found.length).toBe(4);
		expect(grid.querySegment(0, 40, 60, 40, 1, []).length).toBe(0);
	});
});

describe("weapon data", () => {
	it("is consistent", () => {
		expect(validateWeapons(WEAPONS)).toEqual([]);
	});

	it("maps the number keys to the planned weapons and keeps 7 free", () => {
		expect(weaponInSlot(2)?.id).toBe("sword");
		expect(weaponInSlot(3)?.id).toBe("pistol");
		expect(weaponInSlot(4)?.id).toBe("ar");
		expect(weaponInSlot(5)?.id).toBe("shotgun");
		expect(weaponInSlot(6)?.id).toBe("rocketLauncher");
		expect(weaponInSlot(7)).toBeNull();
		expect(RESERVED_SLOTS).toContain(7);
	});

	it("flags broken definitions", () => {
		const broken = { ...weaponById("pistol"), id: "sword" as const, slot: 7, fireRate: 0 };
		const problems = validateWeapons([...WEAPONS, broken]);
		expect(problems.some((problem) => problem.includes("duplicate id"))).toBe(true);
		expect(problems.some((problem) => problem.includes("reserved"))).toBe(true);
		expect(problems.some((problem) => problem.includes("fire rate"))).toBe(true);
	});
});

describe("WeaponInventory", () => {
	const inventory = () => new WeaponInventory(WEAPONS, "fists");
	const settle = (weapons: WeaponInventory, seconds = 5) => {
		for (let t = 0; t < seconds; t += 0.05) weapons.update(0.05);
	};

	it("switches by slot, refuses empty, reserved and current slots", () => {
		const weapons = inventory();
		expect(weapons.selectSlot(4)).toBe(true);
		expect(weapons.current.definition.id).toBe("ar");
		expect(weapons.selectSlot(4)).toBe(false);
		expect(weapons.selectSlot(7)).toBe(false);
		expect(weapons.selectSlot(9)).toBe(false);
		expect(weapons.current.definition.id).toBe("ar");
	});

	it("can't fire while bringing a weapon up", () => {
		const weapons = inventory();
		weapons.selectSlot(3);
		expect(weapons.fire()).toBe("busy");
		settle(weapons, 1);
		expect(weapons.fire()).toBe("fired");
	});

	it("spaces shots by the fire rate and spends a round each", () => {
		const weapons = inventory();
		weapons.selectSlot(4);
		settle(weapons, 1);
		expect(weapons.fire()).toBe("fired");
		expect(weapons.fire()).toBe("busy");
		weapons.update(0.1);
		expect(weapons.fire()).toBe("fired");
		expect(weapons.current.magazine).toBe(28);
	});

	it("reloads from the reserve when empty, after the reload time", () => {
		const weapons = inventory();
		weapons.selectSlot(6);
		settle(weapons, 1);
		expect(weapons.fire()).toBe("fired");
		settle(weapons, 2);
		expect(weapons.fire()).toBe("empty");
		expect(weapons.reloading).toBe(true);
		expect(weapons.current.magazine).toBe(0);
		settle(weapons, 3);
		expect(weapons.current.magazine).toBe(1);
		expect(weapons.current.reserve).toBe(7);
	});

	it("can't reload a full magazine or with no spares", () => {
		const weapons = inventory();
		weapons.selectSlot(3);
		settle(weapons, 1);
		expect(weapons.reload()).toBe(false);
		weapons.current.reserve = 0;
		weapons.fire();
		expect(weapons.reload()).toBe(false);
	});

	it("cycles with the mouse wheel in slot order, wrapping round", () => {
		const weapons = inventory();
		weapons.cycle(-1);
		expect(weapons.current.definition.id).toBe("rocketLauncher");
		weapons.cycle(1);
		expect(weapons.current.definition.id).toBe("fists");
		weapons.cycle(1);
		expect(weapons.current.definition.id).toBe("sword");
	});

	it("never needs ammunition for fists and blades", () => {
		const weapons = inventory();
		settle(weapons, 1);
		for (let i = 0; i < 20; i++) {
			expect(weapons.fire()).toBe("fired");
			settle(weapons, 1);
		}
	});
});

describe("scatter", () => {
	it("stays within the spread cone and unit length, in any direction", () => {
		const spread = (5 * Math.PI) / 180;
		for (const [x, y, z] of [[0, 0, 1], [0, 1, 0], [0.6, -0.8, 0], [1, 0, 0]]) {
			for (let i = 0; i < 200; i++) {
				const [dx, dy, dz] = scatter(x, y, z, spread);
				expect(Math.hypot(dx, dy, dz)).toBeCloseTo(1, 5);
				expect(dx * x + dy * y + dz * z).toBeGreaterThanOrEqual(Math.cos(spread) - 1e-9);
			}
		}
	});

	it("leaves the direction alone with no spread", () => {
		expect(scatter(0, 0, 1, 0)).toEqual([0, 0, 1]);
	});
});
