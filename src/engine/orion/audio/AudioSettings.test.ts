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
		saveAudioSettings({ master: 0.4, effects: 0.75, muted: true });
		expect(loadAudioSettings()).toEqual({ master: 0.4, effects: 0.75, muted: true });
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
		stubStorage({ "orion.audio": JSON.stringify({ master: 7, effects: "loud", muted: "yes" }) });
		expect(loadAudioSettings()).toEqual({ master: 1, effects: 1, muted: false });
	});
});
