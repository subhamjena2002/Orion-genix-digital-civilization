import type { Vector3Tuple } from "../properties/Properties";
import type { LodAssetSet } from "../assets/AssetRegistry";
import { ORION_DISTRICTS, ORION_PARCELS, type DistrictKind, type Zoning } from "../world/WorldModel";

export interface BuildingDefinition {
	id: string;
	assetPath: string;
	category: string;
	districtType: string;
	footprint: [number, number];
	height: number;
	floors: number;
	entrancePoints: readonly string[];
	scale: Vector3Tuple;
	rotation: Vector3Tuple;
	collisionType: "box" | "compound" | "mesh";
	collisionDimensions: Vector3Tuple | null;
	interiorReady: boolean;
	lodAssets: LodAssetSet;
	materialVariants: readonly string[];
	source: string;
	license: string;
	complete: boolean;
	suitableForHero: boolean;
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
}

export const ORION_BUILDING_REGISTRY: readonly BuildingDefinition[] = [
	{
		id: "modular-apartment-facade-kit",
		assetPath: "/models/buildings/modern/modular_urban_apartments_facade/orion-apartment.glb",
		category: "modular facade component kit",
		districtType: "residential",
		footprint: [24, 12],
		height: 13,
		floors: 4,
		entrancePoints: [],
		scale: [1, 1, 1],
		rotation: [0, 0, 0],
		collisionType: "box",
		collisionDimensions: [24, 13, 12],
		interiorReady: false,
		lodAssets: { lod0: "/models/buildings/modern/modular_urban_apartments_facade/orion-apartment.glb", lod1: null, lod2: null },
		materialVariants: [],
		source: "local repository; provenance requires verification",
		license: "unverified",
		complete: false,
		suitableForHero: false,
	},
];

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

export const ORION_BUILDING_MAP: readonly BuildingPlacement[] = ORION_PARCELS
	.filter((parcel) => parcel.zoning !== "park" && parcel.zoning !== "undeveloped")
	.map((parcel, index) => {
		const district = ORION_DISTRICTS.find((candidate) => candidate.id === parcel.districtId);
		const form = getBuildingForm(parcel.zoning, district?.kind ?? "mixed-use", index);
		return {
			id: `building-${String(index + 1).padStart(3, "0")}`,
			parcelId: parcel.id,
			buildingDefinitionId: "modular-apartment-facade-kit",
			position: parcel.position,
			rotation: [0, 0, 0],
			footprint: form.footprint,
			height: form.height,
			floors: form.floors,
			zoning: parcel.zoning,
			districtKind: district?.kind ?? "mixed-use",
			entranceSide: index % 2 === 0 ? "south" : "north",
			status: parcel.developmentState === "building-ready" ? "built" : "planned",
		};
	});