import type { GraphicsDevice, Texture } from "playcanvas";

import { addGrain, makeCanvas, normalsFromHeight, rgb, seededRandom, textureFromCanvas, textureFromPixels } from "../rendering/CanvasTextures";

/** Metres covered by one repeat of the paving texture: two slabs each way. */
export const PAVING_TILE_METRES = 2;

/**
 * Pavement: pale concrete slabs a metre square, each a shade apart, with dark joints and the odd
 * stain. The photographed paving it replaces was warm orange stone, which read as a garden path
 * rather than a city pavement.
 */
export function paintPaving(device: GraphicsDevice): { diffuse: Texture; normal: Texture } {
	const size = 256;
	const slab = size / PAVING_TILE_METRES;
	const colour = makeCanvas(size, size);
	const relief = makeCanvas(size, size);
	const random = seededRandom(777);
	relief.fillStyle = "#808080";
	relief.fillRect(0, 0, size, size);
	for (let y = 0; y < size; y += slab) {
		for (let x = 0; x < size; x += slab) {
			const tone = 0.9 + random() * 0.12;
			colour.fillStyle = rgb(196 * tone, 192 * tone, 184 * tone);
			colour.fillRect(x, y, slab, slab);
			// Bevelled edges round each slab, then the joint.
			colour.fillStyle = "rgba(255,255,255,0.10)";
			colour.fillRect(x + 2, y + 2, slab - 4, 2);
			colour.fillStyle = "rgba(0,0,0,0.10)";
			colour.fillRect(x + 2, y + slab - 4, slab - 4, 2);
			colour.fillStyle = "#5d5a55";
			colour.fillRect(x, y, slab, 2);
			colour.fillRect(x, y, 2, slab);
			relief.fillStyle = "#202020";
			relief.fillRect(x, y, slab, 2);
			relief.fillRect(x, y, 2, slab);
		}
	}
	addGrain(colour, 16, random, 14);
	for (let i = 0; i < 5; i++) {
		colour.fillStyle = "rgba(50,45,40,0.12)";
		colour.beginPath();
		colour.ellipse(random() * size, random() * size, 4 + random() * 10, 3 + random() * 8, random() * 3, 0, Math.PI * 2);
		colour.fill();
	}
	const normals = normalsFromHeight(relief, 3);
	return {
		diffuse: textureFromCanvas(device, colour, { name: "paving", srgb: true }),
		normal: textureFromPixels(device, normals.width, normals.height, normals.pixels, { name: "paving-normal", srgb: false }),
	};
}
