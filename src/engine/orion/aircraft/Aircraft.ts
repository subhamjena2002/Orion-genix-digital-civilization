import type { RegisteredAsset } from "../assets/AssetRegistry";
import type { Vector3Tuple } from "../properties/Properties";

export interface AircraftDefinition extends RegisteredAsset {
	category: "helicopter";
	dimensions: Vector3Tuple;
	rotorReferences: readonly string[];
	doors: number;
	seats: number;
}

const plannedHelicopter = (id: string, archetype: string, dimensions: Vector3Tuple): AircraftDefinition => ({
	id,
	category: "helicopter",
	assetPath: null,
	source: "unassigned local asset",
	license: "unverified",
	originalFilename: null,
	availability: "unavailable",
	dimensions,
	rotorReferences: ["main-rotor", "tail-rotor"],
	doors: 2,
	seats: archetype === "emergency" ? 4 : 6,
});

export const ORION_AIRCRAFT: readonly AircraftDefinition[] = [
	plannedHelicopter("aircraft-civilian-helicopter", "civilian", [2, 2.5, 10]),
	plannedHelicopter("aircraft-utility-helicopter", "utility", [2.5, 3, 12]),
	plannedHelicopter("aircraft-emergency-helicopter", "emergency", [2.4, 3, 11]),
];