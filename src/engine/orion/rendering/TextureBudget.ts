import type { AppBase, GraphicsDevice, Texture } from "playcanvas";

/**
 * Memory for the textures packed inside the GLB models — cars, aircraft, the train, the army
 * base kit, the player: 170-odd images, nearly all 1024 px and a few 2048, uncompressed.
 *
 * The engine decodes each to a full-size bitmap and keeps that bitmap on the CPU for as long as
 * the texture lives, beside the copy it uploads to the GPU: ~730 MB of RAM next to ~960 MB of
 * video memory, holding pictures nothing reads again after the upload. Two things here:
 *
 * - A size cap, applied as each image is decoded. With mipmapping the GPU samples the level that
 *   matches the texture's size on screen, and even a car filling half the screen doesn't reach
 *   the top level of a 2048 texture — so 1024 draws the same picture. Phones, tablets and
 *   machines reporting 4 GB or less get 512: there, memory decides whether the game runs at all.
 *   With full quality pinned (F4, read at start) the cap is 2048, the largest the models ship.
 * - Once a texture is on the GPU, its bitmap is closed. The image's file bytes (about a tenth of
 *   the size, and held by the model's asset anyway) are kept: when a lost GPU context comes back
 *   every texture is uploaded again, and these are decoded afresh for it.
 *
 * Only images from inside model files are touched — their bytes are on hand to decode again.
 * Ground, sky and sign textures are left as they are.
 */

/** Longest side of a model's texture, in texels, on most machines. */
export const TEXTURE_CAP = 1024;
/** On phones, tablets and machines with 4 GB or less. */
export const SMALL_DEVICE_TEXTURE_CAP = 512;
/** With full quality pinned. */
export const FULL_QUALITY_TEXTURE_CAP = 2048;
/** How often textures already on the GPU are checked for bitmaps to let go of, ms. */
const RELEASE_INTERVAL_MS = 200;
/**
 * Bitmaps let go of per check (closing one takes ~0.35 ms): a model's worth of textures arriving
 * together is spread over a second or so rather than costing one frame.
 */
const RELEASES_PER_CHECK = 8;

export interface DeviceClass {
	/** `navigator.deviceMemory` in GB, where the browser reports it. */
	deviceMemory?: number;
	/** A touch screen is the main pointer: a phone or tablet. */
	coarsePointer: boolean;
	fullQuality: boolean;
}

export function textureCapFor(device: DeviceClass): number {
	if (device.fullQuality) return FULL_QUALITY_TEXTURE_CAP;
	if (device.coarsePointer || (device.deviceMemory !== undefined && device.deviceMemory <= 4)) return SMALL_DEVICE_TEXTURE_CAP;
	return TEXTURE_CAP;
}

/** This browser's device class. */
export function thisDeviceClass(fullQuality: boolean): DeviceClass {
	return {
		deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
		coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
		fullQuality,
	};
}

/** `width` × `height` scaled down (never up) to fit within `cap`, keeping its proportions. */
export function fitWithin(width: number, height: number, cap: number): { width: number; height: number } {
	const scale = Math.min(1, cap / Math.max(width, height));
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

type Colour = readonly [number, number, number];
type DecodedImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

/** The file bytes of each texture made from a model's image: what it's decoded from again. */
const fileBytes = new WeakMap<Texture, ArrayBuffer>();
/** Average colours of let-go images, for anything that wanted to read the picture later. */
const averages = new WeakMap<Texture, Colour>();

/** Marks `texture` as made from a model's image, decodable again from `bytes`. */
export function rememberFileBytes(texture: Texture, bytes: ArrayBuffer): void {
	fileBytes.set(texture, bytes);
}

/**
 * One small canvas the CPU draws (`willReadFrequently`): reading pixels back from a GPU-drawn one
 * stalls for ~15 ms each time.
 */
let averaging: OffscreenCanvasRenderingContext2D | null | undefined;

/** A picture's average colour (r, g, b in 0–1), from an 8×8 copy; null where it can't be read. */
export function averageColour(source: CanvasImageSource): Colour | null {
	if (averaging === undefined) averaging = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(8, 8).getContext("2d", { willReadFrequently: true });
	const context = averaging;
	if (!context) return null;
	try {
		context.clearRect(0, 0, 8, 8);
		context.drawImage(source, 0, 0, 8, 8);
		const pixels = context.getImageData(0, 0, 8, 8).data;
		let r = 0;
		let g = 0;
		let b = 0;
		for (let i = 0; i < pixels.length; i += 4) {
			r += pixels[i];
			g += pixels[i + 1];
			b += pixels[i + 2];
		}
		const count = (pixels.length / 4) * 255;
		return [r / count, g / count, b / count];
	} catch {
		// Unreadable, e.g. a compressed texture.
		return null;
	}
}

/** The average colour of a model texture whose bitmap has been let go, kept from before. */
export function releasedAverageColour(texture: Texture): Colour | null {
	return averages.get(texture) ?? null;
}

/** The engine's own fields for a texture's pixels and pending upload (not public API). */
interface TextureInternals {
	_levels: unknown[];
	_needsUpload: boolean;
	_needsMipmapsUpload: boolean;
}

/** Lets go of the bitmaps of model textures already on the GPU, up to `limit`. Returns how many. */
export function releaseUploadedImages(textures: Iterable<Texture>, limit = Infinity): number {
	let released = 0;
	for (const texture of textures) {
		if (released >= limit) break;
		if (!fileBytes.has(texture)) continue;
		const internals = texture as unknown as TextureInternals;
		const image = internals._levels[0];
		if (!image || internals._needsUpload || internals._needsMipmapsUpload) continue;
		const average = averages.has(texture) ? null : averageColour(image as CanvasImageSource);
		if (average) averages.set(texture, average);
		// With the texture uploaded, the engine only reads this again to upload it again, which
		// only a lost GPU context asks for: see decodeReleased.
		internals._levels[0] = null;
		closeImage(image);
		released++;
	}
	return released;
}

function isDecodedImage(data: unknown): data is ImageBitmap | HTMLImageElement {
	return (typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap) || (typeof HTMLImageElement !== "undefined" && data instanceof HTMLImageElement);
}

function closeImage(image: unknown): void {
	if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
	else if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) image.width = 0;
}

