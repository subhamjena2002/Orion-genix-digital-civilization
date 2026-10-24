/**
 * Builds the city's vehicles from code, the way scripts/build-supercar.mjs builds the Vesper GT:
 *
 *   node scripts/build-vehicles.mjs            every vehicle
 *   node scripts/build-vehicles.mjs sedan bus  just these
 *
 * Every one is an original, generic design — nothing traced from a real make — with no textures:
 * each surface is a PBR material and every detail is geometry, ambient occlusion baked into the
 * vertex colours. The parts the game moves are their own nodes, named as it looks for them
 * (see VehicleModels.ts): the driver's door "door-left"/"door-right" with its "window-…" inside
 * it, "hood", "trunk", the other doors and bumpers (they come loose in a crash), and the wheels.
 *
 * A body is lofted from a cross-section worked out at each station along the vehicle (see
 * sectionHalf): floor, sill, a flank that bulges a little, the belt line, the glass leaning in
 * to the roof rail, and the roof (or, ahead of and behind the cabin, the bonnet and boot)
 * crowning to the centreline. Wheel arches are cut by lifting the sill over each wheel. The
 * skin is split into panels and glass by key index and position (see bodyRegion), and the
 * ends are closed with caps. Lamps, grilles, plates and trim are then laid onto the finished
 * skin by casting rays at it (see projector), so they sit on it wherever it really is.
 *
 * Car space: metres, +Y up, nose towards +Z, +X the vehicle's left.
 */

import { writeFile } from "node:fs/promises";
import { Document, NodeIO } from "@gltf-transform/core";

import {
	profile, clamp01, smoothstep, Geo, cross, sub, add, scale, norm, range, catmull, loft, rotation, box, lathe, tube,
	ribbon, wall, patch, skinBox, mirrorPod, bowl, ring, thicken, bakeOcclusion, projector, projectGrid, roundedBox,
	vehicleDocument,
} from "./vehicle-kit.mjs";

const OUT = "public/models/vehicles";
const lerp = (a, b, t) => a + (b - a) * t;

// ---- The body section -----------------------------------------------------------------------------

/**
 * Key indices round the right half of a section, bottom centre to top centre:
 *   0 floor centre · 1 floor edge · 2 sill lip (lifted over the wheels: the arch) · 3 flank foot
 *   3–6 the flank · 6 belt line (a crease) · 7 glass base · 8 glass top (the drip rail)
 *   9 roof rail · 9–10 roof, crowning to the centreline
 * Ahead of and behind the cabin the "glass" closes down to nothing and 7–10 is the bonnet or boot.
 */
const K = { sill: 3, belt: 6, glassBase: 7, glassTop: 8, rail: 9, top: 10 };
const FLANK_STEPS = 3;
const GLASS_STEPS = 4;
const ROOF_STEPS = 9;

function archTop(spec, z) {
	let top = -Infinity;
	for (const axle of spec.axles) {
		const dz = z - axle.z;
		const r = axle.arch;
		if (Math.abs(dz) < r) top = Math.max(top, axle.radius + Math.sqrt(r * r - dz * dz));
	}
	return top;
}

/** The right half of the body at z, as {x, y, t, crease} from the floor centre to the roof centre. */
function sectionHalf(spec, z) {
	const w = spec.halfWidth(z);
	const floor = spec.floorY(z);
	const belt = spec.beltY(z);
	const roof = Math.max(belt + 0.015, spec.roofY(z));
	const h = roof - belt;
	const c = smoothstep(0.05, 0.3, h);
	const lip = Math.min(belt - 0.1, Math.max(floor + 0.04, archTop(spec, z)));
	const bulge = typeof spec.bulge === "function" ? spec.bulge(z) : spec.bulge ?? 0.012;
	// Where the flank stands furthest out, as a share of sill-to-belt: with `characterLine`, a
	// crease there catches the light down the side, as pressed steel does.
	const crest = spec.crest ?? 0.45;
	const points = [];
	const push = (x, y, t, crease) => points.push({ x, y, t, crease });
	push(0, floor, 0, false);
	push(w - 0.13, floor, 1, true);
	push(w - 0.035, lip, 2, true);
	const flank = [[w - (spec.rockerTuck ?? 0.004), lip + 0.045], [w + bulge, lip + (belt - lip) * crest], [w, belt - 0.07], [w - 0.012, belt]];
	push(...flank[0], K.sill, true);
	for (let k = 0; k < 3; k++) {
		for (let s = 1; s <= FLANK_STEPS; s++) {
			const [x, y] = catmull(flank[Math.max(0, k - 1)], flank[k], flank[k + 1], flank[Math.min(3, k + 2)], s / FLANK_STEPS);
			const t = K.sill + k + s / FLANK_STEPS;
			push(x, y, t, t === K.belt || (spec.characterLine === true && t === K.sill + 1));
		}
	}
	const inset = spec.glassInset;
	const x7 = w - inset;
	const y7 = belt + 0.012;
	const x8 = lerp(w - inset - 0.05, Math.min(spec.roofHalf(z), w - inset - 0.01), c);
	const share = typeof spec.glassShare === "function" ? spec.glassShare(z) : spec.glassShare ?? 0.86;
	const y8 = belt + 0.012 + Math.max(0.008, (h - 0.04) * share * c);
	push(x7, y7, K.glassBase, true);
	for (let s = 1; s <= GLASS_STEPS; s++) {
		const f = s / GLASS_STEPS;
		// Side glass bows out a little, as real glass does.
		const bow = Math.sin(Math.PI * f) * (spec.glassBow ?? 0.012) * c;
		push(x7 + (x8 - x7) * f + bow, y7 + (y8 - y7) * f, K.glassBase + f, s === GLASS_STEPS);
	}
	const top = roof + (spec.crown ?? 0.03);
	const sharp = lerp(2.2, spec.roofSharpness ?? 5, c);
	const curve = (x) => top - (top - y8) * Math.pow(Math.max(0, x / x8), sharp);
	const x9 = Math.max(0.05, x8 - (spec.rail ?? 0.07));
	push(x9, curve(x9), K.rail, false);
	for (let s = 1; s <= ROOF_STEPS; s++) {
		const u = s / ROOF_STEPS;
		const x = x9 * Math.cos((u * Math.PI) / 2);
		push(s === ROOF_STEPS ? 0 : x, curve(x), K.rail + u, false);
	}
	return points;
}

/** A point on the body's right half at z, `t` a key index (fractional). */
function surfacePoint(spec, z, t) {
	const half = sectionHalf(spec, z);
	let k = 0;
	while (k < half.length - 2 && half[k + 1].t < t) k++;
	const a = half[k];
	const b = half[k + 1];
	const f = clamp01((t - a.t) / (b.t - a.t || 1));
	return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, z];
}

function onBody(spec, z, t) {
	const e = 0.002;
	const p = surfacePoint(spec, z, t);
	let n = norm(cross(sub(surfacePoint(spec, z + e, t), surfacePoint(spec, z - e, t)), sub(surfacePoint(spec, z, t + e), surfacePoint(spec, z, t - e))));
	if (n[0] < -0.2 || (Math.abs(n[0]) <= 0.2 && n[1] < 0)) n = scale(n, -1);
	return { p, n };
}

/** Stations along the body: closer at the ends and round the arches, and on every panel cut. */
function stations(spec) {
	const { front, rear } = spec;
	const count = spec.stations ?? 140;
	const zs = [];
	for (let k = 0; k <= count; k++) zs.push(rear + (front - rear) * (0.5 - 0.5 * Math.cos((Math.PI * k) / count)));
	for (const axle of spec.axles) for (let k = -12; k <= 12; k++) zs.push(axle.z + (k / 12) * axle.arch);
	// The rounded ends: a few more just inside each.
	for (const d of [0.01, 0.025, 0.045, 0.07, 0.1]) zs.push(front - d, rear + d);
	for (const cut of spec.cuts ?? []) zs.push(cut);
	return [...new Set(zs.filter((z) => z >= rear && z <= front).map((z) => Math.round(z * 1e4) / 1e4))].sort((a, b) => a - b);
}

/**
 * Which part each quad of the skin belongs to. `doors`, `lids` and `panes` come from the spec;
 * everything else is "body", below the sill "underbody".
 */
function bodyRegion(spec, z, lo, hi, side) {
	if (hi <= 2) return "underbody";
	if (spec.cladding && hi <= spec.cladding(z)) return "cladding";
	for (const door of spec.doors ?? []) {
		if (door.side !== side || z <= door.rear || z >= door.front) continue;
		if (lo >= door.low && hi <= K.glassBase) return door.key;
		if (lo >= K.glassBase && hi <= K.glassTop) {
			if (!door.window) return door.frame ?? door.key;
			const inside = z < door.window.front && z > door.window.rear && lo >= K.glassBase + 0.2 && hi <= K.glassTop - 0.2;
			return inside ? door.window.key : door.frame ?? door.key;
		}
	}
	for (const lid of spec.lids ?? []) {
		if (z > lid.rear && z < lid.front && lo >= lid.edge && hi <= (lid.to ?? Infinity) && lo >= (lid.from ?? -Infinity)) return lid.key;
	}
	for (const pane of spec.panes ?? []) {
		if (z <= pane.rear || z >= pane.front || lo < pane.low || hi > pane.high) continue;
		if (pane.side && pane.side !== side) continue;
		const frit = pane.frit ?? 0.04;
		const edge = z > pane.front - frit || z < pane.rear + frit || lo < pane.low + (pane.fritT ?? 0.2) || hi > pane.high - (pane.fritT ?? 0.2);
		return edge && pane.key !== "frit" ? "frit" : pane.key;
	}
	if (spec.paint2 && spec.paint2(z, lo, hi, side)) return "body2";
	return "body";
}

/**
 * Lofts the body into `parts` and closes both ends. `spec.capRegion(x, y, end)` names the part
 * for each quad of an end cap (default "body").
 */
function buildBody(spec, parts) {
	const zs = stations(spec);
	const halves = zs.map((z) => sectionHalf(spec, z));
	const built = halves.map((half, j) => ring(half, zs[j]));
	const rings = built.map((r) => r.points);
	const creases = built[0].creases;
	const H = halves[0].length;
	const I = rings[0].length;
	const keyOf = (i) => (i < H ? { t: halves[0][i].t, x: 1 } : { t: halves[0][I - i].t, x: -1 });
	const region = (j, i) => {
		const z = (zs[j] + zs[j + 1]) / 2;
		const a = keyOf(i);
		const b = keyOf((i + 1) % I);
		const side = a.t === 0 ? b.x : a.x;
		return bodyRegion(spec, z, Math.min(a.t, b.t), Math.max(a.t, b.t), side);
	};
	loft(rings, creases, region, parts, (p) => [p[0], p[1] - spec.centreY, 0]);

	// End caps: rings shrinking to the middle, bowed out a touch.
	for (const [j, sign, end] of [[0, -1, "rear"], [zs.length - 1, 1, "front"]]) {
		const r = rings[j];
		const centre = scale(r.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / r.length);
		const steps = spec.capSteps ?? 10;
		const capRings = range(0, 1, steps).map((u) => r.map((p) => {
			const q = add(centre, scale(sub(p, centre), 1 - u));
			return [q[0], q[1], q[2] + sign * (spec.capBow ?? 0.015) * Math.sin((u * Math.PI) / 2)];
		}));
		const capRegion = (k, i) => {
			const a = capRings[k][i];
			const b = capRings[k + 1][(i + 1) % I];
			const x = (a[0] + b[0]) / 2;
			const y = (a[1] + b[1]) / 2;
			return spec.capRegion?.(x, y, end) ?? (spec.capPart?.[end] ?? "body");
		};
		loft(capRings, new Array(I).fill(false), capRegion, parts, () => [0, 0, sign]);
	}
}

/**
 * The opening panels' depth: inner skins and edges (thicken) and jamb walls round each opening.
 */
function finishPanels(spec, parts) {
	for (const door of spec.doors ?? []) if (door.thick !== false) thicken(parts.get(door.key), parts.get(`${door.key}-inner`), 0.045);
	for (const lid of spec.lids ?? []) if (lid.thick !== false) thicken(parts.get(lid.key), parts.get(`${lid.key}-inner`), 0.025);
	const jamb = parts.get("jamb");
	const seams = parts.get("seams");
	for (const door of spec.doors ?? []) {
		const mirror = door.side < 0;
		for (const z of [door.front, door.rear]) {
			const path = range(door.low, K.glassTop, 14).map((t) => onBody(spec, z, t));
			wall(jamb, path, 0.07, mirror);
			ribbon(seams, path, 0.005, 0.001, mirror);
		}
		const sill = range(door.rear, door.front, 24).map((z) => onBody(spec, z, door.low));
		wall(jamb, sill, 0.07, mirror);
		ribbon(seams, sill, 0.005, 0.001, mirror);
	}
	for (const lid of spec.lids ?? []) {
		if (lid.seam === false) continue;
		for (const mirror of [false, true]) {
			const edge = range(lid.rear, lid.front, 30).map((z) => onBody(spec, z, lid.edge));
			wall(jamb, edge, 0.06, mirror);
			ribbon(seams, edge, 0.005, 0.001, mirror);
		}
		for (const z of [lid.front, lid.rear]) {
			if (z >= spec.front - 0.01 || z <= spec.rear + 0.01) continue;
			const across = [...range(lid.edge, K.top, 12).map((t) => onBody(spec, z, t)), ...range(K.top, lid.edge, 12).slice(1).map((t) => {
				const { p, n } = onBody(spec, z, t);
				return { p: [-p[0], p[1], p[2]], n: [-n[0], n[1], n[2]] };
			})];
			wall(jamb, across, 0.06);
			ribbon(seams, across, 0.005, 0.001);
		}
	}
}

// ---- Wheels -----------------------------------------------------------------------------------------

/**
 * One wheel at the origin, its outer face towards +X: a tyre with a rounded sidewall and tread
 * grooves (or blocks), and a rim in one of a few styles: "alloy" (split spokes), "steel" (a
 * pressed disc with vents and a hub cap), "truck" (a deep dish with a ring of wheel nuts).
 * `dual` puts a second tyre and rim inboard of the first, as on a lorry's rear axle.
 */
function buildWheel(wheel) {
	const { radius: R, rim: r, width, style = "alloy", spokes = 5, dual = false, blocks = false } = wheel;
	const tyre = new Geo();
	const rim = new Geo();
	const hub = new Geo();
	const one = (offset) => {
		const half = width / 2;
		const o = (x) => x + offset;
		const tread = [];
		const grooves = blocks ? [] : [-0.36, 0, 0.36];
		for (const g of range(-1, 1, 20)) {
			const inGroove = grooves.some((c) => Math.abs(g - c) < 0.05);
			tread.push([inGroove ? R - 0.009 : R, o(g * (half - 0.025))]);
		}
		lathe(tyre, [[r - 0.004, o(-half + 0.012)], [r + 0.025, o(-half - 0.004)], [lerp(r, R, 0.6), o(-half - 0.012)], [R - 0.025, o(-half + 0.004)], [R - 0.006, o(-half + 0.02)], ...tread, [R - 0.006, o(half - 0.02)], [R - 0.025, o(half - 0.004)], [lerp(r, R, 0.6), o(half + 0.012)], [r + 0.025, o(half + 0.004)], [r - 0.004, o(half - 0.012)]], 56);
		if (blocks) {
			// Chunky tread: blocks round the crown, staggered across it.
			const count = Math.round((2 * Math.PI * R) / 0.07);
			for (let k = 0; k < count; k++) {
				const a = (k / count) * Math.PI * 2;
				for (const [x, w] of [[k % 2 ? -0.22 : -0.28, 0.2], [k % 2 ? 0.28 : 0.22, 0.2]]) {
					box(tyre, [o(x * width), Math.cos(a) * (R + 0.006), Math.sin(a) * (R + 0.006)], [w * width, 0.014, 0.045], 0, (a * 180) / Math.PI);
				}
			}
		}
		// Barrel, its outer lip.
		lathe(rim, [[r + 0.01, o(half - 0.006)], [r + 0.01, o(half - 0.02)], [r - 0.01, o(half - 0.028)], [r - 0.02, o(-half + 0.03)], [r - 0.004, o(-half + 0.004)]], 48, [0, 0, 0], true);
		const face = half - 0.03;
		if (style === "alloy") {
			// Split spokes from the hub to the lip, dished in towards the middle.
			const depth = (radius) => o(face - 0.04 * (1 - radius / r));
			lathe(rim, [[r - 0.01, o(face)], [r - 0.03, o(face - 0.004)], [r - 0.03, o(face - 0.03)]], 48, [0, 0, 0], true);
			for (let k = 0; k < spokes * 2; k++) {
				const pair = Math.floor(k / 2);
				const a = ((pair + (k % 2 ? 0.09 : -0.09)) / spokes) * Math.PI * 2;
				const from = 0.07;
				const to = r - 0.025;
				const mid = (from + to) / 2;
				const len = to - from;
				const centre = [depth(mid), Math.cos(a) * mid, Math.sin(a) * mid];
				box(rim, centre, [0.03, len, 0.022], 0, (a * 180) / Math.PI, 0);
			}
			lathe(rim, [[0, o(face + 0.004)], [0.05, o(face + 0.002)], [0.075, o(face - 0.02)], [0.075, o(face - 0.06)]], 24, [0, 0, 0], true);
			for (let k = 0; k < 5; k++) {
				const a = (k / 5) * Math.PI * 2;
				tube(hub, [o(face + 0.006), Math.cos(a) * 0.04, Math.sin(a) * 0.04], [o(face - 0.01), Math.cos(a) * 0.04, Math.sin(a) * 0.04], 0.008, 6);
			}
		} else if (style === "multi") {
			// A modern multi-spoke: thin twin spokes standing proud of a dark, recessed barrel (the
			// gaps read as depth, not as a flat grey disc), a polished lip, and a centre cap.
			const dish = (radius) => o(face - 0.055 * (1 - radius / r));
			lathe(rim, [[r - 0.004, o(face + 0.004)], [r - 0.022, o(face)], [r - 0.03, o(face - 0.02)]], 64, [0, 0, 0], true);
			// The barrel's inside, seen between the spokes: in the tyre's black, set well back.
			lathe(tyre, [[r - 0.02, o(face - 0.07)], [0.1, o(face - 0.085)]], 48, [0, 0, 0], true);
			for (let k = 0; k < spokes; k++) {
				for (const offset of [-0.055, 0.055]) {
					const a = ((k + offset) / spokes) * Math.PI * 2;
					const from = 0.085;
					const to = r - 0.026;
					const mid = (from + to) / 2;
					box(rim, [dish(mid), Math.cos(a) * mid, Math.sin(a) * mid], [0.024, to - from, 0.017], 0, (a * 180) / Math.PI, 0);
				}
			}
			lathe(rim, [[0, o(face + 0.002)], [0.06, o(face)], [0.085, o(face - 0.03)], [0.085, o(face - 0.07)]], 32, [0, 0, 0], true);
			lathe(hub, [[0, o(face + 0.006)], [0.036, o(face + 0.005)], [0.04, o(face + 0.001)]], 24);
			for (let k = 0; k < 5; k++) {
				const a = (k / 5) * Math.PI * 2;
				tube(hub, [o(face - 0.006), Math.cos(a) * 0.058, Math.sin(a) * 0.058], [o(face - 0.022), Math.cos(a) * 0.058, Math.sin(a) * 0.058], 0.009, 6);
			}
		} else if (style === "steel") {
			// A pressed steel disc: a raised ring, vents, and a plain hub cap.
			lathe(rim, [[r - 0.012, o(face - 0.01)], [r * 0.8, o(face - 0.002)], [r * 0.7, o(face - 0.012)], [r * 0.45, o(face - 0.012)], [r * 0.38, o(face)], [0.001, o(face)]], 40, [0, 0, 0], true);
			for (let k = 0; k < 8; k++) {
				const a = (k / 8) * Math.PI * 2;
				box(hub, [o(face - 0.006), Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58], [0.014, 0.05, 0.03], 0, (a * 180) / Math.PI);
			}
			lathe(hub, [[0, o(face + 0.025)], [r * 0.2, o(face + 0.022)], [r * 0.32, o(face + 0.008)], [r * 0.34, o(face)]], 32);
		} else {
			// A lorry's deep dish, a hub with a ring of wheel nuts.
			lathe(rim, [[r - 0.012, o(face - 0.01)], [r * 0.82, o(face - 0.07)], [r * 0.5, o(face - 0.08)], [r * 0.45, o(face - 0.06)], [0.001, o(face - 0.06)]], 40, [0, 0, 0], true);
			for (let k = 0; k < 6; k++) {
				const a = (k / 6) * Math.PI * 2;
				tube(hub, [o(face - 0.07), Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66], [o(face - 0.07), Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66].map((v, i) => (i === 0 ? v + 0.004 : v)), 0.045, 12);
			}
			lathe(hub, [[0, o(face - 0.0)], [0.08, o(face - 0.004)], [0.11, o(face - 0.03)], [0.12, o(face - 0.06)]], 24, [0, 0, 0], true);
			for (let k = 0; k < 10; k++) {
				const a = (k / 10) * Math.PI * 2;
				tube(hub, [o(face - 0.055), Math.cos(a) * 0.15, Math.sin(a) * 0.15], [o(face - 0.03), Math.cos(a) * 0.15, Math.sin(a) * 0.15], 0.014, 6);
			}
		}
	};
	one(0);
	if (dual) one(-(width + 0.03));
	return { tyre, rim, hub };
}

// ---- Shared materials ------------------------------------------------------------------------------

