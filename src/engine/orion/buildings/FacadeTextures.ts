import { type GraphicsDevice, type Texture } from "playcanvas";

import { addGrain, grey, makeCanvas, normalsFromHeight, rgb, seededRandom, textureFromCanvas, textureFromPixels, type Canvas2D } from "../rendering/CanvasTextures";

/**
 * Building facades, painted in code at startup.
 *
 * Each style is one repeating tile, BAYS window bays wide and FLOORS storeys tall (a bay is
 * BAY_METRES across, a storey FLOOR_METRES high), so a wall of any size is covered by repeating it
 * and windows never stretch. A tile carries four maps painted in step:
 *
 *  - colour, with gloss in its alpha (glass shines, plaster doesn't),
 *  - height, turned into a normal map so frames, sills and ledges catch the sun,
 *  - and which windows are lit, for night.
 *
 * Plaster is painted near white so one tile serves every colour of building: the wall's colour is
 * multiplied in from the mesh (vertex colour), which also keeps every building of a style on one
 * material.
 */

export type FacadeStyle = "deco" | "glass" | "office" | "brick" | "apartment" | "industrial";
export type GroundStyle = "shop" | "warehouse";

export const FACADE_STYLES: readonly FacadeStyle[] = ["deco", "glass", "office", "brick", "apartment", "industrial"];
export const GROUND_STYLES: readonly GroundStyle[] = ["shop", "warehouse"];

export const BAYS = 4;
export const FLOORS = 4;
export const BAY_METRES = 3.2;
export const FLOOR_METRES = 3.2;
/** Ground-floor tiles cover one taller storey. */
export const GROUND_METRES = 4.4;
/** The trim tile (plaster for cornices, parapets, plant and roofs) repeats every this many metres. */
export const TRIM_TILE_METRES = 2;
/** One repeat of the roof tiles, metres each way (house roofs map half a repeat per metre). */
export const ROOF_TILE_METRES = 2;

export interface FacadeMaps {
	/** sRGB colour, gloss in alpha. */
	diffuse: Texture;
	normal: Texture;
	/** Lit windows (colour), black elsewhere. */
	lit: Texture;
}

interface Layers {
	color: Canvas2D;
	height: Canvas2D;
	gloss: Canvas2D;
	lit: Canvas2D;
}

interface Paint {
	color?: string | CanvasGradient;
	height?: number;
	gloss?: number;
	lit?: string;
}

function layers(width: number, height: number): Layers {
	const make = (fill: string) => {
		const context = makeCanvas(width, height);
		context.fillStyle = fill;
		context.fillRect(0, 0, width, height);
		return context;
	};
	return { color: make("#fff"), height: make(grey(0.5)), gloss: make(grey(0.12)), lit: make("#000") };
}

function paint(target: Layers, x: number, y: number, w: number, h: number, what: Paint): void {
	if (what.color !== undefined) {
		target.color.fillStyle = what.color;
		target.color.fillRect(x, y, w, h);
	}
	if (what.height !== undefined) {
		target.height.fillStyle = grey(what.height);
		target.height.fillRect(x, y, w, h);
	}
	if (what.gloss !== undefined) {
		target.gloss.fillStyle = grey(what.gloss);
		target.gloss.fillRect(x, y, w, h);
	}
	if (what.lit !== undefined) {
		target.lit.fillStyle = what.lit;
		target.lit.fillRect(x, y, w, h);
	}
}

/** A soft shadow band (cast by a ledge or sill), painted onto colour only. */
function shade(target: Layers, x: number, y: number, w: number, h: number, strength: number, downwards = true): void {
	const gradient = target.color.createLinearGradient(0, y, 0, y + h);
	gradient.addColorStop(downwards ? 0 : 1, `rgba(20,16,12,${strength})`);
	gradient.addColorStop(downwards ? 1 : 0, "rgba(20,16,12,0)");
	target.color.fillStyle = gradient;
	target.color.fillRect(x, y, w, h);
}

