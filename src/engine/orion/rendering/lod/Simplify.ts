import { MeshoptSimplifier } from "meshoptimizer";

/** One mesh to simplify: positions (xyz, tightly packed) and triangle indices. */
export interface SimplifyInput {
	positions: Float32Array;
	indices: Uint32Array;
	/**
	 * Per-vertex values the surface should keep (tightly packed, `attributeWeights.length` per
	 * vertex), each weighted against geometric error. Without them a collapse is judged on shape
	 * alone, and a flat panel whose colour varies (baked occlusion, a trim's colour) loses that
	 * variation first. Ignored by sloppy levels.
	 */
	attributes?: Float32Array;
	attributeWeights?: readonly number[];
}

export interface SimplifyLevel {
	/** Largest geometric deviation allowed, in the positions' own units. */
	error: number;
	/** Drop small disconnected pieces (bolts, badges) whose loss is within the error. */
	prune: boolean;
	/**
	 * Keep open edges exactly where they are. Needed where separately simplified pieces must
	 * meet without a gap; unlocked, an edge can still only move within `error`.
	 */
	lockBorder: boolean;
	/**
	 * Ignore topology and cluster vertices on a grid instead. Far cruder up close, but it can
	 * collapse interiors and hard-edged panels that topology-preserving collapse can't touch —
	 * right for a car a few dozen pixels tall. Pieces left with fewer than `minTriangles` go.
	 */
	sloppy?: boolean;
	/** Pieces simplified below this many triangles are dropped (a speck, and a draw call). */
	minTriangles?: number;
}

/**
 * Error-bounded simplification with meshoptimizer: edges collapse until the next collapse
 * would move the surface further than `error`. Open borders (where one material meets another,
 * or a panel's edge) can be locked so separately simplified parts still meet without cracks;
 * attribute seams are respected, so UVs and hard edges survive.
 *
 * Returns, per level, the simplified index list for each input (empty if the piece was pruned).
 */
export async function simplifyLevels(inputs: readonly SimplifyInput[], levels: readonly SimplifyLevel[]): Promise<Uint32Array[][]> {
	await MeshoptSimplifier.ready;
	return levels.map((level) => inputs.map((input) => simplifyOne(input, level)));
}

/**
 * The ArrayBuffers behind a worker reply, each once: postMessage refuses a transfer list that
 * names a buffer twice (a mesh too small to simplify returns its own indices at every level). Run
 * in the worker, a refused reply sent every LOD job back to the main thread to be simplified
 * again there — 100–160 ms each (measured, Phase 2.3).
 */
export function transferList(arrays: readonly ArrayBufferView[]): ArrayBuffer[] {
	const buffers = new Set<ArrayBuffer>();
	for (const array of arrays) if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
	return [...buffers];
}

function simplifyOne(input: SimplifyInput, level: SimplifyLevel): Uint32Array {
	if (input.indices.length < 3) return input.indices;
	let indices: Uint32Array;
	if (level.sloppy) {
		// The sloppy simplifier takes its error relative to the mesh's size.
		const relative = level.error / Math.max(MeshoptSimplifier.getScale(input.positions, 3), 1e-9);
		[indices] = MeshoptSimplifier.simplifySloppy(input.indices, input.positions, 3, null, 0, relative);
	} else {
		const flags: ("LockBorder" | "ErrorAbsolute" | "Prune")[] = ["ErrorAbsolute"];
		if (level.lockBorder) flags.push("LockBorder");
		if (level.prune) flags.push("Prune");
		// No triangle target: the error bound alone decides where to stop.
		const weights = input.attributeWeights;
		[indices] = input.attributes && weights && weights.length > 0
			? MeshoptSimplifier.simplifyWithAttributes(input.indices, input.positions, 3, input.attributes, weights.length, [...weights], null, 0, level.error, flags)
			: MeshoptSimplifier.simplify(input.indices, input.positions, 3, 0, level.error, flags);
	}
	// A fresh empty list each time, never one shared: a reply transfers its buffers, and a shared
	// one would be gone (detached) for every reply after the first.
	return indices.length / 3 < (level.minTriangles ?? 1) ? new Uint32Array(0) : indices;
}
