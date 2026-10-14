/**
 * Builds the game's supercar, the "Vesper GT", from code:
 *
 *   node scripts/build-supercar.mjs public/models/vehicles/vesper-gt.glb
 *
 * An original, fictional mid-engined design — nothing traced from a real car — so nothing on it
 * needs hiding or licensing. No textures: every surface is a PBR material and every detail is
 * geometry, so the whole car stays around a megabyte where a downloaded one is many.
 *
 * The body is lofted: a cross-section is worked out at each station along the car (plan width,
 * fender line, deck crown, a scallop carved down the flank into the rear intake, wheel arches
 * cut out of the side) and the sections are joined into one smooth skin, with hard creases kept
 * at the shoulder, the sill and the window line. The skin is then cut into the panels that move
 * in game, each its own node named as the game looks for them:
 *
 *   door-left / door-right   open (butterfly, see VehicleModels) and hang loose after a crash;
 *                            each carries its window ("window-left"), which shatters
 *   hood                     the front lid, springs up on its rear hinge in a hard front hit
 *   trunk                    the engine cover behind the cabin, opens on its front hinge
 *   wing                     the rear wing, raised with speed and tilted as an air brake
 *   wheel-front-left …       spun and steered
 *
 * Panels that open have an inner skin and an edge, and the body has jambs round each opening,
 * so an open door looks like a door and not a sheet of paper.
 *
 * Car space: metres, +Y up, nose towards +Z, +X the car's left.
 */

import { writeFile } from "node:fs/promises";
import { Document, NodeIO } from "@gltf-transform/core";

import {
	profile, clamp01, smoothstep, Geo, sub, add, scale, range, catmull, loft, box, lathe, tube, sample, ribbon, wall, patch, skinBox, mirrorPod, bowl, ring, thicken, bakeOcclusion,
} from "./vehicle-kit.mjs";

const [target] = process.argv.slice(2);
if (!target) {
	console.error("usage: node scripts/build-supercar.mjs <out.glb>");
	process.exit(1);
}

// ---- Proportions ------------------------------------------------------------------------------

const LENGTH = 4.6;
const FRONT = LENGTH / 2;
const REAR = -LENGTH / 2;
const FRONT_AXLE = 1.4;
const REAR_AXLE = -1.33;
const WHEEL_RADIUS = 0.36;
const RIM_RADIUS = 0.278;
const TRACK = { front: 0.85, rear: 0.86 };
const TYRE_WIDTH = { front: 0.27, rear: 0.33 };
const ARCH_RADIUS = 0.425;
/** Inner wall of the wheel tubs. */
const TUB_X = 0.58;
/** Door and window cuts along the car. */
const DOOR = { front: 0.8, rear: -0.62 };
const WINDSCREEN_BASE = 0.66;
const CABIN_REAR = -1.3;
/** Lids: the front boot and the engine cover. */
const HOOD = { front: 2.02, rear: 0.86 };
const ENGINE_COVER = { front: -1.34, rear: -2.02 };
/** The opening lids cover the deck inside this key index (see bodyHalf). */
const LID_EDGE = 10;

// ---- Smooth profiles along the car ------------------------------------------------------------

// Points run tail to nose (z ascending).
// The nose tapers to a rounded point a hand's height tall, not a flat face.
const halfWidth = profile([[REAR, 0.68], [-2.24, 0.86], [-1.98, 0.995], [-1.33, 1.01], [-0.8, 0.975], [0.1, 0.945], [0.95, 0.975], [1.4, 0.99], [1.86, 0.95], [2.1, 0.86], [2.22, 0.72], [FRONT, 0.5]]);
const floorY = profile([[REAR, 0.33], [-2.1, 0.2], [-1.8, 0.115], [1.86, 0.105], [2.1, 0.12], [2.22, 0.16], [FRONT, 0.235]]);
/** The fender and shoulder line: high over both axles, dipping along the doors. */
const shoulderY = profile([[REAR, 0.69], [-2.16, 0.87], [-1.33, 0.95], [-0.8, 0.85], [-0.1, 0.745], [0.6, 0.73], [1.4, 0.875], [1.92, 0.73], [2.12, 0.6], [2.24, 0.46], [FRONT, 0.34]]);
/** Height on the centreline: a low front boot between the fenders, the engine deck behind. */
const deckY = profile([[REAR, 0.67], [-2.14, 0.87], [-1.52, 0.955], [-0.9, 0.87], [0, 0.74], [0.6, 0.725], [1.32, 0.725], [1.92, 0.6], [2.12, 0.5], [2.24, 0.41], [FRONT, 0.33]]);
/** Cabin height above the deck, and its half widths at the base. */
const cabinHeight = profile([[CABIN_REAR, 0], [-1.02, 0.13], [-0.56, 0.27], [-0.2, 0.32], [0.1, 0.27], [0.4, 0.14], [WINDSCREEN_BASE, 0]]);
const cabinWidth = profile([[CABIN_REAR, 0.66], [-0.6, 0.8], [0.1, 0.79], [WINDSCREEN_BASE, 0.7]]);

/** Deck height across the car: the centreline height at x = 0, rising (or falling) to the shoulder. */
function deckAt(x, z) {
	const edge = halfWidth(z) - 0.09;
	const u = Math.min(1, Math.abs(x) / edge);
	return deckY(z) + (shoulderY(z) - deckY(z)) * u ** 2.6;
}

/** Top of the wheel arch opening at z, or -Infinity outside the arches. */
function archTop(z) {
	let top = -Infinity;
	for (const axle of [FRONT_AXLE, REAR_AXLE]) {
		const dz = z - axle;
		if (Math.abs(dz) < ARCH_RADIUS) top = Math.max(top, WHEEL_RADIUS + Math.sqrt(ARCH_RADIUS * ARCH_RADIUS - dz * dz));
	}
	return top;
}

/**
 * The flank's sculpting: a scallop pressed into the side, starting behind the front wheel low
 * down and sweeping up and back, deepening into the rear intake. Inward depth (m) at (z, y).
 */
