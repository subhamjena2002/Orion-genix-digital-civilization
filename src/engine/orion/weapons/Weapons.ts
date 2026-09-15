import type { RegisteredAsset } from "../assets/AssetRegistry";

export type WeaponCategory = "handgun" | "shotgun" | "carbine" | "smg" | "long-range-rifle" | "launcher";

export interface WeaponDefinition extends RegisteredAsset {
	category: WeaponCategory;
	gripPoint: string;
	muzzlePoint: string;
	magazinePoint: string;
	attachmentPoints: readonly string[];
	animationReferences: readonly string[];
}

const plannedWeapon = (id: string, category: WeaponCategory): WeaponDefinition => ({
	id,
	category,
	assetPath: null,
	source: "unassigned local asset",
	license: "unverified",
	originalFilename: null,
	availability: "unavailable",
	gripPoint: "grip",
	muzzlePoint: "muzzle",
	magazinePoint: "magazine",
	attachmentPoints: ["optic", "underbarrel", "muzzle"],
	animationReferences: [],
});

export const ORION_WEAPONS: readonly WeaponDefinition[] = [
	plannedWeapon("weapon-handgun-standard", "handgun"),
	plannedWeapon("weapon-shotgun-standard", "shotgun"),
	plannedWeapon("weapon-carbine-standard", "carbine"),
	plannedWeapon("weapon-smg-standard", "smg"),
	plannedWeapon("weapon-long-range-rifle-standard", "long-range-rifle"),
	plannedWeapon("weapon-launcher-standard", "launcher"),
];