const CURTAINS = ["#e9dcc4", "#d9c2a0", "#c7d4dc", "#e6c9c4", "#d2d8bf", "#efe9dc", "#b9a58b", "#c9b8d6"];
const LIT = ["rgb(255,196,120)", "rgb(255,214,150)", "rgb(255,228,180)", "rgb(255,180,100)", "rgb(170,190,255)"];

/**
 * A pane of glass: dark inside, the sky reflected brighter towards the top, perhaps curtains or
 * blinds behind it, perhaps lit at night.
 */
function glass(target: Layers, random: () => number, x: number, y: number, w: number, h: number, options: { tint: [number, number, number]; interior: boolean; litChance: number }): void {
	const [r, g, b] = options.tint;
	const bright = 0.75 + random() * 0.5;
	const gradient = target.color.createLinearGradient(0, y, 0, y + h);
	gradient.addColorStop(0, rgb(r * 2.1 * bright, g * 2.1 * bright, b * 2.1 * bright));
	gradient.addColorStop(0.45, rgb(r * 1.1 * bright, g * 1.1 * bright, b * 1.1 * bright));
	gradient.addColorStop(1, rgb(r * 0.55, g * 0.55, b * 0.55));
	paint(target, x, y, w, h, { color: gradient, height: 0.18, gloss: 0.93 });
	if (options.interior) {
		const roll = random();
		target.color.globalAlpha = 0.78;
		if (roll < 0.35) {
			// Curtains drawn part-way from either side, with folds.
			const curtain = CURTAINS[Math.floor(random() * CURTAINS.length)];
			const left = w * (0.15 + random() * 0.3);
			const right = w * (0.1 + random() * 0.3);
			for (const [cx, cw] of [[x, left], [x + w - right, right]] as const) {
				target.color.fillStyle = curtain;
				target.color.fillRect(cx, y + 2, cw, h - 4);
				target.color.fillStyle = "rgba(0,0,0,0.12)";
				for (let fold = cx + 5; fold < cx + cw; fold += 9) target.color.fillRect(fold, y + 2, 3, h - 4);
			}
		} else if (roll < 0.55) {
			// Blinds, part way down.
			const drop = h * (0.25 + random() * 0.55);
			target.color.fillStyle = CURTAINS[Math.floor(random() * 3)];
			target.color.fillRect(x + 1, y + 1, w - 2, drop);
			target.color.fillStyle = "rgba(0,0,0,0.14)";
			for (let line = y + 4; line < y + drop; line += 5) target.color.fillRect(x + 1, line, w - 2, 1);
		}
		target.color.globalAlpha = 1;
	}
	// A diagonal sheen across the pane.
	target.color.save();
	target.color.beginPath();
	target.color.rect(x, y, w, h);
	target.color.clip();
	target.color.fillStyle = "rgba(255,255,255,0.10)";
	target.color.beginPath();
	const sheen = x + random() * w;
	target.color.moveTo(sheen, y);
	target.color.lineTo(sheen + w * 0.35, y);
	target.color.lineTo(sheen - w * 0.15, y + h);
	target.color.lineTo(sheen - w * 0.5, y + h);
	target.color.fill();
	target.color.restore();
	if (random() < options.litChance) {
		const lit = LIT[Math.floor(random() * LIT.length)];
		target.lit.globalAlpha = 0.55 + random() * 0.45;
		paint(target, x, y, w, h, { lit });
		target.lit.globalAlpha = 1;
	}
}

