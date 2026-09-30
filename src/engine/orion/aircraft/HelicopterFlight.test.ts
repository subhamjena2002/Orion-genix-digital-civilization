import { describe, expect, it } from "vitest";

import { GUNSHIP_CG_HEIGHT, HelicopterFlight, NO_INPUT, type PilotInput } from "./HelicopterFlight";

const flat = () => 0;

function run(heli: HelicopterFlight, seconds: number, input: Readonly<PilotInput> = NO_INPUT, ground = flat) {
	for (let t = 0; t < seconds; t += 1 / 60) heli.advance(1 / 60, input, ground);
}

function airborne(height = 60): HelicopterFlight {
	const heli = new HelicopterFlight();
	heli.park(0, 0, 0, 0);
	heli.engineOn = true;
	run(heli, 8);
	run(heli, height / 10 + 3, { ...NO_INPUT, climb: 1 });
	run(heli, 6);
	return heli;
}

describe("helicopter flight", () => {
	it("sits still on its wheels, engine off or idling", () => {
		const heli = new HelicopterFlight();
		heli.park(5, 0, -3, 90);
		run(heli, 5);
		expect(heli.y).toBeGreaterThan(GUNSHIP_CG_HEIGHT - 0.12);
		expect(heli.y).toBeLessThan(GUNSHIP_CG_HEIGHT + 0.02);
		expect(Math.hypot(heli.x - 5, heli.z + 3)).toBeLessThan(0.05);
		expect(heli.landed).toBe(true);
		expect(Math.abs(heli.pitch)).toBeLessThan(1);
		heli.engineOn = true;
		run(heli, 8);
		expect(heli.rotor).toBeGreaterThan(0.99);
		expect(heli.landed).toBe(true);
		expect(Math.abs(heli.heading - 90)).toBeLessThan(2);
	});

	it("can't lift off until the rotor is up to speed", () => {
		const heli = new HelicopterFlight();
		heli.park(0, 0, 0, 0);
		heli.engineOn = true;
		run(heli, 1.5, { ...NO_INPUT, climb: 1 });
		expect(heli.y).toBeLessThan(GUNSHIP_CG_HEIGHT + 0.1);
		run(heli, 10, { ...NO_INPUT, climb: 1 });
		expect(heli.y).toBeGreaterThan(30);
	});

	it("climbs at a real attack helicopter's rate and holds its height when let go", () => {
		const heli = new HelicopterFlight();
		heli.park(0, 0, 0, 0);
		heli.engineOn = true;
		run(heli, 8);
		// Well under the ceiling, where it levels off.
		run(heli, 5, { ...NO_INPUT, climb: 1 });
		expect(heli.vy).toBeGreaterThan(9);
		expect(heli.vy).toBeLessThan(15);
		run(heli, 4);
		const height = heli.y;
		run(heli, 10);
		expect(Math.abs(heli.y - height)).toBeLessThan(1.5);
		expect(heli.speed).toBeLessThan(0.5);
		expect(Math.abs(heli.pitch)).toBeLessThan(2);
		expect(Math.abs(heli.bank)).toBeLessThan(2);
	});

	it("flies forward nose down, tops out near 300 km/h, and comes back to a hover when let go", () => {
		const heli = airborne();
		run(heli, 40, { ...NO_INPUT, forward: 1 });
		expect(heli.pitch).toBeGreaterThan(18);
		const kmh = heli.speed * 3.6;
		expect(kmh).toBeGreaterThan(250);
		expect(kmh).toBeLessThan(340);
		expect(heli.z).toBeGreaterThan(500);
		// It stays at height while doing it.
		expect(heli.y).toBeGreaterThan(40);
		run(heli, 45);
		expect(heli.speed).toBeLessThan(3);
	});

	it("flares to a stop from full speed within a few seconds when pulled back", () => {
		const heli = airborne();
		run(heli, 40, { ...NO_INPUT, forward: 1 });
		expect(heli.speed * 3.6).toBeGreaterThan(250);
		const height = heli.y;
		let seconds = 0;
		while (heli.vx * heli.vx + heli.vz * heli.vz > 9 && seconds < 20) {
			run(heli, 0.1, { ...NO_INPUT, forward: -1 });
			seconds += 0.1;
		}
		expect(seconds).toBeLessThan(8);
		// A flare, not a zoom climb.
		expect(Math.abs(heli.y - height)).toBeLessThan(25);
	});

	it("won't climb past its ceiling", () => {
		const heli = airborne();
		run(heli, 60, { ...NO_INPUT, climb: 1 });
		expect(heli.y).toBeGreaterThan(heli.spec.ceiling - 15);
		expect(heli.y).toBeLessThan(heli.spec.ceiling + 5);
		run(heli, 20, { ...NO_INPUT, climb: 1, forward: 1 });
		expect(heli.y).toBeLessThan(heli.spec.ceiling + 15);
	});

	it("turns: in the hover it yaws on the spot; at speed it banks into a co-ordinated turn", () => {
		const hover = airborne();
		const start = hover.heading;
		run(hover, 1.5, { ...NO_INPUT, turn: 1 });
		const turned = ((start - hover.heading + 540) % 360) - 180;
		expect(turned).toBeGreaterThan(40);
		expect(Math.hypot(hover.vx, hover.vz)).toBeLessThan(2);

		const fast = airborne();
		run(fast, 25, { ...NO_INPUT, forward: 0.7 });
		run(fast, 3, { ...NO_INPUT, forward: 0.7, turn: 1 });
		expect(fast.bank).toBeGreaterThan(20);
		// Co-ordinated: the airflow meets the nose, not the side (sideslip under 3°).
		const left: [number, number, number] = [0, 0, 0];
		fast.directionToWorld(1, 0, 0, left);
		const sideways = fast.vx * left[0] + fast.vy * left[1] + fast.vz * left[2];
		expect(Math.abs(sideways) / fast.speed).toBeLessThan(Math.sin(3 * Math.PI / 180));
		// And it's actually turning.
		expect(Math.abs(fast.wy)).toBeGreaterThan(0.05);
	});

	it("sets down gently when descent is held, and the engine winding down leaves it parked", () => {
		const heli = airborne(40);
		let hardest = 0;
		for (let t = 0; t < 40; t += 1 / 60) {
			heli.advance(1 / 60, { ...NO_INPUT, climb: -1 }, flat);
			hardest = Math.max(hardest, heli.takeTouchdown());
		}
		expect(heli.landed).toBe(true);
		expect(hardest).toBeLessThan(2.5);
		expect(heli.rotorStrike).toBe(false);
		heli.engineOn = false;
		run(heli, 20);
		expect(heli.rotor).toBeLessThan(0.05);
		expect(heli.landed).toBe(true);
	});

	it("a tumbling wreck that hits the ground stays down instead of bouncing ever higher", () => {
		const heli = airborne(60);
		heli.wrecked = true;
		heli.engineOn = false;
		heli.rotor = 0;
		heli.wx = 1.5;
		heli.wy = 2;
		heli.wz = 2.5;
		// The airframe's corners against a flat ground at y = 0, as OrionGunship sweeps its hull.
		const hull: [number, number, number][] = [[0, 1.7, 0], [1.4, 0, 1], [-1.4, 0, 1], [0, 0, 5], [0, 0, -9], [0, -1.8, 0.7]];
		const point: [number, number, number] = [0, 0, 0];
		const none = () => null;
		// Height of the centre of mass when the first corner touched (the tail can strike with the
		// centre still well up), and the highest it gets after that.
		let atImpact: number | null = null;
		let highestAfter = -Infinity;
		for (let t = 0; t < 40; t += 1 / 60) {
			heli.advance(1 / 60, NO_INPUT, none);
			for (const [bx, by, bz] of hull) {
				heli.toWorld(bx, by, bz, point);
				if (point[1] >= 0) continue;
				heli.nudge(0, -point[1] + 0.01, 0);
				heli.collide(bx, by, bz, 0, 1, 0);
				atImpact ??= heli.y;
			}
			if (atImpact !== null) highestAfter = Math.max(highestAfter, heli.y);
		}
		expect(atImpact).not.toBeNull();
		expect(highestAfter).toBeLessThan((atImpact ?? 0) + 2);
		expect(heli.y).toBeLessThan(3);
		expect(heli.speed).toBeLessThan(2);
	});

	it("falls like a stone when wrecked", () => {
		const heli = airborne(60);
		heli.wrecked = true;
		heli.takeTouchdown();
		let hardest = 0;
		for (let t = 0; t < 12 && hardest === 0; t += 1 / 60) {
			heli.advance(1 / 60, NO_INPUT, flat);
			hardest = heli.takeTouchdown();
		}
		expect(hardest).toBeGreaterThan(15);
	});
});
