import { audioBus, VEHICLE_PARTS, type VehiclePart } from "./AudioBus";

/**
 * Player-facing sound settings: the master volume, the effects volume, mute, and the vehicle mix.
 *
 * Saved the same way as the graphics settings (GraphicsSettings): a small JSON object in local
 * storage, merged over the defaults, and still applied for the session when storage isn't there
 * (private mode). There is no music in the game yet, so there is no music level; it would go
 * here, beside effects, when there is.
 *
 * The vehicle levels sit under effects: engines, tyres (rolling, squeal, brakes), the gearbox,
 * sirens and collisions each have their own level, so a player who finds sirens grating can turn them
 * down without losing the engines.
 */
export interface AudioSettings {
	/** Everything, 0..1. */
	master: number;
	/** Gunfire, vehicles, the street and the rest of the world, 0..1. */
	effects: number;
	muted: boolean;
	/** Each part of the vehicle mix, 0..1 (see AudioBus.VEHICLE_PARTS). */
	vehicles: Record<VehiclePart, number>;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
	master: 1,
	effects: 1,
	muted: false,
	vehicles: { engines: 1, tyres: 1, transmission: 1, sirens: 1, collisions: 1 },
};

const STORAGE_KEY = "orion.audio";

function level(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function vehicleLevels(saved: unknown): Record<VehiclePart, number> {
	const levels = { ...DEFAULT_AUDIO_SETTINGS.vehicles };
	if (!saved || typeof saved !== "object") return levels;
	for (const part of VEHICLE_PARTS) levels[part] = level((saved as Record<string, unknown>)[part], levels[part]);
	return levels;
}

/** The saved settings merged over the defaults; storage may be unavailable or hold anything. */
export function loadAudioSettings(): AudioSettings {
	const settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS, vehicles: { ...DEFAULT_AUDIO_SETTINGS.vehicles } };
	try {
		const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<keyof AudioSettings, unknown>> | null;
		if (saved && typeof saved === "object") {
			settings.master = level(saved.master, settings.master);
			settings.effects = level(saved.effects, settings.effects);
			if (typeof saved.muted === "boolean") settings.muted = saved.muted;
			settings.vehicles = vehicleLevels(saved.vehicles);
		}
	} catch {
		// Defaults it is.
	}
	return settings;
}

export function saveAudioSettings(settings: AudioSettings): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
			master: level(settings.master, 1),
			effects: level(settings.effects, 1),
			muted: settings.muted,
			vehicles: vehicleLevels(settings.vehicles),
		}));
	} catch {
		// Not persisted; still applies for this session.
	}
}

/** Puts the settings into the mix; works before the audio context exists (it picks them up). */
export function applyAudioSettings(settings: AudioSettings): void {
	const bus = audioBus();
	bus.setLevels(settings.master, settings.effects, settings.muted);
	bus.setVehicleLevels(settings.vehicles);
}