/** A window with a frame, mullions, a sill below and a shading ledge above. */
function framedWindow(target: Layers, random: () => number, x: number, y: number, w: number, h: number, options: { frame: string; tint: [number, number, number]; mullions: number; transom: boolean; sill: boolean; ledge: boolean; litChance: number }): void {
	const unit = w / 16;
	const frame = Math.max(2, unit * 0.7);
	if (options.ledge) {
		paint(target, x - unit, y - unit * 1.6, w + unit * 2, unit * 1.2, { color: options.frame, height: 0.86, gloss: 0.1 });
		shade(target, x - unit, y - unit * 0.4, w + unit * 2, unit * 2.2, 0.32);
	}
	// Reveal: the wall's depth around the opening, in shadow.
	paint(target, x - frame, y - frame, w + frame * 2, h + frame * 2, { color: "rgba(60,52,44,1)", height: 0.32 });
	paint(target, x, y, w, h, { color: options.frame, height: 0.55, gloss: 0.35 });
	glass(target, random, x + frame, y + frame, w - frame * 2, h - frame * 2, { tint: options.tint, interior: true, litChance: options.litChance });
	shade(target, x + frame, y + frame, w - frame * 2, unit * 2.4, 0.38);
	for (let i = 1; i <= options.mullions; i++) {
		const mx = x + (w * i) / (options.mullions + 1) - frame / 2;
		paint(target, mx, y, frame, h, { color: options.frame, height: 0.55, gloss: 0.35 });
	}
	if (options.transom) paint(target, x, y + h * 0.3, w, frame, { color: options.frame, height: 0.55, gloss: 0.35 });
	if (options.sill) {
		paint(target, x - unit * 0.8, y + h, w + unit * 1.6, unit * 1.1, { color: options.frame, height: 0.82, gloss: 0.12 });
		shade(target, x - unit * 0.8, y + h + unit * 1.1, w + unit * 1.6, unit * 2.6, 0.26);
	}
}

/** Floor-line band (the slab edge), with its shadow. */
function slab(target: Layers, y: number, width: number, thickness: number, color: string, height: number): void {
	paint(target, 0, y, width, thickness, { color, height, gloss: 0.12 });
	shade(target, 0, y + thickness, width, thickness * 1.4, 0.18);
}

/** Weathering: grime collecting under each storey's sills and a darker base. */
function weather(target: Layers, random: () => number, cell: number, floors: number, bays: number): void {
	for (let floor = 0; floor < floors; floor++) {
		for (let bay = 0; bay < bays; bay++) {
			if (random() < 0.5) continue;
			const x = bay * cell + cell * (0.25 + random() * 0.5);
			const y = floor * cell + cell * 0.82;
			const gradient = target.color.createLinearGradient(0, y, 0, y + cell * 0.5);
			gradient.addColorStop(0, "rgba(60,50,40,0.10)");
			gradient.addColorStop(1, "rgba(60,50,40,0)");
			target.color.fillStyle = gradient;
			target.color.fillRect(x - cell * 0.12, y, cell * 0.24, cell * 0.5);
		}
	}
}

// ---- The styles -------------------------------------------------------------------------------

/** Ocean Drive plaster: deep-set windows with white frames, eyebrow ledges and banded floors. */
function paintDeco(target: Layers, random: () => number, cell: number): void {
	const size = cell * BAYS;
	addGrain(target.color, 10, random, 30);
	for (let floor = 0; floor < FLOORS; floor++) {
		const top = floor * cell;
		slab(target, top + cell - cell * 0.07, size, cell * 0.07, "#f4f1ea", 0.7);
		// Raised piers between pairs of bays.
		for (let bay = 0; bay <= BAYS; bay += 2) paint(target, bay * cell - cell * 0.05, top, cell * 0.1, cell * 0.93, { color: "#fbf8f2", height: 0.62 });
		for (let bay = 0; bay < BAYS; bay++) {
			const w = cell * 0.5;
			framedWindow(target, random, bay * cell + (cell - w) / 2, top + cell * 0.24, w, cell * 0.52, {
				frame: "#f7f5f0", tint: [40, 74, 82], mullions: 1, transom: true, sill: true, ledge: true, litChance: 0.4,
			});
		}
	}
	weather(target, random, cell, FLOORS, BAYS);
}

