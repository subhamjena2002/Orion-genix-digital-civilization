import { describe, expect, it } from "vitest";

import { simplifyLevels, transferList, type SimplifyInput, type SimplifyLevel } from "./Simplify";

/** A flat grid of quads: something meshoptimizer can actually simplify. */
function grid(size: number): SimplifyInput {
	const positions: number[] = [];
	for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++) positions.push(x, 0, z);
	const indices: number[] = [];
	for (let z = 0; z < size; z++) {
		for (let x = 0; x < size; x++) {
			const a = z * (size + 1) + x;
			indices.push(a, a + size + 1, a + 1, a + 1, a + size + 1, a + size + 2);
		}
	}
	return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Too small to simplify: returned as it is, at every level. */
const tiny: SimplifyInput = { positions: new Float32Array([0, 0, 0, 1, 0, 0]), indices: new Uint32Array([0, 1]) };

const levels: SimplifyLevel[] = [
	{ error: 0.01, prune: false, lockBorder: true },
	// Prunes everything: every piece comes back empty.
	{ error: 0.01, prune: true, lockBorder: false, minTriangles: 1e9 },
];

/** What postMessage checks: the reply and its transfer list must clone. */
const send = (result: Uint32Array[][]) => structuredClone(result, { transfer: transferList(result.flat()) });

describe("worker replies for LOD simplification", () => {
	it("transfer each buffer once, even when a mesh is returned at several levels", async () => {
		const result = await simplifyLevels([grid(8), tiny, grid(4)], levels);
		// The tiny mesh is the same array at both levels: a naive transfer list names it twice.
		expect(result[0][1]).toBe(result[1][1]);
		const naive = result.flat().map((indices) => indices.buffer as ArrayBuffer);
		expect(() => structuredClone(result, { transfer: naive })).toThrow();
		expect(() => send(result)).not.toThrow();
	});

	it("can send reply after reply: no empty result is shared between them", async () => {
		const first = await simplifyLevels([grid(4), grid(6)], levels);
		send(first);
		const second = await simplifyLevels([grid(4), grid(6)], levels);
		expect(() => send(second)).not.toThrow();
		// And the second reply's empties are real, usable arrays.
		expect(second[1].every((indices) => indices.length === 0 && indices.buffer.byteLength === 0)).toBe(true);
	});

	it("still simplifies: the coarser level never has more triangles than the source", async () => {
		const source = grid(8);
		const [[simplified]] = await simplifyLevels([source], [levels[0]]);
		expect(simplified.length).toBeGreaterThan(0);
		expect(simplified.length).toBeLessThanOrEqual(source.indices.length);
		expect(simplified.length % 3).toBe(0);
	});

	it("lists each buffer once", () => {
		const shared = new Uint32Array(6);
		const other = new Uint32Array(3);
		expect(transferList([shared, shared.subarray(0, 3), other])).toEqual([shared.buffer, other.buffer]);
		expect(transferList([])).toEqual([]);
	});

	it("keeps the vertices that carry colour when given colours, and still simplifies flat colour", async () => {
		const size = 8;
		const source = grid(size);
		const vertices = source.positions.length / 3;
		// A dark stripe down the middle of a flat panel (like baked occlusion under a trim).
		const colours = new Float32Array(vertices * 3);
		for (let v = 0; v < vertices; v++) colours.fill(v % (size + 1) === size / 2 ? 0.1 : 0.9, v * 3, v * 3 + 3);
		const level: SimplifyLevel = { error: 0.01, prune: false, lockBorder: false };
		const [[[shapeOnly]], [[coloured]], [[plain]]] = await Promise.all([
			simplifyLevels([source], [level]),
			simplifyLevels([{ ...source, attributes: colours, attributeWeights: [0.5, 0.5, 0.5] }], [level]),
			simplifyLevels([{ ...source, attributes: new Float32Array(vertices * 3).fill(0.9), attributeWeights: [0.5, 0.5, 0.5] }], [level]),
		]);
		const darkUsed = (indices: Uint32Array) => new Set([...indices].filter((v) => v % (size + 1) === size / 2)).size;
		// On shape alone the flat panel collapses to its corners and the stripe is gone.
		expect(darkUsed(shapeOnly)).toBe(0);
		// With colours, the stripe keeps its vertices; with one colour everywhere it costs nothing.
		expect(darkUsed(coloured)).toBeGreaterThan(0);
		expect(coloured.length).toBeLessThan(source.indices.length);
		expect(plain.length).toBe(shapeOnly.length);
	});
});
