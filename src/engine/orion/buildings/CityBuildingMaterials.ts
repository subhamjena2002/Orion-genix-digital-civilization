import { Color, StandardMaterial, type GraphicsDevice } from "playcanvas";

import { ORION_ACTIVE_TIME_OF_DAY } from "../rendering/Environment";
import { FACADE_STYLES, GROUND_STYLES, paintFacade, paintGround, paintRoofTiles, paintTrim, type FacadeMaps, type FacadeStyle, type GroundStyle } from "./FacadeTextures";

/**
 * The few materials every city building shares: one per facade style, one per ground floor,
 * and trim (which roofs too). Colour comes from the mesh (vertex colour), so a whole street of a
 * style draws with one material — and the painted textures are made once.
 */
export interface CityBuildingMaterials {
	wall: Readonly<Record<FacadeStyle, StandardMaterial>>;
	ground: Readonly<Record<GroundStyle, StandardMaterial>>;
	trim: StandardMaterial;
	/** Houses' pitched roofs. */
	tiles: StandardMaterial;
	/** Swimming pools. */
	water: StandardMaterial;
	all: readonly StandardMaterial[];
}

/** Lit windows at night, bright enough to bloom. */
const NIGHT_WINDOW_INTENSITY = 2.6;

let cached: { device: GraphicsDevice; materials: CityBuildingMaterials } | null = null;

/**
 * Pixels per window bay. Phones get half: a facade set at full size is ~45 MB of video memory,
 * and on a small screen the extra detail can't be seen anyway.
 */
function cellSize(): number {
	const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
	return coarse ? 128 : 256;
}

function material(name: string, maps: FacadeMaps, options: { gloss: number; bumpiness: number; night: boolean; lit: boolean }): StandardMaterial {
	const result = new StandardMaterial();
	result.name = name;
	result.diffuse = new Color(1, 1, 1);
	result.diffuseMap = maps.diffuse;
	result.diffuseVertexColor = true;
	result.diffuseVertexColorChannel = "rgb";
	result.useMetalness = true;
	result.metalness = 0;
	result.gloss = options.gloss;
	result.glossMap = maps.diffuse;
	result.glossMapChannel = "a";
	result.normalMap = maps.normal;
	result.bumpiness = options.bumpiness;
	if (options.night && options.lit) {
		result.emissive = new Color(1, 1, 1);
		result.emissiveMap = maps.lit;
		result.emissiveIntensity = NIGHT_WINDOW_INTENSITY;
	}
	result.update();
	return result;
}

export function cityBuildingMaterials(device: GraphicsDevice): CityBuildingMaterials {
	if (cached?.device === device) return cached.materials;
	const cell = cellSize();
	const night = ORION_ACTIVE_TIME_OF_DAY === "night";
	const wall = {} as Record<FacadeStyle, StandardMaterial>;
	for (const style of FACADE_STYLES) {
		wall[style] = material(`facade-${style}`, paintFacade(device, style, cell), { gloss: 0.95, bumpiness: 1, night, lit: true });
	}
	const ground = {} as Record<GroundStyle, StandardMaterial>;
	for (const style of GROUND_STYLES) {
		ground[style] = material(`ground-${style}`, paintGround(device, style, cell), { gloss: 0.95, bumpiness: 1, night, lit: true });
	}
	const trim = material("building-trim", paintTrim(device, cell), { gloss: 0.6, bumpiness: 0.6, night, lit: false });
	const tiles = material("roof-tiles", paintRoofTiles(device, cell * 2), { gloss: 0.7, bumpiness: 1, night, lit: false });
	// Pool water: clear turquoise over a white basin, glossy enough to catch the sky.
	const water = new StandardMaterial();
	water.name = "pool-water";
	water.diffuse = new Color(0.16, 0.6, 0.72);
	water.emissive = new Color(0.02, 0.12, 0.15);
	water.useMetalness = true;
	water.metalness = 0;
	water.gloss = 0.94;
	water.update();
	const materials: CityBuildingMaterials = {
		wall,
		ground,
		trim,
		tiles,
		water,
		all: [...Object.values(wall), ...Object.values(ground), trim, tiles, water],
	};
	cached = { device, materials };
	return materials;
}