/** A curtain wall: storey-high glass between thin mullions, dark spandrels at each floor. */
function paintGlass(target: Layers, random: () => number, cell: number): void {
	const size = cell * BAYS;
	paint(target, 0, 0, size, size, { color: "#8f9aa0", height: 0.5, gloss: 0.6 });
	for (let floor = 0; floor < FLOORS; floor++) {
		const top = floor * cell;
		for (let pane = 0; pane < BAYS * 2; pane++) {
			const x = pane * cell / 2;
			// By day a curtain wall mostly shows the sky it reflects: a light blue-grey, not a dark pane.
			glass(target, random, x + 3, top + 3, cell / 2 - 6, cell * 0.74, { tint: [72, 112, 126], interior: random() < 0.2, litChance: 0.35 });
		}
		// Spandrel: the opaque band hiding the floor slab.
		paint(target, 0, top + cell * 0.76, size, cell * 0.24, { color: "#7d8d94", height: 0.46, gloss: 0.7 });
		paint(target, 0, top + cell * 0.76, size, 3, { color: "#c9d0d3", height: 0.6 });
		for (let pane = 0; pane <= BAYS * 2; pane++) paint(target, pane * cell / 2 - 3, top, 6, cell, { color: "#c3cbcf", height: 0.66, gloss: 0.75 });
	}
}

/** Concrete office: ribbon windows between deep horizontal bands. */
function paintOffice(target: Layers, random: () => number, cell: number): void {
	const size = cell * BAYS;
	addGrain(target.color, 14, random, 40);
	for (let floor = 0; floor < FLOORS; floor++) {
		const top = floor * cell;
		const band = top + cell * 0.12;
		const h = cell * 0.56;
		paint(target, 0, band - 4, size, h + 8, { color: "#5b5650", height: 0.3 });
		for (let pane = 0; pane < BAYS * 3; pane++) {
			const x = pane * cell / 3;
			glass(target, random, x + 4, band, cell / 3 - 8, h, { tint: [30, 52, 60], interior: true, litChance: 0.45 });
			paint(target, x - 2, band, 4, h, { color: "#3c3d3e", height: 0.4, gloss: 0.5 });
		}
		shade(target, 0, band, size, cell * 0.08, 0.45);
		// The band's lower edge catches the light.
		paint(target, 0, band + h + 4, size, cell * 0.03, { color: "#ffffff", height: 0.62 });
	}
	weather(target, random, cell, FLOORS, BAYS);
}

/** Red brick with white sash windows, stone lintels and sills. */
function paintBrick(target: Layers, random: () => number, cell: number): void {
	const size = cell * BAYS;
	const course = Math.max(4, Math.round(cell / 22));
	const brick = course * 3;
	for (let y = 0; y < size; y += course) {
		const offset = (y / course) % 2 === 0 ? 0 : brick / 2;
		for (let x = -brick; x < size; x += brick) {
			const shadeOf = 0.82 + random() * 0.3;
			const red = rgb(150 * shadeOf, 72 * shadeOf, 52 * shadeOf);
			paint(target, x + offset + 1, y + 1, brick - 2, course - 2, { color: red, height: 0.52 });
		}
		paint(target, 0, y, size, 1, { color: "#b7ab9c", height: 0.4 });
	}
	addGrain(target.color, 12, random, 20);
	for (let floor = 0; floor < FLOORS; floor++) {
		const top = floor * cell;
		for (let bay = 0; bay < BAYS; bay++) {
			const w = cell * 0.4;
			const x = bay * cell + (cell - w) / 2;
			paint(target, x - cell * 0.06, top + cell * 0.14, w + cell * 0.12, cell * 0.07, { color: "#ded6c8", height: 0.78 });
			framedWindow(target, random, x, top + cell * 0.21, w, cell * 0.58, {
				frame: "#f2f0ea", tint: [36, 50, 56], mullions: 0, transom: true, sill: true, ledge: false, litChance: 0.45,
			});
		}
	}
	weather(target, random, cell, FLOORS, BAYS);
}

