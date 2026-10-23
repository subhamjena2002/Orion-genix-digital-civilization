"use client";

import { useApp } from "@playcanvas/react/hooks";
import type { Asset } from "playcanvas";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { deferredLoadingStarted, fetchModel, isModelReleased, onModelReleased, requestDeferredModel, whenModelShowable } from "@/engine/orion/rendering/DeferredModels";

/** A patch of the map, in world x/z, and how close to it the player must come to need its models. */
export interface DeferredArea {
	readonly minX: number;
	readonly maxX: number;
	readonly minZ: number;
	readonly maxZ: number;
	readonly reach: number;
}

const PROXIMITY_SAMPLE_MS = 1000;

/**
 * `useModel` for one of the models that load after the loading screen (see DeferredModels): null
 * until that model's turn comes, it has arrived and its shaders are built (`whenModelShowable`). With an `area`, the player coming within reach
 * of it once the game is up fetches the model straight away rather than waiting its turn.
 *
 * Nothing is downloaded for it before it's released, so mounting this early costs nothing.
 */
export function useDeferredModel(url: string, area?: DeferredArea): Asset | null {
	const app = useApp();
	const subscribe = useCallback((changed: () => void) => onModelReleased((which) => {
		if (which === url) changed();
	}), [url]);
	const released = useSyncExternalStore(subscribe, () => isModelReleased(url), () => false);
	const [asset, setAsset] = useState<Asset | null>(null);

	useEffect(() => {
		if (released || !area) return;
		const id = window.setInterval(() => {
			if (!deferredLoadingStarted()) return;
			const pose = readPlayerPose();
			const dx = Math.max(area.minX - pose.x, 0, pose.x - area.maxX);
			const dz = Math.max(area.minZ - pose.z, 0, pose.z - area.maxZ);
			if (Math.hypot(dx, dz) <= area.reach) requestDeferredModel(url);
		}, PROXIMITY_SAMPLE_MS);
		return () => window.clearInterval(id);
	}, [url, area, released]);

	useEffect(() => {
		if (!app || !released) return;
		let live = true;
		fetchModel(app, url)
			// Not into the scene until its shaders are built: drawn whole the moment it arrived, the
			// army base's kit froze the game for ~3 s compiling them all in one frame.
			.then((loaded) => whenModelShowable(url).then(() => loaded))
			.then((loaded) => {
				if (live) setAsset(loaded);
			})
			.catch(() => {
				// Out of tries: the scene goes on without this model, as a missing model always has.
				console.warn(`[orion] ${url} could not be loaded; carrying on without it.`);
			});
		return () => {
			live = false;
		};
	}, [app, url, released]);

	return asset;
}
