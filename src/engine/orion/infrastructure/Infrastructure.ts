import type { RegisteredAsset } from "../assets/AssetRegistry";
import type { Vector3Tuple } from "../properties/Properties";

export interface BridgeDefinition extends RegisteredAsset {
	category: "road-bridge" | "pedestrian-bridge" | "overpass" | "underpass" | "elevated-road";
	length: number;
	width: number;
	height: number;
	supports: number;
	collision: "box" | "compound" | "mesh";
	roadConnections: readonly string[];
}

export interface BridgePlacement {
	id: string;
	bridgeId: string;
	position: Vector3Tuple;
	rotation: Vector3Tuple;
}

const plannedBridge = (id: string, category: BridgeDefinition["category"]): BridgeDefinition => ({
	id,
	category,
	assetPath: null,
	source: "unassigned local asset",
	license: "unverified",
	originalFilename: null,
	availability: "unavailable",
	length: 80,
	width: category === "pedestrian-bridge" ? 4 : 12,
	height: 7,
	supports: 4,
	collision: "compound",
	roadConnections: [],
});

export const ORION_BRIDGES: readonly BridgeDefinition[] = [
	plannedBridge("bridge-river-arterial-001", "road-bridge"),
	plannedBridge("bridge-waterfront-pedestrian-001", "pedestrian-bridge"),
	plannedBridge("bridge-downtown-overpass-001", "overpass"),
	plannedBridge("bridge-airport-elevated-001", "elevated-road"),
];