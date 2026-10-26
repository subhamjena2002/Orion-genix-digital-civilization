import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { preloadOrder } from "./SoundBank";
import { SOUND_FILES } from "./SoundManifest";
import { ENGINE_FAMILIES, VEHICLE_SOUND_FILES } from "./VehicleSoundManifest";

describe("sound preload order", () => {
	it("fetches the sounds heard at once first, and every sound exactly once", () => {
		const sounds = [...Object.keys(SOUND_FILES), ...Object.keys(VEHICLE_SOUND_FILES)];
		const order = preloadOrder(sounds);
		expect([...order].sort()).toEqual([...sounds].sort());
		const first = /^(engine-|idle-|tyre-roll|amb-|foot|punch|whoosh|door)/;
		const firstOther = order.findIndex((sound) => !first.test(sound));
		expect(order.slice(0, firstOther)).toEqual(expect.arrayContaining(["amb-street", "engine-car-1", "idle-car", "tyre-roll"]));
		expect(order.slice(firstOther).some((sound) => sound.startsWith("engine-") || sound.startsWith("idle-"))).toBe(false);
	});
});

describe("the vehicle sound manifest", () => {
	it("lists only files that exist, and no sound twice", () => {
		for (const [sound, files] of Object.entries(VEHICLE_SOUND_FILES)) {
			expect(SOUND_FILES[sound], `${sound} is in both manifests`).toBeUndefined();
			for (const file of files) expect(existsSync(join(process.cwd(), "public", "audio", file)), file).toBe(true);
		}
	});

	it("gives every engine family an idle and something to rev on, all of it recorded", () => {
		for (const [family, map] of Object.entries(ENGINE_FAMILIES)) {
			expect(map.idle, family).not.toBeNull();
			expect(map.ramps.length + map.layers.length, family).toBeGreaterThan(0);
			const sounds = [map.idle?.sound, map.start?.sound, map.stop?.sound, ...map.ramps.map((ramp) => ramp.sound), ...map.layers.map((layer) => layer.sound)];
			for (const sound of sounds) if (sound) expect(VEHICLE_SOUND_FILES[sound], `${family}: ${sound}`).toBeDefined();
			// Ramps must be sorted by pitch, and layers lowest first, or the lookup on the audio thread fails.
			for (const ramp of map.ramps) for (let i = 1; i < ramp.pitch.length; i++) expect(ramp.pitch[i]).toBeGreaterThanOrEqual(ramp.pitch[i - 1]);
			for (let i = 1; i < map.layers.length; i++) expect(map.layers[i].hz).toBeGreaterThan(map.layers[i - 1].hz);
		}
	});
});
