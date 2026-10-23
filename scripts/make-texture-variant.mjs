/**
 * Writes a copy of a GLB whose textures are capped at a smaller size, leaving the original as it is.
 *
 *   node scripts/make-texture-variant.mjs <in.glb> <out.glb> <maxSize>
 *
 * For models whose textures are larger than the game ever shows them: TextureBudget caps every
 * texture at 1024 px as it's decoded (512 on small devices) and keeps the full size only with full
 * quality pinned (F4). A model shipped at 2048 is downloaded at four times the pixels and then
 * thrown away down to 1024 on arrival; a 1024 copy looks the same on screen at a quarter of the
 * download. The game picks the copy or the original by the same cap (see PlayerVisual).
 *
 * Each texture keeps its format: PNG stays PNG (alpha and normal maps stay lossless), JPEG is
 * re-encoded at q95 4:4:4. Resized with Lanczos, like optimize-textures.mjs. A texture already
 * within the size is left untouched.
 */

import { stat } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";

const [input, output, maxArg] = process.argv.slice(2);
const maxSize = Number(maxArg);
if (!input || !output || !Number.isFinite(maxSize) || maxSize <= 0) {
	console.error("usage: node scripts/make-texture-variant.mjs <in.glb> <out.glb> <maxSize>");
	process.exit(1);
}
if (input === output) {
	console.error("out.glb must be a different file: this script never rewrites the original");
	process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);

for (const texture of document.getRoot().listTextures()) {
	const source = Buffer.from(texture.getImage());
	const meta = await sharp(source).metadata();
	const largest = Math.max(meta.width ?? 0, meta.height ?? 0);
	if (largest <= maxSize) continue;
	const resized = sharp(source).resize({ width: maxSize, height: maxSize, fit: "inside", kernel: "lanczos3" });
	const isPng = texture.getMimeType() === "image/png";
	const image = isPng
		? await resized.png({ compressionLevel: 9, palette: false }).toBuffer()
		: await resized.jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
	texture.setImage(new Uint8Array(image));
	console.log(`  ${texture.getName() || texture.getURI() || "texture"}: ${meta.width}x${meta.height} → within ${maxSize} (${(source.length / 1e6).toFixed(2)} → ${(image.length / 1e6).toFixed(2)} MB)`);
}

await io.write(output, document);
const before = (await stat(input)).size;
const after = (await stat(output)).size;
console.log(`${output}: ${(before / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB`);
