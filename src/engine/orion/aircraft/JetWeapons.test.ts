import { describe, expect, it } from "vitest";

import { guideMissile, MissileLock, type MissileState } from "./GunshipWeapons";
import { JET_CANNON, JET_MISSILES, JetArmament } from "./JetWeapons";

function hold(armament: JetArmament, seconds: number) {
	let rounds = 0;
	const missiles: number[] = [];
	for (let t = 0; t < seconds; t += 1 / 60) {
		const fire = armament.update(1 / 60, true);
		rounds += fire.rounds;
		if (fire.missile >= 0) missiles.push(fire.missile);
	}
	armament.update(1 / 60, false);
	return { rounds, missiles };
}

describe("jet weapons", () => {
	it("fires the cannon at its rate while the trigger is held, and runs dry", () => {
		const armament = new JetArmament();
		const { rounds } = hold(armament, 2);
		expect(rounds).toBeGreaterThanOrEqual(Math.floor(JET_CANNON.rate * 2) - 1);
		expect(rounds).toBeLessThanOrEqual(Math.ceil(JET_CANNON.rate * 2) + 1);
		hold(armament, 60);
		expect(armament.rounds).toBe(0);
		expect(armament.update(1 / 60, true).empty).toBe(true);
	});

	it("launches one missile per pull, outboard pylons first, alternating sides, then none", () => {
		const armament = new JetArmament();
		armament.select("missiles");
		const order: number[] = [];
		for (let pull = 0; pull < 6; pull++) {
			order.push(...hold(armament, 1).missiles);
			// Let the launch interval pass between pulls.
			for (let t = 0; t < 1; t += 1 / 60) armament.update(1 / 60, false);
		}
		expect(order).toEqual([0, 1, 2, 3]);
		expect(armament.missiles).toBe(0);
		armament.rearm();
		expect(armament.full).toBe(true);
	});

	it("locks when the nose is held on a target, and a guided missile hits a crossing target", () => {
		const lock = new MissileLock(JET_MISSILES);
		for (let t = 0; t < JET_MISSILES.lockSeconds + 0.1; t += 1 / 60) lock.update(1 / 60, { id: 7, angle: 3 }, null);
		expect(lock.state).toBe("locked");
		// Target crossing at 60 m/s, 900 m ahead; missile dropped from a jet doing 150 m/s.
		const missile: MissileState = { x: 0, y: 300, z: 0, vx: 0, vy: 0, vz: 150, age: 0 };
		const target = { x: -100, y: 300, z: 900, vx: 60, vy: 0, vz: 0 };
		let closest = Infinity;
		for (let t = 0; t < JET_MISSILES.lifetime; t += 1 / 60) {
			target.x += target.vx / 60;
			guideMissile(missile, target, 1 / 60, JET_MISSILES);
			closest = Math.min(closest, Math.hypot(missile.x - target.x, missile.y - target.y, missile.z - target.z));
		}
		expect(closest).toBeLessThan(JET_MISSILES.proximity);
	});
});