function scallop(z, y) {
	const along = smoothstep(0.92, 0.3, z) * (1 - smoothstep(-0.98, -1.22, z));
	if (along <= 0) return 0;
	const depth = 0.028 + 0.034 * clamp01((0.3 - z) / 1.25);
	const centre = 0.4 + 0.22 * clamp01((0.6 - z) / 1.55);
	return along * depth * Math.exp(-(((y - centre) / 0.085) ** 2));
}

// ---- The body section -----------------------------------------------------------------------------

/** Stations along the car, closer together where the shape turns (the ends and the arches). */
function stations(count) {
	const zs = [];
	for (let k = 0; k <= count; k++) zs.push(REAR + (FRONT - REAR) * (0.5 - 0.5 * Math.cos((Math.PI * k) / count)));
	for (const axle of [FRONT_AXLE, REAR_AXLE]) for (let k = -16; k <= 16; k++) zs.push(axle + (k / 16) * ARCH_RADIUS);
	for (const cut of [DOOR.front, DOOR.rear, HOOD.front, HOOD.rear, ENGINE_COVER.front, ENGINE_COVER.rear, WINDSCREEN_BASE, CABIN_REAR, INTAKE.front, INTAKE.rear]) zs.push(cut);
	return [...new Set(zs.map((z) => Math.round(z * 1e4) / 1e4))].sort((a, b) => a - b);
}

/**
 * Key points of the right half (x ≥ 0) of the lower body at z: floor centre, the wheel tub, the
 * sill lip, the flank, the shoulder; the deck follows from deckAt. Key indices are what the panel
 * cuts are drawn on: 3 the sill, 8 the shoulder crease, 8–16 the deck out to the centreline.
 */
const KEY = { lip: 3, shoulder: 8, deckEnd: 16 };
/** The side intakes behind the doors: a real opening in the flank, between these z and key t. */
const INTAKE = { front: -0.72, rear: -1.04, low: 5.0, high: 6.75, depth: 0.07 };

function keyPoints(z) {
	const w = halfWidth(z);
	const floor = floorY(z);
	const shoulder = shoulderY(z);
	const arch = archTop(z);
	const lip = Math.max(floor + 0.035, Math.min(arch, shoulder - 0.1));
	const inArch = arch > -Infinity;
	const mid = Math.max(lip + 0.05, floor + (shoulder - floor) * 0.4);
	return [
		[0, floor],
		[TUB_X, floor],
		[TUB_X, inArch ? Math.max(floor, lip) : floor],
		[w - 0.04, lip],
		[w - 0.006, lip + 0.04],
		[w, Math.max(mid, lip + 0.055)],
		[w - 0.012, Math.max(shoulder - 0.11, lip + 0.09)],
		[w - 0.045, shoulder - 0.022],
		[w - 0.09, shoulder],
	];
}

const SIDE_STEPS = 4;
const DECK_STEPS = 20;

/** The right half as {x, y, t, crease}: keys 0–3 as they are, the flank splined, the deck sampled. */
function bodyHalf(z) {
	const keys = keyPoints(z);
	const points = keys.slice(0, KEY.lip + 1).map(([x, y], t) => ({ x, y, t, crease: t >= 1 }));
	for (let k = KEY.lip; k < KEY.shoulder; k++) {
		const a = keys[Math.max(KEY.lip, k - 1)];
		const b = keys[k];
		const c = keys[k + 1];
		const d = keys[Math.min(KEY.shoulder, k + 2)];
		for (let s = 1; s <= SIDE_STEPS; s++) {
			const t = k + s / SIDE_STEPS;
			let [x, y] = catmull(a, b, c, d, s / SIDE_STEPS);
			if (t > KEY.lip + 0.5 && t < KEY.shoulder - 0.4) x -= scallop(z, y);
			points.push({ x, y, t, crease: t === KEY.shoulder });
		}
	}
	const x0 = halfWidth(z) - 0.09;
	for (let k = 1; k <= DECK_STEPS; k++) {
		const u = k / DECK_STEPS;
		const x = x0 * (1 - u);
		points.push({ x, y: deckAt(x, z), t: KEY.shoulder + (KEY.deckEnd - KEY.shoulder) * u, crease: false });
	}
	return points;
}

/** A point on the lower body's right half at z, `t` a key index (fractional). */
function surfaceAt(z, t) {
	const half = bodyHalf(z);
	let k = 0;
	while (k < half.length - 2 && half[k + 1].t < t) k++;
	const a = half[k];
	const b = half[k + 1];
	const f = clamp01((t - a.t) / (b.t - a.t || 1));
	return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, z];
}

const onSide = (z, t) => sample(surfaceAt, z, t, [1, 0, 0]);
const onDeck = (x, z) => sample((a, b) => [a, deckAt(a, b), b], x, z, [0, 1, 0]);
/** x of the lids' edge on the deck at z. */
const lidEdgeX = (z) => (halfWidth(z) - 0.09) * (1 - (LID_EDGE - KEY.shoulder) / (KEY.deckEnd - KEY.shoulder));

// ---- The body ---------------------------------------------------------------------------------