/** `image` drawn at `width` × `height` on a canvas: Safari's way, where the engine decodes to an <img>. */
function drawnAt(image: CanvasImageSource, width: number, height: number): HTMLCanvasElement | null {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(image, 0, 0, width, height);
	return canvas;
}

/** Decodes an image's file bytes at `width` × `height`, the way the engine decodes on this device. */
async function decodeAt(bytes: ArrayBuffer, useImageBitmap: boolean, width: number, height: number): Promise<DecodedImage> {
	const blob = new Blob([bytes]);
	if (useImageBitmap) {
		// Decoded off the main thread, straight at the size wanted. The engine's own options: values
		// as stored, so normal and roughness maps keep their meaning.
		return createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: "high", premultiplyAlpha: "none", colorSpaceConversion: "none" });
	}
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		if (image.naturalWidth === width && image.naturalHeight === height) return image;
		return drawnAt(image, width, height) ?? image;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** `image` within the cap: itself if it fits, otherwise a smaller copy (the original let go). */
async function withinCap(image: ImageBitmap | HTMLImageElement, bytes: ArrayBuffer, cap: number): Promise<DecodedImage> {
	const size = fitWithin(image.width, image.height, cap);
	if (size.width === image.width && size.height === image.height) return image;
	if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
		// Resizing the decoded bitmap blocks the main thread (~17 ms a texture); decoding the file
		// again at the smaller size happens off it.
		const smaller = await decodeAt(bytes, true, size.width, size.height);
		image.close();
		return smaller;
	}
	return drawnAt(image, size.width, size.height) ?? image;
}

function deviceTextures(device: GraphicsDevice): Iterable<Texture> {
	return (device as unknown as { textures: Set<Texture> }).textures;
}

/** After a lost GPU context comes back: decodes the let-go images again, to be uploaded anew. */
async function decodeReleased(device: GraphicsDevice): Promise<void> {
	// Declared on each concrete device, not the base type.
	const useImageBitmap = (device as unknown as { supportsImageBitmap?: boolean }).supportsImageBitmap ?? false;
	for (const texture of [...deviceTextures(device)]) {
		const bytes = fileBytes.get(texture);
		if (!bytes || texture.getSource(0)) continue;
		try {
			// At the size it was uploaded at before: the cap is already applied to that.
			const image = await decodeAt(bytes, useImageBitmap, texture.width, texture.height);
			// The engine sets its own decoded ImageBitmaps here too; its types leave them out.
			texture.setSource(image as HTMLCanvasElement);
		} catch {
			// Left blank: the image can't be decoded here any more.
		}
	}
}

interface TextureHandler {
	load(url: unknown, callback: (error: unknown, data?: unknown, extra?: unknown) => void, asset?: unknown): void;
	open(url: unknown, data: unknown, asset?: unknown): unknown;
}

/** The bytes of an image packed inside a model file; null for any other texture. */
function modelImageBytes(asset: unknown): ArrayBuffer | null {
	return (asset as { file?: { contents?: ArrayBuffer } | null } | undefined)?.file?.contents ?? null;
}

/**
 * Caps the models' textures as they load and lets go of their bitmaps once uploaded. Install
 * before any model loads; returns the uninstall.
 */
export function installTextureBudget(app: AppBase, cap: number): () => void {
	const handler = app.loader.getHandler("texture") as unknown as TextureHandler | undefined;
	if (!handler) return () => {};
	const device = app.graphicsDevice;
	const { load, open } = handler;

	handler.load = function (url, callback, asset) {
		const bytes = modelImageBytes(asset);
		if (!bytes) {
			load.call(this, url, callback, asset);
			return;
		}
		load.call(this, url, (error, data, extra) => {
			if (error || !isDecodedImage(data)) {
				callback(error, data, extra);
				return;
			}
			withinCap(data, bytes, cap).then(
				(image) => callback(null, image, extra),
				() => callback(null, data, extra),
			);
		}, asset);
	};
	handler.open = function (url, data, asset) {
		const texture = open.call(this, url, data, asset);
		const bytes = modelImageBytes(asset);
		if (bytes && texture) rememberFileBytes(texture as Texture, bytes);
		return texture;
	};

	const timer = window.setInterval(() => releaseUploadedImages(deviceTextures(device), RELEASES_PER_CHECK), RELEASE_INTERVAL_MS);
	const restored = () => void decodeReleased(device);
	device.on("devicerestored", restored);
	return () => {
		handler.load = load;
		handler.open = open;
		window.clearInterval(timer);
		device.off("devicerestored", restored);
	};
}
