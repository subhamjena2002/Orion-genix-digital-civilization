import {
	ADDRESS_REPEAT,
	FILTER_LINEAR,
	FILTER_LINEAR_MIPMAP_LINEAR,
	PIXELFORMAT_RGBA8,
	PIXELFORMAT_SRGBA8,
	Texture,
	type GraphicsDevice,
} from "playcanvas";

/**
 * Helpers for textures painted in code at startup (building facades, palm fronds): a 2D canvas to
 * paint on, a deterministic random source so the city looks the same every visit, and the step
 * from a painted height map to a normal map.
 */

export type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function makeCanvas(width: number, height: number): Canvas2D {
	if (typeof OffscreenCanvas !== "undefined") {
		const context = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
		if (context) return context;
	}
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("2D canvas unavailable");
	return context;
}

/** Park–Miller: tiny, fast and the same sequence everywhere for a given seed. */
export function seededRandom(seed: number): () => number {
	let state = Math.abs(Math.floor(seed)) % 2147483646 + 1;
	return () => {
		state = (state * 16807) % 2147483647;
		return (state - 1) / 2147483646;
	};
}

/** A stable 32-bit hash of a string (FNV-1a), for seeding from ids. */
export function hashString(text: string): number {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

interface TextureOptions {
	name: string;
	/** Colour data is sRGB; normals, gloss and masks are linear. */
	srgb: boolean;
	anisotropy?: number;
}

/** A repeating, mipmapped texture from RGBA pixels. */
export function textureFromPixels(device: GraphicsDevice, width: number, height: number, pixels: Uint8ClampedArray, options: TextureOptions): Texture {
	const texture = new Texture(device, {
		name: options.name,
		width,
		height,
		format: options.srgb ? PIXELFORMAT_SRGBA8 : PIXELFORMAT_RGBA8,
		mipmaps: true,
		minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
		magFilter: FILTER_LINEAR,
		addressU: ADDRESS_REPEAT,
		addressV: ADDRESS_REPEAT,
		anisotropy: options.anisotropy ?? 8,
	});
	const target = texture.lock() as Uint8Array;
	target.set(pixels);
	texture.unlock();
	return texture;
}

export function textureFromCanvas(device: GraphicsDevice, context: Canvas2D, options: TextureOptions): Texture {
	const { width, height } = context.canvas;
	return textureFromPixels(device, width, height, context.getImageData(0, 0, width, height).data, options);
}

/**
 * A tangent-space normal map from a height map painted in grey (brighter = further out), wrapping
 * at the edges like the repeating texture it goes with. `strength` is how steep a full black-to-
 * white step is; `scale` resamples it (a half-size normal map of a full-size height map).
 */
export function normalsFromHeight(height: Canvas2D, strength: number, scale = 1): { width: number; height: number; pixels: Uint8ClampedArray } {
	const sourceWidth = height.canvas.width;
	const sourceHeight = height.canvas.height;
	const source = height.getImageData(0, 0, sourceWidth, sourceHeight).data;
	const width = Math.max(1, Math.round(sourceWidth * scale));
	const rows = Math.max(1, Math.round(sourceHeight * scale));
	const step = 1 / scale;
	// The wrapped source column for each output column from -1 to width (and row offsets likewise),
	// worked out once rather than per sample: these maps are painted at startup, on the loading screen.
	const columns = new Int32Array(width + 2);
	for (let x = -1; x <= width; x++) columns[x + 1] = (((Math.round(x * step) % sourceWidth) + sourceWidth) % sourceWidth) * 4;
	const rowStarts = new Int32Array(rows + 2);
	for (let y = -1; y <= rows; y++) rowStarts[y + 1] = (((Math.round(y * step) % sourceHeight) + sourceHeight) % sourceHeight) * sourceWidth * 4;
	const sample = (x: number, y: number) => source[rowStarts[y + 1] + columns[x + 1]] / 255;
	const pixels = new Uint8ClampedArray(width * rows * 4);
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < width; x++) {
			// Canvas rows run downwards while the texture's V runs up the wall, hence the sign on dy.
			const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
			const dy = (sample(x, y - 1) - sample(x, y + 1)) * strength;
			const length = Math.hypot(dx, dy, 1);
			const i = (y * width + x) * 4;
			pixels[i] = Math.round((-dx / length * 0.5 + 0.5) * 255);
			pixels[i + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
			pixels[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
			pixels[i + 3] = 255;
		}
	}
	return { width, height: rows, pixels };
}

/** Speckle and blotches over what's painted, for plaster, concrete and grime. */
export function addGrain(context: Canvas2D, amount: number, random: () => number, blotches = 0): void {
	const { width, height } = context.canvas;
	const image = context.getImageData(0, 0, width, height);
	const data = image.data;
	for (let i = 0; i < data.length; i += 4) {
		const n = (random() - 0.5) * amount;
		data[i] += n;
		data[i + 1] += n;
		data[i + 2] += n;
	}
	context.putImageData(image, 0, 0);
	for (let i = 0; i < blotches; i++) {
		const x = random() * width;
		const y = random() * height;
		const r = 20 + random() * 90;
		const gradient = context.createRadialGradient(x, y, 0, x, y, r);
		const dark = random() < 0.6;
		gradient.addColorStop(0, dark ? "rgba(40,32,24,0.07)" : "rgba(255,255,255,0.06)");
		gradient.addColorStop(1, "rgba(0,0,0,0)");
		context.fillStyle = gradient;
		context.fillRect(x - r, y - r, r * 2, r * 2);
	}
}

/** "rgb(...)" from 0..255 channels. */
export function rgb(r: number, g: number, b: number, a = 1): string {
	return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

/** Grey level 0..1 as a fill, for height and gloss maps. */
export function grey(level: number): string {
	const v = Math.round(Math.max(0, Math.min(1, level)) * 255);
	return `rgb(${v},${v},${v})`;
}
