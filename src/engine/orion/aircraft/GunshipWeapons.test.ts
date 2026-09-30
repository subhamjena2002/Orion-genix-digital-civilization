import { describe, expect, it } from "vitest";

import { CANNON, GunshipArmament, guideMissile, MissileLock, MISSILES, ROCKETS, type MissileState } from "./GunshipWeapons";

describe("gunship weapons", () => {
	it("fires the cannon at its rate whatever the frame rate, and runs dry", () => {
		for (const fps of [30, 60, 144]) {
			const arms = new GunshipArmament();
			let fired = 0;
			for (let t = 0; t < 3; t += 1 / fps) fired += arms.update(1 / fps, true).rounds;
			expect(fired).toBeGreaterThanOrEqual(Math.floor(3 * CANNON.rate));
			expect(fired).toBeLessThanOrEqual(Math.ceil(3 * CANNON.rate) + 1);
		}
		const arms = new GunshipArmament();
		for (let t = 0; t < 200; t += 1 / 60) arms.update(1 / 60, true);
		expect(arms.rounds).toBe(0);
		arms.update(1 / 60, false);
		expect(arms.update(1 / 60, true).empty).toBe(true);
	});

	it("ripples rockets from alternate pods, and a missile per trigger pull", () => {
		const arms = new GunshipArmament();
		arms.select("rockets");
		const pods: number[] = [];
		for (let t = 0; t < 0.6; t += 1 / 60) pods.push(...arms.update(1 / 60, true).rockets);
		expect(pods.length).toBeGreaterThanOrEqual(4);
		for (let i = 1; i < pods.length; i++) expect(pods[i]).not.toBe(pods[i - 1]);

		arms.select("missiles");
		arms.update(1 / 60, false);
		const launched: number[] = [];
		for (let pull = 0; pull < 10; pull++) {
			for (let t = 0; t < 0.4; t += 1 / 60) {
				const rail = arms.update(1 / 60, true).missile;
				if (rail >= 0) launched.push(rail);
			}
			for (let t = 0; t < 0.4; t += 1 / 60) arms.update(1 / 60, false);
		}
		expect(launched.length).toBe(MISSILES.count);
		expect(new Set(launched).size).toBe(MISSILES.count);
		expect(arms.missiles).toBe(0);
		arms.rearm();
		expect(arms.full).toBe(true);
		expect(arms.rockets).toBe(2 * ROCKETS.perPod);
	});

	it("locks only after the sight is held on a target, and loses it when it drifts off", () => {
		const lock = new MissileLock();
		for (let t = 0; t < 0.5; t += 1 / 60) lock.update(1 / 60, { id: 7, angle: 2 }, null);
		expect(lock.state).toBe("locking");
		for (let t = 0; t < 0.8; t += 1 / 60) lock.update(1 / 60, { id: 7, angle: 2 }, null);
		expect(lock.state).toBe("locked");
		expect(lock.targetId).toBe(7);
		lock.update(1 / 60, null, 8);
		expect(lock.state).toBe("locked");
		lock.update(1 / 60, null, 40);
		expect(lock.state).not.toBe("locked");
	});

	it("guides a missile into a car driving across its path", () => {
		const missile: MissileState = { x: 0, y: 60, z: 0, vx: 0, vy: 0, vz: MISSILES.launchSpeed, age: 0 };
		const target = { x: -150, y: 0.8, z: 700, vx: 20, vy: 0, vz: 0 };
		let closest = Infinity;
		for (let t = 0; t < MISSILES.lifetime; t += 1 / 60) {
			guideMissile(missile, target, 1 / 60);
			target.x += target.vx / 60;
			closest = Math.min(closest, Math.hypot(missile.x - target.x, missile.y - target.y, missile.z - target.z));
			if (closest < MISSILES.proximity) break;
		}
		expect(closest).toBeLessThan(MISSILES.proximity);
	});

	it("flies an unguided missile straight", () => {
		const missile: MissileState = { x: 0, y: 60, z: 0, vx: 0, vy: 0, vz: MISSILES.launchSpeed, age: 0 };
		for (let t = 0; t < 4; t += 1 / 60) guideMissile(missile, null, 1 / 60);
		expect(Math.abs(missile.x)).toBeLessThan(0.01);
		expect(missile.z).toBeGreaterThan(400);
		expect(Math.hypot(missile.vx, missile.vy, missile.vz)).toBeLessThanOrEqual(MISSILES.maxSpeed + 3);
	});
});
