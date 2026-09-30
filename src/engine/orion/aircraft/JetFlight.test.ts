import { describe, expect, it } from "vitest";

import { JET_CG_HEIGHT, JetFlight, NO_JET_INPUT, type JetInput } from "./JetFlight";

const flat = () => 0;

function run(jet: JetFlight, seconds: number, input: Readonly<JetInput> = NO_JET_INPUT, ground = flat) {
	for (let t = 0; t < seconds; t += 1 / 60) jet.advance(1 / 60, input, ground);
}

/** Takes off down +Z on full afterburner and returns the distance the wheels rolled. */
function takeOff(jet: JetFlight): number {
	jet.engineOn = true;
	// Settle onto the wheels first.
	run(jet, 0.5);
	let rolled = 0;
	for (let t = 0; t < 40 && jet.wheelsDown > 0; t += 1 / 60) {
		// Full power, and the stick back once there's flying speed.
		jet.advance(1 / 60, { ...NO_JET_INPUT, throttle: 1, pitch: jet.speed > 62 ? 1 : 0 }, flat);
		rolled = jet.z;
	}
	return rolled;
}

/** Airborne, climbed out, gear up and levelled off near `height` on dry power. */
function cruising(height = 200): JetFlight {
	const jet = new JetFlight();
	jet.park(0, 0, 0, 0);
	takeOff(jet);
	jet.gearDown = false;
	run(jet, 3, { ...NO_JET_INPUT, throttle: 1, pitch: 0.3 });
	while (jet.y < height) jet.advance(1 / 60, { ...NO_JET_INPUT, throttle: 1, pitch: jet.pitch < 15 ? 0.25 : 0 }, flat);
	// Push over to level, and settle the throttle to about three quarters.
	for (let t = 0; t < 12; t += 1 / 60) {
		const vs = jet.vy;
		jet.advance(1 / 60, { ...NO_JET_INPUT, throttle: jet.throttle > 0.72 ? -1 : 0, pitch: Math.max(-1, Math.min(1, -vs * 0.08)) }, flat);
	}
	return jet;
}

