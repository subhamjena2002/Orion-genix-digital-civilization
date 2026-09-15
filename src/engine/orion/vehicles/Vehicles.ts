import type { LodAssetSet, RegisteredAsset } from "../assets/AssetRegistry";
import type { Vector3Tuple } from "../properties/Properties";

export type VehicleCategory = "compact" | "sedan" | "luxury" | "sports" | "utility" | "service" | "truck" | "transit" | "motorcycle";

export interface VehicleDefinition extends RegisteredAsset {
	category: VehicleCategory;
	dimensions: Vector3Tuple;
	wheelbase: number;
	mass: number;
	collision: "box" | "compound" | "mesh";
	lodAssets: LodAssetSet;
	seats: number;
}

const plannedVehicle = (id: string, category: VehicleCategory, dimensions: Vector3Tuple, seats: number): VehicleDefinition => ({
	id,
	category,
	assetPath: null,
	source: "unassigned local asset",
	license: "unverified",
	originalFilename: null,
	availability: "unavailable",
	dimensions,
	wheelbase: dimensions[2] * 0.58,
	mass: 1400,
	collision: "compound",
	lodAssets: { lod0: null, lod1: null, lod2: null },
	seats,
});

export const ORION_VEHICLES: readonly VehicleDefinition[] = [
	plannedVehicle("vehicle-compact-hatchback", "compact", [1.8, 1.5, 4.1], 5),
	plannedVehicle("vehicle-sedan", "sedan", [1.9, 1.5, 4.8], 5),
	plannedVehicle("vehicle-luxury-sedan", "luxury", [2, 1.5, 5.2], 5),
	plannedVehicle("vehicle-sports-coupe", "sports", [1.95, 1.25, 4.5], 2),
	plannedVehicle("vehicle-supercar", "sports", [2, 1.15, 4.7], 2),
	plannedVehicle("vehicle-suv", "utility", [2.05, 1.8, 4.8], 5),
	plannedVehicle("vehicle-pickup", "utility", [2.1, 1.9, 5.4], 5),
	plannedVehicle("vehicle-van", "utility", [2.1, 2.4, 5.5], 8),
	plannedVehicle("vehicle-minivan", "utility", [2, 1.9, 4.9], 7),
	plannedVehicle("vehicle-taxi", "service", [1.9, 1.5, 4.8], 5),
	plannedVehicle("vehicle-police", "service", [2, 1.6, 5], 5),
	plannedVehicle("vehicle-ambulance", "service", [2.2, 2.6, 6.2], 4),
	plannedVehicle("vehicle-fire-engine", "service", [2.5, 3.2, 8.2], 6),
	plannedVehicle("vehicle-garbage-truck", "truck", [2.5, 3.3, 8], 3),
	plannedVehicle("vehicle-delivery-truck", "truck", [2.4, 3, 7], 3),
	plannedVehicle("vehicle-box-truck", "truck", [2.5, 3.4, 8.5], 3),
	plannedVehicle("vehicle-semi-truck", "truck", [2.6, 4, 16], 2),
	plannedVehicle("vehicle-bus", "transit", [2.6, 3.2, 12], 40),
	plannedVehicle("vehicle-motorcycle", "motorcycle", [0.9, 1.4, 2.2], 2),
	plannedVehicle("vehicle-scooter", "motorcycle", [0.7, 1.2, 1.8], 2),
	plannedVehicle("vehicle-construction-truck", "truck", [2.6, 3.4, 8], 3),
	plannedVehicle("vehicle-utility-truck", "truck", [2.4, 3, 7], 3),
	plannedVehicle("vehicle-tanker", "truck", [2.6, 3.6, 11], 3),
	plannedVehicle("vehicle-tow-truck", "service", [2.4, 3, 7], 3),
];