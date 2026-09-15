import type { RegisteredAsset } from "../assets/AssetRegistry";

export interface CharacterDefinition extends RegisteredAsset {
	archetype: string;
	animations: { idle: string | null; walk: string | null; run: string | null };
	collision: "capsule";
}

const plannedCharacter = (id: string, archetype: string): CharacterDefinition => ({
	id,
	category: "pedestrian",
	archetype,
	assetPath: null,
	source: "unassigned local asset",
	license: "unverified",
	originalFilename: null,
	availability: "unavailable",
	animations: { idle: null, walk: null, run: null },
	collision: "capsule",
});

export const ORION_CHARACTERS: readonly CharacterDefinition[] = [
	plannedCharacter("character-adult-male", "adult male"),
	plannedCharacter("character-adult-female", "adult female"),
	plannedCharacter("character-elderly-male", "elderly male"),
	plannedCharacter("character-elderly-female", "elderly female"),
	plannedCharacter("character-business-person", "business person"),
	plannedCharacter("character-construction-worker", "construction worker"),
	plannedCharacter("character-delivery-worker", "delivery worker"),
	plannedCharacter("character-police-officer", "police officer"),
	plannedCharacter("character-firefighter", "firefighter"),
	plannedCharacter("character-paramedic", "paramedic"),
	plannedCharacter("character-student", "student"),
	plannedCharacter("character-tourist", "tourist"),
	plannedCharacter("character-cyclist", "cyclist"),
	plannedCharacter("character-service-worker", "service worker"),
];

export interface PedestrianSpawnPoint {
	id: string;
	districtId: string;
	position: [number, number, number];
	type: "sidewalk" | "plaza" | "transit";
	density: "low" | "medium" | "high";
	allowedHours: [number, number];
}

export const ORION_PEDESTRIAN_SPAWN_POINTS: readonly PedestrianSpawnPoint[] = [
	{ id: "ped-spawn-north-district-sidewalk", districtId: "low-density-residential", position: [0, 0, 5.2], type: "sidewalk", density: "low", allowedHours: [6, 23] },
];