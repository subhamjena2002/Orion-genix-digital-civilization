import type { Vector3Tuple } from "../properties/Properties";
import type { LodAssetSet } from "../assets/AssetRegistry";
import { railBlocks } from "../rail/RailLine";
import { ORION_DISTRICTS, ORION_PARCELS, type DistrictKind, type Zoning } from "../world/WorldModel";

/** A small decorative prop (tree, path, planter) placed relative to a building's own position. */
export interface YardProp {
	assetPath: string;
	position: Vector3Tuple;
	rotation: Vector3Tuple;
	scale: number;
}

export interface BuildingDefinition {
	id: string;
	assetPath: string;
	category: string;
	districtType: string;
	/** Measured local bounds of the GLB (all kit models are origin-centred with their base at y=0). */
	nativeSize: Vector3Tuple;
	floors: number;
	collisionType: "box" | "compound" | "mesh";
	interiorReady: boolean;
	lodAssets: LodAssetSet;
	source: string;
	license: string;
	yardProps: readonly YardProp[];
}

export interface BuildingPlacement {
	id: string;
	parcelId: string;
	buildingDefinitionId: string;
	position: Vector3Tuple;
	rotation: Vector3Tuple;
	footprint: [number, number];
	height: number;
	floors: number;
	zoning: Zoning;
	districtKind: DistrictKind;
	entranceSide: "north" | "south" | "east" | "west";
	status: "built" | "planned";
	renderMode: "asset" | "primitive";
}

const COMMERCIAL_PATH = "/models/props/kenney-commercial";
const SUBURBAN_PATH = "/models/props/kenney-suburban";

/** Shared yard dressing placed around suburban houses. */
const KENNEY_YARD_PROPS: readonly YardProp[] = [
	{ assetPath: `${SUBURBAN_PATH}/tree-small.glb`, position: [-5.5, 0, 4], rotation: [0, 0, 0], scale: 8 },
	{ assetPath: `${SUBURBAN_PATH}/planter.glb`, position: [4.5, 0, 4.2], rotation: [0, 30, 0], scale: 8 },
	{ assetPath: `${SUBURBAN_PATH}/path-stones-short.glb`, position: [0, 0, 4.6], rotation: [0, 0, 0], scale: 8 },
	{ assetPath: `${SUBURBAN_PATH}/path-stones-short.glb`, position: [0, 0, 6.2], rotation: [0, 0, 0], scale: 8 },
];

interface ModelSpec {
	file: string;
	size: Vector3Tuple;
	floors: number;
	yard?: readonly YardProp[];
}

/**
 * Kenney City Kit models (CC0). `size` is each GLB's measured local bounding box — read
 * straight from its POSITION accessor — which is what lets a placement scale a model to
 * fit its parcel instead of relying on hand-tuned magic numbers.
 */
