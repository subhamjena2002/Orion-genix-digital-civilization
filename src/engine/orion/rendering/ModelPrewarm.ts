import { fetchAsset } from "@playcanvas/react/utils";
import type { AppBase, ContainerResource, Entity } from "playcanvas";

import { getBuildingDefinition, ORION_BUILDING_MAP } from "../buildings/Buildings";
import { VEHICLE_MODEL_BASE, VEHICLE_MODELS } from "../traffic/VehicleModels";

/**
 * Loads the city's models up front and draws each once, out of sight, so driving into a new
 * area doesn't stall.
 *
 * Models were fetched the first time a building or car of that kind came into range, and a
 * material's shaders compile the first time it's drawn (about 70 ms each here, blocking) — so
 * the first drive through a district froze for a quarter to over a second at a time. Doing it
 * while the game starts moves that cost to where nobody is driving yet.
 *
 * Fetched exactly as `useModel(url)` fetches (same asset key), so the scene reuses these loads
 * rather than repeating them.
 */

const TRAIN_MODEL = "/models/rail/metro-train.glb";
/** Frames each model stays drawn: its colour pass, shadow pass and post effects all compile. */
const DRAWN_FRAMES = 3;
/** In front of the lens, far too small to see. */
const SPECK_SCALE = 0.0005;

export function modelsToPrewarm(): string[] {
	const urls = new Set<string>();
	for (const placement of ORION_BUILDING_MAP) {
		if (placement.renderMode !== "asset") continue;
		const definition = getBuildingDefinition(placement.buildingDefinitionId);
		if (!definition) continue;
		urls.add(definition.assetPath);
		for (const prop of definition.yardProps) urls.add(prop.assetPath);
	}
	for (const spec of VEHICLE_MODELS) urls.add(`${VEHICLE_MODEL_BASE}/${spec.file}`);
	urls.add(TRAIN_MODEL);
	return [...urls];
}

/**
 * One model at a time, in the background: fetch, draw for a few frames at the camera, remove.
 * Returns a cancel for when the camera goes away.
 */
export function prewarmModels(app: AppBase, camera: Entity, urls: readonly string[]): () => void {
	let cancelled = false;
	let current: Entity | null = null;

	const waitFrames = (count: number) => new Promise<void>((resolve) => {
		let left = count;
		const onFrame = () => {
			if (--left > 0 && !cancelled) return;
			app.off("frameend", onFrame);
			resolve();
		};
		app.on("frameend", onFrame);
	});

	const run = async () => {
		for (const url of urls) {
			if (cancelled) return;
			try {
				// fetchAsset only uses the asset registry, which every AppBase has.
				const asset = await fetchAsset({ app: app as Parameters<typeof fetchAsset>[0]["app"], url, type: "container" });
				if (cancelled) return;
				const resource = asset.resource as ContainerResource | undefined;
				if (!resource?.instantiateRenderEntity) continue;
				current = resource.instantiateRenderEntity();
				camera.addChild(current);
				current.setLocalPosition(0, 0, -1.5);
				current.setLocalScale(SPECK_SCALE, SPECK_SCALE, SPECK_SCALE);
				await waitFrames(DRAWN_FRAMES);
			} catch {
				// A model that fails here fails in the scene too, where it's already handled.
			} finally {
				current?.destroy();
				current = null;
			}
		}
	};
	void run();

	return () => {
		cancelled = true;
		current?.destroy();
		current = null;
	};
}