/** Apartments: balconies with railings, a window and a balcony door per bay, the odd AC unit. */
function paintApartment(target: Layers, random: () => number, cell: number): void {
	const size = cell * BAYS;
	addGrain(target.color, 10, random, 30);
	for (let floor = 0; floor < FLOORS; floor++) {
		const top = floor * cell;
		for (let bay = 0; bay < BAYS; bay++) {
			const x0 = bay * cell;
			const balcony = (bay + floor) % 2 === 0;
			// Balcony door and a window beside it.
			framedWindow(target, random, x0 + cell * 0.12, top + cell * 0.2, cell * 0.3, cell * 0.68, {
				frame: "#eeece6", tint: [40, 60, 66], mullions: 0, transom: false, sill: false, ledge: false, litChance: 0.4,
			});
			framedWindow(target, random, x0 + cell * 0.54, top + cell * 0.28, cell * 0.34, cell * 0.36, {
				frame: "#eeece6", tint: [40, 60, 66], mullions: 1, transom: false, sill: true, ledge: false, litChance: 0.4,
			});
			if (balcony) {
				// Slab, then the railing in front of the door.
				paint(target, x0 + cell * 0.04, top + cell * 0.86, cell * 0.92, cell * 0.06, { color: "#f3f1ec", height: 0.9 });
				shade(target, x0 + cell * 0.04, top + cell * 0.92, cell * 0.92, cell * 0.12, 0.4);
				const railTop = top + cell * 0.6;
				paint(target, x0 + cell * 0.04, railTop, cell * 0.92, cell * 0.025, { color: "#2c3033", height: 0.92, gloss: 0.5 });
				for (let bar = x0 + cell * 0.06; bar < x0 + cell * 0.95; bar += cell * 0.045) {
					paint(target, bar, railTop, cell * 0.012, cell * 0.26, { color: "#2c3033", height: 0.9, gloss: 0.5 });
				}
			} else if (random() < 0.5) {
				// An air conditioner under the window.
				paint(target, x0 + cell * 0.6, top + cell * 0.72, cell * 0.22, cell * 0.13, { color: "#d9dad6", height: 0.95, gloss: 0.3 });
				paint(target, x0 + cell * 0.61, top + cell * 0.74, cell * 0.2, cell * 0.02, { color: "#9a9c99", height: 0.9 });
				shade(target, x0 + cell * 0.6, top + cell * 0.85, cell * 0.22, cell * 0.08, 0.3);
			}
		}
		slab(target, top + cell * 0.95, size, cell * 0.05, "#f6f4ef", 0.66);
	}
	weather(target, random, cell, FLOORS, BAYS);
}

/** Corrugated cladding with a strip of high windows. */
function paintIndustrial(target: Layers, random: () => number, cell: number): void {
	const size = cell * BAYS;
	const rib = Math.max(3, Math.round(cell / 32));
	for (let x = 0; x < size; x += rib * 2) {
		paint(target, x, 0, rib, size, { color: "#e4e5e2", height: 0.62, gloss: 0.4 });
		paint(target, x + rib, 0, rib, size, { color: "#c3c5c3", height: 0.4, gloss: 0.35 });
	}
	addGrain(target.color, 8, random, 25);
	for (let floor = 0; floor < FLOORS; floor++) {
		const top = floor * cell;
		paint(target, 0, top + cell * 0.12, size, cell * 0.2, { color: "#3e4447", height: 0.3 });
		for (let pane = 0; pane < BAYS * 2; pane++) {
			glass(target, random, pane * cell / 2 + 4, top + cell * 0.13, cell / 2 - 8, cell * 0.18, { tint: [44, 58, 60], interior: false, litChance: 0.25 });
		}
		slab(target, top + cell * 0.96, size, cell * 0.04, "#8d9192", 0.55);
	}
	weather(target, random, cell, FLOORS, BAYS);
}

