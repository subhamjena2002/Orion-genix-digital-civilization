import { fetchAsset } from "@playcanvas/react/utils";
import type { AppBase, Asset, Entity } from "playcanvas";

import { GUNSHIP_MODEL } from "../aircraft/GunshipModel";
import { JET_MODEL } from "../aircraft/JetModel";
import { VEHICLE_MODEL_BASE, VEHICLE_MODELS } from "../traffic/VehicleModels";
import { AIRFIELD_BOUNDS } from "../world/Airfield";
import { BASE } from "../world/MilitaryBase";
import { SAFEHOUSE_MODEL, SAFEHOUSE_SITE } from "../world/Safehouse";
import { prewarmModels } from "./ModelPrewarm";

/**
 * The big set-piece models nobody needs in the first seconds of play, fetched after the loading
 * screen has gone rather than before it.
 *
 * Together they were over half of what the game downloaded before "Ready" (about 64 MB of the
 * 122 MB measured): the train, and the army base's kit, gunship and jets — 250 m and more from
 * the spawn, past the distance their models are drawn at. Each one already copes with its model
 * arriving late: the base builds its compound when the kit comes in, the aircraft find their
 * moving parts on first use, and the train starts running once it has a body to show.
 *
 * Once the game is showing they load one at a time, in this order, and each is drawn once out of
 * sight (as ModelPrewarm does for the rest) so its first real appearance doesn't stall on shader
 * compiles. Coming near the base or the airfield first jumps the queue (see `requestDeferredModel`).
 */

export const TRAIN_MODEL = "/models/rail/metro-train.glb";
export const MILITARY_KIT_MODEL = "/models/military/military-base-kit.glb";

/**
 * Deferred models the scene only ever draws inside a static batch, so their prewarm builds the
 * batched shaders (ModelPrewarm `batched`): the kit, which MilitaryBase lays as one batch group.
 */
export const STATIC_BATCHED_MODELS: ReadonlySet<string> = new Set([MILITARY_KIT_MODEL]);

/** Vehicle models marked `deferred` (fire engines, mission cars): small, so first in line. */
const DEFERRED_VEHICLES = [...new Set(VEHICLE_MODELS.filter((spec) => spec.deferred).map((spec) => `${VEHICLE_MODEL_BASE}/${spec.file}`))];

/**
 * Load order: the few small vehicles a mission or a fire can call for at any moment, then the
 * kit (in sight of the spawn; its walls are drawn from 300 m, and stand-ins hold the perimeter
 * until it arrives), the safehouse villa (solid before it's drawn: see components/world/
 * Safehouse), then the train and the aircraft.
 */
export const DEFERRED_MODELS: readonly string[] = [...DEFERRED_VEHICLES, MILITARY_KIT_MODEL, SAFEHOUSE_MODEL, TRAIN_MODEL, GUNSHIP_MODEL, JET_MODEL];

/**
 * The army base and the airfield beside it. Coming within `reach` of either (once the game is up)
 * fetches their models at once. The kit is drawn from 300 m and the aircraft from 280 m, and a car
 * covers the 200 m in about ten seconds.
 */
export const ARMY_BASE_AREA = {
	minX: Math.min(BASE.centre[0] - BASE.size[0] / 2, AIRFIELD_BOUNDS.minX),
	maxX: Math.max(BASE.centre[0] + BASE.size[0] / 2, AIRFIELD_BOUNDS.maxX),
	minZ: Math.min(BASE.centre[1] - BASE.size[1] / 2, AIRFIELD_BOUNDS.minZ),
	maxZ: Math.max(BASE.centre[1] + BASE.size[1] / 2, AIRFIELD_BOUNDS.maxZ),
	reach: 200,
} as const;

/** The safehouse's lot: coming within `reach` fetches the villa at once (it's drawn from 420 m). */
export const SAFEHOUSE_AREA = {
	minX: SAFEHOUSE_SITE.x - 25,
	maxX: SAFEHOUSE_SITE.x + 25,
	minZ: SAFEHOUSE_SITE.z - 25,
	maxZ: SAFEHOUSE_SITE.z + 25,
	reach: 450,
} as const;

/** Tries per model, and the wait before trying a failed one again. */
const ATTEMPTS = 3;
const RETRY_MS = 8_000;

const released = new Set<string>();
let started = false;
const listeners = new Set<(url: string) => void>();

/** How the after-Ready loading is going: models arrived, and those given up on. */
export interface DeferredProgress {
	total: number;
	loaded: number;
	failed: number;
}
const progress: DeferredProgress = { total: DEFERRED_MODELS.length, loaded: 0, failed: 0 };
const progressListeners = new Set<() => void>();

export function deferredProgress(): Readonly<DeferredProgress> {
	return progress;
}

/** Calls `listener` each time a deferred model arrives or is given up on; returns the unsubscribe. */
export function onDeferredProgress(listener: () => void): () => void {
	progressListeners.add(listener);
	return () => progressListeners.delete(listener);
}

const settled = new Set<string>();

