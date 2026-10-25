/**
 * Draws the OrionGenix logo in the style of a crime-sandbox title card: heavy white letters with
 * thick black outlines and a hard drop shadow, framed in a box on a Vice-City sunset. The icon is
 * the "OG" monogram; the wordmark stacks ORION / GENIX with the initials in their own tiles.
 * The lettering is Impact (Windows ships it; the outputs are committed, so builds don't need it).
 *
 *   node scripts/make-icons.mjs
 *
 * Writes public/logo.svg and public/logo-wordmark.png, src/app/favicon.ico (16/32/48),
 * src/app/icon.png (512, the one Google picks up for results), src/app/apple-icon.png (180) and
 * public/icon-192.png / icon-512.png for the manifest.
 */

import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const FONT = `font-family="Impact, 'Arial Black', sans-serif"`;

const SUNSET = `<linearGradient id="sunset" x1="0" y1="0" x2="0" y2="1">
		<stop offset="0" stop-color="#3a0d5c"/>
		<stop offset="0.38" stop-color="#ff2d95"/>
		<stop offset="0.72" stop-color="#ff7a1a"/>
		<stop offset="1" stop-color="#ffc53d"/>
	</linearGradient>`;

/**
 * A framed sunset tile with letters on it, in a 100-unit square: the black box edge, a white
 * keyline inside it, the sun's stripes low down and the outlined letters. `small` drops the
 * keyline and stripes and fattens the outline, which would otherwise turn to mud at 16–48 px.
 */
function tile(letters, { size = 74, small = false, id = "t" } = {}) {
	const outline = small ? 7 : 5.5;
	const stripes = small
		? ""
		: [70, 78, 85, 91].map((y, i) => `<rect x="0" y="${y}" width="100" height="${1.4 + i * 0.7}" fill="#3a0d5c" opacity="0.35"/>`).join("");
	// Impact's capitals stand about 0.79 em tall; this puts them in the middle of the tile.
	const baseline = 50 + size * 0.395;
	const text = (extra) => `<text x="50" y="${baseline}" ${FONT} font-size="${size}" text-anchor="middle" letter-spacing="${small ? 0 : -1}" ${extra}>${letters}</text>`;
	return `<defs><clipPath id="${id}-clip"><rect x="0" y="0" width="100" height="100" rx="${small ? 8 : 10}"/></clipPath></defs>
	<g clip-path="url(#${id}-clip)">
		<rect width="100" height="100" fill="url(#sunset)"/>
		<circle cx="50" cy="66" r="30" fill="#ffd36b" opacity="0.35"/>
		${stripes}
	</g>
	<rect x="${small ? 2.5 : 2}" y="${small ? 2.5 : 2}" width="${small ? 95 : 96}" height="${small ? 95 : 96}" rx="${small ? 7 : 9}" fill="none" stroke="#000" stroke-width="${small ? 5 : 4}"/>
	${small ? "" : `<rect x="6" y="6" width="88" height="88" rx="6" fill="none" stroke="#fff" stroke-width="1.6" opacity="0.9"/>`}
	${text(`transform="translate(${small ? 2.5 : 3} ${small ? 2.5 : 3})" fill="#000" stroke="#000" stroke-width="${outline}" stroke-linejoin="round"`)}
	${text(`fill="#000" stroke="#000" stroke-width="${outline}" stroke-linejoin="round"`)}
	${text(`fill="#fff"`)}`;
}

/** The square icon; `scale` shrinks it inside the square for icons that are masked or cropped. */
function svg({ scale = 1, small = false } = {}) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
	<defs>${SUNSET}</defs>
	${scale < 1 ? `<rect width="100" height="100" fill="#050507"/>` : ""}
	<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${tile("OG", { small, size: small ? 76 : 64 })}</g>
</svg>`;
}

/** ORION over GENIX, each initial in its own tile and the rest in outlined capitals beside it. */
function wordmark() {
	const row = (initial, rest, y, id) => `
	<g transform="translate(20 ${y}) scale(1.9)">${tile(initial, { size: 92, id })}</g>
	<g ${FONT} font-size="200" letter-spacing="-2">
		<text x="226" y="${y + 172}" transform="translate(7 7)" fill="#000" stroke="#000" stroke-width="20" stroke-linejoin="round">${rest}</text>
		<text x="226" y="${y + 172}" fill="#000" stroke="#000" stroke-width="20" stroke-linejoin="round">${rest}</text>
		<text x="226" y="${y + 172}" fill="#fff">${rest}</text>
	</g>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 440" width="1520" height="880">
	<defs>${SUNSET}</defs>
	${row("O", "RION", 20, "o")}
	${row("G", "ENIX", 230, "g")}
</svg>`;
}

const png = (size, options) => sharp(Buffer.from(svg(options)), { density: 72 * Math.ceil(size / 100) * 4 }).resize(size, size).png().toBuffer();

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

await writeFile("public/logo.svg", svg());
await sharp(Buffer.from(wordmark())).png().toFile("public/logo-wordmark.png");
const small = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size, { small: true }) })));
await writeFile("src/app/favicon.ico", ico(small));
await writeFile("src/app/icon.png", await png(512));
// iOS rounds the corners itself; the tile fills the square.
await writeFile("src/app/apple-icon.png", await png(180));
// Android masks to a circle or squircle: keep the lettering inside the safe zone.
await writeFile("public/icon-192.png", await png(192, { scale: 0.8 }));
await writeFile("public/icon-512.png", await png(512, { scale: 0.8 }));
console.log("icons written");
