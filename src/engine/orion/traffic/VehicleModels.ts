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
	/**
	 * For a model whose livery is painted into the paint material's own picture: what replaces
	 * that picture. `null` paints the body one flat colour. A file name (under /models/vehicles/)
	 * is the same picture with the livery taken out, paint left a neutral grey, and its alpha
	 * marking which texels are paint — only those take the colour (see PAINT_MASK_DIFFUSE).
	 */
	paintMap?: string | null;
	/**
	 * A second use of a file the city already draws (a police car out of uniform), told apart by
	 * name: what's built from the model per file (its merged body, its simplified levels) is built
	 * per variant instead, since hidden parts change the geometry.
	 */
	variant?: string;
	/** Extra material names to hide on this model, on top of HIDDEN_MATERIAL. */
	hideMaterial?: RegExp;
	/** Node names to hide on this model (a light bar, a push bar), on top of HIDDEN_NODE. */
	hideNode?: RegExp;
	/**
	 * Materials to keep even though HIDDEN_MATERIAL would hide them: a livery drawn as "decals"
	 * of plain words (TAXI, AMBULANCE) is paint, not a maker's mark.
	 */
	keepMaterial?: RegExp;
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
	 * How the doors open, where they don't simply swing out on a vertical hinge at the front
	 * edge (the default): butterfly doors rise up and forward about an axis along the A-pillar.
	 */
	doorSwing?: DoorSwing;
	/** The rear wing's node: raised at speed and tilted up as an air brake under hard braking. */
	activeWing?: RegExp;
	/**
	 * True when the model is recognisably a real manufacturer's car. Hiding its badges is not
	 * enough to ship it: the body shape is a registered design, so it has to be replaced with an
	 * original before release. VehicleModels.test.ts keeps a list of the ones still in the tree,
	 * so a new one can't be added without the decision being made deliberately.
	 */
	realBrandDerivative?: boolean;
	/**
	 * Loaded after the loading screen rather than before it (see DeferredModels): for a model of
	 * something out of the world when play starts (fire engines, mission cars). Until it arrives
	 * the procedural body stands in, as it always has while a model loads.
	 */
	deferred?: boolean;
	credit: { author: string; licence: "CC0" | "CC-BY-4.0" | "Purchased" | string; source: string };
}