const KENNEY_MODELS: Readonly<Record<string, ModelSpec>> = {
	"shop-a": { file: `${COMMERCIAL_PATH}/building-a.glb`, size: [0.88, 1.29, 0.94], floors: 3 },
	"shop-b": { file: `${COMMERCIAL_PATH}/building-b.glb`, size: [0.97, 1.29, 0.94], floors: 3 },
	"shop-c": { file: `${COMMERCIAL_PATH}/building-c.glb`, size: [0.88, 0.89, 1.09], floors: 2 },
	"shop-d": { file: `${COMMERCIAL_PATH}/building-d.glb`, size: [0.84, 1.29, 0.90], floors: 3 },
	"shop-e": { file: `${COMMERCIAL_PATH}/building-e.glb`, size: [1.64, 0.89, 1.01], floors: 2 },
	"shop-f": { file: `${COMMERCIAL_PATH}/building-f.glb`, size: [0.84, 1.69, 1.03], floors: 4 },
	"shop-g": { file: `${COMMERCIAL_PATH}/building-g.glb`, size: [0.97, 1.69, 0.92], floors: 4 },
	"shop-h": { file: `${COMMERCIAL_PATH}/building-h.glb`, size: [0.88, 1.29, 1.01], floors: 3 },
	"block-i": { file: `${COMMERCIAL_PATH}/building-i.glb`, size: [1.24, 1.68, 1.30], floors: 4 },
	"block-j": { file: `${COMMERCIAL_PATH}/building-j.glb`, size: [2.08, 1.69, 1.34], floors: 4 },
	"block-k": { file: `${COMMERCIAL_PATH}/building-k.glb`, size: [2.08, 1.47, 0.94], floors: 3 },
	"block-l": { file: `${COMMERCIAL_PATH}/building-l.glb`, size: [1.37, 2.27, 1.40], floors: 6 },
	"block-m": { file: `${COMMERCIAL_PATH}/building-m.glb`, size: [1.24, 3.15, 1.24], floors: 8 },
	"block-n": { file: `${COMMERCIAL_PATH}/building-n.glb`, size: [2.32, 2.48, 1.82], floors: 6 },
	"tower-a": { file: `${COMMERCIAL_PATH}/building-skyscraper-a.glb`, size: [1.36, 2.88, 1.36], floors: 9 },
	"tower-b": { file: `${COMMERCIAL_PATH}/building-skyscraper-b.glb`, size: [1.36, 4.48, 1.36], floors: 14 },
	"tower-c": { file: `${COMMERCIAL_PATH}/building-skyscraper-c.glb`, size: [1.28, 4.08, 1.39], floors: 13 },
	"tower-d": { file: `${COMMERCIAL_PATH}/building-skyscraper-d.glb`, size: [1.28, 5.47, 1.39], floors: 17 },
	"tower-e": { file: `${COMMERCIAL_PATH}/building-skyscraper-e.glb`, size: [1.29, 4.08, 1.24], floors: 13 },
	"filler-a": { file: `${COMMERCIAL_PATH}/low-detail-building-a.glb`, size: [0.50, 2.00, 0.50], floors: 6 },
	"filler-b": { file: `${COMMERCIAL_PATH}/low-detail-building-b.glb`, size: [0.50, 2.23, 0.50], floors: 7 },
	"filler-c": { file: `${COMMERCIAL_PATH}/low-detail-building-c.glb`, size: [0.50, 2.25, 0.50], floors: 7 },
	"filler-d": { file: `${COMMERCIAL_PATH}/low-detail-building-d.glb`, size: [0.50, 1.75, 0.50], floors: 5 },
	"filler-e": { file: `${COMMERCIAL_PATH}/low-detail-building-e.glb`, size: [0.50, 1.80, 0.50], floors: 5 },
	"filler-f": { file: `${COMMERCIAL_PATH}/low-detail-building-f.glb`, size: [0.50, 2.00, 0.50], floors: 6 },
	"filler-g": { file: `${COMMERCIAL_PATH}/low-detail-building-g.glb`, size: [0.50, 2.00, 0.50], floors: 6 },
	"filler-h": { file: `${COMMERCIAL_PATH}/low-detail-building-h.glb`, size: [0.50, 2.10, 0.50], floors: 6 },
	"filler-wide-a": { file: `${COMMERCIAL_PATH}/low-detail-building-wide-a.glb`, size: [1.00, 1.10, 0.50], floors: 3 },
	"filler-wide-b": { file: `${COMMERCIAL_PATH}/low-detail-building-wide-b.glb`, size: [1.00, 1.15, 0.50], floors: 3 },
	"house-a": { file: `${SUBURBAN_PATH}/building-type-a.glb`, size: [1.30, 0.83, 1.03], floors: 1, yard: KENNEY_YARD_PROPS },
	"house-e": { file: `${SUBURBAN_PATH}/building-type-e.glb`, size: [1.30, 1.14, 1.03], floors: 2, yard: KENNEY_YARD_PROPS },
	"house-j": { file: `${SUBURBAN_PATH}/building-type-j.glb`, size: [1.37, 1.04, 0.92], floors: 2, yard: KENNEY_YARD_PROPS },
	"house-p": { file: `${SUBURBAN_PATH}/building-type-p.glb`, size: [1.24, 0.92, 0.99], floors: 1, yard: KENNEY_YARD_PROPS },
	"house-t": { file: `${SUBURBAN_PATH}/building-type-t.glb`, size: [1.31, 1.16, 1.41], floors: 2, yard: KENNEY_YARD_PROPS },
};

export const ORION_BUILDING_REGISTRY: readonly BuildingDefinition[] = Object.entries(KENNEY_MODELS).map(([id, spec]) => ({
	id,
	assetPath: spec.file,
	category: id.split("-")[0],
	districtType: id.startsWith("house") ? "suburban" : "urban",
	nativeSize: spec.size,
	floors: spec.floors,
	collisionType: "box",
	interiorReady: false,
	lodAssets: { lod0: spec.file, lod1: null, lod2: null },
	source: "Kenney City Kit (Commercial / Suburban) — kenney.nl",
	license: "CC0 1.0 Universal (public domain)",
	yardProps: spec.yard ?? [],
}));

const definitionsById = new Map(ORION_BUILDING_REGISTRY.map((definition) => [definition.id, definition]));

export function getBuildingDefinition(id: string): BuildingDefinition | undefined {
	return definitionsById.get(id);
}

/**
 * Uniform scale that fits a model's own footprint inside its parcel, leaving a small margin.
 * Height follows proportionally, which is why each district draws from a pool of models whose
 * natural proportions already suit it (towers downtown, low-rise shops in the suburbs).
 */
export function resolveBuildingScale(definition: BuildingDefinition, footprint: readonly [number, number]): number {
	const [width, depth] = footprint;
	const [nativeWidth, , nativeDepth] = definition.nativeSize;
	const fill = 0.92;
	return Math.min((width * fill) / nativeWidth, (depth * fill) / nativeDepth);
}

