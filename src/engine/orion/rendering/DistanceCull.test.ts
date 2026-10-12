import { describe, expect, it } from "vitest";

import { distanceToBox, registerDistanceCull, updateDistanceCull, wantShown } from "./DistanceCull";
import { writeCameraView } from "../player/PlayerPose";

describe("distance culling", () => {
	it("measures to the nearest edge of the box, not its centre", () => {
		const runway = { x: 0, z: 0, halfX: 10, halfZ: 300 };
		expect(distanceToBox(runway, 5, 100)).toBe(0);
		expect(distanceToBox(runway, 40, 0)).toBe(30);
		expect(distanceToBox(runway, 40, 340)).toBeCloseTo(50);
	});

	it("hides past the limit and shows again only well inside it", () => {
		expect(wantShown(true, 299, 300)).toBe(true);
		expect(wantShown(true, 301, 300)).toBe(false);
		// Just back inside the limit isn't enough to come back: no flicker at the edge.
		expect(wantShown(false, 290, 300)).toBe(false);
		expect(wantShown(false, 270, 300)).toBe(true);
	});

	it("applies the change when the camera moves, and shows it again when unregistered", () => {
		let shown = true;
		const stop = registerDistanceCull({ x: 0, z: 0, halfX: 5, halfZ: 5, maxDistance: 100, isShown: () => shown, apply: (value) => { shown = value; } });
		const tick = () => { for (let i = 0; i < 8; i++) updateDistanceCull(); };
		writeCameraView(500, 0, 0, 1);
		tick();
		expect(shown).toBe(false);
		writeCameraView(50, 0, 0, 1);
		tick();
		expect(shown).toBe(true);
		writeCameraView(500, 0, 0, 1);
		tick();
		expect(shown).toBe(false);
		stop();
		expect(shown).toBe(true);
	});
});