/** A door's hinge, for the driver's (left, +X) door; the other side is its mirror image. */
export interface DoorSwing {
	/** Hinge axis in car space (+Z forward, +Y up, +X the car's left); a positive turn opens it. */
	axis: readonly [number, number, number];
	/** A point on the hinge: across from the middle, above the road, forward of the middle. */
	hinge: readonly [number, number, number];
	/** How far it opens, degrees. */
	degrees: number;
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

/** Vehicles made for this project in code: no third-party claim on them. */
const ORION_ORIGINAL = { author: "OrionGenix", licence: "Original work, made for this project", source: "scripts/build-vehicles.mjs" };

export const VEHICLE_MODELS: readonly VehicleModelSpec[] = [
	// The city's vehicles: original, generic designs built in code (scripts/build-vehicles.mjs),
	// each part the game moves its own node, no textures. Every one but the plain sedan wears its
	// own livery, so keeps its paint.
	{
		// A four-door fastback saloon in the fleet's colours; visual meshes rebuilt in Blender
		// (blender/build_sedan_2026.py) on the same part names and pivots as orion-sedan.glb.
		file: "orion-sedan-2026.glb",
		styles: ["sedan"],
		length: 4.86,
		// Left-hand drive, in the front seat.
		seat: { forward: 0.3, lateral: 0.38, rootAboveRoad: 0.24, scale: 0.6 },
		// Only mission cars are sedans, and they're out of the world until a mission places them.
		deferred: true,
		credit: ORION_ORIGINAL,
	},
	{
		// A compact crossover-hatch on the saloon's doors: floating black roof, arch cladding, fleet colours.
		file: "orion-hatchback.glb",
		styles: ["hatchback"],
		length: 4.24,
		seat: { forward: 0.3, lateral: 0.38, rootAboveRoad: 0.31, scale: 0.6 },
		credit: ORION_ORIGINAL,
	},
	{
		// A modern mid-size SUV: high bonnet, light-bar face, floating black roof, 20-inch wheels, fleet colours.
		file: "orion-suv.glb",
		styles: ["suv"],
		length: 4.96,
		seat: { forward: 0.3, lateral: 0.38, rootAboveRoad: 0.4, scale: 0.62 },
		credit: ORION_ORIGINAL,
	},
	{
		// The saloon as a cab: yellow, a chequer band, a lit roof sign.
		file: "orion-taxi.glb",
		styles: ["taxi"],
		length: 4.86,
		keepPaint: true,
		seat: { forward: 0.3, lateral: 0.38, rootAboveRoad: 0.24, scale: 0.6 },
		credit: ORION_ORIGINAL,
	},
	{
		// The saloon as a patrol car: black with white doors, a red and blue light bar
		// ("siren-red"/"siren-blue", which flash), a push bar and steel wheels.
		file: "orion-police.glb",
		styles: ["police"],
		length: 4.96,
		keepPaint: true,
		seat: { forward: 0.3, lateral: 0.38, rootAboveRoad: 0.24, scale: 0.6 },
		credit: ORION_ORIGINAL,
	},
	{
		// A boxy four-door wagon on a raised chassis: matte olive, a roof rack, a snorkel, a spare
		// wheel on the back. No markings.
		file: "orion-wagon.glb",
		styles: ["militaryWagon"],
		length: 4.8,
		keepPaint: true,
		seat: { forward: 0.5, lateral: 0.42, rootAboveRoad: 0.5, scale: 0.66 },
		credit: ORION_ORIGINAL,
	},
	{
		// A panel van with a sliding side door, white with a blue band.
		file: "orion-van.glb",
		styles: ["van"],
		length: 5.0,
		keepPaint: true,
		seat: { forward: 1.55, lateral: 0.45, rootAboveRoad: 0.5, scale: 0.75 },
		credit: ORION_ORIGINAL,
	},
	{
		// The van's cab with a patient compartment behind: beacons, a light bar, a chequered band.
		file: "orion-ambulance.glb",
		styles: ["ambulance"],
		length: 6.5,
		keepPaint: true,
		seat: { forward: 2.3, lateral: 0.45, rootAboveRoad: 0.5, scale: 0.75 },
		credit: ORION_ORIGINAL,
	},
	{
		// A crew-cab utility truck with tool lockers, a ladder rack and amber beacons.
		file: "orion-service-truck.glb",
		styles: ["serviceTruck"],
		length: 5.5,
		keepPaint: true,
		seat: { forward: 1.15, lateral: 0.5, rootAboveRoad: 0.62, scale: 0.7 },
		credit: ORION_ORIGINAL,
	},
	{
		// A bonneted wrecker: boom, hook and wheel-lift on the back.
		file: "orion-tow-truck.glb",
		styles: ["towTruck"],
		length: 6.5,
		keepPaint: true,
		seat: { forward: 1.3, lateral: 0.6, rootAboveRoad: 0.78, scale: 0.75 },
		credit: ORION_ORIGINAL,
	},
	{
		// A cab-over box lorry: the cab in blue, a white box.
		file: "orion-truck.glb",
		styles: ["truck"],
		length: 9.6,
		keepPaint: true,
		// High in the cab over the front axle.
		seat: { forward: 4.0, lateral: 0.53, rootAboveRoad: 0.95, scale: 0.8 },
		credit: ORION_ORIGINAL,
	},
	{
		// A refuse truck: a low cab, the compactor body, the hopper at the back.
		file: "orion-garbage-truck.glb",
		styles: ["garbageTruck"],
		length: 8.5,
		keepPaint: true,
		seat: { forward: 3.45, lateral: 0.65, rootAboveRoad: 0.72, scale: 0.8 },
		credit: ORION_ORIGINAL,
	},
	{
		// A fire engine: crew cab, roller-shutter lockers, an aerial ladder, light bars.
		file: "orion-fire-truck.glb",
		styles: ["fireTruck"],
		length: 9.5,
		keepPaint: true,
		seat: { forward: 3.95, lateral: 0.67, rootAboveRoad: 0.75, scale: 0.8 },
		// Out of the world until something is burning.
		deferred: true,
		credit: ORION_ORIGINAL,
	},
	{
		// A low-floor city bus with two glazed doors on the kerb side.
		file: "orion-city-bus.glb",
		styles: ["bus"],
		length: 11,
		keepPaint: true,
		// The driver's seat, front left behind the windscreen.
		seat: { forward: 4.85, lateral: 0.75, rootAboveRoad: 0.55, scale: 0.85 },
		credit: ORION_ORIGINAL,
	},
	{
		// A bonneted school bus: yellow, black rub rails, a stop arm.
		file: "orion-school-bus.glb",
		styles: ["schoolBus"],
		length: 10,
		keepPaint: true,
		seat: { forward: 3.35, lateral: 0.62, rootAboveRoad: 0.75, scale: 0.85 },
		credit: ORION_ORIGINAL,
	},
	{
		// The Vesper GT: an original mid-engined supercar built in code (scripts/build-supercar.mjs),
		// no textures, a few hundred kilobytes. Its doors, bonnet, engine cover and glass are
		// separate parts, named as the game looks for them.
		file: "vesper-gt.glb",
		styles: ["luxury"],
		length: 4.6,
		// Left-hand drive, low in a low cabin (roof 1.14 m).
		seat: { forward: 0.05, lateral: 0.4, rootAboveRoad: 0.2, scale: 0.6 },
		// Butterfly doors: hinged along the A-pillar, they rise up and forward.
		doorSwing: { axis: [0.3, -0.47, 0.83], hinge: [0.82, 0.86, 0.72], degrees: 72 },
		activeWing: /^wing$/,
		credit: { ...ORION_ORIGINAL, source: "scripts/build-supercar.mjs" },
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

/** What's built from a model is keyed by this: per file, and per variant of the same file. */
export function modelKey(spec: VehicleModelSpec): string {
	return spec.variant ? `${spec.file}#${spec.variant}` : spec.file;
}

/** Picks this car's model deterministically, so a given car always looks the same. */
export function pickVehicleModel(style: VehicleStyle, seed: number): VehicleModelSpec | null {
	const matches = VEHICLE_MODELS.filter((model) => model.styles.includes(style));
	if (matches.length === 0) return null;
	return matches[Math.abs(seed) % matches.length];
}
