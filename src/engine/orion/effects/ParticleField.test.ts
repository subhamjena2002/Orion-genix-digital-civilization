import { describe, expect, it } from "vitest";

import { EmissionAccumulator, MAX_PARTICLES, PARTICLE_KIND, ParticleField } from "./ParticleField";

const FRAME = 1 / 60;

function run(field: ParticleField, seconds: number, wind?: { x: number; z: number }) {
	for (let t = 0; t < seconds; t += FRAME) field.step(FRAME, wind);
}

describe("ParticleField", () => {
	it("counts spawned particles and retires them when their life is up", () => {
		const field = new ParticleField(8);
		field.spawn({ kind: PARTICLE_KIND.smoke, x: 0, y: 0, z: 0, size: 1, life: 0.5 });
		field.spawn({ kind: PARTICLE_KIND.smoke, x: 0, y: 0, z: 0, size: 1, life: 2 });
		expect(field.count).toBe(2);

		run(field, 1);
		expect(field.count).toBe(1);
		expect(field.life[0]).toBe(2);

		run(field, 1.1);
		expect(field.count).toBe(0);
	});

	it("keeps the survivors' data intact when one is removed from the middle", () => {
		const field = new ParticleField(8);
		field.spawn({ kind: PARTICLE_KIND.flame, x: 1, y: 0, z: 0, size: 1, life: 5, seed: 0.1 });
		field.spawn({ kind: PARTICLE_KIND.spark, x: 2, y: 0, z: 0, size: 1, life: 0.1, seed: 0.2 });
		field.spawn({ kind: PARTICLE_KIND.scorch, x: 3, y: 0, z: 0, size: 1, life: 5, seed: 0.3 });

		field.step(0.2);
		expect(field.count).toBe(2);
		const kinds = [field.kind[0], field.kind[1]].sort();
		expect(kinds).toEqual([PARTICLE_KIND.flame, PARTICLE_KIND.scorch].sort());
		for (let i = 0; i < field.count; i++) {
			// Each survivor still carries its own seed and position, not a neighbour's.
			if (field.kind[i] === PARTICLE_KIND.flame) expect(field.seed[i]).toBeCloseTo(0.1);
			else expect(field.x[i]).toBe(3);
		}
	});

	it("lifts buoyant gas and brings falling sparks down onto the floor", () => {
		const field = new ParticleField(4);
		field.spawn({ kind: PARTICLE_KIND.flame, x: 0, y: 0, z: 0, size: 1, life: 5, buoyancy: 4 });
		field.spawn({ kind: PARTICLE_KIND.spark, x: 0, y: 2, z: 0, vy: 3, size: 1, life: 5, gravity: 9.8, floor: 0 });

		let lowest = Infinity;
		for (let t = 0; t < 2; t += FRAME) {
			field.step(FRAME);
			lowest = Math.min(lowest, field.y[1]);
		}
		expect(field.y[0]).toBeGreaterThan(3);
		expect(lowest).toBeGreaterThanOrEqual(0);
		// It hit the ground and lost most of its energy bouncing.
		expect(field.y[1]).toBeLessThan(0.5);
	});

	it("bounces a spark back up with less speed than it landed with", () => {
		const field = new ParticleField(1);
		field.spawn({ kind: PARTICLE_KIND.spark, x: 0, y: 0.01, z: 0, vy: -10, size: 1, life: 5, floor: 0 });
		field.step(FRAME);
		expect(field.y[0]).toBe(0);
		expect(field.vy[0]).toBeGreaterThan(0);
		expect(field.vy[0]).toBeLessThan(10);
	});

	it("drifts smoke with the wind but leaves sparks to their own momentum", () => {
		const field = new ParticleField(2);
		field.spawn({ kind: PARTICLE_KIND.smoke, x: 0, y: 0, z: 0, size: 1, life: 20, seed: 0 });
		field.spawn({ kind: PARTICLE_KIND.spark, x: 0, y: 0, z: 0, size: 1, life: 20 });
		run(field, 10, { x: 2, z: 0 });
		expect(field.x[0]).toBeGreaterThan(10);
		expect(field.x[1]).toBe(0);
	});

	it("grows a sprite from its birth size towards size x growth", () => {
		const field = new ParticleField(1);
		field.spawn({ kind: PARTICLE_KIND.smoke, x: 0, y: 0, z: 0, size: 1, growth: 3, life: 1 });
		expect(field.currentSize(0)).toBeCloseTo(1);
		field.step(0.5);
		const midway = field.currentSize(0);
		field.step(0.49);
		expect(midway).toBeGreaterThan(1);
		expect(field.currentSize(0)).toBeGreaterThan(midway);
		expect(field.currentSize(0)).toBeLessThanOrEqual(3);
	});

	it("makes room when full by replacing the particle with the least life left", () => {
		const field = new ParticleField(3);
		field.spawn({ kind: PARTICLE_KIND.smoke, x: 0, y: 0, z: 0, size: 1, life: 10 });
		field.spawn({ kind: PARTICLE_KIND.smoke, x: 1, y: 0, z: 0, size: 1, life: 1 });
		field.spawn({ kind: PARTICLE_KIND.smoke, x: 2, y: 0, z: 0, size: 1, life: 10 });

		const index = field.spawn({ kind: PARTICLE_KIND.flame, x: 9, y: 0, z: 0, size: 1, life: 1 });
		expect(index).toBe(1);
		expect(field.count).toBe(3);
		expect(field.kind[1]).toBe(PARTICLE_KIND.flame);
		expect(field.x[1]).toBe(9);
	});

	it("never evicts a scorch mark to make room", () => {
		const field = new ParticleField(2);
		field.spawn({ kind: PARTICLE_KIND.scorch, x: 0, y: 0, z: 0, size: 1, life: 0.1 });
		field.spawn({ kind: PARTICLE_KIND.scorch, x: 1, y: 0, z: 0, size: 1, life: 0.2 });
		expect(field.spawn({ kind: PARTICLE_KIND.flame, x: 0, y: 0, z: 0, size: 1, life: 1 })).toBe(-1);
		expect(field.kind[0]).toBe(PARTICLE_KIND.scorch);
		expect(field.kind[1]).toBe(PARTICLE_KIND.scorch);
	});

	it("orders particles farthest from the camera first", () => {
		const field = new ParticleField(16);
		// Keys are centimetre-precise; anything closer than that may come out in either order.
		const distances = [5, 40, 0.5, 12, 12.03, 300, 1];
		for (const z of distances) field.spawn({ kind: PARTICLE_KIND.smoke, x: 0, y: 0, z, size: 1, life: 1 });
		const order = new Uint16Array(16);
		const count = field.sortBackToFront(0, 0, 0, order);
		expect(count).toBe(distances.length);
		const sorted = Array.from(order.subarray(0, count), (index) => field.z[index]);
		const expected = [...distances].sort((a, b) => b - a);
		sorted.forEach((z, i) => expect(z).toBeCloseTo(expected[i], 4));
		// Every live particle appears exactly once.
		expect(new Set(order.subarray(0, count)).size).toBe(count);
	});

	it("only writes as many indices as the order buffer holds", () => {
		const field = new ParticleField(8);
		for (let i = 0; i < 6; i++) field.spawn({ kind: PARTICLE_KIND.smoke, x: i, y: 0, z: 0, size: 1, life: 1 });
		expect(field.sortBackToFront(0, 0, 0, new Uint16Array(4))).toBe(4);
	});

	it("rejects a pool too large for its sort keys", () => {
		expect(() => new ParticleField(MAX_PARTICLES + 1)).toThrow(RangeError);
	});

	it("stays finite through long, choppy simulation", () => {
		const field = new ParticleField(64);
		for (let i = 0; i < 64; i++) {
			field.spawn({
				kind: (i % 5) as 0 | 1 | 2 | 3 | 4, x: i, y: 1, z: -i, vx: 3, vy: 5, vz: -2,
				size: 0.5, growth: 2, life: 1000, buoyancy: 2, drag: 1, gravity: i % 2 ? 9.8 : 0, floor: 0, spin: 1,
			});
		}
		for (let frame = 0; frame < 2000; frame++) field.step(frame % 7 === 0 ? 0.1 : 0.004, { x: 1, z: 1 });
		for (let i = 0; i < field.count; i++) {
			expect(Number.isFinite(field.x[i] + field.y[i] + field.z[i] + field.vx[i] + field.vy[i] + field.vz[i])).toBe(true);
		}
	});
});