function buildBody(parts) {
	const zs = stations(300);
	const halves = zs.map(bodyHalf);
	const built = halves.map((half, j) => ring(half, zs[j]));
	const rings = built.map((r) => r.points);
	const creases = built[0].creases;
	const H = halves[0].length;
	const I = rings[0].length;
	// Ring index → key index and side.
	const keyOf = (i) => (i < H ? { t: halves[0][i].t, x: 1 } : { t: halves[0][I - i].t, x: -1 });

	const region = (j, i) => {
		const zMid = (zs[j] + zs[j + 1]) / 2;
		const a = keyOf(i);
		const b = keyOf((i + 1) % I);
		const low = Math.min(a.t, b.t);
		const high = Math.max(a.t, b.t);
		const side = a.t === 0 ? b.x : a.x;
		if (high <= KEY.lip) return "underbody";
		if (zMid < INTAKE.front && zMid > INTAKE.rear && low >= INTAKE.low && high <= INTAKE.high) return null;
		if (zMid < DOOR.front && zMid > DOOR.rear && low >= KEY.lip && high <= KEY.shoulder) return `door-${side > 0 ? "left" : "right"}`;
		if (low >= LID_EDGE && zMid < HOOD.front && zMid > HOOD.rear) return "hood";
		if (low >= LID_EDGE && zMid < ENGINE_COVER.front && zMid > ENGINE_COVER.rear) return "trunk";
		return "body";
	};
	loft(rings, creases, region, parts, (p) => [p[0], p[1] - 0.45, 0]);

	// Nose and tail caps: fan from the middle of the end rings.
	for (const [j, sign] of [[0, -1], [zs.length - 1, 1]]) {
		const geo = parts.get(sign > 0 ? "nose" : "tail");
		const r = rings[j];
		const centre = scale(r.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / r.length);
		const n = [0, 0, sign];
		const middle = geo.vertex(centre, n);
		const ids = r.map((p) => geo.vertex(p, n));
		for (let i = 0; i < ids.length; i++) geo.triangle(middle, ids[i], ids[(i + 1) % ids.length], n);
	}

	// Jambs round each opening, so it shows depth with the panel open.
	const jamb = parts.get("jamb");
	for (const mirror of [false, true]) {
		for (const z of [DOOR.front, DOOR.rear]) wall(jamb, range(KEY.lip, KEY.shoulder, 16).map((t) => onSide(z, t)), 0.075, mirror);
		wall(jamb, range(DOOR.rear, DOOR.front, 40).map((z) => onSide(z, KEY.lip)), 0.075, mirror);
		wall(jamb, range(DOOR.rear, DOOR.front, 40).map((z) => onSide(z, KEY.shoulder)), 0.06, mirror);
		for (const [front, rear] of [[HOOD.front, HOOD.rear], [ENGINE_COVER.front, ENGINE_COVER.rear]]) {
			wall(jamb, range(rear, front, 40).map((z) => onDeck(lidEdgeX(z), z)), 0.08, mirror);
		}
	}
	for (const z of [HOOD.front, HOOD.rear, ENGINE_COVER.front, ENGINE_COVER.rear]) wall(jamb, range(-lidEdgeX(z), lidEdgeX(z), 24).map((x) => onDeck(x, z)), 0.08);
}

/** Cabin cross-profile: (share of half width, share of height), side base to roof centre. */
const CABIN_PROFILE = [[1, 0], [0.985, 0.22], [0.955, 0.46], [0.91, 0.68], [0.845, 0.85], [0.74, 0.95], [0.55, 0.995], [0.28, 1.01], [0, 1.015]];
/** Key index of the side glass's top edge (the drip rail). */
const CABIN_GLASS_TOP = 4;
const CABIN_STEPS = 3;

function cabinHalf(z) {
	const h = cabinHeight(z);
	const cw = cabinWidth(z);
	const keys = CABIN_PROFILE.map(([u, v]) => [u * cw, v]);
	const points = [];
	for (let k = 0; k < keys.length - 1; k++) {
		const a = keys[Math.max(0, k - 1)];
		const d = keys[Math.min(keys.length - 1, k + 2)];
		for (let s = k === 0 ? 0 : 1; s <= CABIN_STEPS; s++) {
			const [x, v] = catmull(a, keys[k], keys[k + 1], d, s / CABIN_STEPS);
			const t = k + s / CABIN_STEPS;
			points.push({ x, y: deckAt(x, z) + 0.004 + v * h, t, crease: t === 0 || t === CABIN_GLASS_TOP });
		}
	}
	return points;
}

function buildCabin(parts) {
	const zs = stations(300).filter((z) => z >= CABIN_REAR && z <= WINDSCREEN_BASE);
	const halves = zs.map(cabinHalf);
	const built = halves.map((half, j) => ring(half, zs[j]));
	const rings = built.map((r) => r.points);
	const creases = built[0].creases;
	const H = halves[0].length;
	const I = rings[0].length;
	const keyOf = (i) => (i < H ? { t: halves[0][i].t, x: 1 } : { t: halves[0][I - i].t, x: -1 });
	const region = (j, i) => {
		// The ring closes across the cabin floor, from one side's base to the other: not skin.
		if (i === I - 1) return null;
		const zMid = (zs[j] + zs[j + 1]) / 2;
		const a = keyOf(i);
		const b = keyOf((i + 1) % I);
		const high = Math.max(a.t, b.t);
		const side = (a.t === CABIN_PROFILE.length - 1 ? b.x : a.x) > 0 ? "left" : "right";
		const low = Math.min(a.t, b.t);
		const sideGlass = high <= CABIN_GLASS_TOP;
		// Glass is edged in a black ceramic band where it meets the body, as real glass is.
		if (zMid > 0.12) return zMid > WINDSCREEN_BASE - 0.05 || zMid < 0.17 || low < 0.4 ? "frit" : "windscreen";
		if (sideGlass && zMid < 0.0 && zMid > DOOR.rear + 0.08) {
			const edge = zMid > -0.035 || zMid < DOOR.rear + 0.115 || low < 0.3 || high > CABIN_GLASS_TOP - 0.3;
			return edge ? `frit-${side}` : `window-${side}`;
		}
		if (sideGlass && zMid < DOOR.rear - 0.06 && zMid > -1.04) return zMid > DOOR.rear - 0.095 || zMid < -1.0 || low < 0.3 || high > CABIN_GLASS_TOP - 0.3 ? "frit" : "quarter-glass";
		if (!sideGlass && zMid < -0.8) return zMid > -0.845 || zMid < CABIN_REAR + 0.06 ? "frit" : "rear-glass";
		return "roof";
	};
	loft(rings, creases, region, parts, (p) => [p[0], p[1] - 0.6, 0]);
}

// ---- Details ------------------------------------------------------------------------------------

