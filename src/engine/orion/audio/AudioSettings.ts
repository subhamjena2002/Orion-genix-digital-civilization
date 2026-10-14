import { audioBus } from "./AudioBus";

/**
 * Player-facing sound settings: the master volume, the effects volume and mute.
 *
 * Saved the same way as the graphics settings (GraphicsSettings): a small JSON object in local
 * storage, merged over the defaults, and still applied for the session when storage isn't there
 * (private mode). There is no music in the game yet, so there is no music level; it would go
 * here, beside effects, when there is.
 */
export interface AudioSettings {
	/** Everything, 0..1. */
	master: number;
	/** Gunfire, vehicles, the street and the rest of the world, 0..1. */
	effects: number;
	muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = { master: 1, effects: 1, muted: false };

const STORAGE_KEY = "orion.audio";

function level(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/** The saved settings merged over the defaults; storage may be unavailable or hold anything. */
export function loadAudioSettings(): AudioSettings {
	const settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
	try {
		const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<keyof AudioSettings, unknown>> | null;
		if (saved && typeof saved === "object") {
			settings.master = level(saved.master, settings.master);
			settings.effects = level(saved.effects, settings.effects);
			if (typeof saved.muted === "boolean") settings.muted = saved.muted;
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
		}));
	} catch {
		// Not persisted; still applies for this session.
	}
}

/** Puts the settings into the mix; works before the audio context exists (it picks them up). */
export function applyAudioSettings(settings: AudioSettings): void {
	audioBus().setLevels(settings.master, settings.effects, settings.muted);
}
