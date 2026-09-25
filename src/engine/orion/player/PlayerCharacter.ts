export type PlayerMovementState = "idle" | "walk" | "run" | "fall";

export interface CharacterAnimations {
	idle: string | null;
	walk: string | null;
	run: string | null;
}

export interface PlayerCharacterDefinition {
	assetPath: string | null;
	animations: CharacterAnimations;
	scale: [number, number, number];
	offset: [number, number, number];
}

export const ORION_PLAYER_CHARACTER: PlayerCharacterDefinition = {
	assetPath: "/models/characters/orion-citizen/orion-citizen.glb",
	animations: {
		idle: "HumanArmature|Man_Idle",
		walk: "HumanArmature|Man_Walk",
		run: "HumanArmature|Man_Run",
	},
	scale: [1, 1, 1],
	offset: [0, -0.65, 0],
};