function buildDetails(parts) {
	const black = parts.get("trim");
	const carbon = parts.get("carbon");
	const accent = parts.get("accent");
	// Front splitter with a bronze lip, side skirts with a bronze edge, the rear diffuser with fins.
	box(carbon, [0, 0.1, FRONT - 0.2], [1.52, 0.022, 0.34]);
	box(accent, [0, 0.1, FRONT - 0.03], [1.5, 0.012, 0.012]);
	for (const x of [-1, 1]) {
		box(carbon, [x * 0.99, 0.15, 0.03], [0.06, 0.05, 1.95]);
		box(accent, [x * 1.022, 0.13, 0.03], [0.008, 0.008, 1.9]);
	}
	box(carbon, [0, 0.235, REAR + 0.24], [1.48, 0.026, 0.46], 0, -13);
	for (let k = -3; k <= 3; k++) box(carbon, [k * 0.2, 0.25, REAR + 0.22], [0.012, 0.14, 0.4], 0, -13);
	box(accent, [0, 0.2, REAR + 0.03], [1.48, 0.012, 0.012]);
	// Intakes in the lower corners of the nose and a slot across its tip; a mesh panel across the
	// lower tail.
	for (const mirror of [false, true]) patch(black, range(1.98, 2.24, 8).map((z) => range(3.15, 4.9, 6).map((t) => onSide(z, t))), 0.004, mirror);
	// The main intake across the flat of the nose: a dark opening with a crossed mesh in it, framed
	// in carbon. The mesh is what makes it read as an opening rather than a painted-on shape.
	box(black, [0, 0.278, FRONT + 0.002], [0.9, 0.092, 0.006]);
	for (const y of range(0.244, 0.312, 5)) box(carbon, [0, y, FRONT + 0.008], [0.88, 0.005, 0.01]);
	for (const x of range(-0.42, 0.42, 21)) box(carbon, [x, 0.278, FRONT + 0.008], [0.005, 0.086, 0.01]);
	for (const y of [0.229, 0.327]) box(carbon, [0, y, FRONT + 0.01], [0.93, 0.01, 0.022]);
	for (const x of [-1, 1]) box(carbon, [x * 0.46, 0.278, FRONT + 0.01], [0.01, 0.108, 0.022]);
	// The panel across the lower tail, with horizontal slats.
	box(black, [0, 0.5, REAR - 0.004], [1.3, 0.18, 0.012]);
	for (const y of range(0.43, 0.57, 7)) box(carbon, [0, y, REAR - 0.012], [1.26, 0.006, 0.012]);
	// Side intakes where the scallop ends behind the doors.
	// Each is a hole in the skin: dark walls going in, a back wall, and slats across the mouth.
	const inside = parts.get("intake");
	const { front, rear, low, high, depth } = INTAKE;
	const edges = [
		range(rear, front, 12).map((z) => onSide(z, low)),
		range(rear, front, 12).map((z) => onSide(z, high)),
		range(low, high, 10).map((t) => onSide(front, t)),
		range(low, high, 10).map((t) => onSide(rear, t)),
	];
	for (const mirror of [false, true]) {
		for (const edge of edges) wall(inside, edge, depth, mirror);
		patch(inside, range(rear, front, 12).map((z) => range(low, high, 10).map((t) => onSide(z, t))), -depth, mirror);
		for (const t of [5.35, 5.75, 6.15, 6.5]) {
			const { p, n } = onSide((front + rear) / 2, t);
			skinBox(carbon, sub(p, scale(n, 0.018)), [0, 0, 1], n, [front - rear - 0.01, 0.006, 0.03], 30, mirror);
		}
	}
	// Flush door handles near the back of each door's top edge: a dark recess with a pull bar.
	for (const mirror of [false, true]) {
		const handle = parts.get(`handle-${mirror ? "right" : "left"}`);
		ribbon(handle, range(DOOR.rear + 0.09, DOOR.rear + 0.23, 6).map((z) => onSide(z, 7.05)), 0.026, 0.0015, mirror);
		const { p, n } = onSide(DOOR.rear + 0.16, 7.05);
		skinBox(handle, add(p, scale(n, 0.004)), [0, 0, 1], n, [0.12, 0.008, 0.006], 0, mirror);
	}
	// Side marker lamps: amber behind the front wheel, red ahead of the tail.
	const marker = parts.get("marker");
	const tailMarker = parts.get("taillight");
	for (const mirror of [false, true]) {
		const front = onSide(FRONT_AXLE - ARCH_RADIUS - 0.06, 6.3);
		skinBox(marker, add(front.p, scale(front.n, 0.003)), [0, 0, 1], front.n, [0.06, 0.016, 0.006], 0, mirror);
		const rear = onSide(REAR + 0.22, 6.3);
		skinBox(tailMarker, add(rear.p, scale(rear.n, 0.003)), [0, 0, 1], rear.n, [0.06, 0.016, 0.006], 0, mirror);
	}
	// Bonnet vents: part of the bonnet, so they lift with it.
	// A dark recess with angled fins across it, each standing out of the skin.
	const finned = (geo, xFrom, xTo, zFrom, zTo, fins, mirror) => {
		patch(geo, range(zFrom, zTo, 8).map((z) => range(xFrom, xTo, 8).map((x) => onDeck(x, z))), 0.002, mirror);
		const xMid = (xFrom + xTo) / 2;
		for (const z of range(Math.min(zFrom, zTo) + 0.02, Math.max(zFrom, zTo) - 0.02, fins - 1)) {
			const { p, n } = onDeck(xMid, z);
			const u = sub(onDeck(xMid + 0.01, z).p, onDeck(xMid - 0.01, z).p);
			skinBox(geo, add(p, scale(n, 0.012)), u, n, [xTo - xFrom - 0.02, 0.006, 0.024], 38, mirror);
		}
	};
	const vents = parts.get("hood-vents");
	for (const mirror of [false, true]) finned(vents, 0.24, 0.5, 1.56, 1.82, 7, mirror);
	// Engine cover louvres.
	const louvres = parts.get("trunk-louvres");
	for (const mirror of [false, true]) finned(louvres, 0.12, 0.58, -1.88, -1.48, 10, mirror);
	// Slats across the nose intakes, and a small chevron badge on the tip of the nose.
	for (const mirror of [false, true]) {
		for (const t of [3.6, 4.05, 4.5]) {
			const { p, n } = onSide(2.11, t);
			skinBox(carbon, add(p, scale(n, 0.006)), sub(onSide(2.13, t).p, onSide(2.09, t).p), n, [0.24, 0.008, 0.012], 0, mirror);
		}
		const { p, n } = onDeck(0.022, 2.2);
		skinBox(accent, add(p, scale(n, 0.003)), [0.55, 0, -1], n, [0.06, 0.012, 0.004], 0, mirror);
	}
	// Wipers parked along the base of the windscreen.
	for (const [from, to] of [[-0.52, 0.04], [0.1, 0.64]]) {
		const z = WINDSCREEN_BASE - 0.07;
		tube(black, [from, deckAt(from, z) + 0.035, z], [to, deckAt(to, z) + 0.03, z - 0.02], 0.007, 6);
	}
	// Shut lines round the panels that open.
	const seams = parts.get("trim");
	for (const mirror of [false, true]) {
		for (const z of [DOOR.front, DOOR.rear]) ribbon(seams, range(KEY.lip, KEY.shoulder, 16).map((t) => onSide(z, t)), 0.006, 0.0012, mirror);
		for (const [front, rear] of [[HOOD.front, HOOD.rear], [ENGINE_COVER.front, ENGINE_COVER.rear]]) {
			ribbon(seams, range(rear, front, 40).map((z) => onDeck(lidEdgeX(z), z)), 0.006, 0.0012, mirror);
		}
	}
	// Twin exhausts with inner pipes.
	const chrome = parts.get("chrome");
	for (const x of [-0.14, 0.14]) {
		tube(chrome, [x, 0.4, REAR + 0.14], [x, 0.4, REAR - 0.03], 0.055, 20);
		tube(black, [x, 0.4, REAR + 0.1], [x, 0.4, REAR - 0.035], 0.042, 20);
	}
	// Mirrors on short stalks off the top of each door, ahead of the side window.
	for (const x of [-1, 1]) {
		const root = surfaceAt(0.32, KEY.shoulder);
		const mount = [x * (root[0] - 0.02), root[1] + 0.02, 0.32];
		const name = x > 0 ? "left" : "right";
		const mirror = parts.get(`mirror-${name}`);
		tube(mirror, mount, [x * (root[0] + 0.12), root[1] + 0.09, 0.28], 0.012, 8);
		mirrorPod(mirror, parts.get(`mirror-${name}-glass`), [x * (root[0] + 0.17), root[1] + 0.1, 0.27], [0.08, 0.04, 0.05], x * -10);
	}
	// The rear wing: plate, end plates and swan-neck posts, all one part so it moves together.
	const wing = parts.get("wing");
	box(wing, [0, 1.07, -1.98], [1.66, 0.026, 0.32], 0, 6);
	box(wing, [0, 1.088, -2.13], [1.62, 0.04, 0.03], 0, 6);
	for (const x of [-1, 1]) {
		box(wing, [x * 0.83, 1.05, -1.98], [0.012, 0.15, 0.36]);
		// Reaching well down into the deck, so the posts stay planted as the wing rises.
		box(wing, [x * 0.4, 0.9, -1.94], [0.025, 0.32, 0.12], 0, -10);
	}
}

