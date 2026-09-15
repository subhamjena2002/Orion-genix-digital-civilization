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
	assetPath: null,
	animations: {
		idle: null,
		walk: null,
		run: null,
	},
	scale: [1, 1, 1],
	offset: [0, 0, 0],
};