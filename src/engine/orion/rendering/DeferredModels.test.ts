import { existsSync } from "node:fs";
import { join } from "node:path";
import { EventHandler, type AppBase } from "playcanvas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ARMY_BASE_AREA, DEFERRED_MODELS, fetchModel, isDeferredModel, isModelReleased, markModelShowable, onModelReleased, requestDeferredModel, SHOWABLE_WAIT_MS, whenModelShowable } from "./DeferredModels";
import { modelsToPrewarm } from "./ModelPrewarm";
import { HELIPAD } from "../world/MilitaryBase";
import { VEHICLE_MODEL_BASE, VEHICLE_MODELS } from "../traffic/VehicleModels";
import { ORION_VEHICLES } from "../traffic/Vehicles";

describe("deferred models", () => {
	it("are real files under public/", () => {
		for (const url of DEFERRED_MODELS) expect(existsSync(join(process.cwd(), "public", url))).toBe(true);
	});

	it("take the vehicles marked deferred first, and only those", () => {
		const deferredVehicles = VEHICLE_MODELS.filter((spec) => spec.deferred).map((spec) => `${VEHICLE_MODEL_BASE}/${spec.file}`);
		expect(deferredVehicles).toEqual(expect.arrayContaining(["/models/vehicles/orion-fire-truck.glb", "/models/vehicles/orion-sedan.glb"]));
		expect(DEFERRED_MODELS.slice(0, deferredVehicles.length)).toEqual(deferredVehicles);
		// Nothing in ordinary traffic waits: the city's streets look right from the first frame.
		for (const [style] of ORION_VEHICLES.map((vehicle) => [vehicle.style] as const)) {
			const spec = VEHICLE_MODELS.find((model) => model.styles.includes(style));
			expect(spec?.deferred ?? false).toBe(false);
		}
	});

	it("are not fetched by the startup prewarm", () => {
		const startup = modelsToPrewarm();
		for (const url of DEFERRED_MODELS) expect(startup).not.toContain(url);
		expect(startup.length).toBeGreaterThan(0);
	});

	it("tells listeners once when a model is released", () => {
		const url = DEFERRED_MODELS[0];
		const heard: string[] = [];
		const stop = onModelReleased((which) => heard.push(which));
		expect(isDeferredModel(url)).toBe(true);
		expect(isModelReleased(url)).toBe(false);
		requestDeferredModel(url);
		requestDeferredModel(url);
		stop();
		expect(isModelReleased(url)).toBe(true);
		expect(heard).toEqual([url]);
		expect(isDeferredModel("/models/vehicles/orion-taxi.glb")).toBe(false);
		// Anything not deferred may always load.
		expect(isModelReleased("/models/vehicles/orion-taxi.glb")).toBe(true);
	});

	it("covers the helipad, and leaves the spawn outside the reach", () => {
		const inside = (x: number, z: number) => x >= ARMY_BASE_AREA.minX && x <= ARMY_BASE_AREA.maxX && z >= ARMY_BASE_AREA.minZ && z <= ARMY_BASE_AREA.maxZ;
		expect(inside(HELIPAD.x, HELIPAD.z)).toBe(true);
		// The player starts at (8, 16): the base's models wait their turn rather than all at once.
		expect(ARMY_BASE_AREA.minZ - 16).toBeGreaterThan(ARMY_BASE_AREA.reach);
	});
});

/**
 * Just enough of an AppBase for fetchAsset: a registry whose loads fail `failures` times. Like the
 * real one, it ignores loads of an asset already loading or loaded — and a failure counts as loaded.
 */
function appFailing(failures: number) {
	type FakeAsset = EventHandler & { name: string; type: string; resource: unknown; loading: boolean; loaded: boolean };
	const assets: FakeAsset[] = [];
	let loads = 0;
	const registry = {
		find: (name: string, type: string) => assets.find((asset) => asset.name === name && asset.type === type) ?? null,
		add: (asset: FakeAsset) => assets.push(asset),
		load: (asset: FakeAsset) => {
			if (asset.loading || asset.loaded) return;
			loads++;
			asset.loading = true;
			queueMicrotask(() => {
				asset.loading = false;
				asset.loaded = true;
				if (loads <= failures) {
					asset.fire("error", new Error("offline"));
				} else {
					asset.resource = {};
					asset.fire("load", asset);
				}
			});
		},
	};
	return { app: { assets: registry } as unknown as AppBase, loads: () => loads };
}

describe("fetching a deferred model", () => {
	afterEach(() => vi.useRealTimers());

	it("tries again after a failed download", async () => {
		vi.useFakeTimers();
		const { app, loads } = appFailing(1);
		const fetched = fetchModel(app, "/models/test-a.glb");
		await vi.runAllTimersAsync();
		await expect(fetched).resolves.toBeTruthy();
		expect(loads()).toBe(2);
	});

	it("gives up after three tries rather than hanging", async () => {
		vi.useFakeTimers();
		const { app, loads } = appFailing(Infinity);
		const fetched = fetchModel(app, "/models/test-b.glb");
		const settled = expect(fetched).rejects.toThrow("offline");
		await vi.runAllTimersAsync();
		await settled;
		expect(loads()).toBe(3);
	});
});

describe("showing a deferred model", () => {
	afterEach(() => vi.useRealTimers());

	it("waits for its prewarm before it goes into the scene", async () => {
		const url = DEFERRED_MODELS[DEFERRED_MODELS.length - 1];
		let shown = false;
		void whenModelShowable(url).then(() => {
			shown = true;
		});
		await Promise.resolve();
		expect(shown).toBe(false);
		markModelShowable(url);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(shown).toBe(true);
		// Marked once, it stays showable.
		await expect(whenModelShowable(url)).resolves.toBeUndefined();
	});

	it("never waits for ever on a prewarm that can't run", async () => {
		vi.useFakeTimers();
		const url = DEFERRED_MODELS[DEFERRED_MODELS.length - 2];
		let shown = false;
		void whenModelShowable(url).then(() => {
			shown = true;
		});
		await vi.advanceTimersByTimeAsync(SHOWABLE_WAIT_MS - 1);
		expect(shown).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(shown).toBe(true);
	});

	it("doesn't hold back models that aren't deferred", async () => {
		await expect(whenModelShowable("/models/vehicles/orion-taxi.glb")).resolves.toBeUndefined();
	});
});