function buildLights(parts) {
	const head = parts.get("headlight");
	const lens = parts.get("lens");
	const housing = parts.get("trim");
	const chrome = parts.get("chrome");
	// Headlamp units in the front corners, swept back along the fender: a glossy black housing,
	// three chrome reflector bowls with lenses, an LED daytime strip along the top edge, and a
	// clear cover over the whole unit that catches the light like real lamp glass.
	const lampHousing = parts.get("lamp-housing");
	const lampGlass = parts.get("lamp-glass");
	const lamp = (s, w) => {
		const z = 2.2 - 0.3 * s;
		const tLow = 5.7 + 0.7 * s;
		return onSide(z, tLow + (7.75 - tLow) * w);
	};
	for (const mirror of [false, true]) {
		const side = (v) => (mirror ? [-v[0], v[1], v[2]] : v);
		patch(lampHousing, range(0, 1, 16).map((s) => range(0, 1, 6).map((w) => lamp(s, w))), 0.003, mirror);
		patch(lampGlass, range(0, 1, 16).map((s) => range(0, 1, 6).map((w) => lamp(s, w))), 0.016, mirror);
		ribbon(head, range(0.02, 0.98, 16).map((s) => lamp(s, 0.88)), 0.011, 0.007, mirror);
		for (const s of [0.22, 0.5, 0.78]) {
			const { p, n } = lamp(s, 0.42);
			const base = side(add(p, scale(n, 0.003)));
			const out = side(n);
			bowl(chrome, base, out, 0.034);
			tube(lens, add(base, scale(out, 0.004)), add(base, scale(out, 0.008)), 0.015, 16);
		}
	}
	// Tail: a black band across the back with two LED lines in it, turning down at each end.
	const tail = parts.get("taillight");
	box(housing, [0, 0.785, REAR + 0.05], [1.5, 0.1, 0.05]);
	for (const y of [0.808, 0.765]) box(tail, [0, y, REAR + 0.022], [1.42, 0.01, 0.012]);
	for (const x of [-1, 1]) {
		box(tail, [x * 0.715, 0.735, REAR + 0.04], [0.012, 0.13, 0.012], x * 18);
		box(housing, [x * 0.715, 0.735, REAR + 0.06], [0.05, 0.16, 0.04], x * 18);
	}
}

