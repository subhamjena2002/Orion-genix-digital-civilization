import { describe, expect, it } from "vitest";

import { shopPaneAt, SHOP_GLASS_BOTTOM, SHOP_GLASS_TOP } from "../buildings/ShopfrontLayout";
import { markOf, surfaceOf } from "../combat/Surfaces";
import { CarPhysics, carSpecFor } from "./CarPhysics";
import { estimateRimRadius, sagPoint, tyreTriangles } from "./FlatTyreGeometry";
import { carPaneKind, glassDamage, hitPane, newPane, PANE_STRENGTH, worsenPane } from "./GlassDamage";
import { connectedPatches, rayTriangles, type TriangleData } from "./MeshRaycast";
import { deflate, hitTyre, newTyre, NO_TYRE_EFFECT, repairTyre, tyreHandling, tyreHitDamage, type TyreHandling } from "./TyreDamage";
import { SMOULDER_SECONDS, VehicleFire } from "./VehicleFire";

const PISTOL = 30;

describe("glass panes", () => {
	it("stars on the first round, then spreads, then shatters at its strength", () => {
		const pane = newPane();
		expect(hitPane(pane, "plate", glassDamage("bullet", PISTOL))).toBe("crack");
		expect(hitPane(pane, "plate", glassDamage("bullet", PISTOL))).toBe("spread");
		expect(hitPane(pane, "plate", glassDamage("bullet", PISTOL))).toBe("shatter");
		expect(pane.stage).toBe("shattered");
	});

	it("never shatters twice: rounds through an empty frame do nothing", () => {
		const pane = newPane();
		hitPane(pane, "tempered", 999);
		expect(hitPane(pane, "tempered", glassDamage("bullet", PISTOL))).toBe("none");
		expect(pane.hits).toBe(1);
	});

	it("takes two pistol rounds for a side window, several for a windscreen, which crazes first", () => {
		const side = newPane();
		hitPane(side, "tempered", glassDamage("bullet", PISTOL));
		expect(hitPane(side, "tempered", glassDamage("bullet", PISTOL))).toBe("shatter");
		const screen = newPane();
		const outcomes = Array.from({ length: 5 }, () => hitPane(screen, "laminated", glassDamage("bullet", PISTOL)));
		expect(outcomes).toContain("craze");
		expect(outcomes.at(-1)).toBe("shatter");
		expect(outcomes.slice(0, -1)).not.toContain("shatter");
	});

	it("knows a windscreen from the other windows", () => {
		expect(carPaneKind("windscreen-glass")).toBe("laminated");
		expect(carPaneKind("window-left")).toBe("tempered");
	});

	it("only ever gets worse in a crash", () => {
		const pane = newPane();
		expect(worsenPane(pane, "laminated", "crazed")).toBe("craze");
		expect(worsenPane(pane, "laminated", "cracked")).toBe("none");
		expect(worsenPane(pane, "laminated", "shattered")).toBe("shatter");
		expect(pane.damage).toBeGreaterThanOrEqual(PANE_STRENGTH.laminated);
	});
});

describe("tyres", () => {
	const square = (sidewall: boolean) => tyreHitDamage("bullet", PISTOL, 1, sidewall);

	it("goes flat after two pistol rounds square into the sidewall, three into the tread", () => {
		const wall = newTyre();
		expect(hitTyre(wall, "car", square(true))).toBe(false);
		expect(hitTyre(wall, "car", square(true))).toBe(true);
		const tread = newTyre();
		expect(hitTyre(tread, "car", square(false))).toBe(false);
		expect(hitTyre(tread, "car", square(false))).toBe(false);
		expect(hitTyre(tread, "car", square(false))).toBe(true);
	});

	it("takes more rounds that glance off, and more for a lorry's tyre", () => {
		const glancing = newTyre();
		let rounds = 0;
		while (!hitTyre(glancing, "car", tyreHitDamage("bullet", PISTOL, 0.2, false))) rounds++;
		expect(rounds + 1).toBeGreaterThan(3);
		const lorry = newTyre();
		rounds = 0;
		while (!hitTyre(lorry, "heavy", square(true))) rounds++;
		expect(rounds + 1).toBeGreaterThan(2);
	});

	it("isn't hurt by punches or crashes", () => {
		expect(tyreHitDamage("melee", 50, 1, true)).toBe(0);
		expect(tyreHitDamage("impact", 50, 1, true)).toBe(0);
	});

	it("goes down over a couple of seconds rather than at once, and comes back on repair", () => {
		const tyre = newTyre();
		hitTyre(tyre, "car", 999);
		deflate(tyre, 0.5);
		expect(tyre.deflation).toBeGreaterThan(0.1);
		expect(tyre.deflation).toBeLessThan(0.6);
		for (let i = 0; i < 40; i++) deflate(tyre, 0.1);
		expect(tyre.deflation).toBe(1);
		repairTyre(tyre);
		expect(tyre).toEqual(newTyre());
	});

	it("pulls towards the flat side and weakens that axle", () => {
		const out: TyreHandling = { ...NO_TYRE_EFFECT };
		const corners = [{ front: true, left: true }, { front: true, left: false }, { front: false, left: true }, { front: false, left: false }];
		const flatFrontLeft = [{ ...newTyre(), deflation: 1 }, newTyre(), newTyre(), newTyre()];
		tyreHandling(flatFrontLeft, corners, out);
		expect(out.pull).toBeGreaterThan(0);
		expect(out.frontGrip).toBeLessThan(out.rearGrip);
		expect(out.shimmy).toBeGreaterThan(0);
		const flatRearRight = [newTyre(), newTyre(), newTyre(), { ...newTyre(), deflation: 1 }];
		tyreHandling(flatRearRight, corners, out);
		expect(out.pull).toBeLessThan(0);
		expect(out.shimmy).toBe(0);
	});
});

