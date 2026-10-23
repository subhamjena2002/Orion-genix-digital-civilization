"use client";

import { useSyncExternalStore } from "react";

import { gameResources, onResourcesCounted } from "@/engine/orion/loading/GameResources";
import { formatMegabytes } from "@/engine/orion/loading/ResourceLedger";
import { deferredProgress, onDeferredProgress } from "@/engine/orion/rendering/DeferredModels";

/**
 * A quiet line while the parts of the world left until after the loading screen (DeferredModels)
 * are still coming: how many of them are in, and what has been downloaded in the background so far.
 * Gone once they all are. Updated only as files arrive — nothing here runs per frame.
 */

const subscribe = (changed: () => void) => {
	const stopModels = onDeferredProgress(changed);
	const stopFiles = onResourcesCounted(changed);
	return () => {
		stopModels();
		stopFiles();
	};
};

const snapshot = () => {
	const progress = deferredProgress();
	const bytes = gameResources()?.background.bytes ?? 0;
	return `${progress.loaded}|${progress.failed}|${progress.total}|${bytes}`;
};

export function BackgroundLoadStatus() {
	const state = useSyncExternalStore(subscribe, snapshot, () => "");
	if (!state) return null;
	const [loaded, failed, total, bytes] = state.split("|").map(Number);
	if (loaded + failed >= total) return null;
	return (
		<p className="orion-background-loading" role="status">
			Loading more of the world: {loaded} of {total} · {formatMegabytes(bytes)} in the background
		</p>
	);
}
