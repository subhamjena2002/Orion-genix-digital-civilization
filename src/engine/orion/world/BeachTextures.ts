import type { GraphicsDevice, Texture } from "playcanvas";

import { makeCanvas, normalsFromHeight, rgb, seededRandom, textureFromCanvas, textureFromPixels } from "../rendering/CanvasTextures";

/** Metres per repeat of the sand texture. */
export const SAND_TILE_METRES = 6;
/** Metres per repeat of the foam along the shore. */
export const FOAM_TILE_METRES = 14;

/**
 * Beach sand: warm, fine grains of many shades, with the low ripples the wind leaves, in a
 * height map that becomes the normal map so the ripples catch a low sun.
 */
export function paintSand(device: GraphicsDevice): { diffuse: Texture; normal: Texture } {
	const size = 512;
	const colour = makeCanvas(size, size);
	const relief = makeCanvas(size, size);
	const random = seededRandom(5150);
	const image = colour.createImageData(size, size);
	const heights = relief.createImageData(size, size);
	// Ripples: a few crossing waves, bent by a slow wobble so they don't read as stripes.
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = (x / size) * Math.PI * 2;
			const v = (y / size) * Math.PI * 2;
			const ripple = Math.sin(v * 9 + Math.sin(u * 2) * 1.6 + Math.sin(u * 3 + v) * 0.6) * 0.6
				+ Math.sin(v * 14 + u * 3 + Math.sin(u * 5) * 0.8) * 0.25;
			const grain = random();
			const shade = 0.9 + grain * 0.16 + ripple * 0.035;
			// A few darker and lighter grains among the sand.
			const fleck = grain > 0.985 ? 0.75 : grain < 0.012 ? 1.12 : 1;
			const i = (y * size + x) * 4;
			image.data[i] = Math.min(255, 228 * shade * fleck);
			image.data[i + 1] = Math.min(255, 206 * shade * fleck);
			image.data[i + 2] = Math.min(255, 162 * shade * fleck);
			image.data[i + 3] = 255;
			const h = 128 + ripple * 60 + (grain - 0.5) * 30;
			heights.data[i] = h;
			heights.data[i + 1] = h;
			heights.data[i + 2] = h;
			heights.data[i + 3] = 255;
		}
	}
	colour.putImageData(image, 0, 0);
	relief.putImageData(heights, 0, 0);
	// Scattered shell bits and pebbles.
	for (let i = 0; i < 260; i++) {
		const tone = 150 + random() * 90;
		colour.fillStyle = rgb(tone, tone * 0.94, tone * 0.85);
		colour.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
	}
	const normals = normalsFromHeight(relief, 2.5);
	return {
		diffuse: textureFromCanvas(device, colour, { name: "sand", srgb: true }),
		normal: textureFromPixels(device, normals.width, normals.height, normals.pixels, { name: "sand-normal", srgb: false }),
	};
}

/**
 * Surf foam: lacy white patches, thickest at the beach edge of the strip (v = 0) and breaking
 * up towards the sea (v = 1). Alpha carries the shape.
 */
export function paintFoam(device: GraphicsDevice): Texture {
	const width = 512;
	const height = 128;
	const context = makeCanvas(width, height);
	const random = seededRandom(3141);
	context.clearRect(0, 0, width, height);
	for (let i = 0; i < 900; i++) {
		const v = Math.pow(random(), 1.6);
		const x = random() * width;
		const y = v * height;
		const r = (1 - v) * 9 + 2 + random() * 5;
		const alpha = (1 - v) * 0.5 + 0.1;
		for (const dx of [-width, 0, width]) {
			const gradient = context.createRadialGradient(x + dx, y, 0, x + dx, y, r);
			gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
			gradient.addColorStop(1, "rgba(255,255,255,0)");
			context.fillStyle = gradient;
			context.fillRect(x + dx - r, y - r, r * 2, r * 2);
		}
	}
	// The unbroken wash line along the sand.
	const wash = context.createLinearGradient(0, 0, 0, height * 0.25);
	wash.addColorStop(0, "rgba(255,255,255,0.75)");
	wash.addColorStop(1, "rgba(255,255,255,0)");
	context.fillStyle = wash;
	context.fillRect(0, 0, width, height * 0.25);
	return textureFromCanvas(device, context, { name: "surf-foam", srgb: true, anisotropy: 4 });
}
