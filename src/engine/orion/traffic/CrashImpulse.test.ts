import { describe, expect, it } from "vitest";

import { crashImpulse, type CrashBody } from "./CrashImpulse";

const car = (overrides: Partial<CrashBody> = {}): CrashBody => ({
	mass: 1450,
	inertia: (1450 * (4.7 * 4.7 + 1.8 * 1.8)) / 12,
	velocityX: 0,
	velocityZ: 0,
	turnRate: 0,
	offsetX: 0,
	offsetZ: 0,
	...overrides,
});
const WALL: CrashBody = { mass: Infinity, inertia: Infinity, velocityX: 0, velocityZ: 0, turnRate: 0, offsetX: 0, offsetZ: 0 };

describe("crash impulse", () => {
	it("keeps the pair's momentum, and parts them at the restitution", () => {
		// A drives along +Z into B's tail; the normal out of B into A points back down -Z.
		const a = car({ velocityZ: 20, offsetZ: 2.35 });
		const b = car({ mass: 1850, inertia: 3600, velocityZ: 5, offsetZ: -2.35 });
		const result = crashImpulse(a, b, 0, -1, 0.2, 0.4);
		expect(a.mass * result.a.velocityZ + b.mass * result.b.velocityZ).toBeCloseTo(a.mass * 20 + b.mass * 5, 6);
		expect(result.b.velocityZ - result.a.velocityZ).toBeCloseTo(0.2 * 15, 6);
		// Square on, through both centres: nobody spins.
		expect(result.a.turnRate).toBeCloseTo(0, 9);
		expect(result.b.turnRate).toBeCloseTo(0, 9);
	});

	it("does nothing to bodies already moving apart", () => {
		const result = crashImpulse(car({ velocityZ: -3 }), WALL, 0, -1, 0.2, 0.4);
		expect(result.normalImpulse).toBe(0);
		expect(result.a.velocityZ).toBe(-3);
	});

	it("spins a car struck behind its rear axle, away from the blow", () => {
		// B is hit on its left flank near the tail by A driving across it along -X.
		const a = car({ velocityX: -15, offsetX: -2.35 });
		const b = car({ offsetX: 0.9, offsetZ: -1.8 });
		const result = crashImpulse(a, b, 1, 0, 0.2, 0.4);
		expect(result.b.velocityX).toBeLessThan(0);
		// Tail shoved towards -X swings the nose the other way: a turn to the left (positive).
		expect(Math.abs(result.b.turnRate)).toBeGreaterThan(0.5);
		const centreOnly = crashImpulse(a, car({ offsetX: 0.9 }), 1, 0, 0.2, 0.4);
		expect(Math.abs(result.b.turnRate)).toBeGreaterThan(Math.abs(centreOnly.b.turnRate));
	});

	it("drags the other car along on a sideswipe, no more than friction allows", () => {
		// A overtakes B along +Z and leans into it from the side (normal +X out of B into A).
		const a = car({ velocityX: -1, velocityZ: 25, offsetX: -0.9 });
		const b = car({ velocityZ: 15, offsetX: 0.9 });
		const result = crashImpulse(a, b, 1, 0, 0.2, 0.4);
		expect(result.b.velocityZ).toBeGreaterThan(15);
		expect(result.a.velocityZ).toBeLessThan(25);
		const along = (result.b.velocityZ - 15) * b.mass;
		expect(along).toBeLessThanOrEqual(0.4 * result.normalImpulse + 1e-6);
	});

	it("bounces off a wall and turns a car that hits it with a corner", () => {
		const result = crashImpulse(car({ velocityZ: 15, offsetX: 0.9, offsetZ: 2.35 }), WALL, 0, -1, 0.2, 0.4);
		expect(result.a.velocityZ).toBeLessThan(15);
		expect(Math.abs(result.a.turnRate)).toBeGreaterThan(0.1);
		expect(result.deltaVB).toBe(0);
	});
});
