import { isDeferredModel } from "../rendering/DeferredModels";
import { ResourceLedger, type InitialPayload, type ResourceRecord } from "./ResourceLedger";

/**
 * The game's one ResourceLedger, fed by a PerformanceObserver: the browser hands over each file
 * as it finishes, so nothing here polls. Started when the game mounts; `initialPayload()` is what
 * a platform SDK can be told about the first load once the game is playable.
 */

let ledger: ResourceLedger | null = null;
const listeners = new Set<() => void>();

/** Generous: the game requests a few hundred files, and an entry dropped is a file not counted. */
const TIMING_BUFFER = 2000;

export function startResourceTracking(): ResourceLedger | null {
	if (ledger) return ledger;
	if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return null;
	const tracked = new ResourceLedger(window.location.origin, isDeferredModel);
	ledger = tracked;
	try {
		performance.setResourceTimingBufferSize(TIMING_BUFFER);
	} catch {
		// Older browsers: the observer below still sees every entry.
	}
	const take = (entries: readonly PerformanceEntry[]) => {
		let changed = false;
		for (const entry of entries) changed = tracked.record(toRecord(entry as PerformanceResourceTiming)) || changed;
		if (changed) for (const listener of listeners) listener();
	};
	// The page itself, then every file, including those finished before this ran (buffered).
	take(performance.getEntriesByType("navigation"));
	try {
		new PerformanceObserver((list) => take(list.getEntries())).observe({ type: "resource", buffered: true });
	} catch {
		take(performance.getEntriesByType("resource"));
	}
	return tracked;
}

export function gameResources(): ResourceLedger | null {
	return ledger;
}

/** Calls `listener` when newly finished files have been counted; returns the unsubscribe. */
export function onResourcesCounted(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The game has become playable: fixes when the initial payload is measured. */
export function markGameReady(): void {
	ledger?.markReady(performance.now());
}

/** What had downloaded when the game became playable (null before then). */
export function initialPayload(): InitialPayload | null {
	return ledger?.initialPayload ?? null;
}

function toRecord(entry: PerformanceResourceTiming): ResourceRecord {
	return {
		name: entry.name,
		startTime: entry.startTime,
		responseEnd: entry.responseEnd,
		encodedBodySize: entry.encodedBodySize,
		transferSize: entry.transferSize,
		responseStatus: (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus,
	};
}