const SIGN_COLOURS = ["#9e2a2b", "#1f3a5f", "#1d6b64", "#c58b1c", "#5b2a6e", "#20242a", "#b8462e", "#2d5e3a"];
const AWNING_COLOURS = ["#b3261e", "#1f6f5c", "#244a8a", "#d08a1e", "#7d2a5a"];

/** Shopfronts: sign boards, striped awnings, plate glass and doors, on a stone plinth. */
function paintShop(target: Layers, random: () => number, cell: number, height: number): void {
	const size = cell * BAYS;
	addGrain(target.color, 10, random, 10);
	const sign = height * 0.17;
	const plinth = height * 0.07;
	for (let pair = 0; pair < BAYS; pair += 2) {
		const colour = SIGN_COLOURS[Math.floor(random() * SIGN_COLOURS.length)];
		const x0 = pair * cell;
		paint(target, x0 + cell * 0.04, height * 0.03, cell * 1.92, sign, { color: colour, height: 0.75, gloss: 0.45 });
		// Lettering: light blocks of varying length.
		let lx = x0 + cell * 0.2;
		const letterH = sign * 0.42;
		const letter = random() < 0.5 ? "#f5efe0" : "#ffd66b";
		while (lx < x0 + cell * 1.7) {
			const lw = cell * (0.05 + random() * 0.07);
			paint(target, lx, height * 0.03 + (sign - letterH) / 2, lw, letterH, { color: letter, height: 0.8, lit: letter });
			lx += lw + cell * 0.025;
			if (random() < 0.15) lx += cell * 0.08;
		}
	}
	for (let bay = 0; bay < BAYS; bay++) {
		const x0 = bay * cell;
		const top = height * 0.22;
		const bottom = height - plinth;
		// Piers between the shops.
		paint(target, x0, top, cell * 0.06, bottom - top, { color: "#e9e4da", height: 0.7 });
		const door = random() < 0.3;
		const glassX = x0 + cell * 0.08;
		const glassW = cell * 0.86;
		paint(target, glassX - 4, top - 4, glassW + 8, bottom - top + 4, { color: "#2b2e30", height: 0.5, gloss: 0.6 });
		if (door) {
			const dw = glassW * 0.42;
			const dx = glassX + (glassW - dw) / 2;
			glass(target, random, glassX, top, dx - glassX - 4, bottom - top, { tint: [52, 60, 58], interior: false, litChance: 0.8 });
			glass(target, random, dx + dw + 4, top, glassX + glassW - dx - dw - 4, bottom - top, { tint: [52, 60, 58], interior: false, litChance: 0.8 });
			paint(target, dx, top + 6, dw, bottom - top - 6, { color: "#3a3b3a", height: 0.35 });
			glass(target, random, dx + 6, top + 12, dw - 12, bottom - top - 24, { tint: [40, 46, 46], interior: false, litChance: 0.9 });
			paint(target, dx + dw * 0.78, top + (bottom - top) * 0.5, 5, 26, { color: "#c9c2b0", height: 0.8, gloss: 0.8 });
		} else {
			glass(target, random, glassX, top, glassW, bottom - top, { tint: [52, 60, 58], interior: false, litChance: 0.85 });
			// Shelves and goods behind the glass.
			target.color.globalAlpha = 0.5;
			for (let shelf = top + (bottom - top) * 0.45; shelf < bottom - 10; shelf += (bottom - top) * 0.2) {
				target.color.fillStyle = "#1a1c1d";
				target.color.fillRect(glassX + 6, shelf, glassW - 12, 4);
				for (let item = glassX + 10; item < glassX + glassW - 16; item += 10 + random() * 14) {
					target.color.fillStyle = SIGN_COLOURS[Math.floor(random() * SIGN_COLOURS.length)];
					target.color.fillRect(item, shelf - 8 - random() * 10, 6 + random() * 6, 8 + random() * 10);
				}
			}
			target.color.globalAlpha = 1;
			paint(target, glassX + glassW / 2 - 3, top, 6, bottom - top, { color: "#2b2e30", height: 0.55, gloss: 0.6 });
		}
		// Some shops have a striped awning over the window.
		if (random() < 0.5) {
			const colour = AWNING_COLOURS[Math.floor(random() * AWNING_COLOURS.length)];
			const awningH = height * 0.11;
			const stripe = cell / 12;
			for (let sx = x0 + cell * 0.04; sx < x0 + cell * 0.98; sx += stripe * 2) {
				paint(target, sx, top - 2, stripe, awningH, { color: colour, height: 0.95, gloss: 0.2 });
				paint(target, sx + stripe, top - 2, Math.min(stripe, x0 + cell * 0.98 - sx - stripe), awningH, { color: "#f1ece2", height: 0.95, gloss: 0.2 });
			}
			shade(target, x0 + cell * 0.04, top - 2, cell * 0.94, awningH, 0.25, false);
			shade(target, x0 + cell * 0.04, top + awningH - 2, cell * 0.94, awningH * 0.8, 0.5);
		}
	}
	paint(target, 0, height - plinth, size, plinth, { color: "#8a8378", height: 0.6, gloss: 0.15 });
	paint(target, 0, height - plinth, size, 3, { color: "#b9b2a6", height: 0.7 });
}

