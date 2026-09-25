/**
 * Shrinks the textures inside GLB models without changing what they look like in the game.
 *
 *   node scripts/optimize-textures.mjs <file.glb> [more.glb ...]
 *
 * Files are rewritten in place — the originals stay in git history (LFS). Run it on anything
 * over Cloudflare's 25 MiB per-file limit, or anything that's simply heavier than it needs to be.
 *
 * What it does, texture by texture, based on how the materials actually use each one:
 *
 *   - Colour maps on OPAQUE materials: the renderer ignores their alpha channel entirely, so they
 *     become JPEG. The alpha is stripped, not flattened — flattening composites transparent pixels
 *     onto black, which would darken them on screen even though alpha was never shown.
 *   - Colour maps whose alpha IS used (MASK or BLEND: hair cards, glass, foliage): stay PNG, but
 *     properly compressed. Many models ship PNGs stored uncompressed; this alone is lossless.
 *   - Normal maps: stay lossless if they're PNG. Compression artefacts in a normal map show as
 *     blotchy shading, so a PNG normal is never made lossy. One that is ALREADY JPEG carries
 *     that loss anyway; it's re-encoded at q95, which is below the point where it shows.
 *   - Roughness / metalness / occlusion: smooth, low-detail data. Capped at 1024 — halving it is
 *     not visible in the lighting.
 *   - Anything used in a slot this script doesn't recognise (material extensions) is left alone.
 *
 * A texture is only replaced if the new version is actually smaller.
 *
 * Two passes. The first never touches a JPEG that isn't being resized — re-encoding an existing
 * JPEG stacks a second generation of loss on the first, and on foliage that was measurably
 * visible. Only a file still over the size budget afterwards gets its existing JPEGs re-encoded.
 *
 * Every JPEG is written 4:4:4. The usual 4:2:0 default keeps colour at quarter resolution: fine
 * for photographs, visibly smeary on dense foliage, and actively wrong for normal maps, where the
 * "colour" channels are the surface direction.
 */

import { readFile, stat } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";

/** Largest dimension kept for each texture slot. */
const MAX_SIZE = {
	baseColorTexture: 2048,
	normalTexture: 2048,
	emissiveTexture: 2048,
	metallicRoughnessTexture: 1024,
	occlusionTexture: 1024,
};
/**
 * JPEG qualities to try, lowest first. Each attempt is compared with the source and accepted
 * only if it clears MIN_PSNR; normal maps start higher, since shading shows artefacts first.
 */
const COLOUR_QUALITIES = [90, 95, 98];
const NORMAL_QUALITIES = [95, 98];
/**
 * The floor, in dB. Around 38 dB is where differences stop being visible in a texture; below it
 * the texture stays lossless (PNG sources) or untouched (JPEG sources) instead.
 */
const MIN_PSNR = 38;
const CLOUDFLARE_LIMIT = 25 * 1024 * 1024;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Every slot a texture is used in, and whether any material shows its alpha. */
function usageOf(document, texture) {
	const slots = new Set();
	let alphaShown = false;
	for (const edge of document.getGraph().listParentEdges(texture)) {
		const parent = edge.getParent();
		const slot = edge.getName();
		// The Root lists every texture; that edge isn't a use.
		if (parent.propertyType === "Root") continue;
		slots.add(slot);
		if (slot === "baseColorTexture" && typeof parent.getAlphaMode === "function" && parent.getAlphaMode() !== "OPAQUE") {
			alphaShown = true;
		}
	}
	return { slots, alphaShown };
}

