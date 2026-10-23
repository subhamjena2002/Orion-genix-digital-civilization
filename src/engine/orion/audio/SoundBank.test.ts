import { describe, expect, it } from "vitest";

import { preloadOrder } from "./SoundBank";
import { SOUND_FILES } from "./SoundManifest";

describe("sound preload order", () => {
	it("fetches the sounds heard at once first, and every sound exactly once", () => {
		const sounds = Object.keys(SOUND_FILES);
		const order = preloadOrder(sounds);
		expect([...order].sort()).toEqual([...sounds].sort());
		const firstOther = order.findIndex((sound) => !/^(engine-|amb-|foot|punch|whoosh|door)/.test(sound));
		expect(order.slice(0, firstOther)).toEqual(expect.arrayContaining(["amb-street", "engine-car-1"]));
		expect(order.slice(firstOther).some((sound) => sound.startsWith("engine-"))).toBe(false);
	});
});