describe("driving on a flat", () => {
	function drive(handling: TyreHandling, seconds: number) {
		const car = new CarPhysics(carSpecFor("sedan", 4.6, 1.9));
		car.reset(0, 0, 0, 25);
		car.tyres = handling;
		for (let t = 0; t < seconds; t += 1 / 60) car.step(1 / 60, { drive: 0.3, steer: 0, handbrake: false, brake: 0 });
		return car;
	}

	it("drifts towards the flat side, slows, but neither stops dead nor spins", () => {
		const corners = [{ front: true, left: true }, { front: true, left: false }, { front: false, left: true }, { front: false, left: false }];
		const handling = tyreHandling([{ ...newTyre(), deflation: 1 }, newTyre(), newTyre(), newTyre()], corners, { ...NO_TYRE_EFFECT });
		const good = drive(NO_TYRE_EFFECT, 3);
		const flat = drive(handling, 3);
		// Heading 0 faces +Z; left is +X.
		expect(flat.x).toBeGreaterThan(good.x + 0.5);
		expect(flat.speed).toBeLessThan(good.speed);
		expect(flat.speed).toBeGreaterThan(10);
		expect(Math.abs(flat.heading)).toBeLessThan(Math.PI / 2);
	});
});

describe("vehicle fire", () => {
	it("builds from the first flames to full strength", () => {
		const fire = new VehicleFire();
		fire.ignite(false);
		expect(fire.stage).toBe("igniting");
		for (let i = 0; i < 60; i++) fire.update(0.1, 0);
		expect(fire.stage).toBe("burning");
		expect(fire.intensity).toBeGreaterThan(0.9);
	});

	it("dies back only while water reaches it, comes back when it stops, and goes out", () => {
		const fire = new VehicleFire();
		fire.ignite(false);
		for (let i = 0; i < 60; i++) fire.update(0.1, 0);
		for (let i = 0; i < 20; i++) {
			fire.applyWater(1, 0.1);
			fire.update(0.1, 0);
		}
		expect(fire.stage).toBe("suppressing");
		const knockedBack = fire.intensity;
		expect(knockedBack).toBeLessThan(0.8);
		for (let i = 0; i < 30; i++) fire.update(0.1, 0);
		expect(fire.stage).toBe("burning");
		expect(fire.intensity).toBeGreaterThan(knockedBack);
		for (let i = 0; i < 100 && fire.burning; i++) {
			fire.applyWater(1, 0.1);
			fire.update(0.1, 0);
		}
		expect(fire.stage).toBe("smouldering");
		expect(fire.intensity).toBe(0);
	});

	it("smoulders then cools, and never relights by itself", () => {
		const fire = new VehicleFire();
		fire.ignite(true);
		fire.putOut();
		expect(fire.residue).toBe(1);
		for (let t = 0; t < SMOULDER_SECONDS + 1; t += 0.5) fire.update(0.5, 0.085);
		expect(fire.stage).toBe("cooled");
		expect(fire.burning).toBe(false);
	});

	it("puts a wreck fire out by itself once there's nothing left to burn", () => {
		const fire = new VehicleFire();
		fire.ignite(true);
		for (let t = 0; t < 120 && fire.burning; t += 0.1) fire.update(0.1, 0.085);
		expect(fire.out).toBe(true);
	});
});