/** Loading bays: roller doors between corrugated panels. */
function paintWarehouse(target: Layers, random: () => number, cell: number, height: number): void {
	const size = cell * BAYS;
	const rib = Math.max(3, Math.round(cell / 32));
	for (let x = 0; x < size; x += rib * 2) {
		paint(target, x, 0, rib, height, { color: "#dfe0dc", height: 0.62, gloss: 0.4 });
		paint(target, x + rib, 0, rib, height, { color: "#bcbebb", height: 0.4, gloss: 0.35 });
	}
	addGrain(target.color, 8, random, 12);
	for (let bay = 0; bay < BAYS; bay += 2) {
		const x0 = bay * cell + cell * 0.25;
		const w = cell * 1.5;
		const top = height * 0.2;
		paint(target, x0 - 8, top - 8, w + 16, height - top + 8, { color: "#e3b23c", height: 0.7, gloss: 0.3 });
		for (let y = top; y < height; y += 10) {
			paint(target, x0, y, w, 8, { color: "#8c9193", height: 0.45, gloss: 0.45 });
			paint(target, x0, y + 8, w, 2, { color: "#5c6062", height: 0.35 });
		}
		shade(target, x0, top, w, height * 0.12, 0.4);
		if (random() < 0.6) paint(target, x0 + w * 0.1, top + height * 0.2, w * 0.8, height * 0.08, { lit: "rgb(255,210,150)" });
	}
	paint(target, 0, height - height * 0.06, size, height * 0.06, { color: "#6f6e69", height: 0.55 });
}

// ---- Packing -----------------------------------------------------------------------------------

function pack(device: GraphicsDevice, name: string, target: Layers, normalStrength: number): FacadeMaps {
	const { width, height } = target.color.canvas;
	const colour = target.color.getImageData(0, 0, width, height).data;
	const gloss = target.gloss.getImageData(0, 0, width, height).data;
	for (let i = 0; i < colour.length; i += 4) colour[i + 3] = gloss[i];
	const normals = normalsFromHeight(target.height, normalStrength, 0.5);
	return {
		diffuse: textureFromPixels(device, width, height, colour, { name: `${name}-diffuse`, srgb: true }),
		normal: textureFromPixels(device, normals.width, normals.height, normals.pixels, { name: `${name}-normal`, srgb: false }),
		lit: textureFromCanvas(device, target.lit, { name: `${name}-lit`, srgb: true, anisotropy: 4 }),
	};
}