function buildInterior(parts) {
	const geo = parts.get("interior");
	const accent = parts.get("interior-accent");
	const screen = parts.get("screen");
	// Floor pan and bulkheads, so the cabin is closed when a door's open.
	box(geo, [0, 0.2, -0.3], [1.72, 0.03, 1.95]);
	box(geo, [0, 0.46, CABIN_REAR + 0.42], [1.62, 0.52, 0.04]);
	box(geo, [0, 0.46, WINDSCREEN_BASE - 0.06], [1.62, 0.52, 0.04]);
	// Sills inside the jambs.
	for (const x of [-1, 1]) box(geo, [x * 0.86, 0.24, 0.09], [0.16, 0.12, 1.4]);
	// The front boot and the engine bay, seen with a lid up: an intake plenum, runners, struts.
	box(geo, [0, 0.5, 1.45], [1.25, 0.03, 0.95]);
	box(geo, [0, 0.62, -1.72], [1.2, 0.03, 0.78]);
	const metal = parts.get("chrome");
	for (const x of [-1, 1]) for (let k = 0; k < 6; k++) tube(metal, [x * 0.2, 0.66, -1.44 - k * 0.1], [x * 0.33, 0.73, -1.44 - k * 0.1], 0.024, 10);
	box(accent, [0, 0.71, -1.72], [0.32, 0.07, 0.64]);
	for (const x of [-1, 1]) tube(metal, [x * 0.5, 0.66, -1.42], [x * 0.18, 0.86, -1.95], 0.012, 8);
	// Bucket seats: cushion, back, bolsters, headrest, a red stripe down each.
	for (const x of [-1, 1]) {
		const sx = x * 0.4;
		box(geo, [sx, 0.29, -0.42], [0.46, 0.1, 0.5]);
		for (const s of [-1, 1]) box(geo, [sx + s * 0.22, 0.34, -0.42], [0.07, 0.14, 0.48]);
		box(geo, [sx, 0.62, -0.73], [0.46, 0.62, 0.1], 0, -18);
		for (const s of [-1, 1]) box(geo, [sx + s * 0.22, 0.62, -0.7], [0.07, 0.58, 0.14], 0, -18);
		box(geo, [sx, 0.98, -0.85], [0.24, 0.16, 0.08], 0, -18);
		box(accent, [sx, 0.63, -0.672], [0.06, 0.5, 0.01], 0, -18);
	}
	// Dashboard with a screen, centre tunnel with the gear selector, steering wheel.
	box(geo, [0, 0.66, 0.28], [1.58, 0.14, 0.36], 0, 8);
	box(screen, [0.18, 0.74, 0.2], [0.28, 0.12, 0.01], 0, -20);
	box(screen, [0.4, 0.72, 0.17], [0.2, 0.07, 0.01], 0, -25);
	box(geo, [0, 0.33, -0.1], [0.24, 0.22, 1.1]);
	box(accent, [0, 0.46, 0.0], [0.06, 0.04, 0.12]);
	const steer = parts.get("steering");
	tube(steer, [0.4, 0.62, 0.18], [0.4, 0.58, 0.05], 0.025, 8);
	lathe(steer, [[0.165, -0.016], [0.185, 0], [0.165, 0.016], [0.145, 0], [0.165, -0.016]], 28, [0.4, 0.6, 0.03]);
	for (const a of [0, 2.1, 4.2]) box(steer, [0.4, 0.6 + Math.cos(a) * 0.08, 0.03 + Math.sin(a) * 0.08], [0.02, 0.16, 0.03], 0, (-a * 180) / Math.PI);
}

/**
 * One wheel at the origin, its outer face towards +X: a low-profile tyre with tread grooves, a
 * 21-inch rim with fifteen twisted turbine blades dished in towards a centre-lock hub, and a
 * cross-drilled disc behind.
 */
function buildWheel(tyre, rim, disc, width) {
	const R = WHEEL_RADIUS;
	const r = RIM_RADIUS;
	const half = width / 2;
	// Sidewall, shoulders, and a tread with three circumferential grooves.
	const tread = [];
	const grooves = [-0.25, 0, 0.25];
	for (const g of range(-1, 1, 24)) {
		const x = g * (half - 0.03);
		const inGroove = grooves.some((c) => Math.abs(g - c) < 0.035);
		tread.push([inGroove ? R - 0.008 : R, x]);
	}
	lathe(tyre, [[r - 0.004, -half + 0.012], [r + 0.03, -half - 0.006], [R - 0.03, -half + 0.002], [R - 0.008, -half + 0.022], ...tread, [R - 0.008, half - 0.022], [R - 0.03, half - 0.002], [r + 0.03, half + 0.006], [r - 0.004, half - 0.012]], 72);
	// Barrel with an outer lip.
	lathe(rim, [[r + 0.012, half + 0.004], [r + 0.012, half - 0.012], [r - 0.006, half - 0.018], [r - 0.024, -half + 0.03], [r - 0.004, -half]], 64, [0, 0, 0], true);
	// Turbine blades: each a twisted vane from the hub out to the lip, dished towards the centre.
	const blades = 15;
	const steps = 7;
	const face = (radius) => half - 0.012 - 0.055 * (1 - radius / r) ** 1.4;
	for (let b = 0; b < blades; b++) {
		const base = (b / blades) * Math.PI * 2;
		const strip = [];
		for (let s = 0; s <= steps; s++) {
			const radius = 0.075 + (r - 0.085) * (s / steps);
			const angle = base + 0.55 * (s / steps) ** 1.3;
			const w = 0.022 - 0.008 * (s / steps);
			const tangent = [0, -Math.sin(angle), Math.cos(angle)];
			const radial = [0, Math.cos(angle), Math.sin(angle)];
			const centre = [face(radius), radial[1] * radius, radial[2] * radius];
			strip.push({ centre, tangent, radial, w });
		}
		const vertexRow = (depth) => strip.map(({ centre, tangent, w }) => [add(add(centre, scale(tangent, w)), [-depth, 0, 0]), add(add(centre, scale(tangent, -w)), [-depth, 0, 0])]);
		const front = vertexRow(0);
		const back = vertexRow(0.03);
		for (let s = 0; s < steps; s++) {
			const quad = (p0, p1, p2, p3, n) => {
				const ids = [p0, p1, p2, p3].map((p) => rim.vertex(p, n));
				rim.triangle(ids[0], ids[1], ids[2], n);
				rim.triangle(ids[0], ids[2], ids[3], n);
			};
			quad(front[s][0], front[s + 1][0], front[s + 1][1], front[s][1], [1, 0, 0]);
			quad(front[s][0], front[s + 1][0], back[s + 1][0], back[s][0], strip[s].tangent);
			quad(front[s][1], front[s + 1][1], back[s + 1][1], back[s][1], scale(strip[s].tangent, -1));
		}
	}
	// Centre-lock hub and nut.
	lathe(rim, [[0, half - 0.005], [0.04, half - 0.005], [0.045, half - 0.02], [0.08, half - 0.05], [0.08, half - 0.08]], 24, [0, 0, 0], true);
	lathe(rim, [[0, half + 0.012], [0.028, half + 0.012], [0.032, half - 0.006]], 6, [0, 0, 0], true);
	// Disc: a ring with a hat, and dark cross-drilling bands.
	lathe(disc, [[0.09, 0.02], [0.225, 0.02], [0.225, -0.012], [0.09, -0.012], [0.09, 0.02]], 48, [0, 0, 0], true);
	for (let k = 0; k < 24; k++) {
		const a = (k / 24) * Math.PI * 2;
		box(disc, [0.0215, Math.cos(a) * 0.16, Math.sin(a) * 0.16], [0.002, 0.012, 0.012]);
	}
}