function settle(url: string, outcome: "loaded" | "failed") {
	// Each model once, however many times the queue is started.
	if (settled.has(url)) return;
	settled.add(url);
	progress[outcome]++;
	for (const listener of progressListeners) listener();
}

export function isDeferredModel(url: string): boolean {
	return DEFERRED_MODELS.includes(url);
}

/** Whether the game is up and the deferred models have begun to load. */
export function deferredLoadingStarted(): boolean {
	return started;
}

const startWaiters: (() => void)[] = [];

/**
 * Resolves once the loading screen has gone (when the deferred models start). For loaders of
 * their own with a stand-in to show meanwhile — weapon models (WeaponModels) — that would only
 * compete with the files the game needs to start.
 */
export function afterLoadingScreen(): Promise<void> {
	if (started) return Promise.resolve();
	return new Promise((resolve) => startWaiters.push(resolve));
}

/**
 * Longest a deferred model's scene copy waits on its prewarm (`whenModelShowable`): a hidden tab
 * draws no frames, so the prewarm can stall, and a model must never stay missing for that.
 */
export const SHOWABLE_WAIT_MS = 20_000;

const showable = new Map<string, { promise: Promise<void>; resolve: () => void }>();

function showableEntry(url: string) {
	let entry = showable.get(url);
	if (!entry) {
		let resolve!: () => void;
		const promise = new Promise<void>((done) => {
			resolve = done;
		});
		entry = { promise, resolve };
		showable.set(url, entry);
	}
	return entry;
}

/**
 * Resolves once a deferred model can be put in the scene without stalling the game: its prewarm
 * has built every shader it draws with (see ModelPrewarm `gradual`), or `SHOWABLE_WAIT_MS` has
 * passed. Any model that isn't deferred is showable at once.
 */
export function whenModelShowable(url: string): Promise<void> {
	if (!isDeferredModel(url)) return Promise.resolve();
	const entry = showableEntry(url);
	return Promise.race([entry.promise, new Promise<void>((resolve) => setTimeout(resolve, SHOWABLE_WAIT_MS))]);
}

/** The prewarm is finished with `url` (drawn, failed, or cancelled). */
export function markModelShowable(url: string): void {
	showableEntry(url).resolve();
}

/** Whether `url` may be fetched now: any model that isn't deferred always may. */
export function isModelReleased(url: string): boolean {
	return !isDeferredModel(url) || released.has(url);
}

/** Lets a deferred model load now; whoever is waiting on it (`onModelReleased`) starts its fetch. */
export function requestDeferredModel(url: string) {
	if (isModelReleased(url)) return;
	released.add(url);
	for (const listener of listeners) listener(url);
}

export function onModelReleased(listener: (url: string) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Fetches a model the way `useModel` does (same registry key, so both share the one download),
 * trying again a couple of times if it fails. Rejects once out of tries; the scene then goes on
 * without that model, as it would have before.
 */
export async function fetchModel(app: AppBase, url: string): Promise<Asset> {
	let lastError: unknown = null;
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		if (attempt > 0) {
			await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
			// A failed download leaves the asset marked loaded with no resource, and the registry
			// won't fetch a loaded asset again: without this the retry would wait for ever. The key
			// is the one fetchAsset gives it (the url, then its props as JSON).
			const failed = app.assets.find(`${url}{}`, "container");
			if (failed && !failed.resource && !failed.loading) failed.loaded = false;
		}
		try {
			return await fetchAsset({ app: app as Parameters<typeof fetchAsset>[0]["app"], url, type: "container" });
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError ?? new Error(`Failed to load ${url}`);
}

/**
 * Releases the deferred models one after another once the game is up, drawing each at the camera
 * for a few frames as it arrives. Returns a cancel for when the camera goes away.
 *
 * The downloads run as a chain of their own rather than inside the prewarm: that waits on rendered
 * frames, which a hidden tab doesn't produce, and the next download shouldn't wait on them too.
 */
export function loadDeferredModels(app: AppBase, camera: Entity): () => void {
	started = true;
	for (const resolve of startWaiters.splice(0)) resolve();
	let cancelled = false;
	const fetches = new Map<string, Promise<Asset>>();
	let previous: Promise<unknown> = Promise.resolve();
	for (const url of DEFERRED_MODELS) {
		const fetched = previous.then(() => {
			if (cancelled) throw new Error("cancelled");
			requestDeferredModel(url);
			return fetchModel(app, url).then(
				(asset) => {
					settle(url, "loaded");
					return asset;
				},
				(error: unknown) => {
					settle(url, "failed");
					throw error;
				},
			);
		});
		// One that fails doesn't hold up the rest.
		previous = fetched.catch(() => undefined);
		fetches.set(url, fetched);
	}
	const cancelPrewarm = prewarmModels(app, camera, DEFERRED_MODELS, {
		load: (url) => fetches.get(url) ?? fetchModel(app, url),
		gradual: true,
		onDone: markModelShowable,
		batched: (url) => STATIC_BATCHED_MODELS.has(url),
	});
	return () => {
		cancelled = true;
		cancelPrewarm();
	};
}
