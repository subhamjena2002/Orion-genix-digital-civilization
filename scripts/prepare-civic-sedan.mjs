/**
 * Paint for the plain sedan: the taxi's body texture with the taxi taken out of it.
 *
 *   node scripts/prepare-civic-sedan.mjs public/models/vehicles/civic-taxi.glb public/models/vehicles/civic-sedan-paint.png
 *
 * The taxi (civic pack, see VehicleModels) is a full-size sedan, but its yellow is painted into the
 * one texture that covers the whole car: trim, grille, lamps, wheels and the cabin seen through
 * the glass are on the same picture. Tinting that picture can't make a red car (red over yellow
 * is orange), and it would tint the chrome and the lamps along with the paint. So, texel by texel:
 *
 *   - paint (the taxi yellow) becomes grey at its own brightness, so panel lines, shading and
 *     grime stay, with full-strength paint at white;
 *   - the chequer band along the doors is painted over, keeping the door seam that crosses it;
 *   - everything else is left exactly as it was.
 *
 * Alpha marks the paint: 0.5 where it is, 1 where it isn't. Never 0: a browser that decodes
 * images premultiplied would lose the colour under a zero alpha. The game tints only the texels
 * the alpha marks (PAINT_MASK_DIFFUSE in OrionVehicleModel). The TAXI lettering is a separate
 * decal material, which the game hides.
 */

import { writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
	console.error("usage: node scripts/prepare-civic-sedan.mjs <civic-taxi.glb> <civic-sedan-paint.png>");
	process.exit(1);
}

/** The body material: one texture for the whole car. */
const BODY_MATERIAL = "taxi";
/** Taxi yellow: its hue window (degrees), and the least saturation and brightness still paint. */
const PAINT_HUE = [18, 55];
const PAINT_SATURATION = 0.45;
const PAINT_MIN_VALUE = 0.06;
/** Alpha of a paint texel, and of anything else. */
const PAINT_ALPHA = 128;
const OTHER_ALPHA = 255;
/**
 * The chequer band along the doors, in texels of the 1024 texture, measured on it: a strip 19
 * texels tall whose top runs from y 528 at x 320 to y 534.5 at x 705 (the UV island is turned a
 * little). Its rows end above the window openings. Its top row is shared with the bottom of the
 * door handles' recesses: there, only the squares' soft top edge is painted over, not the recess
 * (near-black, where the edge is mid-grey).
 */
const BAND = { left: 316, right: 714, x0: 320, top0: 528, slope: 6.5 / 385, height: 19 };
/** The two door handles' recesses (x ranges), and how dark a texel of one is. */
const HANDLES = [[478, 524], [668, 716]];
const RECESS_VALUE = 0.3;
/** The door seam crossing the band, from (527.5, 505) to (536.5, 554): kept 1.5 texels either side. */
const SEAM = { x0: 527.5, y0: 505, x1: 536.5, y1: 554, halfWidth: 1.5 };

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function isPaint(r, g, b) {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max < PAINT_MIN_VALUE || max - min < PAINT_SATURATION * max) return false;
	const delta = max - min;
	let hue;
	if (max === r) hue = ((g - b) / delta) % 6;
	else if (max === g) hue = (b - r) / delta + 2;
	else hue = (r - g) / delta + 4;
	hue = (hue * 60 + 360) % 360;
	return hue >= PAINT_HUE[0] && hue <= PAINT_HUE[1];
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(source);
const material = document.getRoot().listMaterials().find((candidate) => candidate.getName() === BODY_MATERIAL);
const texture = material?.getBaseColorTexture();
if (!texture) throw new Error(`No "${BODY_MATERIAL}" base colour texture in ${source}`);
const { data, info } = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
if (width !== 1024 || height !== 1024) throw new Error(`Expected the 1024 body texture, got ${width}×${height}: the band and seam positions are measured on that`);

// Full-strength paint: the brightness most paint texels sit at (a high percentile, so the
// shaded ones don't drag it down).
const values = [];
for (let i = 0; i < data.length; i += 4) {
	const r = data[i] / 255;
	const g = data[i + 1] / 255;
	const b = data[i + 2] / 255;
	if (isPaint(r, g, b)) values.push(Math.max(r, g, b));
}
values.sort((a, b) => a - b);
const fullPaint = toLinear(values[Math.floor(values.length * 0.9)]);

const out = Buffer.alloc(width * height * 4);
for (let i = 0, texel = 0; i < data.length; i += 4, texel++) {
	const r = data[i] / 255;
	const g = data[i + 1] / 255;
	const b = data[i + 2] / 255;
	if (isPaint(r, g, b)) {
		const grey = Math.round(toSrgb(Math.min(1, toLinear(Math.max(r, g, b)) / fullPaint)) * 255);
		out[i] = out[i + 1] = out[i + 2] = grey;
		out[i + 3] = PAINT_ALPHA;
	} else {
		out[i] = data[i];
		out[i + 1] = data[i + 1];
		out[i + 2] = data[i + 2];
		out[i + 3] = OTHER_ALPHA;
	}
}

// The band: plain paint, as on the door around it.
let painted = 0;
for (let x = BAND.left; x <= BAND.right; x++) {
	const top = BAND.top0 + (x - BAND.x0) * BAND.slope;
	for (let y = Math.floor(top); y <= Math.floor(top + BAND.height); y++) {
		const seamX = SEAM.x0 + ((y - SEAM.y0) / (SEAM.y1 - SEAM.y0)) * (SEAM.x1 - SEAM.x0);
		if (Math.abs(x - seamX) <= SEAM.halfWidth) continue;
		const i = (y * width + x) * 4;
		const inRecess = HANDLES.some(([from, to]) => x >= from && x <= to) && Math.max(data[i], data[i + 1], data[i + 2]) < RECESS_VALUE * 255;
		if (y === Math.floor(top) && inRecess) continue;
		out[i] = out[i + 1] = out[i + 2] = 255;
		out[i + 3] = PAINT_ALPHA;
		painted++;
	}
}

await writeFile(target, await sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer());
console.log(`${target}: ${values.length} paint texels (full paint at ${Math.round(values[Math.floor(values.length * 0.9)] * 255)}), ${painted} band texels repainted`);
