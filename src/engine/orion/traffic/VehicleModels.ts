import type { VehicleStyle } from "./Vehicles";

/**
 * Real car models (GLB) that replace the procedural fallback bodies.
 *
 * Drop a file into `public/models/vehicles/` and add an entry here. Everything else is
 * automatic: the model is measured, scaled to `length`, sat on the road and turned to face
 * the direction of travel; wheels are found by node name and spun; paint, brake-light and
 * headlight materials are found by material name.
 *
 * Only unbranded / fictional designs belong here — real manufacturers' designs and logos
 * are trademarks. Record the licence and author for every file: CC-BY models must be
 * credited in the product.
 */
export interface VehicleModelSpec {
	/** File name under /models/vehicles/. */
	file: string;
	/** Which fleet styles may use this model. */
	styles: readonly VehicleStyle[];
	/** Real-world length in metres; the model is scaled so its longest side matches. */
	length: number;
	/**
	 * Extra rotation (degrees) if the model's nose ends up facing backwards. The long axis is
	 * detected automatically; this only fixes front/back, so it's normally 0 or 180.
	 */
	yawOffset?: number;
	/** Keep the model's own paint instead of applying fleet colours (e.g. liveried police cars). */
	keepPaint?: boolean;
	/** Overrides for material-name matching when a model uses unusual names. */
	paintMaterial?: RegExp;
	/** Extra material names to hide on this model, on top of HIDDEN_MATERIAL. */
	hideMaterial?: RegExp;
	/**
	 * True when the model is recognisably a real manufacturer's car. Hiding its badges is not
	 * enough to ship it: the body shape is a registered design, so it has to be replaced with an
	 * original before release. VehicleModels.test.ts keeps a list of the ones still in the tree,
	 * so a new one can't be added without the decision being made deliberately.
	 */
	realBrandDerivative?: boolean;
	credit: { author: string; licence: "CC0" | "CC-BY-4.0" | "Purchased" | string; source: string };
}

export const VEHICLE_MODELS: readonly VehicleModelSpec[] = [
	{
		// A box lorry, unbadged, so there is nothing on it to hide.
		file: "truck.glb",
		styles: ["truck"],
		length: 9.6,
		// It comes painted; fleet colours would flatten the cab and box to one shade.
		keepPaint: true,
		credit: {
			// UNKNOWN: supplied as a file, not from a page that named its author or terms. Fill
			// these in before release — an unattributed CC-BY model is a licence breach.
			author: "unknown — to be confirmed",
			licence: "unknown — to be confirmed",
			source: "supplied by the project owner, 2026-09-20",
		},
	},
	{
		// An army estate car, star and all. Its materials are called "Material1..3", so none of the
		// paint and lamp matching finds anything — it keeps its own baked textures, which is what
		// it wants anyway.
		file: "military-wagon.glb",
		styles: ["militaryWagon"],
		length: 4.8,
		keepPaint: true,
		credit: {
			author: "Axel Roman (DeathCoreBoy1)",
			// From the Sketchfab page below; confirm against the download dialog before release.
			licence: "CC-BY-4.0 — to be confirmed",
			source: "https://sketchfab.com/3d-models/dcb-k-133byat-unbranded-1a37570f3bbf4c31b6c8c1f89fdf3724",
		},
	},
	// Example — uncomment and edit once the file is in public/models/vehicles/:
	// {
	// 	file: "sports-coupe.glb",
	// 	styles: ["luxury"],
	// 	length: 4.6,
	// 	credit: { author: "Author name", licence: "CC-BY-4.0", source: "https://sketchfab.com/..." },
	// },
];

export const VEHICLE_MODEL_BASE = "/models/vehicles";

/** Material names that usually mean car body paint. */
export const PAINT_MATERIAL = /paint|body|carpaint|car_paint|exterior|chassis/i;
/** Brake discs, calipers and pads are not lamps: matching them lit the rotors up red. */
export const BRAKE_LIGHT_MATERIAL = /brake(?![ _.-]?(?:rotor|disc|disk|caliper|pad))|tail.?light|rear.?light|stop.?light|taillamp/i;
export const HEADLIGHT_MATERIAL = /head.?light|front.?light|headlamp/i;
export const SIREN_MATERIAL = /siren|beacon|light.?bar|police.?light/i;
/**
 * Brand marks are hidden: logos, badges and the maker's lettering are trademarks even on a
 * licensed model, and a number plate is somebody's real registration. Anything a model calls a
 * label, decal or nameplate is a mark until proven otherwise, so it goes.
 *
 * This hides the marks. It does NOT make a copy of a real car safe to ship — the shape itself
 * is protected (see `realBrandDerivative`).
 */
export const HIDDEN_MATERIAL = /logo|badge|emblem|label|lettering|decal|wordmark|nameplate|marque|(?:number|licen[cs]e|reg)[ _.-]?plate/i;
/** Pre-blurred "fast spin" rim copies; real spinning replaces them. */
export const HIDDEN_NODE = /blur/i;
/** Node names carrying a brand mark, for models whose materials don't say so. */
export const HIDDEN_BRAND_NODE = /logo|badge|emblem|wordmark|nameplate/i;
/** Node names that usually mean a wheel assembly (spun as a unit). */
export const WHEEL_NODE = /wheel|tyre|tire/i;

/** Picks this car's model deterministically, so a given car always looks the same. */
export function pickVehicleModel(style: VehicleStyle, seed: number): VehicleModelSpec | null {
	const matches = VEHICLE_MODELS.filter((model) => model.styles.includes(style));
	if (matches.length === 0) return null;
	return matches[Math.abs(seed) % matches.length];
}
