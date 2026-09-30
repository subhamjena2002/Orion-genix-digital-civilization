import { Color, FOG_EXP2, type Scene } from "playcanvas";

export type TimeOfDay = "day" | "night";

export interface EnvironmentProfile {
	id: TimeOfDay;
	clearColor: string;
	exposure: number;
	fogColor: string;
	fogDensity: number;
	/**
	 * Haze seen from high up (flying): thinner, and the blue-grey of distant sea rather than the
	 * sky's horizon, so from the air the sea reads as sea and meets the sky at a visible horizon.
	 */
	highFogColor: string;
	highFogDensity: number;
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
		highFogColor: "#7f98a6",
		highFogDensity: 0.0013,
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
		highFogColor: "#111c27",
		highFogDensity: 0.0019,
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

/** Camera heights (m) over which the haze goes from its street-level to its high-altitude form. */
const HAZE_LOW = 30;
const HAZE_HIGH = 260;
/** Each profile's two haze colours, parsed once. */
const parsed = new WeakMap<EnvironmentProfile, { low: Color; high: Color }>();

/**
 * Haze for where the camera is, once a frame. At street level it's the profile's own (it hides
 * the building draw distance); climbing, it thins and turns sea-blue. Only the density and colour
 * change — both are shader constants, so nothing recompiles (the fog type is fixed at startup).
 */
export function updateAtmosphere(scene: Scene, profile: EnvironmentProfile, cameraHeight: number): void {
	const t = Math.min(1, Math.max(0, (cameraHeight - HAZE_LOW) / (HAZE_HIGH - HAZE_LOW)));
	const blend = t * t * (3 - 2 * t);
	scene.fog.density = profile.fogDensity + (profile.highFogDensity - profile.fogDensity) * blend;
	let colours = parsed.get(profile);
	if (!colours) {
		colours = { low: new Color().fromString(profile.fogColor), high: new Color().fromString(profile.highFogColor) };
		parsed.set(profile, colours);
	}
	scene.fog.color.lerp(colours.low, colours.high, blend);
}
