/// <reference lib="webworker" />
import { visibleTriangles, type VisibilityInput } from "./HiddenSurface";
import { simplifyLevels, type SimplifyInput, type SimplifyLevel } from "./Simplify";

type Request =
	| { id: number; kind: "simplify"; inputs: SimplifyInput[]; levels: SimplifyLevel[] }
	| { id: number; kind: "visibility"; inputs: VisibilityInput[] };

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Mesh processing for LOD building — hidden-surface removal and simplification of a detailed car
 * take a few hundred milliseconds, so they run off the main thread.
 */
scope.onmessage = async (event: MessageEvent<Request>) => {
	const request = event.data;
	try {
		if (request.kind === "visibility") {
			const result = visibleTriangles(request.inputs);
			scope.postMessage({ id: request.id, result }, result ? result.map((flags) => flags.buffer as ArrayBuffer) : []);
			return;
		}
		const result = await simplifyLevels(request.inputs, request.levels);
		scope.postMessage({ id: request.id, result }, result.flatMap((level) => level.map((indices) => indices.buffer as ArrayBuffer)));
	} catch (error) {
		scope.postMessage({ id: request.id, error: String(error) });
	}
};
