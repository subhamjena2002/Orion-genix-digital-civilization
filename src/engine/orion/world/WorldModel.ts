import type { Vector3Tuple } from "../properties/Properties";

export type DistrictKind =
	| "downtown"
	| "financial"
	| "high-density-residential"
	| "low-density-residential"
	| "suburban"
	| "commercial"
	| "industrial"
	| "waterfront"
	| "airport"
	| "civic"
	| "logistics-port"
	| "mixed-use";

export type DistrictContentState = "active" | "planned";
export type Zoning = "residential" | "commercial" | "industrial" | "civic" | "mixed-use" | "park" | "utility" | "transport" | "undeveloped";

export interface WorldBounds {
	center: Vector3Tuple;
	size: [number, number];
}

export interface DistrictDefinition {
	id: string;
	name: string;
	kind: DistrictKind;
	contentState: DistrictContentState;
	bounds: WorldBounds;
	blockIds: readonly string[];
	density: "low" | "medium" | "high";
	streetProfile: string;
}

export interface BlockDefinition {
	id: string;
	districtId: string;
	bounds: WorldBounds;
	parcelIds: readonly string[];
}

export interface ParcelDefinition {
	id: string;
	districtId: string;
	blockId: string;
	position: Vector3Tuple;
	bounds: [number, number];
	zoning: Zoning;
	propertyId: string | null;
	developmentState: "building-ready" | "developed" | "park" | "planned";
}

type DistrictSpec = readonly [string, string, DistrictKind, string, "low" | "medium" | "high", Vector3Tuple];

const districtSpecs: readonly DistrictSpec[] = [
	["low-density-residential", "Low-Density Residential", "low-density-residential", "neighborhood-grid", "medium", [0, 0, 0]],
	["downtown-core", "Downtown Core", "downtown", "arterial-grid", "high", [0, 0, 160]],
	["financial-district", "Financial District", "financial", "arterial-grid", "high", [160, 0, 160]],
	["high-density-residential", "High-Density Residential", "high-density-residential", "transit-grid", "high", [160, 0, 0]],
	["suburban-district", "Suburban District", "suburban", "local-streets", "low", [-160, 0, 0]],
	["commercial-district", "Commercial District", "commercial", "retail-grid", "medium", [-160, 0, 160]],
	["industrial-district", "Industrial District", "industrial", "freight-grid", "low", [-320, 0, 160]],
	["waterfront", "Waterfront", "waterfront", "promenade", "medium", [320, 0, 160]],
	["airport-district", "Airport District", "airport", "access-grid", "low", [-320, 0, 0]],
	["civic-district", "Civic District", "civic", "civic-grid", "medium", [320, 0, 0]],
	["logistics-port", "Logistics / Port", "logistics-port", "freight-grid", "low", [-320, 0, -160]],
	["mixed-use-district", "Mixed-Use District", "mixed-use", "neighborhood-grid", "medium", [320, 0, -160]],
];

export const ORION_DISTRICTS: readonly DistrictDefinition[] = districtSpecs.map(([id, name, kind, streetProfile, density, center], index) => ({
	id,
	name,
	kind,
	contentState: index === 0 ? "active" : "planned",
	bounds: { center, size: [140, 140] },
	blockIds: Array.from({ length: 4 }, (_, blockIndex) => `${id}-block-${String(blockIndex + 1).padStart(3, "0")}`),
	density,
	streetProfile,
}));

const blockOffsets: readonly [number, number][] = [[-35, -35], [35, -35], [-35, 35], [35, 35]];

export const ORION_BLOCKS: readonly BlockDefinition[] = ORION_DISTRICTS.flatMap((district) => district.blockIds.map((id, index) => {
	const [offsetX, offsetZ] = blockOffsets[index];
	return {
		id,
		districtId: district.id,
		bounds: { center: [district.bounds.center[0] + offsetX, 0, district.bounds.center[2] + offsetZ], size: [60, 60] },
		parcelIds: Array.from({ length: 9 }, (_, parcelIndex) => `${id}-parcel-${String(parcelIndex + 1).padStart(2, "0")}`),
	};
}));

function getParcelZoning(kind: DistrictKind): Zoning {
	if (kind === "industrial" || kind === "logistics-port") return "industrial";
	if (kind === "downtown" || kind === "financial" || kind === "commercial") return "commercial";
	if (kind === "civic") return "civic";
	if (kind === "waterfront") return "park";
	return "residential";
}

export const ORION_PARCELS: readonly ParcelDefinition[] = ORION_DISTRICTS.flatMap((district) => {
	const zoning = getParcelZoning(district.kind);
	return district.blockIds.flatMap((blockId, blockIndex): readonly ParcelDefinition[] => {
		const block = ORION_BLOCKS.find((candidate) => candidate.id === blockId);
		if (!block) return [];
		if (district.id === "low-density-residential" && blockIndex === 0) {
			return [[-19, -19], [19, -19], [-19, 19], [19, 19]].map(([x, z], index) => ({
				id: `parcel-${String(index + 1).padStart(3, "0")}`,
				districtId: district.id,
				blockId,
				position: [x, 0, z] as Vector3Tuple,
				bounds: [13, 12] as [number, number],
				zoning: "residential" as Zoning,
				propertyId: `property-${String(index + 1).padStart(3, "0")}`,
				developmentState: index === 0 ? "building-ready" as const : "planned" as const,
			}));
		}
		return block.parcelIds.map((id, parcelIndex) => {
			const localX = (parcelIndex % 3 - 1) * 18;
			const localZ = (Math.floor(parcelIndex / 3) - 1) * 18;
			return {
				id,
				districtId: district.id,
				blockId,
				position: [block.bounds.center[0] + localX, 0, block.bounds.center[2] + localZ] as Vector3Tuple,
				bounds: [14, 14] as [number, number],
				zoning,
				propertyId: null,
				developmentState: zoning === "park" ? "park" as const : "planned" as const,
			};
		});
	});
});

export const ORION_CITY = {
	id: "orion-city-001",
	name: "Orion City",
	regionId: "north-region",
	districtIds: ORION_DISTRICTS.map((district) => district.id),
	districts: ORION_DISTRICTS,
	blocks: ORION_BLOCKS,
	parcels: ORION_PARCELS,
} as const;