async function optimizeTexture(texture, usage, pass) {
	const { slots, alphaShown } = usage;
	const original = texture.getImage();
	if (!original || slots.size === 0) return null;
	// Unknown slot (an extension): don't touch what we don't understand.
	if ([...slots].some((slot) => !(slot in MAX_SIZE))) return null;

	const mime = texture.getMimeType();
	const image = sharp(original, { failOn: "none" });
	const meta = await image.metadata();
	// The most generous limit among the slots it's used in.
	const cap = Math.max(...[...slots].map((slot) => MAX_SIZE[slot]));
	const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
	const resize = longest > cap;
	let pipeline = resize ? image.resize({ width: meta.width >= meta.height ? cap : undefined, height: meta.height > meta.width ? cap : undefined }) : image;

	// First pass: an existing JPEG that isn't being resized is left exactly as it is.
	if (pass === 1 && mime === "image/jpeg" && !resize) return null;

	const isNormal = slots.has("normalTexture");
	const colourOnly = slots.size === 1 && slots.has("baseColorTexture");
	// Colour whose alpha never reaches the screen: drop the alpha without compositing it.
	const dropAlpha = colourOnly && !alphaShown;
	const wantsLossless = mime === "image/png" && (isNormal || alphaShown || !colourOnly);

	let out;
	let outMime;
	if (wantsLossless) {
		out = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
		outMime = "image/png";
	} else {
		const source = dropAlpha ? pipeline.clone().removeAlpha() : pipeline.clone();
		const reference = await source.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
		for (const quality of isNormal ? NORMAL_QUALITIES : COLOUR_QUALITIES) {
			const attempt = await source.clone().jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
			const decoded = await sharp(attempt).removeAlpha().raw().toBuffer();
			if (psnr(reference.data, decoded) >= MIN_PSNR) {
				out = attempt;
				outMime = "image/jpeg";
				break;
			}
		}
		if (!out) {
			// No JPEG was good enough. A PNG source stays lossless; a JPEG source stays as it was.
			if (mime !== "image/png") return null;
			out = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
			outMime = "image/png";
		}
	}

	if (out.byteLength >= original.byteLength) return null;
	texture.setImage(new Uint8Array(out)).setMimeType(outMime);
	if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.(png|jpe?g)$/i, outMime === "image/png" ? ".png" : ".jpg"));
	return { from: original.byteLength, to: out.byteLength, resized: resize ? `${meta.width}→${cap}` : null, mime: `${mime.split("/")[1]}→${outMime.split("/")[1]}`, slots: [...slots].join("+"), alphaShown };
}

/** Peak signal-to-noise ratio between two equal-length 8-bit buffers, in dB. */
function psnr(a, b) {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const d = a[i] - b[i];
		sum += d * d;
	}
	const mse = sum / a.length;
	return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

const mib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;

for (const path of process.argv.slice(2)) {
	const before = (await stat(path)).size;
	const document = await io.read(path);
	const changes = [];
	// A texture re-encoded once is never re-encoded again: that would stack the loss.
	const touched = new Set();
	const runPass = async (pass) => {
		for (const texture of document.getRoot().listTextures()) {
			if (touched.has(texture)) continue;
			const result = await optimizeTexture(texture, usageOf(document, texture), pass);
			if (!result) continue;
			touched.add(texture);
			changes.push({ name: texture.getName() || texture.getURI() || "(unnamed)", pass, ...result });
		}
		await io.write(path, document);
		return (await stat(path)).size;
	};
	let after = await runPass(1);
	if (after > CLOUDFLARE_LIMIT) after = await runPass(2);
	const verdict = after > CLOUDFLARE_LIMIT ? "STILL OVER 25 MiB" : "under 25 MiB";
	console.log(`\n${path}\n  ${mib(before)} → ${mib(after)}  (${verdict}), ${changes.length} of ${document.getRoot().listTextures().length} textures changed`);
	const saved = changes.reduce((sum, change) => sum + change.from - change.to, 0);
	const byKind = {};
	for (const change of changes) {
		const kind = `${change.slots}${change.alphaShown ? " (alpha used)" : ""}: ${change.mime}${change.resized ? `, ${change.resized}px` : ""}${change.pass === 2 ? " [pass 2]" : ""}`;
		byKind[kind] = (byKind[kind] ?? 0) + 1;
	}
	for (const [kind, count] of Object.entries(byKind)) console.log(`    ${count} × ${kind}`);
	console.log(`  saved ${mib(saved)} of texture data`);
	// Sanity: the file must still parse.
	await io.readBinary(new Uint8Array(await readFile(path)));
}
