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
	 * Police models whose roof light bar shares a texture with every other lamp, so it can't be
	 * found by material: the node is named instead, and cut into a left (red) and right (blue)
	 * half that flash.
	 */
	lightBarNode?: RegExp;
	/**
	 * The driver's seat, measured on the model, where measuring it from the geometry goes wrong
	 * (a box lorry's "roof" is the top of its box; a roof rack isn't the roof). In car space:
	 * +Z forward from the middle of the car, +X to the car's left.
	 */
	seat?: DriverSeat;
	/**
	 * True when the model is recognisably a real manufacturer's car. Hiding its badges is not
	 * enough to ship it: the body shape is a registered design, so it has to be replaced with an
	 * original before release. VehicleModels.test.ts keeps a list of the ones still in the tree,
	 * so a new one can't be added without the decision being made deliberately.
	 */
	realBrandDerivative?: boolean;
	credit: { author: string; licence: "CC0" | "CC-BY-4.0" | "Purchased" | string; source: string };
}

export interface DriverSeat {
	/** Where the seated figure's feet go, forward of the car's middle. */
	forward: number;
	/** Out from the centreline, positive to the car's left (a left-hand-drive car). */
	lateral: number;
	/** Height of the feet above the road. */
	rootAboveRoad: number;
	/**
	 * The seated figure sits upright, feet under the knees, the top of its head 1.78 m above
	 * them; in a low cabin it's drawn this much smaller so both head and feet stay inside.
	 */
	scale?: number;
}

export const VEHICLE_MODELS: readonly VehicleModelSpec[] = [
	{
		// A box lorry, unbadged, so there is nothing on it to hide.
		file: "truck.glb",
		styles: ["truck"],
		length: 9.6,
		// It comes painted; fleet colours would flatten the cab and box to one shade.
		keepPaint: true,
		// In the cab over the front wheels, not halfway down the box: the cab runs from 2.6 to
		// 4.7 m ahead of the middle with its roof 2.38 m up. Right-hand drive.
		seat: { forward: 3.8, lateral: -0.45, rootAboveRoad: 0.52 },
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
		// Left-hand drive; the roof is only 1.67 m up, so a full-size seated figure either put
		// its head through it or its legs out under the sills.
		seat: { forward: 0.4, lateral: 0.42, rootAboveRoad: 0.42, scale: 0.68 },
		credit: {
			author: "Axel Roman (DeathCoreBoy1)",
			// From the Sketchfab page below; confirm against the download dialog before release.
			licence: "CC-BY-4.0 — to be confirmed",
			source: "https://sketchfab.com/3d-models/dcb-k-133byat-unbranded-1a37570f3bbf4c31b6c8c1f89fdf3724",
		},
	},
	{
		// A fictional 1990s patrol sedan ("Phoenix" is the modeller's own marque), in a plain
		// POLICE livery with no real force's name on it. Its brand badges and number plates are
		// hidden like any other car's (badge sheet and plate materials).
		file: "phoenix-93-interceptor.glb",
		styles: ["police"],
		length: 4.94,
		// Modelled nose towards -X: without this it drove along tail-lights first.
		yawOffset: 180,
		// The livery is the paint.
		keepPaint: true,
		lightBarNode: /lightbar/i,
		// Behind its steering wheel, which is on the left (x +0.35); roof about 1.25 m up.
		seat: { forward: 0.07, lateral: 0.36, rootAboveRoad: 0.2, scale: 0.6 },
		credit: {
			author: "Daniel Zhabotinsky",
			// Read from the file's own metadata (Sketchfab download).
			licence: "CC-BY-4.0",
			source: "https://sketchfab.com/3d-models/phoenix-93-interceptor-low-poly-model-ac4a91cb1b184ebd82c598c1bc54ba3d",
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
