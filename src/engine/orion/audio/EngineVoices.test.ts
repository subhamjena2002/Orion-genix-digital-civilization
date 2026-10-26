import { describe, expect, it } from "vitest";

import { engineState } from "./EngineVoices";
import { gearboxFor, VEHICLE_AUDIO } from "./VehicleAudioProfiles";
import { ENGINE_FAMILIES } from "./VehicleSoundManifest";
import { carSpecFor } from "../traffic/CarPhysics";
import { VEHICLE_SHAPES, type VehicleStyle } from "../traffic/Vehicles";

const STYLES = Object.keys(VEHICLE_SHAPES) as VehicleStyle[];

describe("vehicle audio profiles", () => {
	it("gives every vehicle in the game a profile on a recorded engine (or none, for the electric car)", () => {
		for (const style of STYLES) {
			const profile = VEHICLE_AUDIO[style];
			expect(profile, style).toBeDefined();
			if (profile.family === null) expect(profile.sound, style).toBe("electric");
			else expect(ENGINE_FAMILIES[profile.family], `${style}: ${profile.family}`).toBeDefined();
		}
	});

	it("has a gearbox that climbs and reaches what the vehicle can actually do", () => {
		for (const style of STYLES) {
			const gearbox = gearboxFor(style);
			expect(gearbox.redlineRpm, style).toBeGreaterThan(gearbox.idleRpm * 2);
			for (let i = 1; i < gearbox.gearTops.length; i++) expect(gearbox.gearTops[i], `${style} gear ${i}`).toBeGreaterThan(gearbox.gearTops[i - 1]);
			const top = gearbox.gearTops[gearbox.gearTops.length - 1];
			expect(top, style).toBeGreaterThanOrEqual(carSpecFor(style, 4, 2).topSpeed);
			expect(top, style).toBeGreaterThanOrEqual(VEHICLE_SHAPES[style].maxSpeed);
		}
	});

	it("only fits air brakes to heavy vehicles, and sirens to emergency vehicles", () => {
		for (const style of STYLES) {
			const profile = VEHICLE_AUDIO[style];
			if (profile.airBrakes) expect(["truck", "bus", "fireTruck"], style).toContain(profile.sound);
			if (profile.siren) expect(["police", "ambulance", "fireTruck"], style).toContain(style);
		}
	});
});

describe("the gearbox", () => {
	const gearbox = gearboxFor("luxury");

	it("idles when the car is stopped and off the throttle", () => {
		const state = engineState(gearbox, 0, 0, 0);
		expect(state.rpm).toBe(gearbox.idleRpm);
		expect(state.gear).toBe(0);
		expect(state.load).toBeLessThan(0.1);
	});

	it("revs against the clutch when stopped on the throttle", () => {
		const state = engineState(gearbox, 0, 1, 0);
		expect(state.rpm).toBeGreaterThan(gearbox.idleRpm * 1.5);
		expect(state.rpm).toBeLessThan(gearbox.redlineRpm);
	});

	it("climbs to the redline in gear, then drops on the shift", () => {
		const top = gearbox.gearTops[0];
		const beforeShift = engineState(gearbox, top - 0.2, 1, 0);
		const afterShift = engineState(gearbox, top + 0.2, 1, beforeShift.gear);
		expect(beforeShift.gear).toBe(0);
		expect(afterShift.gear).toBe(1);
		expect(beforeShift.rpm).toBeGreaterThan(gearbox.redlineRpm * 0.9);
		expect(afterShift.rpm).toBeLessThan(beforeShift.rpm * 0.75);
	});

	it("never exceeds the redline, at any speed", () => {
		let gear = 0;
		for (let speed = 0; speed < 120; speed += 0.5) {
			const state = engineState(gearbox, speed, 1, gear);
			gear = state.gear;
			expect(state.rpm, `at ${speed} m/s`).toBeLessThanOrEqual(gearbox.redlineRpm + 1e-6);
			expect(state.rpm, `at ${speed} m/s`).toBeGreaterThanOrEqual(gearbox.idleRpm - 1e-6);
		}
	});

	it("holds its gear rather than hunting on the boundary", () => {
		const top = gearbox.gearTops[0];
		let gear = engineState(gearbox, top + 1, 0.5, 0).gear;
		expect(gear).toBe(1);
		gear = engineState(gearbox, top - 0.5, 0.5, gear).gear;
		expect(gear).toBe(1);
		gear = engineState(gearbox, top * 0.5, 0.5, gear).gear;
		expect(gear).toBe(0);
	});

	it("works its way up the box as the car accelerates", () => {
		let gear = 0;
		const seen = new Set<number>();
		for (let speed = 0; speed < gearbox.gearTops[gearbox.gearTops.length - 1]; speed += 0.5) {
			gear = engineState(gearbox, speed, 1, gear).gear;
			seen.add(gear);
		}
		expect(seen.size).toBe(gearbox.gearTops.length);
	});
});