describe("EmissionAccumulator", () => {
	it("emits a steady rate over time regardless of frame rate", () => {
		for (const fps of [30, 60, 144]) {
			const emitter = new EmissionAccumulator();
			let total = 0;
			for (let frame = 0; frame < fps * 2; frame++) total += emitter.take(25, 1 / fps);
			expect(total).toBeGreaterThanOrEqual(49);
			expect(total).toBeLessThanOrEqual(50);
		}
	});

	it("carries fractions over instead of dropping them", () => {
		const emitter = new EmissionAccumulator();
		// 0.4 particles a frame: nothing, nothing, one, ...
		const counts = Array.from({ length: 5 }, () => emitter.take(24, 1 / 60));
		expect(counts).toEqual([0, 0, 1, 0, 1]);
	});

	it("emits nothing for a zero or negative rate or time step", () => {
		const emitter = new EmissionAccumulator();
		expect(emitter.take(0, 1)).toBe(0);
		expect(emitter.take(-5, 1)).toBe(0);
		expect(emitter.take(10, 0)).toBe(0);
	});

	it("forgets the carried fraction when reset", () => {
		const emitter = new EmissionAccumulator();
		emitter.take(0.9, 1);
		emitter.reset();
		expect(emitter.take(0.2, 1)).toBe(0);
	});
});
