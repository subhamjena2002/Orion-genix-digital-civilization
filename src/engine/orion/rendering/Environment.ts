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
}

export const ORION_ENVIRONMENT_PROFILES: Readonly<Record<TimeOfDay, EnvironmentProfile>> = {
	day: {
		id: "day",
		clearColor: "#9aa8a6",
		exposure: 1,
		fogColor: "#9aa8a6",
		fogDensity: 0.002,
		sunIntensity: 2.1,
		fillIntensity: 0.35,
		streetLightIntensity: 0,
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
	},
};

export const ORION_ACTIVE_TIME_OF_DAY: TimeOfDay = "day";