const UPPER_PAINTERS: Readonly<Record<FacadeStyle, (target: Layers, random: () => number, cell: number) => void>> = {
	deco: paintDeco,
	glass: paintGlass,
	office: paintOffice,
	brick: paintBrick,
	apartment: paintApartment,
	industrial: paintIndustrial,
};

const GROUND_PAINTERS: Readonly<Record<GroundStyle, (target: Layers, random: () => number, cell: number, height: number) => void>> = {
	shop: paintShop,
	warehouse: paintWarehouse,
};

export function paintFacade(device: GraphicsDevice, style: FacadeStyle, cell: number): FacadeMaps {
	const size = cell * BAYS;
	const target = layers(size, size);
	UPPER_PAINTERS[style](target, seededRandom(1000 + FACADE_STYLES.indexOf(style) * 7919), cell);
	return pack(device, `facade-${style}`, target, 6);
}

export function paintGround(device: GraphicsDevice, style: GroundStyle, cell: number): FacadeMaps {
	const width = cell * BAYS;
	const height = cell * 2;
	const target = layers(width, height);
	GROUND_PAINTERS[style](target, seededRandom(5000 + GROUND_STYLES.indexOf(style) * 104729), cell, height);
	return pack(device, `ground-${style}`, target, 6);
}

/** Cornices, parapets, fins and rooftop plant: plain plaster to be coloured by the mesh. */
export function paintTrim(device: GraphicsDevice, size: number): FacadeMaps {
	const target = layers(size, size);
	const random = seededRandom(31337);
	paint(target, 0, 0, size, size, { color: "#f5f3ee", height: 0.5, gloss: 0.14 });
	addGrain(target.color, 12, random, 8);
	return pack(device, "trim", target, 2);
}

/**
 * Terracotta roof tiles: barrel tiles in courses, each lit across its curve, the courses
 * overlapping. One repeat covers ROOF_TILE_METRES each way; u runs along the eaves, v up the slope.
 */
export function paintRoofTiles(device: GraphicsDevice, size: number): FacadeMaps {
	const target = layers(size, size);
	const random = seededRandom(2718);
	const courses = 8;
	const across = 10;
	const rowH = size / courses;
	const tileW = size / across;
	for (let row = 0; row < courses; row++) {
		const y = row * rowH;
		const offset = row % 2 === 0 ? 0 : tileW / 2;
		for (let i = -1; i <= across; i++) {
			const x = i * tileW + offset;
			const tone = 0.82 + random() * 0.3;
			const gradient = target.color.createLinearGradient(x, 0, x + tileW, 0);
			gradient.addColorStop(0, rgb(120 * tone, 50 * tone, 32 * tone));
			gradient.addColorStop(0.45, rgb(196 * tone, 98 * tone, 64 * tone));
			gradient.addColorStop(1, rgb(110 * tone, 46 * tone, 30 * tone));
			paint(target, x, y, tileW, rowH, { color: gradient, gloss: 0.3 });
			const relief = target.height.createLinearGradient(x, 0, x + tileW, 0);
			relief.addColorStop(0, grey(0.25));
			relief.addColorStop(0.5, grey(0.8));
			relief.addColorStop(1, grey(0.25));
			target.height.fillStyle = relief;
			target.height.fillRect(x, y, tileW, rowH);
		}
		// The lower edge of each course throws a shadow on the one below (rows run down the canvas,
		// which is down the slope).
		shade(target, 0, y + rowH - rowH * 0.12, size, rowH * 0.12, 0.45, false);
		paint(target, 0, y + rowH - 2, size, 2, { height: 0.1 });
	}
	addGrain(target.color, 10, random, 6);
	return pack(device, "roof-tiles", target, 5);
}