/** Which models suit which district, cycled per placement so neighbouring parcels differ. */
const DISTRICT_MODEL_POOLS: Readonly<Record<DistrictKind, readonly string[]>> = {
	downtown: ["tower-b", "tower-d", "tower-a", "tower-c", "block-m", "tower-e"],
	financial: ["tower-d", "tower-c", "tower-e", "tower-b", "block-m", "tower-a"],
	"high-density-residential": ["block-l", "block-m", "block-n", "block-i", "filler-b", "filler-c"],
	"low-density-residential": ["shop-a", "shop-b", "shop-h", "shop-d", "block-i", "shop-c"],
	suburban: ["house-a", "house-e", "house-j", "house-p", "house-t"],
	commercial: ["shop-e", "block-j", "shop-f", "block-k", "shop-g", "block-n"],
	industrial: ["block-k", "shop-e", "filler-wide-a", "filler-wide-b"],
	"logistics-port": ["block-k", "filler-wide-b", "shop-e", "filler-wide-a"],
	waterfront: ["shop-c", "shop-e", "shop-a", "block-i"],
	airport: ["filler-wide-a", "filler-wide-b", "block-k", "shop-e"],
	civic: ["block-n", "block-l", "block-i", "shop-g"],
	"mixed-use": ["shop-f", "block-i", "shop-g", "block-l", "shop-b", "filler-d"],
};

/**
 * Turns a building to front the nearest road. Roads run as a cross through the district
 * centre and a ring outside the blocks, so the nearest carriageway is along whichever axis
 * the parcel sits closer to — which is exactly what decides the frontage here.
 */
function resolveFrontageYaw(position: Vector3Tuple, districtCenter: Vector3Tuple): number {
	const localX = position[0] - districtCenter[0];
	const localZ = position[2] - districtCenter[2];
	if (Math.abs(localX) >= Math.abs(localZ)) {
		return localX >= 0 ? 90 : -90;
	}
	return localZ >= 0 ? 0 : 180;
}

function getBuildingForm(zoning: Zoning, districtKind: DistrictKind, parcelIndex: number): { footprint: [number, number]; height: number; floors: number } {
	if (districtKind === "downtown" || districtKind === "financial") {
		return { footprint: [13, 13], height: 28 + (parcelIndex % 4) * 8, floors: 8 + (parcelIndex % 4) * 2 };
	}
	if (districtKind === "industrial" || districtKind === "logistics-port") {
		return { footprint: [15, 12], height: 6 + (parcelIndex % 2) * 2, floors: 1 };
	}
	if (zoning === "commercial") {
		return { footprint: [13, 13], height: 14 + (parcelIndex % 3) * 4, floors: 4 + (parcelIndex % 3) };
	}
	if (districtKind === "airport") {
		return { footprint: [17, 12], height: 8, floors: 2 };
	}
	if (districtKind === "suburban") {
		return { footprint: [11, 10], height: 5 + (parcelIndex % 2) * 2, floors: 1 + (parcelIndex % 2) };
	}
	return { footprint: [12, 12], height: 10 + (parcelIndex % 4) * 3, floors: 3 + (parcelIndex % 3) };
}

/**
 * Every building in the city, less the ones the rail loop runs through: the line was laid
 * between the blocks, and a parcel standing on it is left undeveloped rather than having a train
 * pass through the living room. Ids are handed out before this, so clearing one doesn't renumber
 * the rest.
 */
export const ORION_BUILDING_MAP: readonly BuildingPlacement[] = ORION_PARCELS
	.filter((parcel) => parcel.zoning !== "park" && parcel.zoning !== "undeveloped")
	.map((parcel, index): BuildingPlacement => {
		const district = ORION_DISTRICTS.find((candidate) => candidate.id === parcel.districtId);
		const districtKind = district?.kind ?? "mixed-use";
		const form = getBuildingForm(parcel.zoning, districtKind, index);
		const pool = DISTRICT_MODEL_POOLS[districtKind];
		const buildingDefinitionId = pool[index % pool.length];
		return {
			id: `building-${String(index + 1).padStart(3, "0")}`,
			parcelId: parcel.id,
			buildingDefinitionId,
			position: parcel.position,
			rotation: [0, resolveFrontageYaw(parcel.position, district?.bounds.center ?? [0, 0, 0]), 0] as Vector3Tuple,
			footprint: form.footprint,
			height: form.height,
			floors: form.floors,
			zoning: parcel.zoning,
			districtKind,
			entranceSide: index % 2 === 0 ? "south" : "north",
			status: parcel.developmentState === "building-ready" ? "built" : "planned",
			renderMode: "asset",
		};
	})
	.filter((placement) => !railBlocks(placement.position[0], placement.position[2], placement.footprint[0], placement.footprint[1]));
