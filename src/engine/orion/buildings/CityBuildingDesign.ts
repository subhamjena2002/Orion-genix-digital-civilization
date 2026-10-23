import type { DistrictKind } from "../world/WorldModel";
import type { BuildingPlacement } from "./Buildings";
import type { BuildingSpec, Rgb, Tier } from "./CityBuildingMesh";
import { FLOOR_METRES, GROUND_METRES, type FacadeStyle, type GroundStyle } from "./FacadeTextures";

/**
 * What each lot gets built as: which facade, what colour, how tall, how it steps back, which
 * details. Decided from the lot's district and a hash of its id, so the city is the same on every
 * visit and neighbours differ.
 *
 * The palette leans on the pastel plaster of a sunny seaside city (cream, coral, mint, sky, lemon)
 * for the low and mid-rise, with glass, concrete and brick downtown.
 */

const hex = (value: string): Rgb => {
	const n = Number.parseInt(value.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const PASTELS: readonly Rgb[] = ["#f2e6cf", "#f3c9bf", "#f5d6b0", "#cfe6d4", "#cbdcec", "#f2e6a6", "#ddd0ea", "#f5f1ea", "#e7d6bb", "#f0bfae", "#bfe0dc"].map(hex);
const CONCRETE: readonly Rgb[] = ["#d9d4c9", "#cfcbc2", "#e3dccd", "#c8c6c0", "#ddd5c4"].map(hex);
const GLASS: readonly Rgb[] = ["#ffffff", "#e3f0f0", "#f2ece0", "#dde6f2", "#e8f2e6"].map(hex);
const BRICK: readonly Rgb[] = ["#ffffff", "#e9d9cf", "#d8c4b8", "#f1e4d6"].map(hex);
const METAL: readonly Rgb[] = ["#f2f2ef", "#e6ece9", "#ece6da", "#dde4ea", "#efe4cf"].map(hex);
const WHITE_TRIM: Rgb = hex("#fbfaf6");
const ACCENTS: readonly Rgb[] = ["#3fa7a0", "#e07a6a", "#f2c14e", "#7aa6d6", "#ffffff", "#b07cc6"].map(hex);

interface DistrictDesign {
	styles: readonly FacadeStyle[];
	/** Chance of shops along the ground floor. */
	shops: number;
	/** Height multiplier range on the lot's planned height. */
	heightScale: readonly [number, number];
}

const DESIGNS: Readonly<Record<DistrictKind, DistrictDesign>> = {
	downtown: { styles: ["glass", "glass", "office", "deco", "office"], shops: 0.7, heightScale: [0.9, 1.6] },
	financial: { styles: ["glass", "glass", "glass", "office"], shops: 0.5, heightScale: [1, 1.8] },
	"high-density-residential": { styles: ["apartment", "deco", "apartment", "brick"], shops: 0.4, heightScale: [0.9, 1.4] },
	"low-density-residential": { styles: ["deco", "apartment", "deco", "brick"], shops: 0.35, heightScale: [0.7, 1.1] },
	suburban: { styles: ["deco", "apartment"], shops: 0, heightScale: [0.9, 1.1] },
	commercial: { styles: ["deco", "office", "brick", "deco"], shops: 0.95, heightScale: [0.8, 1.3] },
	industrial: { styles: ["industrial", "industrial", "brick"], shops: 0, heightScale: [1, 1.3] },
	"logistics-port": { styles: ["industrial"], shops: 0, heightScale: [1, 1.4] },
	waterfront: { styles: ["deco", "deco", "apartment"], shops: 0.6, heightScale: [0.8, 1.2] },
	airport: { styles: ["industrial", "office"], shops: 0, heightScale: [1, 1.2] },
	civic: { styles: ["office", "deco", "brick"], shops: 0.2, heightScale: [0.9, 1.2] },
	"mixed-use": { styles: ["deco", "brick", "apartment", "office"], shops: 0.8, heightScale: [0.8, 1.3] },
};

/** How much of the lot the building covers (the rest is pavement and verge). */
const LOT_FILL = 0.92;

function pick<T>(items: readonly T[], r: number): T {
	return items[Math.min(items.length - 1, Math.floor(r * items.length))];
}

function tintFor(style: FacadeStyle, r: number): Rgb {
	switch (style) {
		case "glass":
			return pick(GLASS, r);
		case "office":
			return pick(CONCRETE, r);
		case "brick":
			return pick(BRICK, r);
		case "industrial":
			return pick(METAL, r);
		default:
			return pick(PASTELS, r);
	}
}

/** A deterministic stream of 0..1 for one lot. */
function stream(seed: number): () => number {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state >>>= 0;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return state / 4294967296;
	};
}

/** Shopfront tints, by variant: plain, warm, cool, rosy. Light enough to keep the glass glass. */
const SHOP_TINTS: readonly Rgb[] = [[1, 1, 1], [1, 0.94, 0.86], [0.9, 0.96, 1], [1, 0.9, 0.92]];
/** Parcel spacing within a block (WorldModel). */
const PARCEL_PITCH = 18;

/**
 * Which shopfront a building shows (0–3), from where it stands: neighbours along a street, and
 * across the back of a block, always differ — a random pick matched one pair in four.
 */
export function shopVariant(x: number, z: number): number {
	const wrap = (n: number) => ((n % 4) + 4) % 4;
	return wrap(Math.round(x / PARCEL_PITCH) + 2 * Math.round(z / PARCEL_PITCH));
}

export function designBuilding(placement: BuildingPlacement, seed: number): BuildingSpec {
	const r = stream(seed);
	const design = DESIGNS[placement.districtKind] ?? DESIGNS["mixed-use"];
	const style = pick(design.styles, r());
	const shops = style !== "industrial" && r() < design.shops;
	const warehouse = style === "industrial" && r() < 0.8;
	const ground: GroundStyle | null = shops ? "shop" : warehouse ? "warehouse" : null;

	const [low, high] = design.heightScale;
	const planned = placement.height * (low + r() * (high - low));
	const groundTop = ground ? GROUND_METRES : 0;
	const floors = Math.max(1, Math.round((planned - groundTop) / FLOOR_METRES));

	// Tall blocks step back once or twice as they rise.
	const tiers: Tier[] = [];
	if (floors >= 14 && style !== "industrial") {
		const first = Math.round(floors * (0.45 + r() * 0.2));
		const second = Math.round((floors - first) * (0.55 + r() * 0.2));
		tiers.push({ floors: first, inset: 0 }, { floors: second, inset: 1.2 + r() * 1.2 }, { floors: floors - first - second, inset: 1 + r() * 1.5 });
	} else if (floors >= 7 && style !== "industrial" && r() < 0.5) {
		const first = Math.round(floors * (0.6 + r() * 0.2));
		tiers.push({ floors: first, inset: 0 }, { floors: floors - first, inset: 1.2 + r() * 1 });
	} else {
		tiers.push({ floors, inset: 0 });
	}

	const tint = tintFor(style, r());
	const variant = shopVariant(placement.position[0], placement.position[2]);
	const fin = (style === "deco") && floors >= 3 && r() < 0.45;
	const plaster = style === "deco" || style === "apartment";
	// Drawn in the order they always were, so every building keeps its look.
	const accentTint = pick(ACCENTS, r());
	const rooftop = style === "industrial" ? 2 : 2 + Math.floor(r() * 4);
	const randomOffset = Math.floor(r() * 4);
	const floorOffset = Math.floor(r() * 4);
	return {
		width: placement.footprint[0] * LOT_FILL,
		depth: placement.footprint[1] * LOT_FILL,
		style,
		ground,
		tiers: tiers.filter((tier) => tier.floors > 0),
		tint,
		groundTint: shops ? SHOP_TINTS[variant] : [1, 1, 1],
		trimTint: plaster || style === "brick" ? WHITE_TRIM : style === "glass" ? hex("#b9c3c6") : hex("#d8d4cb"),
		accentTint,
		cornice: style !== "glass" && style !== "industrial",
		canopy: ground === "shop",
		fin,
		door: !ground,
		rooftop,
		bayOffset: shops ? variant : randomOffset,
		floorOffset,
		seed,
	};
}