function materials(material, paint, extra = {}) {
	return {
		paint: material(paint.name ?? "carpaint", paint.colour, { metallic: paint.metallic ?? 0.5, roughness: paint.roughness ?? 0.3, doubleSided: true }),
		paint2: material(extra.paint2?.name ?? "paint_secondary", extra.paint2?.colour ?? [0.9, 0.9, 0.9], { metallic: 0.3, roughness: 0.32, doubleSided: true }),
		trim: material("trim", [0.03, 0.031, 0.033], { roughness: 0.55 }),
		gloss: material("trim_gloss", [0.012, 0.012, 0.014], { roughness: 0.15 }),
		cladding: material("cladding", [0.045, 0.045, 0.047], { roughness: 0.75 }),
		chrome: material("chrome", [0.82, 0.82, 0.84], { metallic: 1, roughness: 0.12 }),
		// Lighter, clearer glass (`extra.glass`) lets the cabin read through it on the cars people look at.
		glass: material("glass", extra.glass?.colour ?? [0.03, 0.04, 0.05], { roughness: 0.03, alpha: extra.glass?.alpha ?? 0.62, doubleSided: true }),
		// Frosted panes (an ambulance's patient compartment): pale and nearly opaque.
		frost: material("glass_frosted", [0.78, 0.8, 0.82], { roughness: 0.6, alpha: 0.9, doubleSided: true }),
		underbody: material("underbody", [0.035, 0.035, 0.035], { roughness: 0.9 }),
		headlight: material("headlight", [1, 1, 1], { roughness: 0.1, emissive: [1, 0.98, 0.94] }),
		lens: material("headlight_lens", [0.9, 0.93, 1], { roughness: 0.05, emissive: [0.5, 0.52, 0.55] }),
		lampHousing: material("lamp_housing", [0.025, 0.026, 0.03], { metallic: 0.9, roughness: 0.15 }),
		lampGlass: material("lamp_glass", [0.9, 0.92, 0.95], { roughness: 0, alpha: 0.14, doubleSided: true }),
		taillight: material("tail_light", [0.5, 0.02, 0.02], { roughness: 0.15, emissive: [0.3, 0.01, 0.01] }),
		indicator: material("indicator", [0.95, 0.45, 0.05], { roughness: 0.15, emissive: [0.35, 0.15, 0.01] }),
		reverse: material("reverse_lamp", [0.85, 0.86, 0.88], { roughness: 0.1 }),
		plate: material("plate_blank", [0.88, 0.88, 0.85], { roughness: 0.4 }),
		// Charcoal rather than near-black: a cabin seen through glass or an open door reads as a
		// cabin, not a hole. Light inserts, carpet and screens are their own colours (flattened).
		interior: material("interior", extra.interior ?? [0.14, 0.135, 0.13], { roughness: 0.7 }),
		upholstery: material("upholstery_light", extra.upholstery ?? [0.56, 0.54, 0.5], { roughness: 0.8 }),
		carpet: material("carpet", [0.17, 0.165, 0.16], { roughness: 0.95 }),
		screen: material("screen_glass", [0.03, 0.045, 0.07], { roughness: 0.1 }),
		dash: material("dashboard", [0.04, 0.04, 0.042], { roughness: 0.55 }),
		jamb: material("jamb", [0.4, 0.4, 0.4], { roughness: 0.5, doubleSided: true }),
		tyre: material("tyre_rubber", [0.03, 0.03, 0.032], { roughness: 0.92 }),
		// Machined silver: modern alloys read bright against the tyre.
		rim: material("rim", extra.rim ?? [0.76, 0.77, 0.8], { metallic: 1, roughness: 0.2 }),
		hub: material("hub", extra.hub ?? [0.5, 0.5, 0.52], { metallic: 1, roughness: 0.3 }),
		rotor: material("rotor", [0.42, 0.42, 0.43], { metallic: 1, roughness: 0.42 }),
		caliper: material("caliper", [0.12, 0.12, 0.13], { metallic: 0.3, roughness: 0.4 }),
		steel: material("steel", [0.4, 0.41, 0.43], { metallic: 0.8, roughness: 0.45 }),
		// Under the bonnet: the engine's alloy, its oil cap, a battery terminal, the coolant bottle (all flattened).
		// Bare cast alloy reads as light grey satin: polished metal in a shaded bay only mirrors the dark.
		engineAlloy: material("engine_alloy", [0.6, 0.61, 0.63], { roughness: 0.5 }),
		engineCap: material("engine_cap", [0.92, 0.72, 0.08], { roughness: 0.4 }),
		engineRed: material("engine_red", [0.65, 0.06, 0.05], { roughness: 0.4 }),
		coolant: material("coolant_bottle", [0.84, 0.84, 0.78], { roughness: 0.35 }),
		sirenRed: material("siren-red", [0.55, 0.03, 0.03], { roughness: 0.1, emissive: [0.08, 0, 0], alpha: 0.85 }),
		sirenBlue: material("siren-blue", [0.03, 0.1, 0.6], { roughness: 0.1, emissive: [0, 0.01, 0.1], alpha: 0.85 }),
		beaconAmber: material("beacon-amber", [0.95, 0.5, 0.05], { roughness: 0.1, emissive: [0.25, 0.1, 0], alpha: 0.85 }),
		accent: material("accent", extra.accent ?? [0.7, 0.05, 0.05], { roughness: 0.4 }),
		accent2: material("accent_2", extra.accent2 ?? [0.95, 0.95, 0.95], { roughness: 0.4 }),
		...Object.fromEntries(Object.entries(extra.materials ?? {}).map(([key, [name, colour, opts]]) => [key, material(name, colour, opts)])),
	};
}

/**
 * The part table every body shares: part key → [node, material, parent part]. Doors that open
 * (only the driver's side front door is "door-…": the game swings every "door…" node on that
 * side together) and other loose panels get their own nodes; everything rigid shares "body".
 */
function partTable(M, spec) {
	const table = {
		body: ["body", M.paint],
		body2: ["body", M.paint2],
		jamb: ["body", M.paint],
		seams: ["body", M.gloss],
		frit: ["body", M.gloss],
		cladding: ["body", M.cladding],
		underbody: ["underbody", M.underbody],
		trim: ["trim", M.trim],
		gloss: ["trim", M.gloss],
		chrome: ["chrome-parts", M.chrome],
		steel: ["chrome-parts", M.steel],
		"engine-alloy": ["body", M.engineAlloy],
		"engine-cap": ["body", M.engineCap],
		"engine-red": ["body", M.engineRed],
		coolant: ["body", M.coolant],
		windscreen: ["windscreen-glass", M.glass],
		"rear-glass": ["rear-glass", M.glass],
		"side-glass": ["side-glass", M.glass],
		"frost-glass": ["side-glass", M.frost],
		headlight: ["lights-front", M.headlight],
		// Lenses light up with the headlamps (the game matches both by name): one material, one draw.
		lens: ["lights-front", M.headlight],
		"lamp-housing": ["lights-front", M.lampHousing],
		"lamp-glass": ["lights-front", M.lampGlass],
		indicator: ["lights-front", M.indicator],
		taillight: ["lights-rear", M.taillight],
		reverse: ["lights-rear", M.reverse],
		plate: ["trim", M.plate],
		interior: ["cabin", M.interior],
		upholstery: ["cabin", M.upholstery],
		carpet: ["cabin", M.carpet],
		screen: ["cabin", M.screen],
		dash: ["cabin", M.dash],
		accent: ["body", M.accent],
		accent2: ["body", M.accent2],
		"siren-red": ["lightbar", M.sirenRed],
		"siren-blue": ["lightbar", M.sirenBlue],
		beacon: ["beacons", M.beaconAmber],
		"mirror-left": ["mirror-left", M.paint],
		"mirror-left-glass": ["mirror-left", M.chrome],
		"mirror-right": ["mirror-right", M.paint],
		"mirror-right-glass": ["mirror-right", M.chrome],
		"bumper-front": ["bumper-front", spec.bumperPaint ? M.paint : M.trim],
		"bumper-rear": ["bumper-rear", spec.bumperPaint ? M.paint : M.trim],
	};
	for (const door of spec.doors ?? []) {
		table[door.key] = [door.key, door.paint2 ? M.paint2 : M.paint];
		table[`${door.key}-inner`] = [door.key, M.interior];
		if (door.frame && door.frame !== door.key) table[door.frame] = [door.key, M.gloss];
		table[`${door.key}-handle`] = [door.key, M.trim];
		table[`${door.key}-decor`] = [door.key, M.accent];
		table[`${door.key}-decor2`] = [door.key, M.accent2];
		if (door.window) table[door.window.key] = [door.window.key, M.glass, door.key];
	}
	for (const lid of spec.lids ?? []) {
		table[lid.key] = [lid.key, M.paint];
		table[`${lid.key}-inner`] = [lid.key, M.underbody];
		table[`${lid.key}-trim`] = [lid.key, M.trim];
	}
	return table;
}

const MOVING = /^(door|rear-door|side-door|bus-door|back-door|hood|trunk|tailgate|window|rear-window|mirror|bumper)/;

/**
 * Plain opaque materials — trims, interiors, underbody, metals — differ only in colour within a
 * few kinds of finish. Each gets its colour baked into the vertex colours (over the ambient
 * occlusion already there) and is drawn with one shared material per finish, so a vehicle is
 * about a dozen draws rather than twenty-five. Paint, glass, lamps and sirens keep their own:
 * the game finds and changes those by name.
 */
const FINISHES = {
	flat_matte: { roughness: 0.84, names: ["underbody", "cladding", "interior", "tyre_rubber", "upholstery_light", "carpet"] },
	flat_satin: { roughness: 0.48, names: ["trim", "dashboard", "plate_blank", "accent", "accent_2", "accent_blue", "traffic_cone", "stop_arm", "grab_poles", "jamb", "indicator", "engine_cap", "engine_red", "coolant_bottle", "engine_alloy"] },
	flat_gloss: { roughness: 0.14, metallic: 0.3, names: ["trim_gloss", "lamp_housing", "reverse_lamp", "screen_glass"] },
	flat_metal: { roughness: 0.24, metallic: 1, names: ["chrome", "rim", "steel", "hub", "rotor", "caliper", "aluminium"] },
};

function flattenMaterials(material, paletteTexture, table, parts, wheels) {
	// One material for every finish: roughness and metalness come from a texel of a palette
	// (glTF's metallic-roughness texture: green roughness, blue metalness), picked per part by its
	// texture coordinate; colour comes from the vertices.
	const finishes = Object.values(FINISHES);
	const pixels = finishes.flatMap(({ roughness, metallic = 0 }) => [255, Math.round(roughness * 255), Math.round(metallic * 255), 255]);
	const shared = material("flat_surface", [1, 1, 1], { roughness: 1, metallic: 1 });
	shared.setMetallicRoughnessTexture(paletteTexture("flat_surface_finishes", finishes.length, pixels));
	shared.getMetallicRoughnessTextureInfo().setMinFilter(9728).setMagFilter(9728);
	const finishOf = new Map();
	finishes.forEach(({ names }, index) => {
		for (const name of names) finishOf.set(name, Math.round(((index + 0.5) / finishes.length) * 255));
	});
	const tinted = new Set();
	const tint = (geo, mat, u) => {
		if (tinted.has(geo) || geo.empty) return;
		tinted.add(geo);
		const [r, g, b] = mat.getBaseColorFactor();
		const count = geo.positions.length / 3;
		const colours = geo.colours ?? new Uint8Array(count * 4).fill(255);
		const uvs = new Uint8Array(count * 2);
		for (let v = 0; v < count; v++) {
			colours[v * 4] = Math.round(colours[v * 4] * r);
			colours[v * 4 + 1] = Math.round(colours[v * 4 + 1] * g);
			colours[v * 4 + 2] = Math.round(colours[v * 4 + 2] * b);
			uvs[v * 2] = u;
			uvs[v * 2 + 1] = 128;
		}
		geo.colours = colours;
		geo.uvs = uvs;
	};
	for (const [key, entry] of Object.entries(table)) {
		const u = finishOf.get(entry[1].getName());
		if (u === undefined) continue;
		tint(parts.get(key), entry[1], u);
		table[key] = [entry[0], shared, entry[2]];
	}
	for (const wheel of wheels) {
		wheel.primitives = wheel.primitives.map(([geo, mat]) => {
			const u = finishOf.get(mat.getName());
			if (u === undefined) return [geo, mat];
			tint(geo, mat, u);
			return [geo, shared];
		});
	}
}

/**
 * The indicators as two parts, one per side, each with its own material, so the game can flash
 * either side for a turn (see OrionVehicleModel). Built as one "indicator" part (every lamp on
 * the car, front, side and rear); split here by which side of the centreline each triangle is.
 * They also stay out of the shared finishes: merged into those they lost their glow entirely.
 */
function splitIndicators(material, parts, table) {
	const geo = parts.get("indicator");
	const entry = table.indicator;
	if (!geo || geo.empty || !entry) return;
	const [node, source] = entry;
	const [r, g, b] = source.getBaseColorFactor();
	const halves = { left: new Geo(), right: new Geo() };
	const colours = { left: [], right: [] };
	const remap = { left: new Map(), right: new Map() };
	const P = geo.positions;
	for (let t = 0; t < geo.indices.length; t += 3) {
		const tri = geo.indices.slice(t, t + 3);
		const x = (P[tri[0] * 3] + P[tri[1] * 3] + P[tri[2] * 3]) / 3;
		const side = x > 0 ? "left" : "right";
		const out = halves[side];
		const map = remap[side];
		for (const index of tri) {
			if (!map.has(index)) {
				map.set(index, out.vertex(geo.point(index), geo.normal(index)));
				if (geo.colours) colours[side].push(...geo.colours.slice(index * 4, index * 4 + 4));
			}
			out.indices.push(map.get(index));
		}
	}
	parts.delete("indicator");
	delete table.indicator;
	for (const side of ["left", "right"]) {
		const half = halves[side];
		if (half.empty) continue;
		if (geo.colours) half.colours = Uint8Array.from(colours[side]);
		const key = `indicator-${side}`;
		parts.set(key, half);
		// Unlit: an amber lens with only a faint glow of its own; the game lights it to flash.
		table[key] = [node, material(`indicator_${side}`, [r, g, b], { roughness: 0.15, emissive: [0.05, 0.02, 0] })];
	}
}