// ---- Write the GLB ------------------------------------------------------------------------------

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("vesper-gt");
const root = doc.createNode("vesper-gt");
scene.addChild(root);

const material = (name, base, { metallic = 0, roughness = 0.5, emissive, alpha, doubleSided = false } = {}) => {
	const m = doc.createMaterial(name).setBaseColorFactor([...base, alpha ?? 1]).setMetallicFactor(metallic).setRoughnessFactor(roughness).setDoubleSided(doubleSided);
	if (emissive) m.setEmissiveFactor(emissive);
	if (alpha !== undefined) m.setAlphaMode("BLEND");
	return m;
};
const MATERIALS = {
	paint: material("carpaint", [0.9, 0.9, 0.9], { metallic: 0.6, roughness: 0.24, doubleSided: true }),
	glass: material("glass", [0.025, 0.035, 0.045], { roughness: 0.02, alpha: 0.6, doubleSided: true }),
	trim: material("trim", [0.022, 0.023, 0.025], { roughness: 0.38 }),
	carbon: material("carbon", [0.045, 0.047, 0.05], { metallic: 0.4, roughness: 0.26 }),
	accent: material("accent_bronze", [0.62, 0.36, 0.12], { metallic: 0.9, roughness: 0.3 }),
	underbody: material("underbody", [0.03, 0.03, 0.03], { roughness: 0.9 }),
	chrome: material("chrome", [0.82, 0.82, 0.84], { metallic: 1, roughness: 0.12 }),
	headlight: material("headlight", [1, 1, 1], { roughness: 0.1, emissive: [1, 0.98, 0.94] }),
	lens: material("headlight_lens", [0.9, 0.93, 1], { roughness: 0.05, emissive: [0.55, 0.58, 0.62] }),
	lampHousing: material("lamp_housing", [0.02, 0.021, 0.024], { metallic: 0.9, roughness: 0.12 }),
	lampGlass: material("lamp_glass", [0.9, 0.92, 0.95], { roughness: 0.0, alpha: 0.12, doubleSided: true }),
	intake: material("intake", [0.012, 0.012, 0.014], { roughness: 0.7, doubleSided: true }),
	marker: material("side_marker", [0.95, 0.45, 0.05], { roughness: 0.15, emissive: [0.4, 0.17, 0.01] }),
	taillight: material("tail_light", [0.55, 0.02, 0.02], { roughness: 0.15, emissive: [0.35, 0.01, 0.01] }),
	interior: material("interior", [0.07, 0.065, 0.065], { roughness: 0.65 }),
	accentInside: material("interior_accent", [0.62, 0.05, 0.035], { roughness: 0.5 }),
	screen: material("screen", [0.02, 0.03, 0.05], { roughness: 0.1, emissive: [0.05, 0.16, 0.28] }),
	jamb: material("jamb", [0.5, 0.5, 0.5], { metallic: 0.3, roughness: 0.5, doubleSided: true }),
	tyre: material("tyre_rubber", [0.032, 0.032, 0.034], { roughness: 0.9 }),
	rim: material("rim", [0.3, 0.31, 0.33], { metallic: 1, roughness: 0.3 }),
	rotor: material("rotor", [0.42, 0.42, 0.43], { metallic: 1, roughness: 0.42 }),
	caliper: material("caliper", [0.95, 0.72, 0.04], { roughness: 0.32 }),
};

/** Part name → [node name, material, parent part]. Parts with the same node share it. */
const PARTS = {
	body: ["body", MATERIALS.paint],
	roof: ["body", MATERIALS.paint],
	nose: ["body", MATERIALS.paint],
	tail: ["body", MATERIALS.paint],
	jamb: ["body", MATERIALS.paint],
	underbody: ["underbody", MATERIALS.underbody],
	"door-left": ["door-left", MATERIALS.paint],
	"door-left-inner": ["door-left", MATERIALS.interior],
	"door-right": ["door-right", MATERIALS.paint],
	"door-right-inner": ["door-right", MATERIALS.interior],
	"window-left": ["window-left", MATERIALS.glass, "door-left"],
	"window-right": ["window-right", MATERIALS.glass, "door-right"],
	hood: ["hood", MATERIALS.paint],
	"hood-inner": ["hood", MATERIALS.underbody],
	"hood-vents": ["hood", MATERIALS.trim],
	trunk: ["trunk", MATERIALS.paint],
	"trunk-inner": ["trunk", MATERIALS.underbody],
	"trunk-louvres": ["trunk", MATERIALS.trim],
	windscreen: ["windscreen-glass", MATERIALS.glass],
	frit: ["body", MATERIALS.trim],
	"frit-left": ["window-left", MATERIALS.trim, "door-left"],
	"frit-right": ["window-right", MATERIALS.trim, "door-right"],
	"quarter-glass": ["quarter-glass", MATERIALS.glass],
	"rear-glass": ["rear-glass", MATERIALS.glass],
	trim: ["trim", MATERIALS.trim],
	carbon: ["aero", MATERIALS.carbon],
	accent: ["aero", MATERIALS.accent],
	wing: ["wing", MATERIALS.carbon],
	chrome: ["chrome-parts", MATERIALS.chrome],
	"handle-left": ["door-left", MATERIALS.trim],
	"handle-right": ["door-right", MATERIALS.trim],
	"mirror-left": ["mirror-left", MATERIALS.paint],
	"mirror-left-glass": ["mirror-left", MATERIALS.chrome],
	"mirror-right": ["mirror-right", MATERIALS.paint],
	"mirror-right-glass": ["mirror-right", MATERIALS.chrome],
	marker: ["lights-front", MATERIALS.marker],
	intake: ["trim", MATERIALS.intake],
	headlight: ["lights-front", MATERIALS.headlight],
	lens: ["lights-front", MATERIALS.lens],
	"lamp-housing": ["lights-front", MATERIALS.lampHousing],
	"lamp-glass": ["lights-front", MATERIALS.lampGlass],
	taillight: ["lights-rear", MATERIALS.taillight],
	interior: ["cabin", MATERIALS.interior],
	"interior-accent": ["cabin", MATERIALS.accentInside],
	screen: ["cabin", MATERIALS.screen],
	steering: ["steering", MATERIALS.interior],
};

