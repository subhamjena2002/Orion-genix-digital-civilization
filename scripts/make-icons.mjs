/**
 * Draws the OrionGenix icon — the wordmark's gold four-point star on the landing page's night
 * black — at every size the site needs, so search results, tabs, bookmarks and home screens show
 * the game's mark rather than a framework's.
 *
 *   node scripts/make-icons.mjs
 *
 * Writes src/app/favicon.ico (16/32/48), src/app/icon.png (512, the one Google picks up for
 * results), src/app/apple-icon.png (180) and public/icon-192.png / icon-512.png for the manifest.
 */

import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const STAR = "M12 0l2.4 8.6L24 12l-9.6 3.4L12 24l-2.4-8.6L0 12l9.6-3.4z";

/** `inset` is the star's margin as a share of the side; small icons need it larger to read. */
function svg(inset) {
	const s = 24 / (1 - 2 * inset);
	const o = -inset * s;
	return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${o} ${o} ${s} ${s}">
	<defs>
		<radialGradient id="glow" cx="50%" cy="50%" r="50%">
			<stop offset="0" stop-color="#ff7a1a" stop-opacity="0.55"/>
			<stop offset="0.6" stop-color="#ff2d95" stop-opacity="0.18"/>
			<stop offset="1" stop-color="#050507" stop-opacity="0"/>
		</radialGradient>
		<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#ffe08a"/>
			<stop offset="1" stop-color="#f7b733"/>
		</linearGradient>
	</defs>
	<rect x="${o}" y="${o}" width="${s}" height="${s}" fill="#050507"/>
	<circle cx="12" cy="12" r="${s / 2}" fill="url(#glow)"/>
	<path d="${STAR}" fill="url(#gold)"/>
</svg>`);
}

const png = (size, inset) => sharp(svg(inset), { density: 600 }).resize(size, size).png().toBuffer();

/** An .ico is a directory of PNGs: a 6-byte header, a 16-byte entry per image, then the images. */
function ico(images) {
	const header = Buffer.alloc(6 + 16 * images.length);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = header.length;
	images.forEach(({ size, data }, i) => {
		const e = 6 + 16 * i;
		header.writeUInt8(size >= 256 ? 0 : size, e);
		header.writeUInt8(size >= 256 ? 0 : size, e + 1);
		header.writeUInt16LE(1, e + 4);
		header.writeUInt16LE(32, e + 6);
		header.writeUInt32LE(data.length, e + 8);
		header.writeUInt32LE(offset, e + 12);
		offset += data.length;
	});
	return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const small = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size, 0.08) })));
await writeFile("src/app/favicon.ico", ico(small));
await writeFile("src/app/icon.png", await png(512, 0.16));
// iOS rounds the corners itself and wants no transparency; the star sits a little smaller.
await writeFile("src/app/apple-icon.png", await png(180, 0.2));
// Android masks to a circle or squircle: keep the star inside the safe zone.
await writeFile("public/icon-192.png", await png(192, 0.22));
await writeFile("public/icon-512.png", await png(512, 0.22));
console.log("icons written");
