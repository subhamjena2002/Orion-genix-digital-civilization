import { describe, expect, it } from "vitest";

import { generateNoiseTexture } from "./NoiseTexture";

const SIZE = 64;

function channel(pixels: Uint8Array, x: number, y: number, c: number): number {
	return pixels[(y * SIZE + x) * 4 + c];
}

describe("generateNoiseTexture", () => {
	const pixels = generateNoiseTexture(SIZE, 7);

	it("fills an RGBA image of the requested size", () => {
		expect(pixels.length).toBe(SIZE * SIZE * 4);
	});

	it("is the same for the same seed and different for another", () => {
		expect(generateNoiseTexture(SIZE, 7)).toEqual(pixels);
		expect(generateNoiseTexture(SIZE, 8)).not.toEqual(pixels);
	});

	it("uses the full range in every channel, so the shaders get consistent contrast", () => {
		for (let c = 0; c < 4; c++) {
			let min = 255;
			let max = 0;
			for (let i = c; i < pixels.length; i += 4) {
				min = Math.min(min, pixels[i]);
				max = Math.max(max, pixels[i]);
			}
			expect(min).toBe(0);
			expect(max).toBe(255);
		}
	});

	it("tiles seamlessly: the jump across each edge is no bigger than between neighbours", () => {
		for (let c = 0; c < 4; c++) {
			let inside = 0;
			let across = 0;
			for (let i = 0; i < SIZE; i++) {
				inside += Math.abs(channel(pixels, SIZE - 2, i, c) - channel(pixels, SIZE - 1, i, c));
				across += Math.abs(channel(pixels, SIZE - 1, i, c) - channel(pixels, 0, i, c));
				inside += Math.abs(channel(pixels, i, SIZE - 2, c) - channel(pixels, i, SIZE - 1, c));
				across += Math.abs(channel(pixels, i, SIZE - 1, c) - channel(pixels, i, 0, c));
			}
			expect(across).toBeLessThan(inside * 2 + SIZE);
		}
	});

	it("is smooth: neighbouring texels differ far less than random noise would", () => {
		let difference = 0;
		for (let y = 0; y < SIZE; y++) {
			for (let x = 0; x < SIZE - 1; x++) difference += Math.abs(channel(pixels, x, y, 0) - channel(pixels, x + 1, y, 0));
		}
		const average = difference / (SIZE * (SIZE - 1));
		// Uniform random bytes differ by ~85 on average.
		expect(average).toBeLessThan(20);
	});
});
