import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AUDIO_SETTINGS, loadAudioSettings, saveAudioSettings } from "./AudioSettings";

function stubStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	vi.stubGlobal("window", {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
		},
	});
	return store;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("audio settings", () => {
	it("round-trips through storage", () => {
		stubStorage();
		const vehicles = { engines: 0.8, tyres: 0.5, transmission: 0, sirens: 0.3, collisions: 1 };
		saveAudioSettings({ master: 0.4, effects: 0.75, muted: true, vehicles });
		expect(loadAudioSettings()).toEqual({ master: 0.4, effects: 0.75, muted: true, vehicles });
	});

	it("keeps settings saved before the vehicle mix existed, with the vehicle levels at full", () => {
		stubStorage({ "orion.audio": JSON.stringify({ master: 0.5, effects: 0.6, muted: false }) });
		expect(loadAudioSettings()).toEqual({ master: 0.5, effects: 0.6, muted: false, vehicles: DEFAULT_AUDIO_SETTINGS.vehicles });
	});

	it("falls back to the defaults for missing or corrupt storage", () => {
		stubStorage({ "orion.audio": "{not json" });
		expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
		stubStorage({ "orion.audio": "null" });
		expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
		vi.unstubAllGlobals();
		expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
	});

	it("clamps levels and ignores fields of the wrong type", () => {
		stubStorage({ "orion.audio": JSON.stringify({ master: 7, effects: "loud", muted: "yes", vehicles: { sirens: -2, tyres: "x" } }) });
		expect(loadAudioSettings()).toEqual({ master: 1, effects: 1, muted: false, vehicles: { ...DEFAULT_AUDIO_SETTINGS.vehicles, sirens: 0 } });
	});
});