describe("jet flight", () => {
	it("sits still on its wheels, and idling on the brakes doesn't creep", () => {
		const jet = new JetFlight();
		jet.park(5, 0, -3, 90);
		run(jet, 4);
		expect(jet.y).toBeGreaterThan(JET_CG_HEIGHT - 0.2);
		expect(jet.y).toBeLessThan(JET_CG_HEIGHT + 0.05);
		expect(jet.landed).toBe(true);
		expect(Math.abs(jet.pitch)).toBeLessThan(2);
		expect(Math.abs(jet.bank)).toBeLessThan(1);
		jet.engineOn = true;
		run(jet, 8);
		expect(jet.spool).toBeGreaterThan(0.05);
		expect(Math.hypot(jet.x - 5, jet.z + 3)).toBeLessThan(0.3);
		expect(Math.abs(jet.heading - 90)).toBeLessThan(1);
	});

	it("takes off on full power well inside the airfield's 550 m runway, and flies away straight", () => {
		const jet = new JetFlight();
		jet.park(0, 0, 0, 0);
		const rolled = takeOff(jet);
		expect(jet.wheelsDown).toBe(0);
		expect(rolled).toBeGreaterThan(150);
		expect(rolled).toBeLessThan(420);
		expect(jet.afterburner).toBe(true);
		// Climbing out on a little back stick (let go, it would level off low down).
		run(jet, 4, { ...NO_JET_INPUT, throttle: 1, pitch: 0.3 });
		expect(jet.y).toBeGreaterThan(15);
		// Straight down the runway's line.
		expect(Math.abs(jet.x)).toBeLessThan(6);
		expect(Math.abs(jet.bank)).toBeLessThan(3);
	});

	it("holds level flight hands-off, and the gear comes up", () => {
		const jet = cruising(200);
		const height = jet.y;
		run(jet, 20);
		expect(Math.abs(jet.y - height)).toBeLessThan(25);
		expect(Math.abs(jet.bank)).toBeLessThan(2);
		expect(jet.gear).toBeLessThan(0.05);
		expect(jet.speed * 3.6).toBeGreaterThan(400);
	});

	it("tops out between 700 and 950 km/h on afterburner", () => {
		const jet = cruising(200);
		for (let t = 0; t < 70; t += 1 / 60) jet.advance(1 / 60, { ...NO_JET_INPUT, throttle: 1, pitch: Math.max(-1, Math.min(1, -jet.vy * 0.05)) }, flat);
		const kmh = jet.speed * 3.6;
		expect(kmh).toBeGreaterThan(700);
		expect(kmh).toBeLessThan(950);
	});

	it("banks into a turn on the stick and holds its height; let go and the wings level", () => {
		const jet = cruising(220);
		const height = jet.y;
		const start = jet.heading;
		run(jet, 3, { ...NO_JET_INPUT, roll: 1 });
		expect(jet.bank).toBeGreaterThan(65);
		run(jet, 6, { ...NO_JET_INPUT, roll: 1 });
		const turned = ((start - jet.heading + 540) % 360) - 180;
		// Right turn: heading falls in this convention (it rises towards +X, which is left).
		expect(Math.abs(turned)).toBeGreaterThan(45);
		expect(Math.abs(jet.y - height)).toBeLessThan(40);
		// Co-ordinated: hardly any sideslip.
		expect(Math.abs(jet.beta) * 180 / Math.PI).toBeLessThan(3);
		run(jet, 4);
		expect(Math.abs(jet.bank)).toBeLessThan(5);
	});

	it("at low speed it banks no further than it can hold level, so a held turn doesn't sink", () => {
		const jet = new JetFlight();
		jet.park(0, 0, 0, 0);
		jet.engineOn = true;
		jet.gearDown = false;
		jet.gear = 0;
		jet.y = 200;
		jet.vz = 84;
		jet.throttle = jet.spool = 0.6;
		run(jet, 2);
		const height = jet.y;
		run(jet, 15, { ...NO_JET_INPUT, roll: 1 });
		expect(jet.bank).toBeLessThan(70);
		expect(jet.bank).toBeGreaterThan(40);
		expect(Math.abs(jet.y - height)).toBeLessThan(40);
	});

	it("loops on a held pull without stalling, and comes out the right way up", () => {
		const jet = new JetFlight();
		jet.park(0, 0, 0, 0);
		jet.engineOn = true;
		jet.gearDown = false;
		jet.gear = 0;
		jet.y = 100;
		jet.vz = 120;
		jet.throttle = jet.spool = 1;
		// Pull until it has been over the top and is the right way up again, climbing or level.
		let inverted = false;
		let t = 0;
		for (; t < 30 && !(inverted && Math.abs(jet.bank) < 30 && jet.vy > -2); t += 1 / 60) {
			jet.advance(1 / 60, { ...NO_JET_INPUT, throttle: 1, pitch: 1 }, flat);
			if (Math.abs(jet.bank) > 150) inverted = true;
			expect(Math.abs(jet.alpha) * 180 / Math.PI).toBeLessThan(20);
			expect(jet.load).toBeLessThan(8.2);
		}
		expect(inverted).toBe(true);
		expect(t).toBeLessThan(30);
		run(jet, 6, { ...NO_JET_INPUT, throttle: 1 });
		expect(Math.abs(jet.bank)).toBeLessThan(10);
		expect(jet.y).toBeGreaterThan(40);
		// Over the top and back: it has come round (not stalled and fallen back).
		expect(Math.abs(((jet.heading + 540) % 360) - 180)).toBeLessThan(20);
	});

	it("let go in a shallow dive, it eases back to level flight", () => {
		const jet = cruising(300);
		run(jet, 2.5, { ...NO_JET_INPUT, pitch: -0.4 });
		expect(jet.vy).toBeLessThan(-15);
		run(jet, 15);
		expect(Math.abs(jet.vy)).toBeLessThan(4);
		expect(jet.y).toBeGreaterThan(100);
	});

	it("won't stall on a pull at low speed: the limiter holds the wing short of it", () => {
		const jet = cruising(250);
		// Slow right down on idle with the airbrake, then pull.
		run(jet, 25, { ...NO_JET_INPUT, throttle: -1, pitch: 0.3 });
		run(jet, 8, { ...NO_JET_INPUT, pitch: 1 });
		expect(Math.abs(jet.alpha) * 180 / Math.PI).toBeLessThan(19);
		// Power back on and it flies out.
		run(jet, 12, { ...NO_JET_INPUT, throttle: 1 });
		expect(jet.speed).toBeGreaterThan(jet.stallSpeed * 1.3);
		expect(jet.stalling).toBe(false);
	});

	it("won't climb far past its ceiling", () => {
		const jet = cruising(200);
		let highest = 0;
		for (let t = 0; t < 60; t += 1 / 60) {
			jet.advance(1 / 60, { ...NO_JET_INPUT, throttle: 1, pitch: 0.5 }, flat);
			highest = Math.max(highest, jet.y);
		}
		expect(highest).toBeLessThan(jet.spec.ceiling + 170);
		run(jet, 20, { ...NO_JET_INPUT, throttle: 1 });
		expect(jet.y).toBeLessThan(jet.spec.ceiling + 60);
	});

	it("lands from an approach and stops on the brakes inside the runway", () => {
		const jet = new JetFlight();
		jet.park(0, 0, 0, 0);
		jet.engineOn = true;
		// On a shallow final: 72 m/s, 25 m up, sinking 3 m/s, gear down, idle.
		jet.y = 25;
		jet.vz = 72;
		jet.vy = -3;
		jet.qx = Math.sin((-4 * Math.PI) / 180 / 2);
		jet.qw = Math.cos((-4 * Math.PI) / 180 / 2);
		let hardest = 0;
		let touchdownZ: number | null = null;
		for (let t = 0; t < 60 && !jet.landed; t += 1 / 60) {
			// Hold the sink rate near 2 m/s with the stick; once down, hold the throttle back to brake.
			const down = jet.wheelsDown > 0;
			const pitch = down ? 0 : Math.max(-1, Math.min(1, (-2 - jet.vy) * 0.3));
			jet.advance(1 / 60, { ...NO_JET_INPUT, pitch, throttle: -1 }, flat);
			hardest = Math.max(hardest, jet.takeTouchdown());
			if (down && touchdownZ === null) touchdownZ = jet.z;
		}
		expect(jet.landed).toBe(true);
		expect(hardest).toBeLessThan(4);
		expect(touchdownZ).not.toBeNull();
		// Brakes, airbrake and the braking parachute: well inside the 550 m runway.
		expect(jet.z - (touchdownZ ?? 0)).toBeLessThan(300);
		expect(Math.abs(jet.x)).toBeLessThan(6);
	});

	it("steers on the ground with the nose wheel at taxiing speed", () => {
		const jet = new JetFlight();
		jet.park(0, 0, 0, 0);
		jet.engineOn = true;
		run(jet, 3, { ...NO_JET_INPUT, throttle: 1 });
		// Ease back to a taxiing pace, then steer right.
		for (let t = 0; t < 15; t += 1 / 60) jet.advance(1 / 60, { ...NO_JET_INPUT, throttle: jet.speed > 8 ? -1 : jet.speed < 5 && jet.throttle < 0.15 ? 1 : 0, yaw: t > 3 ? 1 : 0 }, flat);
		expect(jet.onGround).toBe(true);
		expect(jet.speed).toBeLessThan(15);
		const turned = ((0 - jet.heading + 540) % 360) - 180;
		expect(turned).toBeGreaterThan(60);
		expect(Math.abs(jet.bank)).toBeLessThan(4);
	});

	it("falls when wrecked, and stops spinning once it's down", () => {
		const jet = cruising(150);
		jet.wrecked = true;
		let hitAt = -1;
		for (let t = 0; t < 30; t += 1 / 60) {
			jet.advance(1 / 60, NO_JET_INPUT, flat);
			if (jet.y < 3 && hitAt < 0) hitAt = t;
			// The ground, as the game's hull sweep would find it: the centre of mass can't go below it.
			if (jet.y < 1) {
				jet.nudge(0, 1 - jet.y, 0);
				jet.collide(0, -1, 0, 0, 1, 0);
			}
		}
		expect(hitAt).toBeGreaterThan(0);
		expect(jet.y).toBeLessThan(4);
		expect(Math.hypot(jet.wx, jet.wy, jet.wz)).toBeLessThan(0.3);
	});
});
