import type { VisibilityInput } from "./HiddenSurface";
import type { SimplifyInput, SimplifyLevel } from "./Simplify";

type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void };

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
	if (worker !== undefined) return worker;
	try {
		worker = new Worker(new URL("./Simplify.worker.ts", import.meta.url), { type: "module" });
		worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
			const job = pending.get(event.data.id);
			if (!job) return;
			pending.delete(event.data.id);
			if (event.data.error === undefined) job.resolve(event.data.result);
			else job.reject(new Error(event.data.error));
		};
		worker.onerror = () => {
			// A worker that can't start (blocked, or an old browser) falls back to the main thread.
			for (const job of pending.values()) job.reject(new Error("mesh worker failed"));
			pending.clear();
			worker?.terminate();
			worker = null;
		};
	} catch {
		worker = null;
	}
	return worker;
}

function run<T>(message: Record<string, unknown>): Promise<T> | null {
	const target = typeof Worker === "undefined" ? null : getWorker();
	if (!target) return null;
	return new Promise<T>((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
		target.postMessage({ ...message, id });
	});
}

/**
 * Simplifies meshes on a worker thread; falls back to the main thread where workers aren't
 * available. The input arrays are copied, so the caller keeps its geometry.
 */
export async function simplifyInBackground(inputs: readonly SimplifyInput[], levels: readonly SimplifyLevel[]): Promise<Uint32Array[][]> {
	const job = run<Uint32Array[][]>({ kind: "simplify", inputs, levels });
	if (job) {
		try {
			return await job;
		} catch {
			// Fall through to the main thread.
		}
	}
	const { simplifyLevels } = await import("./Simplify");
	return simplifyLevels(inputs, levels);
}

/**
 * Which triangles can be seen from outside (see HiddenSurface). Null when it can't be worked
 * out here — callers must then not rely on hidden geometry having been removed.
 */
export async function visibilityInBackground(inputs: readonly VisibilityInput[]): Promise<Uint8Array[] | null> {
	const job = run<Uint8Array[] | null>({ kind: "visibility", inputs });
	if (!job) return null;
	try {
		return await job;
	} catch {
		return null;
	}
}