const parts = new Map(Object.keys(PARTS).map((key) => [key, new Geo()]));
buildBody(parts);
buildCabin(parts);
for (const [panel, inner, thickness] of [["door-left", "door-left-inner", 0.05], ["door-right", "door-right-inner", 0.05], ["hood", "hood-inner", 0.03], ["trunk", "trunk-inner", 0.03]]) {
	thicken(parts.get(panel), parts.get(inner), thickness);
}
buildDetails(parts);
buildLights(parts);
buildInterior(parts);
{
	const all = [...parts.values()].filter((geo) => !geo.empty);
	const solid = [...parts.entries()].filter(([key, geo]) => !geo.empty && !/glass|windscreen|window|lamp-glass/.test(key)).map(([, geo]) => geo);
	bakeOcclusion(all, solid);
}

const primitive = (geo, mat, origin = [0, 0, 0]) => {
	const positions = new Float32Array(geo.positions.length);
	for (let k = 0; k < geo.positions.length; k += 3) {
		positions[k] = geo.positions[k] - origin[0];
		positions[k + 1] = geo.positions[k + 1] - origin[1];
		positions[k + 2] = geo.positions[k + 2] - origin[2];
	}
	const count = geo.positions.length / 3;
	const colours = geo.colours ?? new Uint8Array(count * 4).fill(255);
	return doc.createPrimitive()
		.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer))
		.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.normals)).setBuffer(buffer))
		.setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(colours).setNormalized(true).setBuffer(buffer))
		.setIndices(doc.createAccessor().setType("SCALAR").setArray(count > 65535 ? new Uint32Array(geo.indices) : new Uint16Array(geo.indices)).setBuffer(buffer))
		.setMaterial(mat);
};

/** Bounds centre of a geometry: a moving part's node sits there, so it turns about itself. */
function centreOf(geo) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let k = 0; k < geo.positions.length; k += 3) {
		for (let a = 0; a < 3; a++) {
			min[a] = Math.min(min[a], geo.positions[k + a]);
			max[a] = Math.max(max[a], geo.positions[k + a]);
		}
	}
	return min.map((m, a) => (m + max[a]) / 2);
}

const nodes = new Map();
const nodeOrigin = new Map();
const MOVING = /^(door|hood|trunk|window|mirror|wing)/;
for (const [key, [nodeName, mat, parentPart]] of Object.entries(PARTS)) {
	const geo = parts.get(key);
	if (geo.empty) continue;
	let node = nodes.get(nodeName);
	if (!node) {
		node = doc.createNode(nodeName).setMesh(doc.createMesh(nodeName));
		const origin = MOVING.test(nodeName) ? centreOf(geo) : [0, 0, 0];
		nodeOrigin.set(nodeName, origin);
		const parent = parentPart ? nodes.get(PARTS[parentPart][0]) : null;
		const parentOrigin = parentPart ? nodeOrigin.get(PARTS[parentPart][0]) : [0, 0, 0];
		node.setTranslation(sub(origin, parentOrigin));
		(parent ?? root).addChild(node);
		nodes.set(nodeName, node);
	}
	node.getMesh().addPrimitive(primitive(geo, mat, nodeOrigin.get(nodeName)));
}

// Wheels: a front and a rear mesh (the rears are wider), each shared by its pair; the right-hand
// ones turned round so the face looks out. Calipers are their own nodes, so they don't spin.
const caliper = new Geo();
box(caliper, [-0.01, 0.13, -0.14], [0.08, 0.15, 0.22], 0, 35);
box(caliper, [-0.01, 0.22, -0.03], [0.07, 0.06, 0.12], 0, 10);
const caliperMesh = doc.createMesh("caliper").addPrimitive(primitive(caliper, MATERIALS.caliper));
for (const [axle, axleName] of [[FRONT_AXLE, "front"], [REAR_AXLE, "rear"]]) {
	const tyre = new Geo();
	const rim = new Geo();
	const disc = new Geo();
	buildWheel(tyre, rim, disc, TYRE_WIDTH[axleName]);
	bakeOcclusion([tyre, rim, disc], [tyre, rim, disc], { ground: false });
	const wheelMesh = doc.createMesh(`wheel-${axleName}`)
		.addPrimitive(primitive(tyre, MATERIALS.tyre))
		.addPrimitive(primitive(rim, MATERIALS.rim))
		.addPrimitive(primitive(disc, MATERIALS.rotor));
	for (const side of [1, -1]) {
		const sideName = side > 0 ? "left" : "right";
		const x = side * TRACK[axleName];
		const turn = side > 0 ? [0, 0, 0, 1] : [0, 1, 0, 0];
		root.addChild(doc.createNode(`wheel-${axleName}-${sideName}`).setMesh(wheelMesh).setTranslation([x, WHEEL_RADIUS, axle]).setRotation(turn));
		root.addChild(doc.createNode(`brake-caliper-${axleName}-${sideName}`).setMesh(caliperMesh).setTranslation([x - side * 0.03, WHEEL_RADIUS, axle]).setRotation(turn));
	}
}

const glb = await new NodeIO().writeBinary(doc);
await writeFile(target, glb);
let vertices = 0;
let triangles = 0;
for (const mesh of doc.getRoot().listMeshes()) {
	for (const p of mesh.listPrimitives()) {
		vertices += p.getAttribute("POSITION").getCount();
		triangles += p.getIndices().getCount() / 3;
	}
}
console.log(`${target}: ${(glb.byteLength / 1024).toFixed(0)} KB, ${vertices} vertices, ${triangles} triangles, ${doc.getRoot().listNodes().length} nodes`);
