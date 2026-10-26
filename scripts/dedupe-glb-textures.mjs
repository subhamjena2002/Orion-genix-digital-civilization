// Folds a GLB's duplicate textures (two texture entries over the same image) into one, in place.
//   node scripts/dedupe-glb-textures.mjs public/models/buildings/safehouse/orion-safehouse.glb
//
// Blender's exporter writes a texture entry per material that uses an image, and the engine
// decodes each image once and shares that bitmap between the entries. TextureBudget closes a
// model image's bitmap as soon as its texture is on the GPU, so the second texture over the same
// image uploads an empty picture and draws black. One texture per image avoids it.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [file] = process.argv.slice(2);
if (!file) throw new Error("usage: node scripts/dedupe-glb-textures.mjs <file.glb>");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(file);
const root = document.getRoot();

const sameBytes = (a, b) => a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
const kept = [];
let folded = 0;
for (const texture of root.listTextures()) {
	const image = texture.getImage();
	const twin = image && kept.find((other) => other.getMimeType() === texture.getMimeType() && sameBytes(other.getImage(), image));
	if (!twin) {
		kept.push(texture);
		continue;
	}
	for (const parent of texture.listParents()) {
		if (parent !== root) parent.swap(texture, twin);
	}
	texture.dispose();
	folded++;
}
await io.write(file, document);
console.log(`${file}: ${folded} duplicate texture(s) folded, ${kept.length} left`);
