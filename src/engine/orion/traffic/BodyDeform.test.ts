import { describe, expect, it } from "vitest";

import { applyDent, applySag, refreshNormals, type Sag } from "./BodyDeform";

/** A flat grid of vertices in the XY plane (a door skin facing +Z), `n` x `n`, 2 m square. */
function panel(n = 21): { positions: Float32Array; normals: Float32Array; indices: number[] } {
	const positions = new Float32Array(n * n * 3);
	const normals = new Float32Array(n * n * 3);
	const indices: number[] = [];
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const i = y * n + x;
			positions.set([(x / (n - 1)) * 2 - 1, (y / (n - 1)) * 2 - 1, 0], i * 3);
			normals.set([0, 0, 1], i * 3);
			if (x < n - 1 && y < n - 1) indices.push(i, i + 1, i + n + 1, i, i + n + 1, i + n);
		}
	}
	return { positions, normals, indices };
}

describe("applyDent", () => {
	it("pushes the skin in most at the point of contact, fading to nothing at the rim", () => {
		const { positions } = panel();
		const rest = positions.slice();
		applyDent(positions, rest, { point: [0, 0, 0], direction: [0, 0, -1], depth: 0.2, radius: 0.8, crumple: 0, wavelength: 0.4, seed: 1 }, 1);
		const centre = 10 * 21 + 10;
		expect(positions[centre * 3 + 2]).toBeCloseTo(-0.2);
		// Outside the radius, untouched.
		expect(positions[2]).toBe(0);
		// Halfway out, partly in.
		const half = 10 * 21 + 14;
		expect(positions[half * 3 + 2]).toBeLessThan(0);
		expect(positions[half * 3 + 2]).toBeGreaterThan(-0.2);
	});

	it("caves in no further than the limit however often it's hit", () => {
		const { positions } = panel();
		const rest = positions.slice();
		for (let i = 0; i < 20; i++) applyDent(positions, rest, { point: [0, 0, 0], direction: [0, 0, -1], depth: 0.2, radius: 0.8, crumple: 0.8, wavelength: 0.4, seed: i }, 0.35);
		for (let i = 0; i < positions.length; i += 3) {
			expect(Math.hypot(positions[i] - rest[i], positions[i + 1] - rest[i + 1], positions[i + 2] - rest[i + 2])).toBeLessThanOrEqual(0.35 + 1e-6);
		}
	});

	it("crumples unevenly when the hit is ragged", () => {
		const { positions } = panel();
		const rest = positions.slice();
		applyDent(positions, rest, { point: [0, 0, 0], direction: [0, 0, -1], depth: 0.2, radius: 0.8, crumple: 1, wavelength: 0.4, seed: 7 }, 1);
		const depths = new Set<string>();
		for (let i = 0; i < positions.length; i += 3) if (positions[i + 2] < -0.05) depths.add(positions[i + 2].toFixed(3));
		expect(depths.size).toBeGreaterThan(10);
	});
});

describe("refreshNormals", () => {
	it("tilts the normals in a dent and leaves the rest alone", () => {
		const { positions, normals, indices } = panel();
		const rest = positions.slice();
		const moved = applyDent(positions, rest, { point: [0, 0, 0], direction: [0, 0, -1], depth: 0.3, radius: 0.8, crumple: 0, wavelength: 0.4, seed: 1 }, 1);
		refreshNormals(positions, normals, indices, moved);
		const slope = 10 * 21 + 14;
		expect(Math.abs(normals[slope * 3])).toBeGreaterThan(0.05);
		expect(normals[slope * 3 + 2]).toBeGreaterThan(0);
		expect(normals[2]).toBe(1);
		for (let i = 0; i < normals.length; i += 3) expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 4);
	});
});

describe("applySag", () => {
	/** A box of points: 4 m long along +Z, 1.5 m tall along +Y, 2 m wide along X. */
	function body(): Float32Array {
		const points: number[] = [];
		for (let z = -2; z <= 2.001; z += 0.25) for (let y = 0; y <= 1.5001; y += 0.25) for (let x = -1; x <= 1.001; x += 0.5) points.push(x, y, z);
		return new Float32Array(points);
	}

	const sag = (hitAcross: number): Sag => ({
		forward: [0, 0, 1], up: [0, 1, 0], side: [1, 0, 0], end: 1, hitAcross,
		drop: 0.25, reach: 0.6, band: 0.5,
		alongRange: [-2, 2], upRange: [0, 1.5], acrossRange: [-1, 1],
	});

	it("drops the low front band, lowest at the very end and on the side that was hit", () => {
		const positions = body();
		const rest = positions.slice();
		applySag(positions, rest, sag(1), 1);
		const dropAt = (x: number, y: number, z: number) => {
			for (let i = 0; i < rest.length; i += 3) {
				if (Math.abs(rest[i] - x) < 1e-3 && Math.abs(rest[i + 1] - y) < 1e-3 && Math.abs(rest[i + 2] - z) < 1e-3) return rest[i + 1] - positions[i + 1];
			}
			throw new Error("no such point");
		};
		expect(dropAt(1, 0, 2)).toBeGreaterThan(0.15);
		expect(dropAt(1, 0, 2)).toBeGreaterThan(dropAt(-1, 0, 2));
		expect(dropAt(1, 0, 2)).toBeGreaterThan(dropAt(1, 0, 1.75));
		// Above the band, and further back than its reach, nothing moves.
		expect(dropAt(1, 1, 2)).toBe(0);
		expect(dropAt(1, 0, 1)).toBe(0);
		expect(dropAt(1, 0, -2)).toBe(0);
	});
});
