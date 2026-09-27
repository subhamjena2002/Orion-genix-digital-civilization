import { FOG_EXP2, type Scene } from "playcanvas";

export type TimeOfDay = "day" | "night";

export interface EnvironmentProfile {
	id: TimeOfDay;
	clearColor: string;
	exposure: number;
	fogColor: string;
	fogDensity: number;
	sunIntensity: number;
	fillIntensity: number;
	streetLightIntensity: number;
	skyboxIntensity: number;
}

export const ORION_ENVIRONMENT_PROFILES: Readonly<Record<TimeOfDay, EnvironmentProfile>> = {
	day: {
		id: "day",
		clearColor: "#9aa8a6",
		exposure: 0.82,
		// The sky's horizon, so the haze melts distant blocks into the sky rather than a grey wall.
		// At this density: ~10% at 120 m, ~20% at the 170 m building draw distance, ~50% at 300 m.
		fogColor: "#a9b6b8",
		fogDensity: 0.0028,
		sunIntensity: 1.05,
		fillIntensity: 0.22,
		streetLightIntensity: 0,
		skyboxIntensity: 0.55,
	},
	night: {
		id: "night",
		clearColor: "#101a24",
		exposure: 0.65,
		fogColor: "#182431",
		fogDensity: 0.004,
		sunIntensity: 0.25,
		fillIntensity: 0.18,
		streetLightIntensity: 2,
		skyboxIntensity: 0.2,
	},
};

export const ORION_ACTIVE_TIME_OF_DAY: TimeOfDay = "day";

/**
 * Atmospheric haze from a profile. The profiles always carried fog values, but they were never
 * applied, so the far end of a street was as crisp and dark as the near end and the city read as
 * flat. Set it once, before the world is shown: changing fog later recompiles every shader.
 */
export function applyEnvironmentFog(scene: Scene, profile: EnvironmentProfile): void {
	scene.fog.type = FOG_EXP2;
	scene.fog.density = profile.fogDensity;
	scene.fog.color.fromString(profile.fogColor);
}
