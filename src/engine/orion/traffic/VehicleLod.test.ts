import { SEMANTIC_POSITION, TYPE_FLOAT32 } from "playcanvas";
import { describe, expect, it } from "vitest";

import { compactGeometry, type MergedGeometry } from "../rendering/MeshMerge";
import { keptValues } from "./VehicleLod";

describe("a paint's LOD3 body, recoloured from the shared one", () => {
	it("knows each kept vertex's group, in the order compaction numbers the vertices", () => {
		// Six vertices, the x of each its own number; a simplified index list using four of them,
		// out of order and with repeats.
		const geometry: MergedGeometry = {
			streams: [{ semantic: SEMANTIC_POSITION, components: 3, dataType: TYPE_FLOAT32, normalize: false, data: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0]) }],
			indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
			vertexCount: 6,
		};
		const indices = new Uint32Array([4, 1, 5, 1, 4, 2]);
		const groupOf = new Uint16Array([7, 8, 9, 10, 11, 12]);
		const compact = compactGeometry(geometry, indices);
		const kept = keptValues(groupOf, indices);
		expect(kept.length).toBe(compact.vertexCount);
		// Vertex k of the compacted mesh came from source vertex x = its position's x.
		const positions = compact.streams[0].data;
		for (let k = 0; k < compact.vertexCount; k++) expect(kept[k]).toBe(groupOf[positions[k * 3]]);
	});
});