/** Builds, bakes and writes one vehicle. */
async function finish(name, build) {
	const started = Date.now();
	const { material, write, paletteTexture } = vehicleDocument(name, Document);
	const { parts, table, wheels, aoReach } = build(material);
	const all = [...parts.values()].filter((geo) => !geo.empty);
	const solid = [...parts.entries()].filter(([key, geo]) => !geo.empty && !/glass|windscreen|window|siren|beacon/.test(key)).map(([, geo]) => geo);
	bakeOcclusion(all, solid, { reach: aoReach ?? 0.55 });
	const done = new Set();
	for (const wheel of wheels) {
		if (done.has(wheel.mesh)) continue;
		done.add(wheel.mesh);
		const geos = wheel.primitives.map(([geo]) => geo).filter((geo) => !geo.empty);
		bakeOcclusion(geos, geos, { ground: false });
	}
	splitIndicators(material, parts, table);
	flattenMaterials(material, paletteTexture, table, parts, wheels);
	const target = `${OUT}/${name}.glb`;
	const stats = await write(target, parts, table, { moving: MOVING, wheels }, NodeIO, writeFile);
	console.log(`${target}: ${(stats.bytes / 1024).toFixed(0)} KB, ${stats.vertices} vertices, ${stats.triangles} triangles, ${stats.nodes} nodes, ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

function partsFor(table) {
	return new Map(Object.keys(table).map((key) => [key, new Geo()]));
}

/** Wheels on each axle, both sides; the right-hand ones turned round so the face looks out. */
function wheelSet(spec, M) {
	const wheels = [];
	for (const [index, axle] of spec.axles.entries()) {
		const { tyre, rim, hub } = buildWheel(axle.wheel);
		const disc = new Geo();
		const caliper = new Geo();
		if (axle.wheel.style === "alloy" || axle.wheel.style === "multi") {
			lathe(disc, [[0.08, 0.02], [axle.wheel.rim - 0.05, 0.02], [axle.wheel.rim - 0.05, -0.01], [0.08, -0.01], [0.08, 0.02]], 40, [axle.wheel.width / 2 - 0.1, 0, 0], true);
		}
		const name = axle.z > 0 ? (index === 0 ? "front" : `front${index}`) : `rear${spec.axles.filter((a) => a.z <= 0).indexOf(axle) || ""}`;
		const primitives = [[tyre, M.tyre], [rim, M.rim], [hub, M.hub], [disc, M.rotor]];
		for (const side of [1, -1]) {
			wheels.push({
				name: `wheel-${name}-${side > 0 ? "left" : "right"}`,
				mesh: `wheel-${name}`,
				primitives,
				translation: [side * axle.track, axle.radius, axle.z],
				rotation: side > 0 ? [0, 0, 0, 1] : [0, 1, 0, 0],
			});
		}
		if (axle.wheel.style === "alloy" || axle.wheel.style === "multi") {
			box(caliper, [-0.01, axle.wheel.rim * 0.45, -axle.wheel.rim * 0.45], [0.07, 0.13, 0.18], 0, 45);
			for (const side of [1, -1]) {
				wheels.push({
					name: `brake-caliper-${name}-${side > 0 ? "left" : "right"}`,
					mesh: `caliper-${name}`,
					primitives: [[caliper, M.caliper]],
					translation: [side * (axle.track - axle.wheel.width / 2 + 0.1), axle.radius, axle.z],
					rotation: side > 0 ? [0, 0, 0, 1] : [0, 1, 0, 0],
				});
			}
		}
	}
	return wheels;
}

// ---- Shared details ---------------------------------------------------------------------------------

/**
 * A lamp unit laid on the skin: a black housing, reflector bowls with lenses and a light strip.
 * (A clear cover over it is optional: it reads only up close, and costs every car a draw.) `outline(u, v)` gives points in space off the body, projected along `direction`.
 */
function lampUnit(parts, at, outline, direction, { bowls = [], strip = null, lens = "lens", stripPart = "headlight", rows = 10, cols = 6, cover = false } = {}) {
	const grid = projectGrid(at, outline, direction, rows, cols);
	if (grid.length < 2) return;
	patch(parts.get("lamp-housing"), grid, 0.003);
	if (cover) patch(parts.get("lamp-glass"), grid, 0.014);
	if (strip) {
		const path = range(strip.from, strip.to, 14).map((u) => at(outline(u, strip.v), direction)).filter(Boolean);
		if (path.length > 1) ribbon(parts.get(stripPart), path, strip.width ?? 0.012, 0.006);
	}
	for (const [u, v, radius] of bowls) {
		const hit = at(outline(u, v), direction);
		if (!hit) continue;
		const base = add(hit.p, scale(hit.n, 0.003));
		bowl(parts.get("chrome"), base, hit.n, radius);
		tube(parts.get(lens), add(base, scale(hit.n, 0.003)), add(base, scale(hit.n, 0.007)), radius * 0.45, 16);
	}
}

/** A flat panel laid on the skin (a plate, a grille's backing, a stripe), `lift` off it. */
function decal(parts, key, at, outline, direction, lift = 0.002, rows = 4, cols = 4) {
	const grid = projectGrid(at, outline, direction, rows, cols);
	if (grid.length >= 2) patch(parts.get(key), grid, lift);
	return grid;
}

/** Bars across a grille: each a thin box laid on the skin. */
function grilleBars(parts, key, at, from, to, ys, direction, size) {
	for (const y of ys) {
		const left = at(add([from, y, 0], scale(direction, -3)), direction);
		const right = at(add([to, y, 0], scale(direction, -3)), direction);
		if (!left || !right) continue;
		const mid = scale(add(left.p, right.p), 0.5);
		const n = norm(add(left.n, right.n));
		skinBox(parts.get(key), add(mid, scale(n, size[2] / 2 + 0.004)), sub(right.p, left.p), n, [Math.hypot(...sub(right.p, left.p)), size[1], size[2]]);
	}
}

/** Door handles: a dark recess with a pull bar, near the door's rear edge below the belt. */
function doorHandle(spec, parts, door, { at = 0.12, below = 0.07, length = 0.15 } = {}) {
	const geo = parts.get(`${door.key}-handle`);
	const mirror = door.side < 0;
	const beltT = K.belt - 0.35;
	void below;
	const z0 = door.rear + at;
	const path = range(z0, z0 + length, 6).map((z) => onBody(spec, z, beltT));
	ribbon(geo, path, 0.03, 0.0015, mirror);
	const { p, n } = onBody(spec, z0 + length / 2, beltT);
	skinBox(geo, add(p, scale(n, 0.006)), [0, 0, 1], n, [length - 0.03, 0.012, 0.01], 0, mirror);
}

/** Wing mirrors on stalks off the front of the front doors. */
function mirrors(spec, parts, { z, size = [0.1, 0.06, 0.05], reach = 0.14, up = 0.08 }) {
	for (const side of [1, -1]) {
		const name = side > 0 ? "left" : "right";
		const { p } = onBody(spec, z, K.glassBase + 0.3);
		const mount = [side * p[0], p[1], z];
		const pod = [side * (p[0] + reach), p[1] + up, z - 0.03];
		const shell = parts.get(`mirror-${name}`);
		tube(shell, mount, sub(pod, [side * size[0] * 0.5, 0, 0]), 0.014, 8);
		mirrorPod(shell, parts.get(`mirror-${name}-glass`), pod, size, side * -8);
	}
}

/** Wipers parked at the foot of a windscreen. */
function wipers(parts, at, xs, y, z, length) {
	for (const x of xs) {
		const a = at([x, y + 1, z], [0, -1, 0]);
		const b = at([x + length, y + 1, z + 0.02], [0, -1, 0]);
		if (!a || !b) continue;
		tube(parts.get("trim"), add(a.p, scale(a.n, 0.02)), add(b.p, scale(b.n, 0.018)), 0.008, 6);
	}
}

/** A seat: cushion, back and headrest, as rounded boxes. */
function seat(geo, x, y, z, { width = 0.5, back = 0.62, recline = -14, headrest = true, lite = false } = {}) {
	// `lite` for rows of them (a bus): seen through glass, one bevel each is plenty.
	const segments = lite ? 1 : undefined;
	roundedBox(geo, [x, y + 0.06, z], [width, 0.12, 0.5], 0.04, { segments });
	roundedBox(geo, [x, y + 0.08 + back / 2, z - 0.25], [width, back, 0.12], 0.05, { pitch: recline, segments });
	if (headrest) roundedBox(geo, [x, y + 0.14 + back, z - 0.32], [width * 0.5, 0.16, 0.09], 0.035, { pitch: recline, segments });
}

/** Dashboard, steering wheel and column for a driver at x, seated at (y, z). */
function cockpit(parts, { x, y, z, width, dashZ, dashY, wheelTilt = -22 }) {
	const dash = parts.get("dash");
	roundedBox(dash, [0, dashY, dashZ], [width, 0.16, 0.42], 0.06, { pitch: 6 });
	const wheelCentre = [x, dashY + 0.02, dashZ - 0.32];
	tube(dash, add(wheelCentre, [0, -0.05, 0.25]), wheelCentre, 0.025, 8);
	const turn = rotation(0, wheelTilt, 0);
	const steer = new Geo();
	lathe(steer, [[0.17, -0.014], [0.188, 0], [0.17, 0.014], [0.152, 0], [0.17, -0.014]], 28);
	for (const a of [0, 2.1, 4.2]) box(steer, [0, Math.cos(a) * 0.085, Math.sin(a) * 0.085], [0.02, 0.17, 0.03], 0, (a * 180) / Math.PI);
	// The wheel is built facing +X; stand it up to face the driver (-Z) and tilt it back.
	const face = rotation(90, 0, 0);
	for (let k = 0; k < steer.positions.length / 3; k++) {
		const p = turn(face(steer.point(k)));
		const n = turn(face(steer.normal(k)));
		steer.positions.splice(k * 3, 3, ...add(p, wheelCentre));
		steer.normals.splice(k * 3, 3, ...n);
	}
	const target = parts.get("dash");
	const base = target.positions.length / 3;
	target.positions.push(...steer.positions);
	target.normals.push(...steer.normals);
	target.indices.push(...steer.indices.map((i) => i + base));
	void y;
	void z;
}

// ---- The sedan, and the cars built on it ------------------------------------------------------------

/**
 * A four-door saloon, 4.7 m, sized like the city's everyday cars. The taxi and the patrol car
 * are the same body with their own fittings.
 */
function sedanSpec(overrides = {}) {
	// A modern four-door: wide and low, a long fastback roof, a waist that rises to the tail,
	// short overhangs, and 19-inch wheels filling tight arches.
	const FRONT = 2.42;
	const REAR = -2.4;
	const wheel = { radius: 0.345, rim: 0.27, width: 0.235, style: "multi", spokes: 5 };
	const spec = {
		front: FRONT,
		rear: REAR,
		centreY: 0.75,
		stations: 160,
		axles: [
			{ z: 1.48, radius: 0.345, arch: 0.372, track: 0.81, wheel },
			{ z: -1.38, radius: 0.345, arch: 0.372, track: 0.81, wheel },
		],
		halfWidth: profile([[REAR, 0.64], [-2.36, 0.82], [-2.25, 0.9], [-1.95, 0.93], [-1.38, 0.935], [0, 0.925], [1.48, 0.93], [1.95, 0.91], [2.22, 0.85], [2.36, 0.74], [FRONT, 0.6]]),
		floorY: profile([[REAR, 0.4], [-2.3, 0.3], [-2.1, 0.21], [-1.85, 0.155], [1.85, 0.15], [2.15, 0.2], [2.35, 0.27], [FRONT, 0.33]]),
		beltY: profile([[REAR, 0.86], [-2.34, 0.96], [-2.2, 1.0], [-1.8, 1.02], [-1.0, 1.0], [0, 0.975], [0.9, 0.95], [1.5, 0.9], [2.0, 0.83], [2.3, 0.74], [FRONT, 0.64]]),
		roofY: profile([[REAR, 0.87], [-2.34, 0.98], [-2.15, 1.02], [-1.8, 1.04], [-1.65, 1.09], [-1.35, 1.22], [-0.95, 1.35], [-0.5, 1.41], [-0.1, 1.425], [0.3, 1.405], [0.6, 1.32], [0.85, 1.16], [1.1, 0.99], [1.35, 0.965], [1.9, 0.9], [2.2, 0.8], [2.35, 0.7], [FRONT, 0.63]]),
		roofHalf: profile([[-1.6, 0.66], [-1.0, 0.66], [-0.3, 0.67], [0.5, 0.68], [1.1, 0.76]]),
		glassInset: 0.075,
		glassShare: 0.84,
		crown: 0.03,
		roofSharpness: 4.5,
		bulge: 0.02,
		crest: 0.58,
		characterLine: true,
		rockerTuck: 0.03,
		bumperPaint: true,
		cladding: (z) => (Math.abs(z) > 2.1 ? 3.6 : 0),
		cuts: [0.98, -0.1, -0.12, -1.06, 1.12, -1.62, 0.92, -0.06, -0.16, -1.0],
		doors: [],
		lids: [
			{ key: "hood", front: FRONT - 0.04, rear: 1.12, edge: K.glassBase },
			{ key: "trunk", front: -1.62, rear: REAR + 0.04, edge: K.glassBase },
		],
		panes: [
			{ key: "windscreen", front: 1.12, rear: 0.48, low: K.rail, high: K.top + 0.01, frit: 0.05, fritT: 0.12 },
			{ key: "rear-glass", front: -0.62, rear: -1.6, low: K.rail, high: K.top + 0.01, frit: 0.05, fritT: 0.12 },
			{ key: "side-glass", front: -1.03, rear: -1.4, low: K.glassBase, high: K.glassTop, frit: 0.035 },
		],
		...overrides,
	};
	// Front and rear doors each side; only the front pair are "door-…" (see partTable).
	for (const side of [1, -1]) {
		const s = side > 0 ? "left" : "right";
		spec.doors.push(
			{ key: `door-${s}`, side, front: 0.98, rear: -0.1, low: K.sill + 0.25, frame: `door-${s}-frame`, window: { key: `window-${s}`, front: 0.92, rear: -0.06 } },
			{ key: `rear-door-${s}`, side, front: -0.12, rear: -1.06, low: K.sill + 0.25, frame: `rear-door-${s}-frame`, window: { key: `rear-window-${s}`, front: -0.16, rear: -1.0 } },
		);
	}
	return spec;
}

/** Rays at the painted skin (body, lids, doors): where details are laid on it. */
function bodyProjector(spec, parts) {
	const keys = ["body", "body2", "cladding", ...(spec.lids ?? []).map((lid) => lid.key), ...(spec.doors ?? []).map((door) => door.key)];
	return projector(keys.map((key) => parts.get(key)).filter((g) => g && !g.empty));
}

/**
 * A livery mark on the flank at (z, t): a thin box on the skin, in the door's own part when it
 * falls on a door (so it swings with it), else on the body. `which` is "decor" or "decor2".
 */
function flankMark(spec, parts, side, z, t, size, which = "decor") {
	const door = (spec.doors ?? []).find((d) => d.side === side && z > d.rear + size[0] / 2 && z < d.front - size[0] / 2 && t > d.low && t < K.glassBase);
	const onDoorEdge = (spec.doors ?? []).some((d) => d.side === side && Math.abs(z - d.rear) < size[0] / 2 + 0.004 || d.side === side && Math.abs(z - d.front) < size[0] / 2 + 0.004);
	if (onDoorEdge) return;
	const geo = parts.get(door ? `${door.key}-${which}` : which === "decor" ? "accent" : "accent2");
	const { p, n } = onBody(spec, z, t);
	skinBox(geo, add(p, scale(n, size[2] / 2 + 0.001)), [0, 0, 1], n, size, 0, side < 0);
}

/** A line of light along the skin from x0 to x1 at height y, on the face that `direction` looks at. */
function lightBar(parts, at, key, x0, x1, y, direction, width) {
	const path = range(x0, x1, 28).map((x) => at([x, y, -3 * direction[2]], direction)).filter(Boolean);
	if (path.length > 1) ribbon(parts.get(key), path.map(({ p, n }) => ({ p: add(p, scale(n, 0.004)), n })), width, 0.006);
}

/**
 * The sedan's fittings, in a 2026 design language: slim LED headlamps joined by a light strip
 * across the nose, a wide lower grille in gloss black with a mesh, a full-width light bar at the
 * tail, a lip spoiler and a diffuser; flush handles, slim mirrors, and the cabin.
 */
function sedanDetails(spec, parts) {
	const onSkin = bodyProjector(spec, parts);
	// A taller body built on the saloon (the hatchback) lifts its face and tail to suit.
	const at = (p, d) => onSkin(d[2] < 0 ? [p[0], p[1] + (spec.faceLift ?? 0), p[2]] : d[2] > 0 ? [p[0], p[1] + (spec.tailLift ?? 0), p[2]] : p, d);
	const F = [0, 0, -1];
	const B = [0, 0, 1];
	for (const side of [1, -1]) {
		// Slim headlamps: a dark housing with two projector bowls and an LED brow along the top.
		lampUnit(parts, at, (u, v) => [side * lerp(0.42, 0.86, u), lerp(0.585, 0.65, v) - 0.025 * u, 3], F, {
			bowls: [[0.35, 0.4, 0.026], [0.6, 0.4, 0.026]], strip: { from: 0.02, to: 0.98, v: 0.88, width: 0.01 }, rows: 8, cols: 4,
		});
		// Corner intakes low in the bumper, a thin fog strip in each.
		decal(parts, "gloss", at, (u, v) => [side * lerp(0.6, 0.84, u), lerp(0.26, 0.38, v), 3], F, 0.003, 3, 4);
		lightBar(parts, at, "lens", side * 0.64, side * 0.8, 0.355, F, 0.012);
		// Tail lamps wrapping round the corners, then the bar across the boot.
		lampUnit(parts, at, (u, v) => [side * lerp(0.6, 0.9, u), lerp(0.87, 0.93, v), -3], B, { cover: false, strip: { from: 0.04, to: 0.96, v: 0.5, width: 0.016 }, stripPart: "taillight", rows: 6, cols: 3 });
		decal(parts, "reverse", at, (u, v) => [side * lerp(0.62, 0.7, u), lerp(0.875, 0.92, v), -3], B, 0.008, 1, 1);
		const rep = onBody(spec, 0.98 + 0.06, K.sill + 2.3);
		skinBox(parts.get("indicator"), add(rep.p, scale(rep.n, 0.003)), [0, 0, 1], rep.n, [0.05, 0.012, 0.006], 0, side < 0);
		// Rear reflectors and the diffuser's outer fins.
		decal(parts, "taillight", at, (u, v) => [side * lerp(0.62, 0.78, u), lerp(0.36, 0.385, v), -3], B, 0.006, 1, 2);
	}
	// The light strip across the nose, joining the headlamps' brows.
	lightBar(parts, at, "headlight", -0.44, 0.44, 0.645, F, 0.012);
	// The light bar across the boot lid, joining the tail lamps.
	lightBar(parts, at, "taillight", -0.62, 0.62, 0.9, B, 0.022);
	// The grille: wide and low, gloss black, with a mesh of small studs.
	decal(parts, "cladding", at, (u, v) => [lerp(-0.56, 0.56, u) * (0.82 + 0.18 * v), lerp(0.27, 0.53, v), 3], F, 0.003, 4, 10);
	for (let row = 0; row < 5; row++) {
		for (let col = 0; col < 18; col++) {
			const x = -0.48 + (col + (row % 2) * 0.5) * 0.056;
			const y = 0.3 + row * 0.045;
			const hit = at([x * (0.85 + 0.15 * ((y - 0.27) / 0.26)), y, 3], F);
			if (hit) skinBox(parts.get("gloss"), add(hit.p, scale(hit.n, 0.008)), [1, 0, 0], hit.n, [0.03, 0.022, 0.01]);
		}
	}
	decal(parts, "plate", at, (u, v) => [lerp(-0.25, 0.25, u), lerp(0.42, 0.52, v), 3], F, 0.012, 2, 6);
	decal(parts, "plate", at, (u, v) => [lerp(-0.25, 0.25, u), lerp(0.62, 0.73, v), -3], B, 0.004, 2, 6);
	// The diffuser: gloss black across the bottom of the rear bumper, with fins.
	decal(parts, "gloss", at, (u, v) => [lerp(-0.62, 0.62, u), lerp(0.24, 0.36, v), -3], B, 0.003, 3, 10);
	for (const x of [-0.3, -0.1, 0.1, 0.3]) {
		const fin = at([x, 0.3, -3], B);
		if (fin) roundedBox(parts.get("gloss"), add(fin.p, scale(fin.n, 0.03)), [0.015, 0.1, 0.06], 0.004);
	}
	// A lip spoiler along the boot lid's trailing edge.
	const lip = at([0, 3, spec.rear + 0.12], [0, -1, 0]);
	if (lip) roundedBox(parts.get("body"), add(lip.p, [0, 0.012, -0.02]), [1.3, 0.025, 0.08], 0.01, { pitch: 10 });
	for (const door of spec.doors) doorHandle(spec, parts, door, { length: 0.13 });
	mirrors(spec, parts, { z: 0.86, size: [0.11, 0.055, 0.045], reach: 0.13, up: 0.07 });
	wipers(parts, at, [-0.62, 0.02], 1.0, 1.06, 0.55);
	// A shark-fin aerial on the roof, at the back.
	const fin = at([0, 3, -0.7], [0, -1, 0]);
	if (fin) roundedBox(parts.get("gloss"), add(fin.p, [0, 0.03, -0.05]), [0.06, 0.06, 0.16], 0.028);
	sedanCabin(parts, spec.cabinLift ?? 0, spec);
}

/**
 * The cabin of the saloon and the cars built on it: two-tone front seats with light inserts and
 * headrests, a rear bench with three headrests, carpet, a light headliner following the roof, a
 * centre console with a selector and armrest, and a dashboard with a trim strip, vents, a
 * digital instrument panel behind the wheel and a touchscreen in the middle. `lift` raises it
 * for taller bodies.
 */
function sedanCabin(parts, lift = 0, spec = null) {
	const inside = new Geo();
	const light = new Geo();
	const carpet = new Geo();
	const screen = new Geo();
	for (const x of [0.38, -0.38]) {
		seat(inside, x, 0.32, -0.05);
		// Light inserts down the cushion and the back.
		roundedBox(light, [x, 0.445, -0.03], [0.3, 0.02, 0.36], 0.008);
		roundedBox(light, [x, 0.73, -0.24], [0.3, 0.42, 0.02], 0.01, { pitch: -14 });
	}
	roundedBox(inside, [0, 0.38, -0.95], [1.4, 0.14, 0.5], 0.05);
	roundedBox(inside, [0, 0.72, -1.2], [1.4, 0.6, 0.14], 0.06, { pitch: -16 });
	for (const x of [-0.45, 0, 0.45]) roundedBox(inside, [x, 1.06, -1.25], [0.24, 0.14, 0.09], 0.035, { pitch: -16 });
	for (const x of [-0.45, 0.45]) roundedBox(light, [x, 0.455, -0.93], [0.36, 0.02, 0.36], 0.008);
	roundedBox(carpet, [0, 0.235, -0.3], [1.6, 0.03, 2.4], 0.01);
	// The console: a raised spine with a selector and a padded armrest.
	roundedBox(inside, [0, 0.36, 0.2], [0.24, 0.16, 0.9], 0.05);
	roundedBox(light, [0, 0.47, -0.15], [0.22, 0.05, 0.32], 0.02);
	roundedBox(parts.get("chrome"), [0, 0.47, 0.32], [0.05, 0.06, 0.08], 0.02);
	// The dashboard's face: a trim strip across it, slim vents, the instrument panel and the screen.
	roundedBox(light, [0, 0.83, 0.55], [1.5, 0.04, 0.02], 0.01);
	for (const x of [-0.62, -0.12, 0.12, 0.62]) roundedBox(inside, [x, 0.77, 0.54], [0.2, 0.025, 0.02], 0.008);
	roundedBox(screen, [0.38, 0.91, 0.52], [0.34, 0.12, 0.02], 0.01, { pitch: 12 });
	roundedBox(screen, [0, 0.9, 0.5], [0.34, 0.2, 0.025], 0.012, { pitch: 14 });
	for (const [geo, key] of [[inside, "interior"], [light, "upholstery"], [carpet, "carpet"], [screen, "screen"]]) {
		placeGeo(parts.get(key), geo, { at: [0, lift, 0] });
	}
	// A light headliner just under the roof, front to back over the cabin.
	if (spec) {
		for (let z = -1.15; z <= 0.55; z += 0.17) {
			const y = Math.min(spec.roofY(z), spec.roofY(z + 0.17)) - 0.06;
			const half = Math.max(0.3, Math.min(spec.roofHalf(z), spec.roofHalf(z + 0.17)) - 0.08);
			if (y > spec.beltY(z) + 0.15) roundedBox(parts.get("upholstery"), [0, y, z + 0.085], [half * 2, 0.02, 0.18], 0.006);
		}
	}
	cockpit(parts, { x: 0.38, y: 0.32 + lift, z: -0.05, width: 1.56, dashZ: 0.72, dashY: 0.86 + lift });
}

/**
 * Builds one vehicle: `spec` its body (see sectionHalf), `details` its fittings, `fit` the
 * extras of a variant (a livery, a light bar). `parts` adds part keys: key → [node, material].
 */
function buildVehicle(name, { spec, details, paint, extra, fit, parts: extraParts = {}, doors2 = false, wheel, aoReach }) {
	return finish(name, (material) => {
		if (doors2) for (const door of spec.doors) door.paint2 = true;
		if (wheel) for (const axle of spec.axles) axle.wheel.style = wheel;
		const M = materials(material, paint, extra);
		const table = partTable(M, spec);
		for (const [key, [node, materialKey]] of Object.entries(extraParts)) table[key] = [node, M[materialKey]];
		const parts = partsFor(table);
		buildBody(spec, parts);
		finishPanels(spec, parts);
		details?.(spec, parts, M);
		engineBay(spec, parts);
		fit?.(spec, parts, M, table);
		return { parts, table, wheels: wheelSet(spec, M), aoReach };
	});
}

// ---- Under the bonnet -------------------------------------------------------------------------------

/**
 * What's under the bonnet, for when a crash knocks it open or tears it off: a closed bay — the
 * inner wings and their top ledges in the body colour, the bulkhead to the cabin, a tray over the
 * road — holding the engine (an alloy block and gearbox under a black cover with a yellow oil cap),
 * the radiator and its fan across the front, the strut tops, an air box and its intake, the
 * battery, and the coolant bottle. Every vehicle with a bonnet ("hood" lid) gets one, sized to the
 * space under it: inside the front wheels, below the shoulder line the bonnet rests on.
 */
function engineBay(spec, parts) {
	const hood = (spec.lids ?? []).find((lid) => lid.key === "hood");
	if (!hood) return;
	const axle = spec.axles.reduce((best, candidate) => (candidate.z > best.z ? candidate : best));
	const front = hood.front - 0.14;
	const rear = hood.rear + 0.03;
	const length = front - rear;
	if (length < 0.35) return;
	const mid = (front + rear) / 2;
	const tyre = axle.wheel?.width ?? 0.24;
	const inner = Math.min(spec.halfWidth(mid) - 0.2, (axle.track ?? 0.8) - tyre / 2 - 0.07);
	const shoulder = (z) => spec.beltY(z) - 0.03;
	const floor = Math.max(spec.floorY(mid) + 0.1, axle.radius * 0.75);
	const depth = Math.min(shoulder(rear), shoulder(front), shoulder(mid)) - floor;
	if (depth < 0.22 || inner < 0.3) return;
	const body = parts.get("body");
	const dark = parts.get("underbody");
	const black = parts.get("cladding");
	const gloss = parts.get("gloss");
	const metal = parts.get("engine-alloy");
	const steel = parts.get("steel");

	// The bay: a tray over the road, the inner wings up to the shoulder, a ledge out to the wing's
	// top edge (so there's no gap down past the wheel), and the bulkhead to the cabin.
	roundedBox(dark, [0, floor, mid], [inner * 2, 0.03, length], 0.01);
	const SEGMENTS = 10;
	for (let s = 0; s < SEGMENTS; s++) {
		const z0 = rear + (length * s) / SEGMENTS;
		const z1 = rear + (length * (s + 1)) / SEGMENTS;
		const zc = (z0 + z1) / 2;
		const [y0, y1] = [shoulder(z0), shoulder(z1)];
		const outer = spec.halfWidth(zc) - (spec.glassInset ?? 0.05) - 0.02;
		// The ledge tilts with the shoulder line, so it runs smooth rather than in steps.
		const pitch = (-Math.atan2(y1 - y0, z1 - z0) * 180) / Math.PI;
		const run = Math.hypot(y1 - y0, z1 - z0) + 0.006;
		for (const side of [1, -1]) {
			const top = Math.min(y0, y1);
			roundedBox(body, [side * inner, (floor + top) / 2, zc], [0.03, top - floor, z1 - z0 + 0.004], 0.008);
			if (outer > inner + 0.03) roundedBox(body, [(side * (inner + outer)) / 2, (y0 + y1) / 2, zc], [outer - inner, 0.025, run + 0.01], 0.002, { pitch });
		}
	}
	const bulkhead = shoulder(rear);
	roundedBox(body, [0, (floor + bulkhead) / 2, rear], [inner * 2, bulkhead - floor, 0.03], 0.01);
	// The scuttle under the windscreen, in black plastic.
	roundedBox(black, [0, bulkhead - 0.012, rear + 0.08], [inner * 2 + 0.06, 0.03, 0.16], 0.01);

	// The radiator across the front: a black core with fins, the body-coloured cross member over
	// it, and the fan's shroud behind.
	const radiatorTop = Math.min(shoulder(front) - 0.06, floor + 0.6);
	const radiatorBottom = floor + 0.05;
	const radiatorMid = (radiatorTop + radiatorBottom) / 2;
	roundedBox(black, [0, radiatorMid, front - 0.03], [inner * 1.7, radiatorTop - radiatorBottom, 0.05], 0.01);
	for (let y = radiatorBottom + 0.05; y < radiatorTop - 0.03; y += 0.045) roundedBox(gloss, [0, y, front - 0.062], [inner * 1.6, 0.01, 0.012], 0.003);
	roundedBox(body, [0, radiatorTop + 0.025, front - 0.02], [inner * 2, 0.05, 0.08], 0.015);
	const fan = Math.min(0.2, (radiatorTop - radiatorBottom) * 0.42);
	tube(black, [0, radiatorMid, front - 0.075], [0, radiatorMid, front - 0.13], fan, 16);
	roundedBox(black, [0, radiatorMid, front - 0.13], [fan * 1.9, fan * 1.9, 0.015], 0.02);

	// The strut tops over the front wheels.
	if (axle.z > rear + 0.12 && axle.z < front - 0.08) {
		for (const side of [1, -1]) {
			const x = side * (inner - 0.1);
			const top = shoulder(axle.z) - 0.03;
			tube(body, [x, top - 0.28, axle.z], [x, top, axle.z], 0.1, 14, 0.085);
			roundedBox(steel, [x, top + 0.008, axle.z], [0.13, 0.016, 0.13], 0.008);
			tube(steel, [x, top + 0.016, axle.z], [x, top + 0.045, axle.z], 0.02, 8);
		}
	}

	// The engine: an alloy block under a black cover, with silver ribs and the yellow oil cap, a
	// steel heat shield over the exhaust side, and the gearbox tapering back to the bulkhead.
	const engineTop = Math.min(shoulder(mid) - 0.07, floor + 0.62);
	const blockHeight = Math.max(0.16, engineTop - floor - 0.13);
	const blockWidth = Math.min(inner * 1.15, 0.72);
	const blockDepth = Math.min(length * 0.42, 0.6);
	const ex = 0.04;
	const ez = mid + length * 0.04;
	const blockY = floor + 0.06 + blockHeight / 2;
	roundedBox(metal, [ex, blockY, ez], [blockWidth, blockHeight, blockDepth], 0.04);
	const coverY = floor + 0.06 + blockHeight + 0.035;
	// The cover sits on the block, leaving its alloy showing round the edges; the intake plenum beside it.
	roundedBox(gloss, [ex - blockWidth * 0.1, coverY, ez], [blockWidth * 0.62, 0.07, blockDepth * 0.74], 0.03);
	for (const x of [-blockWidth * 0.24, blockWidth * 0.04]) roundedBox(steel, [ex + x, coverY + 0.038, ez], [0.03, 0.012, blockDepth * 0.56], 0.005);
	roundedBox(metal, [ex + blockWidth * 0.33, coverY - 0.005, ez], [blockWidth * 0.2, 0.06, blockDepth * 0.82], 0.025);
	for (let k = 0; k < 4; k++) {
		const z = ez - blockDepth * 0.3 + (k * blockDepth * 0.6) / 3;
		tube(metal, [ex + blockWidth * 0.33, coverY - 0.01, z], [ex + blockWidth * 0.08, coverY - 0.03, z], 0.022, 8);
	}
	const cap = [ex - blockWidth * 0.2, coverY + 0.035, ez - blockDepth * 0.22];
	tube(parts.get("engine-cap"), cap, add(cap, [0, 0.035, 0]), 0.035, 12);
	roundedBox(parts.get("engine-cap"), add(cap, [0, 0.036, 0]), [0.068, 0.006, 0.068], 0.003);
	roundedBox(steel, [ex - blockWidth / 2 - 0.03, floor + 0.06 + blockHeight * 0.55, ez], [0.04, blockHeight * 0.5, blockDepth * 0.8], 0.015);
	const gearboxEnd = Math.max(rear + 0.07, ez - blockDepth / 2 - 0.26);
	tube(metal, [ex, floor + 0.06 + blockHeight * 0.42, ez - blockDepth / 2], [ex, floor + 0.06 + blockHeight * 0.36, gearboxEnd], blockHeight * 0.36, 12, blockHeight * 0.26);

	// The air box at the front corner, its intake running back to the engine, and the radiator hoses.
	const airX = -(inner - 0.17);
	const airY = Math.min(engineTop - 0.1, floor + 0.4);
	roundedBox(black, [airX, airY, front - 0.3], [0.26, 0.16, 0.3], 0.03);
	tube(black, [airX, airY + 0.02, front - 0.46], [ex - blockWidth * 0.3, coverY - 0.01, ez + blockDepth * 0.3], 0.045, 10);
	tube(black, [inner * 0.45, radiatorTop - 0.07, front - 0.08], [ex + blockWidth * 0.3, blockY + blockHeight * 0.3, ez + blockDepth / 2], 0.028, 8);
	tube(black, [-inner * 0.4, radiatorBottom + 0.08, front - 0.08], [ex - blockWidth * 0.25, floor + 0.12, ez + blockDepth / 2], 0.028, 8);

	// The battery by the bulkhead (red and black terminals), and the coolant bottle opposite.
	const batteryX = inner - 0.17;
	const batteryY = floor + 0.04 + Math.min(0.2, depth - 0.08) / 2;
	const batteryHeight = Math.min(0.2, depth - 0.08);
	roundedBox(black, [batteryX, batteryY, rear + 0.2], [0.24, batteryHeight, 0.17], 0.015);
	roundedBox(parts.get("engine-red"), [batteryX + 0.06, batteryY + batteryHeight / 2 + 0.012, rear + 0.2], [0.04, 0.025, 0.04], 0.008);
	roundedBox(gloss, [batteryX - 0.06, batteryY + batteryHeight / 2 + 0.012, rear + 0.2], [0.04, 0.025, 0.04], 0.008);
	const bottleHeight = Math.min(0.16, depth - 0.1);
	roundedBox(parts.get("coolant"), [-(inner - 0.15), floor + 0.1 + bottleHeight / 2, rear + 0.24], [0.14, bottleHeight, 0.18], 0.03);
	roundedBox(black, [-(inner - 0.15), floor + 0.1 + bottleHeight + 0.015, rear + 0.24], [0.06, 0.03, 0.06], 0.012);
}

function buildSedanFamily(name, options) {
	return buildVehicle(name, { ...options, spec: sedanSpec(options.overrides), details: sedanDetails });
}

// ---- Placing loose geometry -------------------------------------------------------------------------

/** Copies `source` into `target`, turned (degrees) and then moved. */
function placeGeo(target, source, { at = [0, 0, 0], yaw = 0, pitch = 0, roll = 0 } = {}) {
	const turn = rotation(yaw, pitch, roll);
	const base = target.positions.length / 3;
	for (let k = 0; k < source.positions.length / 3; k++) {
		target.positions.push(...add(turn(source.point(k)), at));
		target.normals.push(...turn(source.normal(k)));
	}
	target.indices.push(...source.indices.map((i) => i + base));
}

/** A flared lip round a wheel arch: a band following the arch's edge, standing off the skin. */
function archFlare(spec, parts, axle, { key = "cladding", width = 0.07, lift = 0.02, t = K.sill + 0.35 } = {}) {
	for (const side of [1, -1]) {
		const path = range(axle.z - axle.arch - 0.04, axle.z + axle.arch + 0.04, 26).map((z) => onBody(spec, z, t));
		ribbon(parts.get(key), path, width, lift, side < 0);
		wall(parts.get(key), path.map(({ p, n }) => ({ p: add(p, scale(n, lift)), n })), lift, side < 0);
	}
}

// ---- The utility wagon ---------------------------------------------------------------------------------

/**
 * A boxy four-door wagon on a raised chassis, with upright glass and big tyres: an army
 * runabout. Matte olive, no markings.
 */
function wagonSpec() {
	const FRONT = 2.4;
	const REAR = -2.4;
	const wheel = { radius: 0.4, rim: 0.23, width: 0.29, style: "steel", blocks: true };
	const spec = {
		front: FRONT,
		rear: REAR,
		centreY: 1.0,
		stations: 140,
		axles: [
			{ z: 1.45, radius: 0.4, arch: 0.47, track: 0.84, wheel },
			{ z: -1.42, radius: 0.4, arch: 0.47, track: 0.84, wheel },
		],
		halfWidth: profile([[REAR, 0.86], [-2.37, 0.935], [-2.28, 0.955], [0, 0.955], [2.2, 0.95], [2.34, 0.905], [FRONT, 0.86]]),
		floorY: profile([[REAR, 0.62], [-2.3, 0.5], [-2.05, 0.45], [2.05, 0.45], [2.3, 0.52], [FRONT, 0.6]]),
		beltY: profile([[REAR, 1.2], [-2.3, 1.24], [0, 1.23], [1.3, 1.21], [2.25, 1.17], [FRONT, 1.12]]),
		roofY: profile([[REAR, 1.24], [-2.37, 1.6], [-2.33, 1.88], [-2.24, 1.96], [0, 1.98], [0.8, 1.97], [0.97, 1.86], [1.24, 1.3], [1.32, 1.255], [2.25, 1.22], [2.35, 1.18], [FRONT, 1.14]]),
		roofHalf: profile([[-2.3, 0.86], [0, 0.865], [1.0, 0.87]]),
		glassInset: 0.04,
		glassShare: 0.9,
		glassBow: 0.004,
		crown: 0.02,
		roofSharpness: 9,
		bulge: 0.004,
		cuts: [1.08, 0.06, 0.04, -0.95, 1.32, -1.0, -2.15, 1.02, 0.1, 0.0, -0.9],
		doors: [],
		lids: [{ key: "hood", front: FRONT - 0.03, rear: 1.32, edge: K.glassBase }],
		panes: [
			{ key: "windscreen", front: 1.26, rear: 0.92, low: K.rail, high: K.top + 0.01, frit: 0.04, fritT: 0.1 },
			{ key: "rear-glass", front: -2.27, rear: REAR + 0.005, low: K.rail, high: K.top + 0.01, frit: 0.01, fritT: 0.12 },
			{ key: "side-glass", front: -1.0, rear: -2.15, low: K.glassBase, high: K.glassTop, frit: 0.04 },
		],
	};
	for (const side of [1, -1]) {
		const s = side > 0 ? "left" : "right";
		spec.doors.push(
			{ key: `door-${s}`, side, front: 1.08, rear: 0.06, low: K.sill + 0.2, frame: `door-${s}-frame`, window: { key: `window-${s}`, front: 1.02, rear: 0.1 } },
			{ key: `rear-door-${s}`, side, front: 0.04, rear: -0.95, low: K.sill + 0.2, frame: `rear-door-${s}-frame`, window: { key: `rear-window-${s}`, front: 0.0, rear: -0.9 } },
		);
	}
	return spec;
}

function wagonDetails(spec, parts) {
	const at = bodyProjector(spec, parts);
	const F = [0, 0, -1];
	const B = [0, 0, 1];
	const steel = parts.get("steel");
	const dark = parts.get("cladding");
	for (const axle of spec.axles) archFlare(spec, parts, axle, { width: 0.09, lift: 0.03 });
	// Front: a slotted grille between two round lamps, a steel bumper and a bull bar.
	decal(parts, "gloss", at, (u, v) => [lerp(-0.52, 0.52, u), lerp(0.82, 1.08, v), 3], F, 0.003, 4, 8);
	for (const x of range(-0.42, 0.42, 7)) {
		const a = at([x, 0.84, 3], F);
		const b = at([x, 1.06, 3], F);
		if (a && b) skinBox(parts.get("body"), add(scale(add(a.p, b.p), 0.5), [0, 0, 0.012]), sub(b.p, a.p), a.n, [0.22, 0.04, 0.02]);
	}
	for (const side of [1, -1]) {
		const lamp = at([side * 0.68, 0.98, 3], F);
		if (lamp) {
			const base = add(lamp.p, scale(lamp.n, 0.004));
			tube(parts.get("chrome"), base, add(base, scale(lamp.n, 0.03)), 0.105, 24);
			bowl(parts.get("chrome"), add(base, scale(lamp.n, 0.032)), lamp.n, 0.09);
			tube(parts.get("lens"), add(base, scale(lamp.n, 0.034)), add(base, scale(lamp.n, 0.04)), 0.05, 18);
		}
		const ind = at([side * 0.68, 0.82, 3], F);
		if (ind) roundedBox(parts.get("indicator"), add(ind.p, scale(ind.n, 0.012)), [0.1, 0.05, 0.03], 0.012);
		// Tail lamps: square clusters in the rear corners.
		const tail = at([side * 0.78, 1.0, -3], B);
		if (tail) {
			roundedBox(parts.get("taillight"), add(tail.p, scale(tail.n, 0.012)), [0.12, 0.2, 0.03], 0.012);
			roundedBox(parts.get("indicator"), add(tail.p, add(scale(tail.n, 0.012), [0, -0.14, 0])), [0.12, 0.07, 0.03], 0.012);
		}
	}
	const bumper = parts.get("bumper-front");
	roundedBox(bumper, [0, 0.62, spec.front + 0.07], [1.86, 0.2, 0.2], 0.03);
	for (const x of [-0.75, 0.75]) roundedBox(bumper, [x, 0.62, spec.front + 0.18], [0.14, 0.06, 0.06], 0.02);
	const zb = spec.front + 0.24;
	for (const x of [-0.42, 0.42]) {
		tube(steel, [x, 0.6, zb], [x, 1.1, zb - 0.03], 0.035, 12);
		tube(steel, [x, 0.65, spec.front + 0.15], [x, 0.65, zb], 0.03, 10);
	}
	tube(steel, [-0.42, 1.1, zb - 0.03], [0.42, 1.1, zb - 0.03], 0.035, 12);
	tube(steel, [-0.6, 0.72, zb - 0.02], [0.6, 0.72, zb - 0.02], 0.03, 12);
	roundedBox(parts.get("bumper-rear"), [0, 0.64, spec.rear - 0.06], [1.86, 0.18, 0.16], 0.03);
	decal(parts, "plate", at, (u, v) => [lerp(-0.25, 0.25, u), lerp(0.64, 0.75, v), 3], F, 0.004, 2, 6);
	// The back: a spare wheel and two jerry cans on brackets.
	const spare = buildWheel({ radius: 0.38, rim: 0.22, width: 0.26, style: "steel", blocks: true });
	placeGeo(parts.get("spare-tyre"), spare.tyre, { at: [0.25, 1.12, spec.rear - 0.18], yaw: 90 });
	placeGeo(steel, spare.rim, { at: [0.25, 1.12, spec.rear - 0.18], yaw: 90 });
	placeGeo(steel, spare.hub, { at: [0.25, 1.12, spec.rear - 0.18], yaw: 90 });
	for (const x of [-0.5, -0.74]) {
		roundedBox(parts.get("body"), [x, 1.08, spec.rear - 0.1], [0.17, 0.46, 0.13], 0.02);
		tube(steel, [x - 0.04, 1.33, spec.rear - 0.1], [x + 0.04, 1.33, spec.rear - 0.1], 0.012, 6);
	}
	// Roof rack: a frame on six feet, slats across.
	const rackY = 2.08;
	for (const z of [-1.9, -0.6, 0.65]) for (const x of [-0.78, 0.78]) tube(steel, [x, 1.99, z], [x, rackY, z], 0.018, 6);
	for (const x of [-0.8, 0.8]) tube(steel, [x, rackY, -2.0], [x, rackY, 0.75], 0.022, 8);
	for (const z of range(-2.0, 0.75, 6)) tube(steel, [-0.8, rackY, z], [0.8, rackY, z], 0.018, 8);
	// A snorkel up the right-hand A-pillar.
	const snorkel = [[-0.98, 1.0, 1.55], [-1.0, 1.2, 1.45], [-0.94, 1.95, 1.18]];
	tube(dark, snorkel[0], snorkel[1], 0.05, 12);
	tube(dark, snorkel[1], snorkel[2], 0.05, 12);
	roundedBox(dark, add(snorkel[2], [0, 0.05, 0.02]), [0.12, 0.12, 0.16], 0.04);
	// Whip aerials on the rear corners.
	for (const x of [-0.85, 0.85]) tube(parts.get("trim"), [x, 1.95, -2.1], [x, 3.1, -2.2], 0.006, 5);
	for (const door of spec.doors) doorHandle(spec, parts, door, { at: 0.1 });
	mirrors(spec, parts, { z: 1.0, size: [0.09, 0.12, 0.04], reach: 0.16, up: 0.1 });
	wipers(parts, at, [-0.7, 0.05], 1.3, 1.25, 0.55);
	const inside = parts.get("interior");
	seat(inside, 0.42, 0.6, 0.15);
	seat(inside, -0.42, 0.6, 0.15);
	roundedBox(inside, [0, 0.66, -0.8], [1.5, 0.14, 0.5], 0.05);
	roundedBox(inside, [0, 1.0, -1.05], [1.5, 0.6, 0.14], 0.06, { pitch: -10 });
	roundedBox(inside, [0, 0.5, -0.4], [1.75, 0.04, 2.6], 0.02);
	cockpit(parts, { x: 0.42, y: 0.6, z: 0.15, width: 1.7, dashZ: 0.9, dashY: 1.12 });
}


// ---- Liveries along the flank ---------------------------------------------------------------------

/**
 * A stripe along the flank at key index `t`, from z `from` to `to`: cut at every door edge, the
 * pieces on a door in that door's part so they move with it. `which` is "decor" (accent) or
 * "decor2" (accent2).
 */
function flankStripe(spec, parts, side, t, width, from, to, which = "decor") {
	const cuts = [from, to];
	for (const door of spec.doors ?? []) if (door.side === side) cuts.push(door.front, door.rear);
	const zs = [...new Set(cuts.filter((z) => z >= from && z <= to))].sort((a, b) => a - b);
	for (let k = 0; k < zs.length - 1; k++) {
		const a = zs[k] + 0.006;
		const b = zs[k + 1] - 0.006;
		if (b - a < 0.02) continue;
		const mid = (a + b) / 2;
		const door = (spec.doors ?? []).find((d) => d.side === side && mid > d.rear && mid < d.front && t > d.low && t < K.glassTop);
		const key = door ? `${door.key}-${which}` : which === "decor" ? "accent" : "accent2";
		ribbon(parts.get(key), range(a, b, Math.max(2, Math.ceil((b - a) / 0.05))).map((z) => onBody(spec, z, t)), width, 0.0015, side < 0);
	}
}

// ---- The van, and the ambulance cab -------------------------------------------------------------------

/**
 * A panel van: a short bonnet, a steep windscreen and a tall cargo body behind the cab, a
 * sliding door on the kerb side. With `cabOnly` it stops behind the cab doors (the ambulance
 * carries its box on the chassis instead). Front positions are measured back from the nose.
 */
function vanSpec({ front = 2.5, rear = -2.5, cabOnly = false, roofTop = 2.45, axles } = {}) {
	const FRONT = front;
	const REAR = rear;
	const f = (d) => FRONT - d;
	const top = roofTop;
	const spec = {
		front: FRONT,
		rear: REAR,
		centreY: 1.3,
		stations: 150,
		axles,
		halfWidth: profile([[REAR, 0.93], [REAR + 0.03, 0.98], [REAR + 0.1, 0.995], [f(0.7), 0.99], [f(0.3), 0.95], [f(0.1), 0.87], [FRONT, 0.77]]),
		floorY: profile([[REAR, 0.5], [REAR + 0.08, 0.36], [REAR + 0.3, 0.3], [f(0.5), 0.3], [f(0.15), 0.36], [FRONT, 0.46]]),
		beltY: profile([[REAR, 1.02], [REAR + 0.06, 1.1], [f(1.2), 1.13], [f(0.6), 1.13], [f(0.15), 1.02], [FRONT, 0.92]]),
		roofY: profile([[REAR, top - 0.14], [REAR + 0.04, top - 0.03], [REAR + 0.12, top], [f(1.5), top], [f(1.38), top - 0.05], [f(1.25), 2.12], [f(0.65), 1.25], [f(0.55), 1.2], [f(0.2), 1.12], [f(0.07), 1.01], [FRONT, 0.93]]),
		roofHalf: profile([[REAR + 0.1, 0.975], [f(1.5), 0.965], [f(1.2), 0.93]]),
		glassInset: 0.03,
		glassShare: 0.6,
		glassBow: 0.003,
		crown: 0.025,
		roofSharpness: 22,
		rail: 0.03,
		bulge: 0.006,
		cladding: () => K.sill + 0.55,
		cuts: [f(0.64), f(1.52), f(0.72), f(1.47), f(0.65), f(1.25), f(1.56), f(2.9)],
		doors: [],
		lids: [{ key: "hood", front: FRONT - 0.02, rear: f(0.62), edge: K.glassBase }],
		panes: [{ key: "windscreen", front: f(0.64), rear: f(1.27), low: K.rail, high: K.top + 0.01, frit: 0.05, fritT: 0.12 }],
		capPart: { front: "body", rear: "body" },
	};
	for (const side of [1, -1]) {
		const s = side > 0 ? "left" : "right";
		spec.doors.push({ key: `door-${s}`, side, front: f(0.64), rear: f(1.52), low: K.sill + 0.2, frame: `door-${s}-frame`, window: { key: `window-${s}`, front: f(0.72), rear: f(1.47) } });
	}
	if (!cabOnly) spec.doors.push({ key: "side-door-right", side: -1, front: f(1.56), rear: f(2.9), low: K.sill + 0.2 });
	return spec;
}

/** The van's face, shared with the ambulance: grille, lamps, bumper, plate. */
function vanFront(spec, parts, at) {
	const F = [0, 0, -1];
	const nose = spec.front;
	decal(parts, "gloss", at, (u, v) => [lerp(-0.52, 0.52, u), lerp(0.72, 0.95, v), 3], F, 0.003, 4, 8);
	grilleBars(parts, "body", at, -0.5, 0.5, [0.79, 0.88], F, [0, 0.03, 0.012]);
	for (const side of [1, -1]) {
		lampUnit(parts, at, (u, v) => [side * lerp(0.56, 0.9, u), lerp(0.84, 1.03, v) + 0.05 * u * v, 3], F, {
			bowls: [[0.3, 0.45, 0.055], [0.68, 0.45, 0.045]], strip: { from: 0.05, to: 0.95, v: 0.12, width: 0.01 }, rows: 10, cols: 6,
		});
		const fog = [side * 0.72, 0.5, nose + 0.075];
		tube(parts.get("lens"), fog, add(fog, [0, 0, 0.012]), 0.04, 14);
	}
	const bumper = parts.get("bumper-front");
	roundedBox(bumper, [0, 0.52, nose - 0.04], [1.94, 0.32, 0.2], 0.05);
	roundedBox(parts.get("plate"), [0, 0.55, nose + 0.065], [0.52, 0.11, 0.01], 0.004);
	roundedBox(parts.get("gloss"), [0, 0.42, nose + 0.058], [1.1, 0.06, 0.012], 0.006);
	wipers(parts, at, [-0.78, 0.04], 1.25, spec.front - 0.68, 0.65);
}

/** The cab's inside and the mirrors and handles, shared with the ambulance. */
function vanCab(spec, parts) {
	for (const door of spec.doors.filter((d) => d.key.startsWith("door-"))) doorHandle(spec, parts, door, { at: 0.06, length: 0.13 });
	mirrors(spec, parts, { z: spec.front - 0.72, size: [0.08, 0.17, 0.05], reach: 0.2, up: 0.14 });
	const inside = parts.get("interior");
	const z = spec.front - 1.3;
	seat(inside, 0.45, 0.62, z, { width: 0.52 });
	seat(inside, -0.45, 0.62, z, { width: 0.52 });
	roundedBox(inside, [0, 0.52, z + 0.1], [1.8, 0.04, 1.3], 0.02);
	cockpit(parts, { x: 0.45, y: 0.62, z, width: 1.8, dashZ: spec.front - 0.68, dashY: 1.2, wheelTilt: -32 });
}

function vanDetails(spec, parts) {
	const at = bodyProjector(spec, parts);
	const B = [0, 0, 1];
	vanFront(spec, parts, at);
	vanCab(spec, parts);
	// Livery: a blue band and a red line down each side.
	for (const side of [1, -1]) {
		flankStripe(spec, parts, side, K.belt - 0.95, 0.16, spec.rear + 0.15, spec.front - 0.5, "decor");
		flankStripe(spec, parts, side, K.belt - 0.55, 0.035, spec.rear + 0.15, spec.front - 0.5, "decor2");
	}
	const slide = spec.doors.find((d) => d.key === "side-door-right");
	doorHandle(spec, parts, slide, { at: slide.front - slide.rear - 0.2, length: 0.13 });
	// The sliding door's rail, behind it under the roof line.
	ribbon(parts.get("gloss"), range(spec.rear + 0.25, slide.rear, 10).map((z) => onBody(spec, z, K.glassBase + 0.3)), 0.03, 0.006, true);
	// Back: a pair of doors with windows, tall lamp clusters in the corners, a step bumper.
	const zr = spec.rear;
	roundedBox(parts.get("gloss"), [0, 1.4, zr - 0.012], [0.012, 1.8, 0.01], 0.004);
	for (const side of [1, -1]) {
		const pane = [side * 0.43, 1.88, zr - 0.02];
		roundedBox(parts.get("gloss"), pane, [0.72, 0.56, 0.012], 0.05);
		roundedBox(parts.get("rear-glass"), add(pane, [0, 0, -0.004]), [0.64, 0.48, 0.008], 0.04);
		roundedBox(parts.get("trim"), [side * 0.1, 1.2, zr - 0.03], [0.04, 0.16, 0.03], 0.01);
		for (const y of [0.85, 1.7]) roundedBox(parts.get("trim"), [side * 0.93, y, zr - 0.02], [0.05, 0.12, 0.03], 0.01);
		const tail = at([side * 0.9, 1.1, -3], B);
		if (tail) {
			const base = add(tail.p, scale(tail.n, 0.01));
			roundedBox(parts.get("lamp-housing"), base, [0.11, 0.62, 0.03], 0.02);
			roundedBox(parts.get("taillight"), add(base, [0, 0.16, -0.012]), [0.09, 0.22, 0.02], 0.015);
			roundedBox(parts.get("indicator"), add(base, [0, -0.05, -0.012]), [0.09, 0.12, 0.02], 0.015);
			roundedBox(parts.get("reverse"), add(base, [0, -0.2, -0.012]), [0.09, 0.1, 0.02], 0.015);
		}
	}
	roundedBox(parts.get("taillight"), [0, 2.38, zr - 0.02], [0.3, 0.04, 0.03], 0.01);
	roundedBox(parts.get("bumper-rear"), [0, 0.48, zr - 0.06], [1.94, 0.22, 0.2], 0.04);
	roundedBox(parts.get("plate"), [0, 0.68, zr - 0.012], [0.52, 0.11, 0.01], 0.004);
	// Roof ribs.
	for (const z of range(spec.rear + 0.4, spec.front - 1.6, 5)) {
		const roof = at([0, 4, z], [0, -1, 0]);
		if (roof) roundedBox(parts.get("body"), add(roof.p, [0, 0.008, 0]), [1.6, 0.025, 0.06], 0.01);
	}
	// A bulkhead behind the seats.
	roundedBox(parts.get("interior"), [0, 1.4, spec.front - 1.7], [1.9, 1.9, 0.04], 0.01);
}

// ---- The ambulance ------------------------------------------------------------------------------------

/** The patient compartment: a box on the chassis behind the cab, and everything on it. */
function ambulanceBox(spec, parts, box3) {
	const { front, rear, half, bottom, top } = box3;
	const len = front - rear;
	const mid = (front + rear) / 2;
	const body = parts.get("body");
	roundedBox(body, [0, (bottom + top) / 2, mid], [half * 2, top - bottom, len], 0.07, { segments: 4 });
	const accent = parts.get("accent");
	const accent2 = parts.get("accent2");
	for (const side of [1, -1]) {
		const x = side * (half + 0.002);
		// A red band and a chequer of red and white squares below the windows.
		box(accent, [x, bottom + 0.62, mid], [0.004, 0.2, len - 0.16]);
		for (let k = 0; k < Math.floor((len - 0.2) / 0.16); k++) {
			const z = rear + 0.1 + 0.08 + k * 0.16;
			box(k % 2 ? accent2 : accent, [x, bottom + 0.4, z], [0.005, 0.16, 0.16]);
		}
		box(accent, [x, top - 0.2, mid], [0.004, 0.08, len - 0.16]);
		// Scene lights high on each side, and a beacon at each top corner.
		for (const z of [front - 0.5, rear + 0.6]) roundedBox(parts.get("lens"), [side * (half + 0.025), top - 0.42, z], [0.04, 0.1, 0.22], 0.015);
		for (const z of [front - 0.12, rear + 0.12]) {
			roundedBox(parts.get("trim"), [side * (half - 0.14), top + 0.02, z], [0.18, 0.04, 0.14], 0.012);
			roundedBox(parts.get(side > 0 ? "siren-red" : "siren-blue"), [side * (half - 0.14), top + 0.08, z], [0.16, 0.09, 0.12], 0.03);
		}
		// Grab rail.
		tube(parts.get("chrome"), [side * (half + 0.04), bottom + 1.5, rear + 0.25], [side * (half + 0.04), bottom + 1.5, rear + 1.0], 0.012, 8);
	}
	// Kerb-side door with a frosted window; a small window on the other side.
	const door = parts.get("side-door-right");
	const dz = front - 0.55;
	roundedBox(door, [-(half + 0.004), bottom + 1.05, dz - 0.45], [0.012, 1.85, 0.86], 0.02);
	roundedBox(parts.get("side-door-right-decor"), [-(half + 0.012), bottom + 0.62, dz - 0.45], [0.004, 0.2, 0.82], 0.002);
	roundedBox(parts.get("gloss"), [-(half + 0.012), bottom + 1.5, dz - 0.45], [0.006, 0.5, 0.62], 0.04);
	roundedBox(parts.get("frost-glass"), [-(half + 0.016), bottom + 1.5, dz - 0.45], [0.004, 0.44, 0.56], 0.035);
	roundedBox(parts.get("side-door-right-handle"), [-(half + 0.02), bottom + 1.05, dz - 0.82], [0.02, 0.2, 0.03], 0.01);
	roundedBox(parts.get("gloss"), [half + 0.006, bottom + 1.5, mid], [0.006, 0.44, 0.7], 0.04);
	roundedBox(parts.get("frost-glass"), [half + 0.01, bottom + 1.5, mid], [0.004, 0.38, 0.64], 0.035);
	// The star of life on both flanks and high on the back: a blue cross with a white border.
	for (const side of [1, -1]) starOfLife(parts, [side * (half + 0.006), bottom + 1.55, rear + 0.75], [side, 0, 0], 0.5);
	starOfLife(parts, [0, top - 0.25, rear - 0.008], [0, 0, -1], 0.34);
	// Flashers that go with the beacons: high on the back corners, and along each flank.
	for (const side of [1, -1]) {
		roundedBox(parts.get(side > 0 ? "siren-red" : "siren-blue"), [side * (half - 0.08), top - 0.12, rear - 0.03], [0.14, 0.12, 0.04], 0.02);
		for (const z of [front - 0.25, mid, rear + 0.25]) {
			roundedBox(parts.get(side > 0 ? "siren-red" : "siren-blue"), [side * (half + 0.012), top - 0.1, z], [0.03, 0.08, 0.18], 0.012);
		}
	}
	// Back: two doors with windows and chevrons, lamps down the corners, a step.
	const zr = rear - 0.004;
	box(parts.get("gloss"), [0, (bottom + top) / 2 - 0.05, zr], [0.012, top - bottom - 0.3, 0.008]);
	for (const side of [1, -1]) {
		const pane = [side * 0.45, top - 0.6, zr - 0.006];
		roundedBox(parts.get("gloss"), pane, [0.7, 0.5, 0.01], 0.05);
		roundedBox(parts.get("rear-glass"), add(pane, [0, 0, -0.004]), [0.62, 0.42, 0.008], 0.04);
		for (let k = 0; k < 4; k++) {
			const y = bottom + 0.35 + k * 0.17;
			box(k % 2 ? accent2 : accent, [side * 0.5, y, zr - 0.005], [0.8, 0.08, 0.004], 0, 0, side * 32);
		}
		roundedBox(parts.get("lamp-housing"), [side * (half - 0.06), bottom + 0.75, zr - 0.02], [0.1, 0.7, 0.03], 0.02);
		roundedBox(parts.get("taillight"), [side * (half - 0.06), bottom + 0.95, zr - 0.035], [0.08, 0.24, 0.02], 0.015);
		roundedBox(parts.get("indicator"), [side * (half - 0.06), bottom + 0.68, zr - 0.035], [0.08, 0.14, 0.02], 0.015);
		roundedBox(parts.get("reverse"), [side * (half - 0.06), bottom + 0.5, zr - 0.035], [0.08, 0.1, 0.02], 0.015);
		roundedBox(parts.get("trim"), [side * 0.08, bottom + 0.9, zr - 0.02], [0.03, 0.16, 0.03], 0.01);
	}
	roundedBox(parts.get("bumper-rear"), [0, bottom - 0.05, rear - 0.12], [1.9, 0.12, 0.3], 0.03);
	roundedBox(parts.get("plate"), [0, bottom + 0.15, zr - 0.012], [0.52, 0.11, 0.01], 0.004);
	// Air conditioning on the roof; the box's underside and wheel boxes.
	roundedBox(parts.get("accent2"), [0, top + 0.1, mid + 0.2], [0.9, 0.18, 0.8], 0.05);
	roundedBox(parts.get("underbody"), [0, bottom - 0.12, mid], [1.5, 0.22, len - 0.2], 0.03);
	// Mud flaps behind the rear wheels.
	for (const side of [1, -1]) roundedBox(parts.get("trim"), [side * 0.82, 0.32, spec.axles[1].z - 0.5], [0.3, 0.3, 0.012], 0.005);
}

/**
 * A star of life on a face whose outward normal is `normal` (an axis): a six-armed blue cross
 * over a white one, `size` across.
 */
function starOfLife(parts, at, normal, size) {
	const flat = Math.abs(normal[0]) > 0.5 ? 0 : 2;
	for (const [key, scaleBy, lift] of [["accent2", 1, 0.004], ["blue-mark", 0.78, 0.008]]) {
		const length = size * scaleBy;
		const arm = size * 0.3 * scaleBy;
		for (const angle of [0, 60, -60]) {
			const dims = flat === 0 ? [0.004, length, arm] : [arm, length, 0.004];
			const centre = add(at, scale(normal, lift));
			box(parts.get(key), centre, dims, 0, flat === 0 ? angle : 0, flat === 0 ? 0 : angle);
		}
	}
}

function ambulanceDetails(spec, parts) {
	const at = bodyProjector(spec, parts);
	vanFront(spec, parts, at);
	vanCab(spec, parts);
	for (const side of [1, -1]) flankStripe(spec, parts, side, K.belt - 0.95, 0.2, spec.rear + 0.05, spec.front - 0.5, "decor");
	// A light bar across the cab roof.
	const roof = at([0, 4, spec.rear + 0.4], [0, -1, 0]);
	if (roof) {
		const y = roof.p[1] + 0.03;
		const z = roof.p[2];
		roundedBox(parts.get("trim"), [0, y, z], [1.5, 0.03, 0.26], 0.012);
		// Segmented: four lamps a side, so the double flash reads as a strobe bar.
		for (const side of [1, -1]) {
			for (let k = 0; k < 4; k++) roundedBox(parts.get(side > 0 ? "siren-red" : "siren-blue"), [side * (0.12 + k * 0.165), y + 0.06, z], [0.15, 0.09, 0.24], 0.025);
		}
	}
	// Grille flashers low on the nose.
	for (const side of [1, -1]) {
		const hit = at([side * 0.55, 0.62, 6], [0, 0, -1]);
		if (hit) roundedBox(parts.get(side > 0 ? "siren-red" : "siren-blue"), add(hit.p, scale(hit.n, 0.012)), [0.16, 0.06, 0.03], 0.012);
	}
	ambulanceBox(spec, parts, { front: spec.rear - 0.03, rear: -3.25, half: 1.1, bottom: 0.66, top: 2.86 });
}

// ---- Cab-over lorries: the cab ---------------------------------------------------------------------

/**
 * A flat-fronted cab sitting over the front axle, as on a lorry: tall, square, the windscreen
 * raked a little, the front wheel's arch cut into its lower flank. `rear` is the back of the
 * cab; with `crew` it is long enough for a second row of doors (the fire engine's).
 */
function cabOverSpec({ front, rear, half, floor, belt, roof, axles, crew = false, frontAxle }) {
	const FRONT = front;
	const REAR = rear;
	const f = (d) => FRONT - d;
	const doorRear = crew ? f(1.45) : REAR + 0.2;
	const spec = {
		front: FRONT,
		rear: REAR,
		centreY: (floor + roof) / 2,
		stations: 120,
		axles,
		halfWidth: profile([[REAR, half - 0.04], [REAR + 0.04, half - 0.008], [REAR + 0.1, half], [f(0.14), half], [f(0.05), half - 0.03], [FRONT, half - 0.075]]),
		floorY: profile([[REAR, floor + 0.04], [REAR + 0.06, floor], [f(0.06), floor], [FRONT, floor + 0.05]]),
		beltY: profile([[REAR, belt - 0.04], [REAR + 0.06, belt], [f(0.45), belt], [f(0.2), belt - 0.12], [FRONT, belt - 0.2]]),
		roofY: profile([[REAR, roof - 0.14], [REAR + 0.05, roof - 0.04], [REAR + 0.15, roof], [f(0.42), roof], [f(0.33), roof - 0.05], [f(0.24), roof - 0.4], [f(0.1), belt - 0.02], [FRONT, belt - 0.12]]),
		roofHalf: profile([[REAR, half - 0.07], [FRONT, half - 0.07]]),
		glassInset: 0.03,
		glassShare: 0.78,
		glassBow: 0.003,
		crown: 0.03,
		roofSharpness: 14,
		rail: 0.04,
		bulge: 0.004,
		cuts: [f(0.32), f(0.36), f(0.24), f(0.1), doorRear, doorRear + 0.04, REAR + 0.24, f(0.4)],
		doors: [],
		lids: [],
		panes: [{ key: "windscreen", front: f(0.11), rear: f(0.34), low: K.rail, high: K.top + 0.01, frit: 0.03, fritT: 0.1 }],
		frontAxle,
	};
	for (const side of [1, -1]) {
		const s = side > 0 ? "left" : "right";
		spec.doors.push({ key: `door-${s}`, side, front: f(0.36), rear: doorRear + (crew ? 0.04 : 0), low: K.sill + 0.15, frame: `door-${s}-frame`, window: { key: `window-${s}`, front: f(0.42), rear: doorRear + (crew ? 0.1 : 0.06) } });
		if (crew) spec.doors.push({ key: `rear-door-${s}`, side, front: doorRear, rear: REAR + 0.24, low: K.sill + 0.15, frame: `rear-door-${s}-frame`, window: { key: `rear-window-${s}`, front: doorRear - 0.06, rear: REAR + 0.3 } });
	}
	return spec;
}

/**
 * The cab's fittings: a grille across the front, lamps in the bumper corners, a steel bumper,
 * steps under the doors, big mirrors on arms, the cab's inside.
 */
function cabOverDetails(spec, parts, { grille = "gloss", bumperY = null } = {}) {
	const at = bodyProjector(spec, parts);
	const F = [0, 0, -1];
	const nose = spec.front;
	const half = spec.halfWidth(nose - 0.5);
	const floor = spec.floorY(nose - 0.5);
	const belt = spec.beltY(nose - 0.5);
	const gTop = belt - 0.12;
	const gBottom = floor + (belt - floor) * 0.42;
	decal(parts, grille, at, (u, v) => [lerp(-half + 0.2, half - 0.2, u), lerp(gBottom, gTop, v), nose + 2], F, 0.003, 4, 10);
	grilleBars(parts, "chrome", at, -half + 0.22, half - 0.22, range(gBottom + 0.05, gTop - 0.05, 4), F, [0, 0.025, 0.01]);
	// Lamps low in the corners, below the grille; indicators beside them.
	for (const side of [1, -1]) {
		lampUnit(parts, at, (u, v) => [side * lerp(half - 0.5, half - 0.12, u), lerp(floor + 0.12, gBottom - 0.04, v), nose + 2], F, {
			bowls: [[0.3, 0.5, 0.06], [0.7, 0.5, 0.06]], strip: { from: 0.05, to: 0.95, v: 0.88, width: 0.012 }, rows: 6, cols: 6,
		});
		const step = parts.get("steel");
		for (const [k, y] of [[0, floor + 0.05], [1, floor - 0.32]]) roundedBox(step, [side * (half - 0.02), y, spec.doors[0].rear + 0.4 + k * 0.05], [0.12, 0.04, 0.5], 0.01);
		// Grab handle beside each door.
		const handleZ = spec.doors.find((d) => d.side === side && d.key.startsWith("door-")).front + 0.06;
		const a = onBody(spec, handleZ, K.sill + 1);
		const b = onBody(spec, handleZ, K.belt - 0.2);
		tube(parts.get("chrome"), add(a.p, scale(a.n, 0.04)).map((v, i) => (i === 0 ? side * v : v)), add(b.p, scale(b.n, 0.04)).map((v, i) => (i === 0 ? side * v : v)), 0.014, 8);
	}
	const by = bumperY ?? floor + 0.02;
	roundedBox(parts.get("bumper-front"), [0, by, nose + 0.06], [half * 2 + 0.02, 0.32, 0.2], 0.04);
	roundedBox(parts.get("plate"), [0, by + 0.02, nose + 0.165], [0.52, 0.11, 0.01], 0.004);
	for (const x of [-0.6, 0.6]) tube(parts.get("lens"), [x, by + 0.02, nose + 0.16], [x, by + 0.02, nose + 0.175], 0.04, 12);
	// Marker lamps along the top of the windscreen.
	for (const x of range(-half + 0.25, half - 0.25, 4)) {
		const top = at([x, spec.roofY(nose - 0.5) - 0.04, nose + 2], F);
		if (top) roundedBox(parts.get("indicator"), add(top.p, scale(top.n, 0.012)), [0.07, 0.03, 0.025], 0.01);
	}
	for (const door of spec.doors) doorHandle(spec, parts, door, { at: 0.06, length: 0.12 });
	// Mirrors on long arms, a main glass and a wide-angle one below.
	for (const side of [1, -1]) {
		const name = side > 0 ? "left" : "right";
		const z = spec.front - 0.5;
		const mount = [side * half, belt + 0.35, z];
		const pod = [side * (half + 0.28), belt + 0.3, z + 0.05];
		const shell = parts.get(`mirror-${name}`);
		tube(shell, mount, sub(pod, [side * 0.04, 0, 0]), 0.016, 8);
		tube(shell, [side * half, belt - 0.05, z], sub(pod, [side * 0.04, 0.35, 0]), 0.016, 8);
		roundedBox(shell, pod, [0.05, 0.42, 0.22], 0.03, { yaw: side * -10 });
		roundedBox(parts.get(`mirror-${name}-glass`), add(pod, [0, 0, -0.03]), [0.04, 0.38, 0.18], 0.02, { yaw: side * -10 });
		roundedBox(shell, add(pod, [0, -0.38, 0]), [0.05, 0.2, 0.18], 0.03, { yaw: side * -10 });
	}
	wipers(parts, at, [-half + 0.25, 0.08], belt + 0.2, nose - 0.2, 0.75);
	const inside = parts.get("interior");
	const seatZ = spec.front - 1.15;
	seat(inside, half - 0.55, floor + 0.35, seatZ, { width: 0.56 });
	seat(inside, -(half - 0.55), floor + 0.35, seatZ, { width: 0.56 });
	roundedBox(inside, [0, floor + 0.3, seatZ + 0.2], [half * 2 - 0.1, 0.04, 1.2], 0.02);
	cockpit(parts, { x: half - 0.55, y: floor + 0.35, z: seatZ, width: half * 2 - 0.1, dashZ: spec.front - 0.45, dashY: belt - 0.05, wheelTilt: -55 });
	return at;
}

/** Chassis rails and the running gear behind a cab: rails, fuel tank, guards, mud flaps. */
function chassis(spec, parts, { from, to, y, railHalf = 0.45, tank = true, guards = [] }) {
	const under = parts.get("underbody");
	for (const x of [-railHalf, railHalf]) roundedBox(under, [x, y, (from + to) / 2], [0.1, 0.26, from - to], 0.01);
	for (const z of range(to + 0.3, from - 0.3, 6)) roundedBox(under, [0, y, z], [railHalf * 2, 0.08, 0.06], 0.01);
	if (tank) {
		const tz = from - 0.75;
		tube(parts.get("chrome"), [0.95, y - 0.05, tz + 0.5], [0.95, y - 0.05, tz - 0.5], 0.27, 24);
		for (const dz of [-0.35, 0.35]) tube(parts.get("trim"), [0.95, y - 0.05, tz + dz - 0.02], [0.95, y - 0.05, tz + dz + 0.02], 0.275, 24);
		roundedBox(parts.get("underbody"), [-0.9, y, tz], [0.4, 0.45, 0.7], 0.03);
	}
	// Side guards between the axles.
	for (const [a, b] of guards) {
		for (const side of [1, -1]) {
			for (const gy of [y - 0.05, y - 0.3]) roundedBox(parts.get("steel"), [side * 1.0, gy, (a + b) / 2], [0.03, 0.1, a - b], 0.01);
		}
	}
	// Mud flaps behind each rear axle.
	for (const axle of spec.axles.slice(1)) {
		for (const side of [1, -1]) roundedBox(parts.get("trim"), [side * (axle.track - 0.05), axle.radius * 0.6, axle.z - axle.radius - 0.12], [axle.wheel.width * (axle.wheel.dual ? 2.2 : 1.2), axle.radius * 1.1, 0.015], 0.005);
	}
}

/** Fenders over wheels outside the cab: an arched shell over each tyre pair. */
function fenders(parts, axles, { key = "trim", from = 0 } = {}) {
	for (const axle of axles.slice(from)) {
		const w = axle.wheel.width * (axle.wheel.dual ? 2.1 : 1.1) + 0.06;
		for (const side of [1, -1]) {
			const x = side * (axle.track - (axle.wheel.dual ? axle.wheel.width / 2 + 0.015 : 0));
			const r = axle.radius + 0.06;
			const shell = range(Math.PI * 0.05, Math.PI * 0.95, 14).map((a) => ({ p: [x, axle.radius + Math.sin(a) * r, axle.z + Math.cos(a) * r], n: [0, Math.sin(a), Math.cos(a)] }));
			ribbon(parts.get(key), shell.map(({ p, n }) => ({ p, n: [n[0], n[1], n[2]] })), w, 0, false);
		}
	}
}

// ---- The box lorry -----------------------------------------------------------------------------------

function truckDetails(spec, parts) {
	cabOverDetails(spec, parts);
	const boxFront = spec.rear - 0.1;
	const boxRear = -4.8;
	const half = 1.1;
	const bottom = 1.18;
	const top = 3.62;
	chassis(spec, parts, { from: spec.rear + 0.4, to: -4.55, y: 0.95, guards: [[spec.axles[0].z - 0.8, spec.axles[1].z + 0.7]] });
	fenders(parts, spec.axles, { from: 1 });
	// The box: white panels with a cab-coloured stripe, marker lamps, a rear frame and doors.
	const boxGeo = parts.get("body2");
	const len = boxFront - boxRear;
	const mid = (boxFront + boxRear) / 2;
	roundedBox(boxGeo, [0, (bottom + top) / 2, mid], [half * 2, top - bottom, len], 0.04, { segments: 2 });
	for (const side of [1, -1]) {
		for (const z of range(boxRear + 0.3, boxFront - 0.3, 9)) roundedBox(parts.get("steel"), [side * (half + 0.006), (bottom + top) / 2, z], [0.012, top - bottom - 0.08, 0.05], 0.004);
		roundedBox(parts.get("accent"), [side * (half + 0.01), bottom + 0.55, mid], [0.008, 0.28, len - 0.3], 0.004);
		for (const z of range(boxRear + 0.4, boxFront - 0.4, 4)) roundedBox(parts.get("indicator"), [side * (half + 0.015), bottom + 0.12, z], [0.02, 0.04, 0.08], 0.008);
		roundedBox(parts.get("steel"), [side * (half + 0.004), bottom + 0.04, mid], [0.03, 0.1, len], 0.01);
		roundedBox(parts.get("steel"), [side * (half + 0.004), top - 0.04, mid], [0.03, 0.08, len], 0.01);
	}
	const zr = boxRear - 0.012;
	roundedBox(parts.get("steel"), [0, (bottom + top) / 2, zr], [half * 2 + 0.03, top - bottom + 0.03, 0.03], 0.01);
	roundedBox(parts.get("body2"), [0, (bottom + top) / 2, zr - 0.02], [half * 2 - 0.12, top - bottom - 0.12, 0.02], 0.01);
	box(parts.get("gloss"), [0, (bottom + top) / 2, zr - 0.032], [0.012, top - bottom - 0.14, 0.006]);
	for (const x of [-0.75, -0.25, 0.25, 0.75]) tube(parts.get("chrome"), [x, bottom + 0.1, zr - 0.06], [x, top - 0.1, zr - 0.06], 0.016, 8);
	for (const x of [-0.6, 0.6]) for (const y of [bottom + 0.6, top - 0.6]) roundedBox(parts.get("steel"), [x, y, zr - 0.04], [0.2, 0.05, 0.03], 0.01);
	// Rear lamps on the underrun bar, a plate between.
	const under = parts.get("bumper-rear");
	roundedBox(under, [0, 0.62, boxRear + 0.1], [2.1, 0.14, 0.14], 0.02);
	for (const side of [1, -1]) {
		roundedBox(parts.get("lamp-housing"), [side * 0.8, 0.82, boxRear + 0.04], [0.42, 0.16, 0.06], 0.02);
		roundedBox(parts.get("taillight"), [side * 0.88, 0.82, boxRear], [0.16, 0.12, 0.03], 0.015);
		roundedBox(parts.get("indicator"), [side * 0.7, 0.82, boxRear], [0.1, 0.12, 0.03], 0.015);
		roundedBox(parts.get("reverse"), [side * 0.6, 0.82, boxRear], [0.06, 0.12, 0.03], 0.015);
		roundedBox(parts.get("taillight"), [side * (half - 0.06), top - 0.06, zr - 0.035], [0.06, 0.06, 0.02], 0.01);
	}
	roundedBox(parts.get("plate"), [0, 0.86, boxRear + 0.02], [0.52, 0.11, 0.01], 0.004);
	// A wind deflector on the cab roof and an exhaust stack behind the cab.
	const roofY = spec.roofY(spec.rear + 0.8) + 0.03;
	roundedBox(parts.get("body"), [0, roofY + 0.3, spec.rear + 0.7], [1.9, 0.6, 1.1], 0.18, { pitch: 14 });
	tube(parts.get("chrome"), [-1.0, 1.0, spec.rear - 0.06], [-1.0, 3.0, spec.rear - 0.06], 0.06, 14);
	tube(parts.get("gloss"), [-1.0, 3.0, spec.rear - 0.06], [-1.0, 3.04, spec.rear - 0.06], 0.05, 14);
}

// ---- The refuse truck ---------------------------------------------------------------------------------

function garbageDetails(spec, parts) {
	cabOverDetails(spec, parts);
	chassis(spec, parts, { from: spec.rear + 0.3, to: -3.6, y: 0.95, tank: true, guards: [] });
	fenders(parts, spec.axles, { from: 1 });
	const bodyFront = spec.rear - 0.12;
	const bodyRear = -3.25;
	const half = 1.2;
	const bottom = 1.15;
	const top = 3.35;
	const geo = parts.get("body2");
	const len = bodyFront - bodyRear;
	const mid = (bodyFront + bodyRear) / 2;
	// The compactor body: tall, its sides ribbed, a cab-coloured band along the bottom.
	roundedBox(geo, [0, (bottom + top) / 2, mid], [half * 2, top - bottom, len], 0.12, { segments: 3 });
	for (const side of [1, -1]) {
		for (const z of range(bodyRear + 0.25, bodyFront - 0.25, 7)) roundedBox(parts.get("body2"), [side * (half + 0.02), (bottom + top) / 2, z], [0.05, top - bottom - 0.2, 0.09], 0.02);
		roundedBox(parts.get("accent"), [side * (half + 0.005), bottom + 0.25, mid], [0.02, 0.3, len - 0.1], 0.01);
		roundedBox(parts.get("accent2"), [side * (half + 0.006), bottom + 0.48, mid], [0.02, 0.06, len - 0.1], 0.01);
		roundedBox(parts.get("steel"), [side * (half - 0.05), top + 0.04, mid], [0.06, 0.06, len], 0.02);
	}
	// The tailgate and hopper, hinged at the top and sloping back over the rear.
	const tg = parts.get("tailgate");
	roundedBox(tg, [0, (bottom + top) / 2 - 0.05, bodyRear - 0.42], [half * 2 + 0.06, top - bottom - 0.1, 0.84], 0.12, { pitch: -6 });
	roundedBox(parts.get("tailgate-dark"), [0, bottom + 0.35, -4.24], [half * 2 - 0.3, 0.55, 0.12], 0.04, { pitch: 28 });
	for (const side of [1, -1]) {
		tube(parts.get("steel"), [side * (half + 0.06), bottom + 0.4, bodyRear - 0.1], [side * (half + 0.06), top - 0.4, bodyRear - 0.5], 0.05, 12);
		tube(parts.get("chrome"), [side * (half + 0.06), top - 0.4, bodyRear - 0.5], [side * (half + 0.06), top - 0.15, bodyRear - 0.62], 0.035, 10);
		roundedBox(parts.get("taillight"), [side * (half - 0.05), bottom + 0.15, -4.25], [0.14, 0.14, 0.04], 0.015);
		roundedBox(parts.get("indicator"), [side * (half - 0.05), bottom - 0.02, -4.25], [0.14, 0.1, 0.04], 0.015);
		roundedBox(parts.get("beacon"), [side * (half - 0.1), top + 0.06, bodyRear - 0.3], [0.14, 0.12, 0.14], 0.05);
		// Steps and handholds for the crew riding on the back.
		roundedBox(parts.get("steel"), [side * 0.7, 0.62, -4.3], [0.5, 0.04, 0.3], 0.01);
		tube(parts.get("chrome"), [side * 0.92, 1.1, -4.3], [side * 0.92, 2.0, -4.3], 0.018, 8);
	}
	// A bin lifter across the hopper mouth.
	roundedBox(parts.get("steel"), [0, bottom - 0.1, -4.3], [1.2, 0.3, 0.14], 0.03);
	for (const x of [-0.4, 0.4]) roundedBox(parts.get("trim"), [x, bottom + 0.1, -4.36], [0.32, 0.08, 0.06], 0.02);
	roundedBox(parts.get("plate"), [0, 0.8, -4.26], [0.52, 0.11, 0.01], 0.004);
	roundedBox(parts.get("bumper-rear"), [0, 0.68, -4.18], [2.2, 0.14, 0.14], 0.02);
	// An amber beacon bar on the cab roof.
	const roofY = spec.roofY(spec.rear + 0.8) + 0.04;
	roundedBox(parts.get("trim"), [0, roofY, spec.rear + 0.5], [1.4, 0.03, 0.22], 0.01);
	for (const x of [-0.5, 0.5]) roundedBox(parts.get("beacon"), [x, roofY + 0.06, spec.rear + 0.5], [0.3, 0.09, 0.2], 0.03);
}

// ---- The fire engine -----------------------------------------------------------------------------------

function fireDetails(spec, parts) {
	cabOverDetails(spec, parts, { grille: "chrome" });
	chassis(spec, parts, { from: spec.rear + 0.3, to: -4.5, y: 0.9, tank: false });
	fenders(parts, spec.axles, { key: "steel", from: 1 });
	const bodyFront = spec.rear - 0.08;
	const bodyRear = -4.75;
	const half = 1.22;
	const bottom = 0.72;
	const top = 2.75;
	const len = bodyFront - bodyRear;
	const mid = (bodyFront + bodyRear) / 2;
	roundedBox(parts.get("body"), [0, (bottom + top) / 2, mid], [half * 2, top - bottom, len], 0.05, { segments: 2 });
	// Lockers down each side with roller shutters: aluminium, ribbed, a bar handle at the foot.
	const lockers = [[bodyFront - 0.15, bodyFront - 1.2], [bodyFront - 1.3, spec.axles[1].z + 0.75], [spec.axles[1].z - 0.75, bodyRear + 0.15]];
	for (const side of [1, -1]) {
		for (const [a, b] of lockers) {
			const lockTop = top - 0.18;
			const lockBottom = a < spec.axles[1].z + 0.8 && b > spec.axles[1].z - 0.8 ? bottom + 0.6 : bottom + 0.12;
			roundedBox(parts.get("shutter"), [side * (half + 0.004), (lockTop + lockBottom) / 2, (a + b) / 2], [0.012, lockTop - lockBottom, a - b], 0.004);
			for (const y of range(lockBottom + 0.04, lockTop - 0.04, Math.round((lockTop - lockBottom) / 0.05))) {
				box(parts.get("shutter"), [side * (half + 0.012), y, (a + b) / 2], [0.006, 0.012, a - b - 0.02]);
			}
			roundedBox(parts.get("steel"), [side * (half + 0.03), lockBottom + 0.05, (a + b) / 2], [0.03, 0.04, a - b - 0.06], 0.01);
		}
		roundedBox(parts.get("accent2"), [side * (half + 0.006), top - 0.08, mid], [0.012, 0.1, len - 0.05], 0.004);
		roundedBox(parts.get("accent2"), [side * (half + 0.006), bottom + 0.06, mid], [0.012, 0.08, len - 0.05], 0.004);
		// Light bars at the body's rear corners.
		roundedBox(parts.get(side > 0 ? "siren-red" : "siren-blue"), [side * (half - 0.15), top + 0.07, bodyRear + 0.15], [0.22, 0.12, 0.14], 0.04);
	}
	// The aerial ladder: a turntable at the back, two rails with rungs, rested on a cradle over the cab.
	const steel = parts.get("ladder");
	const ladderY = top + 0.3;
	// The lathe turns about X: built there and stood upright.
	const table = new Geo();
	lathe(table, [[0, 0.18], [0.55, 0.18], [0.6, 0.08], [0.6, 0]], 32, [0, 0, 0], true);
	placeGeo(parts.get("steel"), table, { at: [0, top, bodyRear + 0.9], roll: 90 });
	for (const x of [-0.42, 0.42]) {
		tube(steel, [x, ladderY + 0.18, bodyRear + 0.6], [x, ladderY + 0.18, spec.front - 0.6], 0.03, 8);
		tube(steel, [x, ladderY - 0.02, bodyRear + 0.6], [x, ladderY - 0.02, spec.front - 0.6], 0.035, 8);
		for (const z of range(bodyRear + 0.7, spec.front - 0.7, 18)) tube(steel, [x, ladderY - 0.02, z], [x, ladderY + 0.18, z + 0.08], 0.01, 5);
	}
	for (const z of range(bodyRear + 0.65, spec.front - 0.65, 28)) tube(steel, [-0.42, ladderY, z], [0.42, ladderY, z], 0.014, 6);
	roundedBox(parts.get("steel"), [0, top + 0.15, bodyRear + 0.9], [0.9, 0.3, 0.6], 0.05);
	for (const x of [-0.4, 0.4]) tube(parts.get("steel"), [x, spec.roofY(spec.front - 1) + 0.02, spec.front - 1.0], [x, ladderY - 0.04, spec.front - 1.0], 0.03, 8);
	// The back: a pump panel with gauges, a step, lamps.
	const zr = bodyRear - 0.01;
	roundedBox(parts.get("shutter"), [0, (bottom + top) / 2 + 0.1, zr], [half * 2 - 0.3, top - bottom - 0.5, 0.012], 0.004);
	for (const x of range(-0.6, 0.6, 4)) tube(parts.get("chrome"), [x, 1.3, zr], [x, 1.3, zr - 0.04], 0.04, 12);
	for (const side of [1, -1]) {
		roundedBox(parts.get("lamp-housing"), [side * (half - 0.09), 1.1, zr - 0.02], [0.14, 0.5, 0.04], 0.02);
		roundedBox(parts.get("taillight"), [side * (half - 0.09), 1.22, zr - 0.04], [0.11, 0.18, 0.02], 0.012);
		roundedBox(parts.get("indicator"), [side * (half - 0.09), 1.0, zr - 0.04], [0.11, 0.12, 0.02], 0.012);
		tube(parts.get("chrome"), [side * (half - 0.25), 1.0, zr - 0.04], [side * (half - 0.25), 2.3, zr - 0.04], 0.02, 8);
	}
	roundedBox(parts.get("bumper-rear"), [0, 0.55, bodyRear - 0.12], [2.3, 0.1, 0.35], 0.02);
	roundedBox(parts.get("plate"), [0, 0.75, zr - 0.012], [0.52, 0.11, 0.01], 0.004);
	// The cab: a light bar on the roof, a white roof, chrome front bumper.
	const at = bodyProjector(spec, parts);
	const roof = at([0, 5, spec.front - 0.7], [0, -1, 0]);
	if (roof) {
		const y = roof.p[1] + 0.03;
		const z = roof.p[2];
		roundedBox(parts.get("trim"), [0, y, z], [2.0, 0.035, 0.3], 0.012);
		for (const side of [1, -1]) roundedBox(parts.get(side > 0 ? "siren-red" : "siren-blue"), [side * 0.5, y + 0.07, z], [0.95, 0.1, 0.28], 0.035);
	}
	for (const side of [1, -1]) {
		flankStripe(spec, parts, side, K.belt - 1.0, 0.1, spec.rear + 0.05, spec.front - 0.2, "decor2");
	}
}

// ---- Bonneted trucks: the cab ---------------------------------------------------------------------

/**
 * A working truck's cab behind a long bonnet: square, upright, the windscreen raked back from
 * the bonnet's end. `hood` is the bonnet's length from the nose; with `crew` the cab takes a
 * second row of doors.
 */
function conventionalSpec({ front, rear, half, floor, hoodY, belt, roof, hood, crew = false, axles, glassShare = 0.7 }) {
	const FRONT = front;
	const REAR = rear;
	const f = (d) => FRONT - d;
	const doorRear = crew ? f(hood + 1.15) : REAR + 0.1;
	const spec = {
		front: FRONT,
		rear: REAR,
		centreY: (floor + roof) / 2,
		stations: 130,
		axles,
		halfWidth: profile([[REAR, half - 0.04], [REAR + 0.04, half - 0.008], [REAR + 0.1, half], [f(0.3), half - 0.015], [f(0.1), half - 0.07], [FRONT, half - 0.14]]),
		floorY: profile([[REAR, floor + 0.04], [REAR + 0.06, floor], [f(0.25), floor], [f(0.06), floor + 0.08], [FRONT, floor + 0.16]]),
		beltY: profile([[REAR, belt - 0.04], [REAR + 0.06, belt], [f(hood + 0.25), belt], [f(hood), hoodY + 0.03], [f(0.2), hoodY - 0.02], [f(0.05), hoodY - 0.07], [FRONT, hoodY - 0.14]]),
		roofY: profile([[REAR, roof - 0.12], [REAR + 0.05, roof - 0.03], [REAR + 0.15, roof], [f(hood + 0.62), roof], [f(hood + 0.5), roof - 0.05], [f(hood + 0.04), hoodY + 0.09], [f(hood - 0.06), hoodY + 0.05], [f(0.2), hoodY + 0.03], [f(0.05), hoodY - 0.03], [FRONT, hoodY - 0.11]]),
		roofHalf: profile([[REAR, half - 0.08], [FRONT, half - 0.08]]),
		glassInset: 0.04,
		glassShare,
		glassBow: 0.004,
		crown: 0.03,
		roofSharpness: 12,
		rail: 0.04,
		bulge: 0.005,
		cuts: [f(hood), f(hood + 0.02), f(hood + 0.5), doorRear, doorRear - 0.02, REAR + 0.1, f(hood + 0.08), f(0.02)],
		doors: [],
		lids: [{ key: "hood", front: f(0.02), rear: f(hood + 0.02), edge: K.glassBase }],
		panes: [{ key: "windscreen", front: f(hood + 0.03), rear: f(hood + 0.52), low: K.rail, high: K.top + 0.01, frit: 0.04, fritT: 0.1 }],
	};
	for (const side of [1, -1]) {
		const s = side > 0 ? "left" : "right";
		spec.doors.push({ key: `door-${s}`, side, front: f(hood + 0.04), rear: doorRear, low: K.sill + 0.2, frame: `door-${s}-frame`, window: { key: `window-${s}`, front: f(hood + 0.14), rear: doorRear + 0.05 } });
		if (crew) spec.doors.push({ key: `rear-door-${s}`, side, front: doorRear - 0.02, rear: REAR + 0.1, low: K.sill + 0.2, frame: `rear-door-${s}-frame`, window: { key: `rear-window-${s}`, front: doorRear - 0.07, rear: REAR + 0.16 } });
	}
	return spec;
}

/** The face of a bonneted truck: a tall grille, square lamps, a steel bumper; mirrors, cab. */
function conventionalDetails(spec, parts) {
	const at = bodyProjector(spec, parts);
	const F = [0, 0, -1];
	const nose = spec.front;
	const half = spec.halfWidth(nose - 0.3);
	const hoodY = spec.beltY(nose - 0.3);
	const floor = spec.floorY(nose - 0.3);
	const gTop = hoodY - 0.06;
	const gBottom = floor + 0.2;
	decal(parts, "gloss", at, (u, v) => [lerp(-0.42, 0.42, u), lerp(gBottom, gTop, v), nose + 2], F, 0.003, 6, 8);
	for (const x of range(-0.36, 0.36, 8)) {
		const a = at([x, gBottom + 0.03, nose + 2], F);
		const b = at([x, gTop - 0.03, nose + 2], F);
		if (a && b) skinBox(parts.get("chrome"), add(scale(add(a.p, b.p), 0.5), scale(a.n, 0.012)), sub(b.p, a.p), a.n, [Math.hypot(...sub(b.p, a.p)), 0.018, 0.016]);
	}
	grilleBars(parts, "chrome", at, -0.44, 0.44, [gTop + 0.01, gBottom - 0.01], F, [0, 0.03, 0.02]);
	for (const side of [1, -1]) {
		lampUnit(parts, at, (u, v) => [side * lerp(0.5, half - 0.1, u), lerp(gTop - 0.22, gTop - 0.02, v), nose + 2], F, {
			bowls: [[0.32, 0.5, 0.06], [0.72, 0.5, 0.05]], strip: { from: 0.05, to: 0.95, v: 0.1, width: 0.01 }, rows: 6, cols: 6,
		});
		const ind = at([side * (half - 0.2), gTop - 0.32, nose + 2], F);
		if (ind) roundedBox(parts.get("indicator"), add(ind.p, scale(ind.n, 0.012)), [0.16, 0.06, 0.025], 0.012);
	}
	roundedBox(parts.get("bumper-front"), [0, floor + 0.05, nose + 0.06], [half * 2 + 0.06, 0.26, 0.18], 0.04);
	roundedBox(parts.get("plate"), [0, floor + 0.05, nose + 0.155], [0.52, 0.11, 0.01], 0.004);
	for (const x of [-0.75, 0.75]) tube(parts.get("lens"), [x, floor + 0.05, nose + 0.15], [x, floor + 0.05, nose + 0.165], 0.045, 12);
	for (const x of [-0.45, 0.45]) roundedBox(parts.get("steel"), [x, floor - 0.06, nose + 0.12], [0.06, 0.1, 0.12], 0.02);
	for (const door of spec.doors) doorHandle(spec, parts, door, { at: 0.08, length: 0.13 });
	// Square mirrors on two-strut arms.
	for (const side of [1, -1]) {
		const name = side > 0 ? "left" : "right";
		const z = spec.doors[0].front - 0.08;
		const belt = spec.beltY(z);
		const pod = [side * (half + 0.24), belt + 0.28, z];
		const shell = parts.get(`mirror-${name}`);
		tube(shell, [side * (half - 0.02), belt + 0.4, z], sub(pod, [side * 0.03, -0.12, 0]), 0.012, 8);
		tube(shell, [side * (half - 0.02), belt + 0.02, z], sub(pod, [side * 0.03, 0.14, 0]), 0.012, 8);
		roundedBox(shell, pod, [0.05, 0.36, 0.2], 0.03, { yaw: side * -8 });
		roundedBox(parts.get(`mirror-${name}-glass`), add(pod, [0, 0, -0.028]), [0.04, 0.32, 0.17], 0.02, { yaw: side * -8 });
	}
	const windscreen = spec.panes[0];
	wipers(parts, at, [-half + 0.2, 0.06], hoodY + 0.1, windscreen.front - 0.04, 0.6);
	// Back of the cab: a window.
	const zr = spec.rear - 0.012;
	const roof = spec.roofY(spec.rear + 0.3);
	const belt = spec.beltY(spec.rear + 0.3);
	roundedBox(parts.get("gloss"), [0, (roof + belt) / 2 + 0.05, zr], [1.3, (roof - belt) * 0.55, 0.01], 0.05);
	roundedBox(parts.get("rear-glass"), [0, (roof + belt) / 2 + 0.05, zr - 0.004], [1.22, (roof - belt) * 0.5, 0.008], 0.04);
	const inside = parts.get("interior");
	const seatZ = spec.doors[0].rear + 0.35;
	seat(inside, half - 0.5, floor + 0.3, seatZ, { width: 0.54 });
	seat(inside, -(half - 0.5), floor + 0.3, seatZ, { width: 0.54 });
	roundedBox(inside, [0, floor + 0.26, seatZ + 0.3], [half * 2 - 0.1, 0.04, 1.3], 0.02);
	cockpit(parts, { x: half - 0.5, y: floor + 0.3, z: seatZ, width: half * 2 - 0.12, dashZ: windscreen.front - 0.25, dashY: hoodY + 0.02, wheelTilt: -40 });
	return at;
}

/** A light bar on the cab roof: a dark base, and lenses in `key` (or alternating keys). */
function roofBar(spec, parts, at, { z, width = 1.4, keys = ["beacon", "beacon"] }) {
	const roof = at([0, 5, z], [0, -1, 0]);
	if (!roof) return;
	const y = roof.p[1] + 0.03;
	roundedBox(parts.get("trim"), [0, y, roof.p[2]], [width, 0.03, 0.24], 0.012);
	for (const side of [1, -1]) roundedBox(parts.get(side > 0 ? keys[0] : keys[1]), [side * width * 0.27, y + 0.06, roof.p[2]], [width * 0.46, 0.09, 0.22], 0.03);
}

// ---- The tow truck -------------------------------------------------------------------------------------

function towDetails(spec, parts) {
	const at = conventionalDetails(spec, parts);
	roofBar(spec, parts, at, { z: spec.rear + 0.5 });
	chassis(spec, parts, { from: spec.rear, to: -3.1, y: 0.8, tank: false });
	fenders(parts, spec.axles, { key: "steel", from: 1 });
	const bedFront = spec.rear - 0.08;
	const bedRear = -2.6;
	const deckY = 1.12;
	const half = 1.1;
	// The wrecker body: a low deck between two tall tool lockers.
	const steel = parts.get("steel");
	roundedBox(parts.get("underbody"), [0, deckY - 0.08, (bedFront + bedRear) / 2], [half * 2, 0.16, bedFront - bedRear], 0.02);
	for (const side of [1, -1]) {
		const lockers = parts.get("body");
		roundedBox(lockers, [side * (half - 0.3), deckY + 0.4, (bedFront + bedRear) / 2], [0.6, 0.8, bedFront - bedRear], 0.04);
		for (const z of [bedFront - 0.55, (bedFront + bedRear) / 2, bedRear + 0.55]) {
			roundedBox(parts.get("gloss"), [side * (half + 0.002), deckY + 0.42, z], [0.008, 0.66, 0.9], 0.01);
			roundedBox(parts.get("body"), [side * (half + 0.006), deckY + 0.42, z], [0.008, 0.62, 0.86], 0.01);
			roundedBox(parts.get("chrome"), [side * (half + 0.016), deckY + 0.55, z], [0.012, 0.03, 0.18], 0.008);
		}
		flankStripe(spec, parts, side, K.belt - 0.9, 0.08, spec.rear + 0.1, spec.front - 1.5, "decor");
		roundedBox(parts.get("taillight"), [side * (half - 0.1), deckY - 0.02, bedRear - 0.6], [0.14, 0.12, 0.04], 0.015);
		roundedBox(parts.get("indicator"), [side * (half - 0.28), deckY - 0.02, bedRear - 0.6], [0.14, 0.12, 0.04], 0.015);
		// Stabiliser legs folded at the back corners.
		roundedBox(steel, [side * 0.7, 0.7, bedRear - 0.15], [0.12, 0.5, 0.12], 0.02);
	}
	// The boom: a turret on the deck between the lockers, the boom raised back over the tail on a
	// hydraulic ram, a cable down from the sheave at its tip to the hook.
	const pivot = [0, deckY + 0.55, bedRear + 1.0];
	const tip = [0, deckY + 1.55, bedRear - 0.55];
	roundedBox(steel, [0, deckY + 0.28, bedRear + 1.05], [0.62, 0.56, 0.7], 0.05);
	const along = sub(tip, pivot);
	const length = Math.hypot(...along);
	const pitch = (Math.atan2(-along[1], along[2]) * 180) / Math.PI;
	const middle = scale(add(pivot, tip), 0.5);
	roundedBox(parts.get("accent"), middle, [0.24, 0.26, length + 0.25], 0.04, { pitch });
	roundedBox(steel, add(middle, scale(norm(along), length * 0.3)), [0.18, 0.2, length * 0.55], 0.03, { pitch });
	const ramFoot = [0, deckY + 0.1, bedRear + 0.35];
	const ramTop = add(pivot, scale(norm(along), length * 0.45));
	tube(steel, ramFoot, ramTop, 0.06, 12);
	tube(parts.get("chrome"), add(ramFoot, scale(norm(sub(ramTop, ramFoot)), 0.5)), ramTop, 0.035, 10);
	for (const x of [-0.13, 0.13]) tube(steel, [x, tip[1], tip[2]], [x, tip[1], tip[2] - 0.001], 0.11, 16);
	tube(parts.get("trim"), [0, tip[1] - 0.1, tip[2] - 0.05], [0, deckY - 0.05, tip[2] - 0.05], 0.008, 5);
	roundedBox(steel, [0, deckY - 0.12, tip[2] - 0.05], [0.06, 0.16, 0.04], 0.015);
	// The wheel-lift tucked under the back: an arm and a crossbar with two cradles.
	const lift = parts.get("steel");
	roundedBox(lift, [0, 0.45, bedRear - 0.45], [0.18, 0.14, 1.0], 0.02);
	roundedBox(lift, [0, 0.45, bedRear - 0.95], [1.5, 0.1, 0.14], 0.02);
	for (const x of [-0.55, 0.55]) roundedBox(parts.get("accent"), [x, 0.5, bedRear - 0.95], [0.3, 0.06, 0.3], 0.02);
	roundedBox(parts.get("plate"), [0, 0.95, bedRear - 0.58], [0.52, 0.11, 0.01], 0.004);
	roundedBox(parts.get("bumper-rear"), [0, 0.75, bedRear - 0.5], [2.1, 0.12, 0.12], 0.02);
}

// ---- The service truck ---------------------------------------------------------------------------------

function serviceDetails(spec, parts) {
	const at = conventionalDetails(spec, parts);
	roofBar(spec, parts, at, { z: spec.rear + 0.4 });
	for (const side of [1, -1]) flankStripe(spec, parts, side, K.belt - 0.9, 0.1, spec.rear + 0.05, spec.front - 0.4, "decor2");
	chassis(spec, parts, { from: spec.rear, to: -2.6, y: 0.65, tank: false });
	// A utility body: tool lockers down both sides over the wheel, an open bed between them.
	const front = spec.rear - 0.06;
	const rear = -2.72;
	const half = 1.0;
	const bottom = 0.68;
	const top = 1.62;
	const axle = spec.axles[1];
	for (const side of [1, -1]) {
		const x = side * (half - 0.22);
		roundedBox(parts.get("body"), [x, (bottom + top) / 2, (front + rear) / 2], [0.44, top - bottom, front - rear], 0.03);
		for (const [a, b] of [[front - 0.05, axle.z + 0.5], [axle.z - 0.5, rear + 0.05]]) {
			roundedBox(parts.get("gloss"), [side * (half + 0.002), (bottom + top) / 2, (a + b) / 2], [0.006, top - bottom - 0.12, a - b - 0.04], 0.006);
			roundedBox(parts.get("body"), [side * (half + 0.006), (bottom + top) / 2, (a + b) / 2], [0.006, top - bottom - 0.16, a - b - 0.08], 0.006);
			roundedBox(parts.get("chrome"), [side * (half + 0.014), top - 0.25, (a + b) / 2], [0.012, 0.04, 0.16], 0.008);
		}
		roundedBox(parts.get("body"), [x, axle.radius + 0.55, axle.z], [0.44, 0.4, 1.0], 0.03);
		roundedBox(parts.get("accent2"), [side * (half + 0.01), bottom + 0.08, (front + rear) / 2], [0.006, 0.07, front - rear - 0.05], 0.003);
		roundedBox(parts.get("taillight"), [side * (half - 0.1), bottom + 0.25, rear - 0.01], [0.14, 0.2, 0.03], 0.015);
		roundedBox(parts.get("indicator"), [side * (half - 0.1), bottom + 0.09, rear - 0.01], [0.14, 0.08, 0.03], 0.015);
		// Ladder rack posts.
		for (const z of [front - 0.15, rear + 0.15]) tube(parts.get("steel"), [side * (half - 0.1), top, z], [side * (half - 0.1), top + 0.55, z], 0.025, 8);
		tube(parts.get("steel"), [side * (half - 0.1), top + 0.55, front - 0.15], [side * (half - 0.1), top + 0.55, rear + 0.15], 0.025, 8);
	}
	roundedBox(parts.get("underbody"), [0, bottom + 0.05, (front + rear) / 2], [1.2, 0.08, front - rear], 0.02);
	for (const z of [front - 0.15, rear + 0.15]) tube(parts.get("steel"), [-(half - 0.1), top + 0.55, z], [half - 0.1, top + 0.55, z], 0.025, 8);
	// The ladder on the rack, and traffic cones in the bed.
	const ladder = parts.get("ladder");
	for (const x of [-0.22, 0.22]) roundedBox(ladder, [x, top + 0.62, (front + rear) / 2], [0.05, 0.08, front - rear + 0.3], 0.01);
	for (const z of range(rear, front, 10)) tube(ladder, [-0.22, top + 0.62, z], [0.22, top + 0.62, z], 0.012, 6);
	for (const z of [rear + 0.5, rear + 0.75]) {
		tube(parts.get("cone"), [0, bottom + 0.12, z], [0, bottom + 0.62, z], 0.13, 14, 0.02);
		roundedBox(parts.get("cone"), [0, bottom + 0.11, z], [0.32, 0.03, 0.32], 0.01);
	}
	roundedBox(parts.get("bumper-rear"), [0, bottom - 0.06, rear - 0.06], [1.9, 0.14, 0.14], 0.02);
	roundedBox(parts.get("plate"), [0, bottom + 0.2, rear - 0.012], [0.52, 0.11, 0.01], 0.004);
}

// ---- Buses ---------------------------------------------------------------------------------------

/** Side windows between pillars, from `from` back to `to`, each about `bay` long. */
function windowBays(from, to, bay, pillar = 0.09) {
	const count = Math.max(1, Math.round((from - to) / bay));
	const step = (from - to) / count;
	return Array.from({ length: count }, (_, k) => ({
		key: "side-glass",
		front: from - k * step - pillar / 2,
		rear: from - (k + 1) * step + pillar / 2,
		low: K.glassBase,
		high: K.glassTop,
		frit: 0.04,
		fritT: 0.15,
	}));
}

/**
 * A low-floor city bus: a near-vertical windscreen running down almost to the bumper, a band of
 * glass the length of each side, two glazed doors on the kerb side, the engine at the back.
 */
function cityBusSpec() {
	const FRONT = 5.5;
	const REAR = -5.5;
	const f = (d) => FRONT - d;
	const wheel = { radius: 0.5, rim: 0.3, width: 0.3, style: "truck" };
	const spec = {
		front: FRONT,
		rear: REAR,
		centreY: 1.6,
		stations: 190,
		axles: [
			{ z: 3.0, radius: 0.5, arch: 0.6, track: 1.06, wheel },
			{ z: -2.75, radius: 0.5, arch: 0.6, track: 1.06, wheel: { ...wheel, dual: true } },
		],
		halfWidth: profile([[REAR, 1.2], [REAR + 0.04, 1.255], [REAR + 0.12, 1.27], [f(0.15), 1.27], [f(0.05), 1.245], [FRONT, 1.19]]),
		floorY: profile([[REAR, 0.5], [REAR + 0.1, 0.36], [REAR + 0.4, 0.33], [f(0.12), 0.32], [FRONT, 0.42]]),
		beltY: profile([[REAR, 1.38], [REAR + 0.06, 1.42], [REAR + 1.2, 1.4], [f(1.6), 1.2], [f(0.3), 1.12], [f(0.12), 0.98], [FRONT, 0.9]]),
		roofY: profile([[REAR, 2.98], [REAR + 0.05, 3.06], [REAR + 0.15, 3.08], [f(0.42), 3.08], [f(0.3), 3.02], [f(0.2), 2.7], [f(0.06), 1.15], [FRONT, 0.98]]),
		roofHalf: profile([[REAR, 1.2], [FRONT, 1.2]]),
		glassInset: 0.03,
		glassShare: 0.84,
		glassBow: 0.003,
		crown: 0.04,
		roofSharpness: 18,
		rail: 0.05,
		bulge: 0.004,
		cladding: () => K.sill + 0.45,
		cuts: [f(0.2), f(0.06), f(0.3), f(0.32), f(1.45), 0.6, -0.65, REAR + 1.15],
		doors: [
			{ key: "bus-door-front", side: -1, front: f(0.32), rear: f(1.45), low: K.sill + 0.05, thick: false },
			{ key: "bus-door-mid", side: -1, front: 0.6, rear: -0.65, low: K.sill + 0.05, thick: false },
		],
		lids: [],
		panes: [
			{ key: "windscreen", front: f(0.04), rear: f(0.3), low: K.rail, high: K.top + 0.01, frit: 0.025, fritT: 0.08 },
			...windowBays(f(0.32), REAR + 1.15, 1.3),
		],
	};
	return spec;
}

/** Rows of seats either side of an aisle, with grab poles: what shows through a bus's windows. */
function busSaloon(parts, { from, to, floor, half, skip = [] }) {
	const inside = parts.get("interior");
	const poles = parts.get("poles");
	roundedBox(inside, [0, floor, (from + to) / 2], [half * 2 - 0.1, 0.04, from - to], 0.02);
	for (let z = from; z > to; z -= 0.82) {
		if (skip.some(([a, b]) => z < a && z > b)) continue;
		for (const side of [1, -1]) {
			for (const x of [half - 0.3, half - 0.75]) seat(inside, side * x, floor + 0.38, z, { width: 0.42, back: 0.55, recline: -8, headrest: false, lite: true });
		}
		tube(poles, [half - 0.95, floor, z - 0.35], [half - 0.95, floor + 2.0, z - 0.35], 0.018, 8);
	}
	for (const side of [1, -1]) tube(poles, [side * 0.45, floor + 1.95, from], [side * 0.45, floor + 1.95, to], 0.016, 8);
}

function cityBusDetails(spec, parts) {
	const at = bodyProjector(spec, parts);
	const F = [0, 0, -1];
	const B = [0, 0, 1];
	const nose = spec.front;
	// Front: lamps low in the corners, a small grille, a destination display behind the glass.
	for (const side of [1, -1]) {
		lampUnit(parts, at, (u, v) => [side * lerp(0.62, 1.12, u), lerp(0.5, 0.68, v) + 0.03 * u, 3 + nose], F, {
			bowls: [[0.25, 0.5, 0.05], [0.55, 0.5, 0.05], [0.82, 0.5, 0.04]], strip: { from: 0.05, to: 0.95, v: 0.9, width: 0.012 }, rows: 8, cols: 6,
		});
		// Mirrors on long arms reaching forward and out, as on city buses.
		const name = side > 0 ? "left" : "right";
		const shell = parts.get(`mirror-${name}`);
		const root = [side * 1.2, 2.75, nose - 0.25];
		const pod = [side * 1.38, 2.2, nose + 0.3];
		tube(shell, root, [side * 1.36, 2.6, nose + 0.28], 0.02, 8);
		tube(shell, [side * 1.36, 2.6, nose + 0.28], add(pod, [0, 0.2, 0]), 0.02, 8);
		roundedBox(shell, pod, [0.08, 0.42, 0.2], 0.04, { yaw: side * 20 });
		roundedBox(parts.get(`mirror-${name}-glass`), add(pod, [0, 0, -0.035]), [0.07, 0.38, 0.17], 0.03, { yaw: side * 20 });
	}
	decal(parts, "gloss", at, (u, v) => [lerp(-0.45, 0.45, u), lerp(0.42, 0.62, v), 3 + nose], F, 0.003, 3, 8);
	grilleBars(parts, "trim", at, -0.43, 0.43, [0.47, 0.52, 0.57], F, [0, 0.012, 0.008]);
	roundedBox(parts.get("bumper-front"), [0, 0.42, nose - 0.02], [2.5, 0.22, 0.2], 0.05);
	roundedBox(parts.get("plate"), [0, 0.43, nose + 0.085], [0.52, 0.11, 0.01], 0.004);
	roundedBox(parts.get("gloss"), [0, 2.82, nose - 0.24], [2.0, 0.26, 0.04], 0.02);
	roundedBox(parts.get("sign"), [0, 2.82, nose - 0.215], [1.7, 0.18, 0.012], 0.01);
	wipers(parts, at, [-1.0, 0.0], 1.0, nose - 0.03, 0.9);
	// Side: a destination display by the front door, repeaters, the livery sweep, engine grilles.
	roundedBox(parts.get("gloss"), [-1.255, 2.5, spec.front - 1.9], [0.02, 0.24, 0.9], 0.01);
	roundedBox(parts.get("sign"), [-1.268, 2.5, spec.front - 1.9], [0.006, 0.17, 0.8], 0.005);
	for (const side of [1, -1]) {
		flankStripe(spec, parts, side, K.sill + 1.0, 0.24, spec.rear + 0.1, spec.front - 0.25, "decor");
		flankStripe(spec, parts, side, K.sill + 1.45, 0.04, spec.rear + 0.1, spec.front - 0.25, "decor2");
		for (const z of [2.1, -0.9, -4.0]) {
			const rep = onBody(spec, z, K.sill + 0.6);
			skinBox(parts.get("indicator"), add(rep.p, scale(rep.n, 0.004)), [0, 0, 1], rep.n, [0.08, 0.03, 0.008], 0, side < 0);
		}
		decal(parts, "gloss", at, (u, v) => [side * 3, lerp(1.6, 2.6, v), lerp(spec.rear + 0.25, spec.rear + 1.0, u)], [-side, 0, 0], 0.003, 4, 4);
	}
	// Door frames: a black surround and a rubber seal down the middle of each pair of leaves.
	for (const door of spec.doors) {
		const geo = parts.get(`${door.key}-frame-bars`);
		const top = onBody(spec, (door.front + door.rear) / 2, K.glassTop - 0.05).p[1];
		for (const z of [door.front - 0.03, (door.front + door.rear) / 2, door.rear + 0.03]) roundedBox(geo, [-1.275, (0.45 + top) / 2, z], [0.03, top - 0.45, 0.05], 0.01);
		for (const y of [0.45, 1.25, top]) roundedBox(geo, [-1.275, y, (door.front + door.rear) / 2], [0.03, 0.05, door.front - door.rear], 0.01);
	}
	// Roof: air conditioning pod, hatches.
	roundedBox(parts.get("body"), [0, 3.17, -1.5], [1.9, 0.22, 2.6], 0.1);
	for (const z of [1.8, -3.8]) roundedBox(parts.get("trim"), [0, 3.12, z], [0.7, 0.06, 0.7], 0.03);
	// Back: a high window, the engine door with louvres, tall lamp clusters.
	const zr = spec.rear;
	roundedBox(parts.get("gloss"), [0, 2.45, zr - 0.012], [2.1, 0.7, 0.012], 0.06);
	roundedBox(parts.get("rear-glass"), [0, 2.45, zr - 0.018], [2.0, 0.6, 0.008], 0.05);
	roundedBox(parts.get("gloss"), [0, 1.15, zr - 0.012], [1.8, 0.7, 0.012], 0.03);
	for (const y of range(0.88, 1.42, 9)) roundedBox(parts.get("body"), [0, y, zr - 0.022], [1.7, 0.03, 0.012], 0.006);
	for (const side of [1, -1]) {
		const tail = at([side * 1.12, 1.25, -3 + zr], B);
		if (!tail) continue;
		const base = add(tail.p, scale(tail.n, 0.012));
		roundedBox(parts.get("lamp-housing"), base, [0.16, 0.8, 0.03], 0.03);
		for (const [dy, key] of [[0.24, "taillight"], [0.06, "taillight"], [-0.12, "indicator"], [-0.28, "reverse"]]) tube(parts.get(key), add(base, [0, dy, -0.012]), add(base, [0, dy, -0.022]), 0.05, 14);
	}
	roundedBox(parts.get("bumper-rear"), [0, 0.45, zr + 0.02], [2.5, 0.24, 0.18], 0.05);
	roundedBox(parts.get("plate"), [0, 0.62, zr - 0.012], [0.52, 0.11, 0.01], 0.004);
	// The saloon, and the driver's cab at the front left.
	busSaloon(parts, { from: spec.front - 2.2, to: spec.rear + 1.4, floor: 0.4, half: 1.22, skip: [[0.7, -0.75]] });
	seat(parts.get("interior"), 0.75, 0.55, spec.front - 1.0, { width: 0.5 });
	cockpit(parts, { x: 0.75, y: 0.55, z: spec.front - 1.0, width: 1.0, dashZ: spec.front - 0.4, dashY: 1.05, wheelTilt: -60 });
}

// ---- The school bus --------------------------------------------------------------------------------

/**
 * A school bus: a long bonnet ahead of a tall, square body with rows of small windows; yellow
 * with black rub rails, a stop arm and warning lamps.
 */
function schoolBusSpec() {
	const FRONT = 5.0;
	const REAR = -5.0;
	const f = (d) => FRONT - d;
	const wheel = { radius: 0.48, rim: 0.28, width: 0.28, style: "truck" };
	const spec = {
		front: FRONT,
		rear: REAR,
		centreY: 1.6,
		stations: 190,
		axles: [
			{ z: 3.85, radius: 0.48, arch: 0.56, track: 1.0, wheel },
			{ z: -2.3, radius: 0.48, arch: 0.56, track: 1.0, wheel: { ...wheel, dual: true } },
		],
		halfWidth: profile([[REAR, 1.17], [REAR + 0.04, 1.215], [REAR + 0.12, 1.225], [f(1.45), 1.225], [f(1.3), 1.0], [f(0.4), 0.98], [f(0.1), 0.92], [FRONT, 0.84]]),
		floorY: profile([[REAR, 0.68], [REAR + 0.1, 0.56], [f(1.4), 0.55], [f(0.3), 0.62], [FRONT, 0.72]]),
		beltY: profile([[REAR, 1.6], [REAR + 0.06, 1.66], [f(1.5), 1.66], [f(1.32), 1.42], [f(1.2), 1.38], [f(0.2), 1.33], [FRONT, 1.18]]),
		roofY: profile([[REAR, 2.92], [REAR + 0.05, 3.0], [REAR + 0.15, 3.02], [f(1.55), 3.02], [f(1.42), 2.95], [f(1.3), 1.46], [f(1.2), 1.41], [f(0.2), 1.37], [FRONT, 1.22]]),
		roofHalf: profile([[REAR, 1.15], [f(1.5), 1.15], [f(1.3), 0.92]]),
		glassInset: 0.03,
		glassShare: 0.62,
		glassBow: 0.002,
		crown: 0.08,
		roofSharpness: 10,
		rail: 0.06,
		bulge: 0.003,
		cuts: [f(1.3), f(1.2), f(1.42), f(1.45), f(2.15), REAR + 0.2],
		doors: [{ key: "bus-door-front", side: -1, front: f(1.45), rear: f(2.15), low: K.sill + 0.05, thick: false }],
		lids: [{ key: "hood", front: f(0.02), rear: f(1.22), edge: K.glassBase }],
		panes: [
			{ key: "windscreen", front: f(1.3), rear: f(1.44), low: K.rail, high: K.top + 0.01, frit: 0.015, fritT: 0.08 },
			...windowBays(f(2.2), REAR + 0.3, 0.82, 0.12),
			{ key: "side-glass", front: f(1.47), rear: f(2.13), low: K.glassBase, high: K.glassTop, frit: 0.04, side: 1 },
		],
	};
	return spec;
}

function schoolBusDetails(spec, parts) {
	const at = bodyProjector(spec, parts);
	const F = [0, 0, -1];
	const nose = spec.front;
	// The bonnet's face: a black grille with chrome bars, round lamps each side, a chrome bumper.
	decal(parts, "gloss", at, (u, v) => [lerp(-0.5, 0.5, u), lerp(0.82, 1.25, v), 3 + nose], F, 0.003, 6, 8);
	grilleBars(parts, "chrome", at, -0.48, 0.48, range(0.86, 1.21, 6), F, [0, 0.014, 0.012]);
	for (const side of [1, -1]) {
		for (const x of [0.62, 0.8]) {
			const lamp = at([side * x, 1.05, 3 + nose], F);
			if (!lamp) continue;
			const base = add(lamp.p, scale(lamp.n, 0.004));
			tube(parts.get("chrome"), base, add(base, scale(lamp.n, 0.025)), 0.085, 22);
			bowl(parts.get("chrome"), add(base, scale(lamp.n, 0.027)), lamp.n, 0.07);
			tube(parts.get("lens"), add(base, scale(lamp.n, 0.029)), add(base, scale(lamp.n, 0.034)), 0.04, 16);
		}
		const ind = at([side * 0.71, 0.88, 3 + nose], F);
		if (ind) roundedBox(parts.get("indicator"), add(ind.p, scale(ind.n, 0.012)), [0.16, 0.06, 0.025], 0.012);
		// Warning lamps high on the front of the body: amber outboard, red inboard.
		const wz = spec.front - 1.42;
		roundedBox(parts.get("trim"), [side * 0.72, 2.75, wz + 0.04], [0.5, 0.22, 0.08], 0.04);
		tube(parts.get("siren-red"), [side * 0.6, 2.75, wz + 0.08], [side * 0.6, 2.75, wz + 0.1], 0.07, 16);
		tube(parts.get("beacon"), [side * 0.85, 2.75, wz + 0.08], [side * 0.85, 2.75, wz + 0.1], 0.07, 16);
		roundedBox(parts.get("trim"), [side * 0.72, 2.75, spec.rear - 0.03], [0.5, 0.22, 0.06], 0.04);
		tube(parts.get("siren-red"), [side * 0.6, 2.75, spec.rear - 0.06], [side * 0.6, 2.75, spec.rear - 0.08], 0.07, 16);
		tube(parts.get("beacon"), [side * 0.85, 2.75, spec.rear - 0.06], [side * 0.85, 2.75, spec.rear - 0.08], 0.07, 16);
		// Black rub rails down each side.
		for (const t of [K.sill + 0.25, K.sill + 1.2, K.belt - 0.15]) flankStripe(spec, parts, side, t, 0.05, spec.rear + 0.05, spec.front - 1.48, "decor");
		// Crossview mirrors on the front fenders and side mirrors by the windscreen.
		const name = side > 0 ? "left" : "right";
		const shell = parts.get(`mirror-${name}`);
		const pod = [side * 1.05, 1.75, nose - 0.25];
		tube(shell, [side * 0.92, 1.35, nose - 0.35], sub(pod, [0, 0.12, 0]), 0.015, 8);
		mirrorPod(shell, parts.get(`mirror-${name}-glass`), pod, [0.1, 0.1, 0.06], side * 30);
		const side2 = [side * 1.48, 2.15, spec.front - 1.5];
		tube(shell, [side * 1.2, 2.4, spec.front - 1.5], add(side2, [0, 0.22, 0]), 0.015, 8);
		roundedBox(shell, side2, [0.06, 0.4, 0.2], 0.03, { yaw: side * -10 });
		roundedBox(parts.get(`mirror-${name}-glass`), add(side2, [0, 0, -0.03]), [0.05, 0.36, 0.17], 0.02, { yaw: side * -10 });
	}
	roundedBox(parts.get("bumper-front"), [0, 0.72, nose + 0.05], [2.1, 0.26, 0.16], 0.04);
	roundedBox(parts.get("plate"), [0, 0.72, nose + 0.135], [0.52, 0.11, 0.01], 0.004);
	// The crossing arm, folded back along the bumper's right end.
	tube(parts.get("accent2"), [-0.95, 0.76, nose + 0.15], [-0.25, 0.76, nose + 0.35], 0.018, 8);
	// The stop arm: a red octagon folded against the driver's side.
	const octagon = new Geo();
	lathe(octagon, [[0, 0.012], [0.22, 0.012], [0.22, -0.012], [0, -0.012]], 8, [0, 0, 0], true);
	placeGeo(parts.get("stop-sign"), octagon, { at: [1.25, 2.1, spec.front - 2.0], yaw: 0 });
	tube(parts.get("chrome"), [1.24, 2.1, spec.front - 1.75], [1.24, 2.1, spec.front - 2.24], 0.01, 6);
	wipers(parts, at, [-0.95, 0.05], 1.5, spec.front - 1.33, 0.85);
	// Door: frame bars on the folding leaves.
	const door = spec.doors[0];
	const geo = parts.get(`${door.key}-frame-bars`);
	for (const z of [door.front - 0.03, (door.front + door.rear) / 2, door.rear + 0.03]) roundedBox(geo, [-1.23, 1.6, z], [0.03, 2.0, 0.05], 0.01);
	for (const y of [0.62, 1.55, 2.58]) roundedBox(geo, [-1.23, y, (door.front + door.rear) / 2], [0.03, 0.05, door.front - door.rear], 0.01);
	// Back: an emergency door with two windows, round lamps, a bumper.
	const zr = spec.rear - 0.012;
	roundedBox(parts.get("gloss"), [0, 1.65, zr], [0.92, 2.1, 0.01], 0.02);
	roundedBox(parts.get("body"), [0, 1.65, zr - 0.004], [0.86, 2.04, 0.01], 0.02);
	for (const y of [2.25, 1.55]) {
		roundedBox(parts.get("gloss"), [0, y, zr - 0.01], [0.7, 0.52, 0.01], 0.04);
		roundedBox(parts.get("rear-glass"), [0, y, zr - 0.014], [0.64, 0.46, 0.008], 0.03);
	}
	for (const side of [1, -1]) {
		roundedBox(parts.get("gloss"), [side * 0.82, 2.2, zr], [0.5, 0.62, 0.01], 0.04);
		roundedBox(parts.get("rear-glass"), [side * 0.82, 2.2, zr - 0.004], [0.44, 0.56, 0.008], 0.03);
		for (const [y, key] of [[1.15, "taillight"], [0.95, "indicator"], [0.75, "taillight"]]) tube(parts.get(key), [side * 0.95, y, zr], [side * 0.95, y, zr - 0.02], 0.065, 16);
	}
	roundedBox(parts.get("bumper-rear"), [0, 0.68, spec.rear - 0.05], [2.4, 0.22, 0.14], 0.03);
	roundedBox(parts.get("plate"), [0, 0.95, zr - 0.006], [0.52, 0.11, 0.01], 0.004);
	busSaloon(parts, { from: spec.front - 2.4, to: spec.rear + 0.5, floor: 0.6, half: 1.18 });
	seat(parts.get("interior"), 0.62, 0.75, spec.front - 2.0, { width: 0.5 });
	cockpit(parts, { x: 0.62, y: 0.75, z: spec.front - 2.0, width: 2.2, dashZ: spec.front - 1.5, dashY: 1.42, wheelTilt: -55 });
}

// ---- The catalogue ----------------------------------------------------------------------------------

/** The taxi: cab yellow, a chequer band down each side, and a lit sign on the roof. */
function taxiFit(spec, parts) {
	for (const side of [1, -1]) {
		for (const [row, t] of [[0, K.belt - 0.95], [1, K.belt - 0.75]]) {
			for (let k = 0; k < 30; k++) {
				const z = -1.32 + k * 0.08 + 0.04;
				if ((k + row) % 2 === 0) flankMark(spec, parts, side, z, t, [0.078, 0.052, 0.002]);
			}
		}
	}
	const at = bodyProjector(spec, parts);
	const roof = at([0, 3, -0.15], [0, -1, 0]);
	if (roof) {
		const base = add(roof.p, [0, 0.015, 0]);
		roundedBox(parts.get("trim"), add(base, [0, 0.02, 0]), [0.12, 0.04, 0.22], 0.015);
		roundedBox(parts.get("sign"), add(base, [0, 0.11, 0]), [0.72, 0.16, 0.2], 0.03, { segments: 2 });
		roundedBox(parts.get("trim"), add(base, [0, 0.11, 0]), [0.74, 0.03, 0.21], 0.012);
		// "TAXI" in block letters on both faces of the sign, readable from the road.
		for (const face of [1, -1]) blockText(parts.get("trim"), "TAXI", add(base, [0, 0.155, face * 0.102]), 0.07, face);
	}
}

/** Block letters, 5 cells tall, for signs: just the few letters the vehicles need. */
const GLYPHS = {
	T: ["###", ".#.", ".#.", ".#.", ".#."],
	A: [".#.", "#.#", "###", "#.#", "#.#"],
	X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
	I: ["#", "#", "#", "#", "#"],
};

/**
 * `text` in raised block letters `height` tall, centred on `at` on a face looking along ±Z
 * (`facing` +1 for +Z). Read left to right from in front of that face.
 */
function blockText(geo, text, at, height, facing) {
	const cell = height / 5;
	const widths = [...text].map((ch) => GLYPHS[ch][0].length);
	const total = widths.reduce((sum, w) => sum + w + 1, -1) * cell;
	// Seen from +Z, +X is to the left: letters run towards -X on the front face.
	let x = total / 2;
	for (const [i, ch] of [...text].entries()) {
		const rows = GLYPHS[ch];
		rows.forEach((row, r) => {
			[...row].forEach((c, k) => {
				if (c !== "#") return;
				const cx = x - (k + 0.5) * cell;
				box(geo, [at[0] + facing * cx, at[1] + (2 - r) * cell, at[2] + facing * 0.004], [cell * 1.02, cell * 1.02, 0.008]);
			});
		});
		x -= (widths[i] + 1) * cell;
	}
}

/**
 * A compact crossover-hatch, 4.2 m, as the city's everyday cars are now: a short bonnet, a
 * raked screen, a roof that slopes down to a spoiler over a small tailgate window, a waist that
 * rises to the tail, black cladding round the arches, a gloss-black floating roof, and 19-inch
 * wheels. Doors, lids and fittings are the saloon's (sedanSpec, sedanDetails), lifted to suit.
 */
function hatchbackSpec() {
	const FRONT = 2.15;
	const REAR = -2.05;
	const wheel = { radius: 0.35, rim: 0.265, width: 0.23, style: "multi", spokes: 5 };
	return sedanSpec({
		front: FRONT,
		rear: REAR,
		axles: [
			{ z: 1.35, radius: 0.35, arch: 0.38, track: 0.79, wheel },
			{ z: -1.32, radius: 0.35, arch: 0.38, track: 0.79, wheel },
		],
		halfWidth: profile([[REAR, 0.66], [-2.0, 0.82], [-1.9, 0.89], [-1.6, 0.915], [0, 0.905], [1.35, 0.91], [1.8, 0.89], [2.0, 0.83], [2.1, 0.72], [FRONT, 0.6]]),
		floorY: profile([[REAR, 0.47], [-1.98, 0.35], [-1.8, 0.26], [-1.55, 0.2], [1.55, 0.2], [1.85, 0.26], [2.05, 0.34], [FRONT, 0.42]]),
		beltY: profile([[REAR, 1.0], [-1.98, 1.07], [-1.7, 1.09], [-1.0, 1.065], [0, 1.04], [0.9, 1.0], [1.4, 0.95], [1.85, 0.88], [2.05, 0.8], [FRONT, 0.72]]),
		roofY: profile([[REAR, 1.02], [-2.02, 1.14], [-1.97, 1.26], [-1.85, 1.35], [-1.6, 1.44], [-1.2, 1.5], [-0.6, 1.545], [0, 1.555], [0.35, 1.525], [0.6, 1.44], [0.88, 1.27], [1.1, 1.09], [1.3, 1.055], [1.8, 0.985], [2.0, 0.9], [2.1, 0.8], [FRONT, 0.73]]),
		roofHalf: profile([[-1.85, 0.68], [-1.0, 0.68], [-0.3, 0.68], [0.5, 0.69], [1.1, 0.76]]),
		cladding: (z) => (z > 1.9 || z < -1.85 ? 3.6 : 0),
		// The roof above the rails in gloss black: the "floating" roof of current crossovers.
		paint2: (z, lo) => lo >= K.rail - 0.01 && z > -1.9 && z < 1.05,
		faceLift: 0.075,
		tailLift: 0.13,
		cuts: [0.98, -0.1, -0.12, -1.06, 1.1, -1.75, 0.92, -0.06, -0.16, -1.0],
		lids: [
			{ key: "hood", front: FRONT - 0.04, rear: 1.1, edge: K.glassBase },
			// The tailgate below its glass: the game opens it as the boot.
			{ key: "trunk", front: -1.75, rear: REAR + 0.04, edge: K.glassBase },
		],
		panes: [
			{ key: "windscreen", front: 1.1, rear: 0.5, low: K.rail, high: K.top + 0.01, frit: 0.05, fritT: 0.12 },
			{ key: "rear-glass", front: -1.35, rear: -1.95, low: K.rail, high: K.top + 0.01, frit: 0.05, fritT: 0.12 },
			{ key: "side-glass", front: -1.03, rear: -1.45, low: K.glassBase, high: K.glassTop, frit: 0.035 },
		],
		cabinLift: 0.07,
	});
}

/** The hatchback's fittings: the saloon's face and tail, arch cladding, a spoiler, slim roof rails. */
function hatchbackDetails(spec, parts, M) {
	sedanDetails(spec, parts, M);
	for (const axle of spec.axles) archFlare(spec, parts, axle, { width: 0.075, lift: 0.018 });
	const at = bodyProjector(spec, parts);
	const top = at([0, 3, -1.86], [0, -1, 0]);
	if (top) {
		roundedBox(parts.get("gloss"), add(top.p, [0, 0.02, -0.07]), [1.25, 0.04, 0.24], 0.015, { pitch: 8 });
		// A third brake light under the spoiler.
		roundedBox(parts.get("taillight"), add(top.p, [0, -0.008, -0.17]), [0.4, 0.022, 0.02], 0.008);
	}
	for (const x of [-0.62, 0.62]) {
		const a = at([x, 3, -1.55], [0, -1, 0]);
		const b = at([x, 3, 0.55], [0, -1, 0]);
		if (a && b) tube(parts.get("gloss"), add(a.p, [0, 0.04, 0]), add(b.p, [0, 0.04, 0]), 0.016, 8);
	}
}

/**
 * A modern mid-size SUV, 4.9 m: tall and square-shouldered, a long flat roof floating on black
 * pillars, a near-upright tailgate, black cladding round 20-inch wheels, and the saloon's light
 * bars front and back, lifted to the SUV's height. Doors and fittings are the saloon's.
 */
function suvSpec() {
	const FRONT = 2.45;
	const REAR = -2.4;
	const wheel = { radius: 0.385, rim: 0.295, width: 0.255, style: "multi", spokes: 6 };
	return sedanSpec({
		front: FRONT,
		rear: REAR,
		axles: [
			{ z: 1.5, radius: 0.385, arch: 0.415, track: 0.84, wheel },
			{ z: -1.45, radius: 0.385, arch: 0.415, track: 0.84, wheel },
		],
		halfWidth: profile([[REAR, 0.72], [-2.36, 0.88], [-2.27, 0.95], [-2.0, 0.97], [0, 0.97], [1.5, 0.97], [2.05, 0.95], [2.3, 0.89], [2.4, 0.78], [FRONT, 0.66]]),
		floorY: profile([[REAR, 0.53], [-2.34, 0.41], [-2.17, 0.31], [-1.95, 0.245], [1.95, 0.245], [2.2, 0.31], [2.38, 0.41], [FRONT, 0.51]]),
		// A high, nearly level bonnet and a tall face: an SUV's, not a people carrier's.
		beltY: profile([[REAR, 1.12], [-2.33, 1.18], [-2.1, 1.2], [-1.0, 1.18], [0, 1.16], [0.9, 1.14], [1.3, 1.1], [1.8, 1.07], [2.2, 1.03], [2.38, 0.97], [FRONT, 0.9]]),
		roofY: profile([[REAR, 1.13], [-2.38, 1.4], [-2.33, 1.6], [-2.2, 1.68], [-1.8, 1.72], [-0.5, 1.74], [0, 1.74], [0.4, 1.72], [0.7, 1.64], [0.95, 1.46], [1.15, 1.28], [1.35, 1.16], [2.0, 1.12], [2.3, 1.07], [2.4, 0.99], [FRONT, 0.92]]),
		roofHalf: profile([[-2.2, 0.76], [-1.0, 0.76], [0, 0.76], [0.7, 0.77], [1.2, 0.82]]),
		cladding: (z) => (z > 2.15 || z < -2.15 ? 3.6 : 0),
		paint2: (z, lo) => lo >= K.rail - 0.01 && z > -2.3 && z < 1.1,
		faceLift: 0.29,
		tailLift: 0.24,
		cabinLift: 0.16,
		roofSharpness: 6,
		cuts: [0.98, -0.1, -0.12, -1.06, 1.2, -2.0, 0.92, -0.06, -0.16, -1.0],
		lids: [
			{ key: "hood", front: FRONT - 0.04, rear: 1.2, edge: K.glassBase },
			{ key: "trunk", front: -2.0, rear: REAR + 0.04, edge: K.glassBase },
		],
		panes: [
			{ key: "windscreen", front: 1.15, rear: 0.62, low: K.rail, high: K.top + 0.01, frit: 0.05, fritT: 0.12 },
			{ key: "rear-glass", front: -2.1, rear: -2.37, low: K.rail, high: K.top + 0.01, frit: 0.04, fritT: 0.12 },
			{ key: "side-glass", front: -1.03, rear: -1.9, low: K.glassBase, high: K.glassTop, frit: 0.035 },
		],
	});
}

/** The SUV's fittings: the saloon's face and tail lifted, arch cladding, skid plates, roof rails. */
function suvDetails(spec, parts, M) {
	sedanDetails(spec, parts, M);
	for (const axle of spec.axles) archFlare(spec, parts, axle, { width: 0.09, lift: 0.022 });
	const at = bodyProjector(spec, parts);
	// Satin skid plates under the bumpers.
	for (const [z, d] of [[spec.front + 0.02, [0, 0, -1]], [spec.rear - 0.02, [0, 0, 1]]]) {
		const plate = at([0, 0.42, -3 * d[2]], d);
		if (plate) roundedBox(parts.get("steel"), add(plate.p, scale(plate.n, 0.02)), [0.9, 0.08, 0.04], 0.015);
		void z;
	}
	// Roof rails, flush on feet, from the screen to the tailgate.
	for (const x of [-0.66, 0.66]) {
		const a = at([x, 3, -2.15], [0, -1, 0]);
		const b = at([x, 3, 0.6], [0, -1, 0]);
		if (a && b) tube(parts.get("gloss"), add(a.p, [0, 0.05, 0]), add(b.p, [0, 0.05, 0]), 0.02, 8);
	}
	const top = at([0, 3, -2.31], [0, -1, 0]);
	if (top) roundedBox(parts.get("gloss"), add(top.p, [0, 0.025, -0.06]), [1.4, 0.04, 0.22], 0.015, { pitch: 6 });
}

/** The patrol car: black with white doors, a light bar, a push bar, steel wheels. */
function policeFit(spec, parts) {
	const at = bodyProjector(spec, parts);
	const roof = at([0, 3, -0.1], [0, -1, 0]);
	if (roof) {
		const y = roof.p[1] + 0.02;
		const z = roof.p[2];
		for (const side of [1, -1]) {
			tube(parts.get("trim"), [side * 0.45, y - 0.01, z - 0.05], [side * 0.45, y + 0.035, z - 0.05], 0.02, 8);
			roundedBox(parts.get(side > 0 ? "siren-red" : "siren-blue"), [side * 0.33, y + 0.075, z], [0.5, 0.075, 0.24], 0.03);
		}
		roundedBox(parts.get("trim"), [0, y + 0.04, z], [1.22, 0.025, 0.25], 0.012);
		roundedBox(parts.get("lens"), [0, y + 0.075, z], [0.14, 0.07, 0.22], 0.02);
	}
	// Push bar across the nose.
	const steel = parts.get("steel");
	const zf = spec.front + 0.1;
	for (const x of [-0.32, 0.32]) {
		tube(steel, [x, 0.3, zf], [x, 0.78, zf], 0.025, 10);
		tube(steel, [x, 0.4, zf], [x, 0.4, spec.front - 0.08], 0.02, 8);
	}
	for (const y of [0.5, 0.74]) tube(steel, [-0.34, y, zf], [0.34, y, zf], 0.022, 10);
	roundedBox(parts.get("gloss"), [0, 0.62, zf + 0.005], [0.6, 0.18, 0.02], 0.01);
	// A spotlight on the driver's A-pillar.
	const pillar = onBody(spec, 0.95, K.glassBase + 0.4);
	roundedBox(parts.get("chrome"), [pillar.p[0] + 0.08, pillar.p[1] + 0.05, 0.95], [0.08, 0.08, 0.13], 0.035);
}

const VEHICLES = {
	"orion-sedan": () => buildSedanFamily("orion-sedan", { paint: { colour: [0.8, 0.8, 0.8] } }),
	"orion-taxi": () => buildSedanFamily("orion-taxi", {
		paint: { colour: [0.98, 0.72, 0.04], metallic: 0.2 },
		extra: {
			accent: [0.02, 0.02, 0.02], rim: [0.8, 0.81, 0.83], hub: [0.86, 0.86, 0.88],
			// Clearer glass over a mid-grey cabin, so seats and headrests read from the street.
			glass: { colour: [0.07, 0.09, 0.11], alpha: 0.46 }, interior: [0.2, 0.19, 0.18],
			materials: { sign: ["taxi_sign", [1, 0.92, 0.6], { roughness: 0.3, emissive: [0.55, 0.45, 0.2] }] },
		},
		fit: taxiFit,
		parts: { sign: ["trim", "sign"] },
	}),
	"orion-hatchback": () => buildVehicle("orion-hatchback", {
		spec: hatchbackSpec(),
		details: hatchbackDetails,
		paint: { colour: [0.8, 0.8, 0.8], metallic: 0.55, roughness: 0.26 },
		extra: { glass: { colour: [0.04, 0.05, 0.06], alpha: 0.6 } },
		// The floating roof shares the gloss-black trim's finish: black, and no extra draw.
		parts: { body2: ["body", "gloss"] },
	}),
	"orion-suv": () => buildVehicle("orion-suv", {
		spec: suvSpec(),
		details: suvDetails,
		paint: { colour: [0.8, 0.8, 0.8], metallic: 0.55, roughness: 0.26 },
		extra: { hub: [0.5, 0.5, 0.52], glass: { colour: [0.04, 0.05, 0.06], alpha: 0.6 } },
		parts: { body2: ["body", "gloss"] },
		aoReach: 0.65,
	}),
	"orion-wagon": () => buildVehicle("orion-wagon", {
		spec: wagonSpec(),
		details: wagonDetails,
		paint: { colour: [0.23, 0.26, 0.15], metallic: 0, roughness: 0.62 },
		parts: { "spare-tyre": ["spare", "tyre"] },
		extra: { rim: [0.22, 0.25, 0.14], hub: [0.2, 0.22, 0.13] },
	}),
	"orion-police": () => buildSedanFamily("orion-police", {
		paint: { colour: [0.03, 0.03, 0.035], metallic: 0.3 },
		extra: { paint2: { name: "paint_white", colour: [0.92, 0.92, 0.92] }, rim: [0.55, 0.56, 0.58], hub: [0.75, 0.75, 0.77] },
		fit: policeFit,
		doors2: true,
		wheel: "steel",
	}),
	"orion-van": () => buildVehicle("orion-van", {
		spec: vanSpec({
			axles: [
				{ z: 1.66, radius: 0.35, arch: 0.42, track: 0.86, wheel: { radius: 0.35, rim: 0.215, width: 0.23, style: "steel" } },
				{ z: -1.62, radius: 0.35, arch: 0.42, track: 0.86, wheel: { radius: 0.35, rim: 0.215, width: 0.23, style: "steel" } },
			],
		}),
		details: vanDetails,
		paint: { colour: [0.93, 0.93, 0.92], metallic: 0.1 },
		extra: { accent: [0.1, 0.25, 0.62], accent2: [0.78, 0.08, 0.06], rim: [0.6, 0.61, 0.63], hub: [0.8, 0.8, 0.82] },
	}),
	"orion-ambulance": () => buildVehicle("orion-ambulance", {
		spec: vanSpec({
			front: 3.25,
			rear: 1.33,
			cabOnly: true,
			roofTop: 2.4,
			axles: [
				{ z: 2.42, radius: 0.37, arch: 0.44, track: 0.88, wheel: { radius: 0.37, rim: 0.225, width: 0.24, style: "steel" } },
				{ z: -1.75, radius: 0.37, arch: 0.44, track: 0.88, wheel: { radius: 0.37, rim: 0.225, width: 0.24, style: "steel" } },
			],
		}),
		details: ambulanceDetails,
		paint: { colour: [0.95, 0.95, 0.94], metallic: 0.1 },
		extra: {
			accent: [0.8, 0.06, 0.05], accent2: [0.97, 0.97, 0.96], rim: [0.6, 0.61, 0.63], hub: [0.8, 0.8, 0.82],
			glass: { colour: [0.06, 0.08, 0.1], alpha: 0.5 }, interior: [0.16, 0.16, 0.17],
			materials: { blueMark: ["accent_blue", [0.04, 0.22, 0.72], { roughness: 0.4 }] },
		},
		parts: {
			"side-door-right": ["side-door-right", "paint"],
			"side-door-right-decor": ["side-door-right", "accent"],
			"side-door-right-handle": ["side-door-right", "trim"],
			"blue-mark": ["body", "blueMark"],
		},
		aoReach: 0.7,
	}),
	"orion-truck": () => buildVehicle("orion-truck", {
		spec: cabOverSpec({
			front: 4.8, rear: 2.7, half: 1.08, floor: 0.85, belt: 1.75, roof: 2.95,
			axles: [
				{ z: 3.95, radius: 0.5, arch: 0.58, track: 0.9, wheel: { radius: 0.5, rim: 0.3, width: 0.3, style: "truck" } },
				{ z: -2.3, radius: 0.5, arch: 0.58, track: 0.9, wheel: { radius: 0.5, rim: 0.3, width: 0.3, style: "truck", dual: true } },
			],
		}),
		details: truckDetails,
		paint: { colour: [0.08, 0.22, 0.5], metallic: 0.3 },
		extra: { paint2: { name: "paint_box", colour: [0.93, 0.93, 0.92] }, accent: [0.08, 0.22, 0.5], rim: [0.75, 0.76, 0.78], hub: [0.3, 0.3, 0.32] },
		aoReach: 0.9,
	}),
	"orion-garbage-truck": () => buildVehicle("orion-garbage-truck", {
		spec: cabOverSpec({
			front: 4.25, rear: 2.25, half: 1.2, floor: 0.65, belt: 1.55, roof: 2.75,
			axles: [
				{ z: 3.3, radius: 0.5, arch: 0.58, track: 1.0, wheel: { radius: 0.5, rim: 0.3, width: 0.32, style: "truck" } },
				{ z: -1.9, radius: 0.5, arch: 0.58, track: 0.98, wheel: { radius: 0.5, rim: 0.3, width: 0.32, style: "truck", dual: true } },
			],
		}),
		details: garbageDetails,
		paint: { colour: [0.93, 0.93, 0.92], metallic: 0.15 },
		extra: { paint2: { name: "paint_body", colour: [0.13, 0.42, 0.2] }, accent: [0.93, 0.93, 0.92], accent2: [0.95, 0.75, 0.1], rim: [0.75, 0.76, 0.78], hub: [0.3, 0.3, 0.32] },
		parts: { tailgate: ["tailgate", "paint2"], "tailgate-dark": ["tailgate", "trim"] },
		aoReach: 0.9,
	}),
	"orion-fire-truck": () => buildVehicle("orion-fire-truck", {
		spec: cabOverSpec({
			front: 4.75, rear: 1.85, half: 1.22, floor: 0.7, belt: 1.6, roof: 2.85, crew: true,
			axles: [
				{ z: 3.85, radius: 0.5, arch: 0.58, track: 1.0, wheel: { radius: 0.5, rim: 0.3, width: 0.32, style: "truck" } },
				{ z: -2.4, radius: 0.5, arch: 0.58, track: 0.98, wheel: { radius: 0.5, rim: 0.3, width: 0.32, style: "truck", dual: true } },
			],
		}),
		details: fireDetails,
		paint: { colour: [0.72, 0.04, 0.03], metallic: 0.35 },
		extra: {
			accent2: [0.96, 0.96, 0.94], rim: [0.8, 0.8, 0.82], hub: [0.75, 0.75, 0.77],
			materials: { shutter: ["aluminium", [0.74, 0.75, 0.77], { metallic: 1, roughness: 0.35 }] },
		},
		parts: { shutter: ["body", "shutter"], ladder: ["ladder", "steel"], "bumper-front": ["bumper-front", "chrome"] },
		aoReach: 0.9,
	}),
	"orion-tow-truck": () => buildVehicle("orion-tow-truck", {
		spec: conventionalSpec({
			front: 3.25, rear: 0.5, half: 1.1, floor: 0.72, hoodY: 1.55, belt: 1.72, roof: 2.6, hood: 1.4,
			axles: [
				{ z: 2.38, radius: 0.45, arch: 0.53, track: 0.95, wheel: { radius: 0.45, rim: 0.27, width: 0.28, style: "truck" } },
				{ z: -1.75, radius: 0.45, arch: 0.53, track: 0.95, wheel: { radius: 0.45, rim: 0.27, width: 0.28, style: "truck", dual: true } },
			],
		}),
		details: towDetails,
		paint: { colour: [0.96, 0.7, 0.06], metallic: 0.25 },
		extra: { accent: [0.05, 0.05, 0.05], rim: [0.75, 0.76, 0.78], hub: [0.3, 0.3, 0.32] },
		aoReach: 0.8,
	}),
	"orion-service-truck": () => buildVehicle("orion-service-truck", {
		spec: conventionalSpec({
			front: 2.75, rear: -0.45, half: 1.0, floor: 0.6, hoodY: 1.25, belt: 1.38, roof: 2.06, hood: 1.15, crew: true, glassShare: 0.78,
			axles: [
				{ z: 1.92, radius: 0.4, arch: 0.47, track: 0.86, wheel: { radius: 0.4, rim: 0.25, width: 0.26, style: "steel" } },
				{ z: -1.62, radius: 0.4, arch: 0.47, track: 0.86, wheel: { radius: 0.4, rim: 0.25, width: 0.26, style: "steel" } },
			],
		}),
		details: serviceDetails,
		paint: { colour: [0.95, 0.42, 0.04], metallic: 0.2 },
		extra: {
			accent2: [0.95, 0.95, 0.93], rim: [0.62, 0.63, 0.65], hub: [0.75, 0.75, 0.77],
			materials: { cone: ["traffic_cone", [0.98, 0.35, 0.05], { roughness: 0.55 }] },
		},
		parts: { ladder: ["ladder", "steel"], cone: ["trim", "cone"] },
		aoReach: 0.7,
	}),
	"orion-city-bus": () => buildVehicle("orion-city-bus", {
		spec: cityBusSpec(),
		details: cityBusDetails,
		paint: { colour: [0.93, 0.94, 0.95], metallic: 0.2 },
		extra: {
			accent: [0.05, 0.32, 0.62], accent2: [0.95, 0.68, 0.1], rim: [0.78, 0.79, 0.8], hub: [0.3, 0.3, 0.32],
			materials: {
				sign: ["destination_sign", [1, 0.62, 0.1], { roughness: 0.4, emissive: [0.9, 0.5, 0.05] }],
				poles: ["grab_poles", [0.95, 0.75, 0.1], { roughness: 0.3, metallic: 0.3 }],
			},
		},
		parts: {
			sign: ["trim", "sign"],
			poles: ["cabin", "poles"],
			"bus-door-front": ["bus-door-front", "glass"],
			"bus-door-front-frame-bars": ["bus-door-front", "gloss"],
			"bus-door-mid": ["bus-door-mid", "glass"],
			"bus-door-mid-frame-bars": ["bus-door-mid", "gloss"],
		},
		aoReach: 0.9,
	}),
	"orion-school-bus": () => buildVehicle("orion-school-bus", {
		spec: schoolBusSpec(),
		details: schoolBusDetails,
		paint: { colour: [0.98, 0.7, 0.03], metallic: 0.15 },
		extra: {
			accent: [0.03, 0.03, 0.03], accent2: [0.97, 0.97, 0.95], rim: [0.75, 0.76, 0.78], hub: [0.3, 0.3, 0.32],
			materials: {
				stop: ["stop_arm", [0.75, 0.04, 0.03], { roughness: 0.35 }],
				poles: ["grab_poles", [0.6, 0.6, 0.62], { roughness: 0.3, metallic: 0.8 }],
			},
		},
		parts: {
			"stop-sign": ["trim", "stop"],
			poles: ["cabin", "poles"],
			"bus-door-front": ["bus-door-front", "glass"],
			"bus-door-front-frame-bars": ["bus-door-front", "gloss"],
		},
		aoReach: 0.9,
	}),
};

const wanted = process.argv.slice(2);
for (const [name, build] of Object.entries(VEHICLES)) {
	if (wanted.length === 0 || wanted.some((w) => name.includes(w))) await build();
}