describe("flat tyre shape", () => {
	it("tells the rim's lip from the tyre", () => {
		const radii = [0.2, 0.24, 0.3, 0.33];
		const bright = [1, 1, 0.02, 0.02];
		expect(estimateRimRadius(radii, bright, 0.33)).toBeCloseTo(0.24);
		expect(Array.from(tyreTriangles([0.2, 0.24, 0.3, 0.2, 0.24, 0.1], [0, 1, 2, 3, 4, 5], 0.245))).toEqual([1, 0]);
	});

	it("sags at the bottom onto a flat patch, keeps its top, and never goes inside the rim", () => {
		const out = [0, 0, 0];
		sagPoint(0, -0.33, 0, 0.33, 0.235, 1, out);
		expect(out[1]).toBeGreaterThan(-0.33 + 0.04);
		expect(out[1]).toBeLessThan(-0.235);
		sagPoint(0, 0.33, 0, 0.33, 0.235, 1, out);
		expect(out[1]).toBeCloseTo(0.33);
		sagPoint(0.1, -0.29, 0, 0.33, 0.235, 1, out);
		expect(out[0]).toBeGreaterThan(0.1);
		sagPoint(0.05, -0.2, 0, 0.33, 0.235, 1, out);
		expect(out).toEqual([0.05, -0.2, 0]);
	});
});

describe("mesh raycasts", () => {
	// Two separate unit squares in the XY plane: one at z = 0, one at z = 2.
	const data: TriangleData = {
		positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 2, 1, 0, 2, 1, 1, 2, 0, 1, 2]),
		indices: Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
	};

	it("finds the nearest triangle, and skips the broken ones", () => {
		const hit = { t: 0, tri: 0 };
		expect(rayTriangles(0.5, 0.4, -1, 0, 0, 1, 10, data, hit)).toBe(true);
		expect(hit.t).toBeCloseTo(1);
		expect(hit.tri).toBeLessThan(2);
		expect(rayTriangles(0.5, 0.4, -1, 0, 0, 1, 10, data, hit, Uint8Array.from([1, 1, 0, 0]))).toBe(true);
		expect(hit.t).toBeCloseTo(3);
		expect(rayTriangles(2, 2, -1, 0, 0, 1, 10, data, hit)).toBe(false);
	});

	it("splits a part into its separate panes", () => {
		const { patch, count } = connectedPatches(data);
		expect(count).toBe(2);
		expect(patch[0]).toBe(patch[1]);
		expect(patch[2]).toBe(patch[3]);
		expect(patch[0]).not.toBe(patch[2]);
	});
});

describe("shop windows", () => {
	it("finds the glass of a shopfront, not the piers, the sign or the plinth", () => {
		// A 12.8 m front: four bays, the tile unshifted.
		const glass = shopPaneAt(12.8, 10, 0, -6.4 + 1.6, 1.5, 5);
		expect(glass).not.toBeNull();
		expect(glass!.side).toBe(0);
		expect(glass!.halfHeight * 2).toBeCloseTo(SHOP_GLASS_TOP - SHOP_GLASS_BOTTOM);
		expect(shopPaneAt(12.8, 10, 0, -6.4 + 0.05, 1.5, 5)).toBeNull();
		expect(shopPaneAt(12.8, 10, 0, -6.4 + 1.6, 4.2, 5)).toBeNull();
		expect(shopPaneAt(12.8, 10, 0, -6.4 + 1.6, 0.1, 5)).toBeNull();
		expect(shopPaneAt(12.8, 10, 0, 0, 1.5, 0)).toBeNull();
	});

	it("numbers panes so neighbours differ and one pane is one pane", () => {
		const a = shopPaneAt(12.8, 10, 0, -6.4 + 1.2, 1.5, 5)!;
		const b = shopPaneAt(12.8, 10, 0, -6.4 + 2, 2.5, 5)!;
		const c = shopPaneAt(12.8, 10, 0, -6.4 + 4.8, 1.5, 5)!;
		expect(a.bay).toBe(b.bay);
		expect(c.bay).not.toBe(a.bay);
	});
});

describe("surfaces", () => {
	it("tells what a round struck from the collider's name", () => {
		expect(surfaceOf("building-collider lot-12", 0)).toBe("plaster");
		expect(surfaceOf("building-collider lot-12", 1)).toBe("concrete");
		expect(surfaceOf("carriageway seg-4", 1)).toBe("asphalt");
		expect(surfaceOf("signal-poles", 0)).toBe("metal");
		expect(markOf("dirt")).toBeNull();
		expect(markOf("metal")).toBe("metal");
	});
});
