import { describe, expect, it } from "vitest";

import { CarPhysics, carSpecFor, type CarControls } from "./CarPhysics";
import type { VehicleStyle } from "./Vehicles";

const FRAME = 1 / 60;
const idle: CarControls = { drive: 0, steer: 0, handbrake: false, brake: 0 };

function car(style: VehicleStyle = "sedan") {
	return new CarPhysics(carSpecFor(style, 4.5, 1.8));
}

function drive(physics: CarPhysics, seconds: number, controls: Partial<CarControls>) {
	const full = { ...idle, ...controls };
	for (let t = 0; t < seconds; t += FRAME) physics.step(FRAME, full);
}

describe("CarPhysics", () => {
	it("accelerates forward (along +Z at heading 0) under throttle", () => {
		const physics = car();
		drive(physics, 3, { drive: 1 });
		expect(physics.forwardSpeed).toBeGreaterThan(8);
		expect(physics.z).toBeGreaterThan(10);
		expect(Math.abs(physics.x)).toBeLessThan(0.01);
	});

	it("brakes to a stop and then holds still instead of creeping", () => {
		const physics = car();
		physics.reset(0, 0, 0, 20);
		drive(physics, 6, { brake: 1 });
		expect(physics.speed).toBe(0);
		const z = physics.z;
		drive(physics, 2, { brake: 1 });
		expect(physics.z).toBe(z);
	});

	it("reverses only once it has stopped", () => {
		const physics = car();
		physics.reset(0, 0, 0, 10);
		drive(physics, 0.2, { drive: -1 });
		expect(physics.braking).toBe(true);
		expect(physics.forwardSpeed).toBeGreaterThan(0);
		drive(physics, 5, { drive: -1 });
		expect(physics.forwardSpeed).toBeLessThan(0);
		expect(physics.reversing).toBe(true);
	});

	it("turns left for positive steer", () => {
		const physics = car();
		physics.reset(0, 0, 0, 10);
		drive(physics, 1, { drive: 0.3, steer: 1 });
		expect(physics.heading).toBeGreaterThan(0.1);
		expect(physics.yawRate).toBeGreaterThan(0);
	});

	it("never passes the top speed for its style", () => {
		const physics = car("auto");
		drive(physics, 60, { drive: 1 });
		expect(physics.forwardSpeed).toBeLessThanOrEqual(physics.spec.topSpeed + 0.5);
	});

	it("loses pull as the engine is damaged", () => {
		const healthy = car();
		const damaged = car();
		damaged.powerFactor = 0.45;
		drive(healthy, 4, { drive: 1 });
		drive(damaged, 4, { drive: 1 });
		expect(damaged.forwardSpeed).toBeLessThan(healthy.forwardSpeed);
	});

	it("slides the rear with the handbrake in a turn", () => {
		const physics = car();
		physics.reset(0, 0, 0, 18);
		drive(physics, 0.6, { steer: 1, handbrake: true });
		expect(physics.rearSlide).toBeGreaterThan(0.2);
	});

	it("behaves the same at 30 fps as at 144 fps", () => {
		const slow = car();
		const fast = car();
		for (let t = 0; t < 3; t += 1 / 30) slow.step(1 / 30, { ...idle, drive: 1, steer: 0.4 });
		for (let t = 0; t < 3; t += 1 / 144) fast.step(1 / 144, { ...idle, drive: 1, steer: 0.4 });
		expect(Math.hypot(slow.x - fast.x, slow.z - fast.z)).toBeLessThan(0.6);
	});

	it("stays finite through a long session of mashed controls", () => {
		const physics = car("luxury");
		for (let frame = 0; frame < 6000; frame++) {
			const phase = Math.floor(frame / 90) % 4;
			physics.step(frame % 13 === 0 ? 0.25 : FRAME, {
				drive: phase === 3 ? -1 : 1,
				steer: phase === 1 ? 1 : phase === 2 ? -1 : 0,
				handbrake: phase === 2,
				brake: 0,
			});
		}
		for (const value of [physics.x, physics.z, physics.heading, physics.velocityX, physics.velocityZ, physics.yawRate]) {
			expect(Number.isFinite(value)).toBe(true);
		}
	});
});
