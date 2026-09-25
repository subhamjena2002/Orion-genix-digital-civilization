import { beforeEach, describe, expect, it } from "vitest";

import { distanceFromCamera, inCameraView, needsPosing, writeCameraView, writePlayerPose } from "./PlayerPose";

describe("camera view", () => {
	beforeEach(() => {
		writePlayerPose(0, 0, 0, 0, 0, 0);
		// Camera at the origin looking down +Z.
		writeCameraView(0, 0, 0, 1);
	});

	it("sees what's ahead and within range", () => {
		expect(inCameraView(0, 50, 100)).toBe(true);
		expect(inCameraView(30, 50, 100)).toBe(true);
	});

	it("doesn't see what's behind or beyond range", () => {
		expect(inCameraView(0, -50, 100)).toBe(false);
		expect(inCameraView(0, 150, 100)).toBe(false);
	});

	it("counts anything right beside the camera as visible", () => {
		expect(inCameraView(0, -5, 100)).toBe(true);
	});

	it("measures distance from the camera", () => {
		expect(distanceFromCamera(3, 4)).toBeCloseTo(5);
	});

	it("ignores a zero-length view direction", () => {
		writeCameraView(10, 10, 0, 0);
		expect(distanceFromCamera(0, 0)).toBeCloseTo(0);
	});
});

describe("needsPosing", () => {
	beforeEach(() => {
		writePlayerPose(0, 0, 0, 0, 0, 0);
		writeCameraView(0, 0, 0, 1);
	});

	it("always poses what the camera can see", () => {
		for (let frame = 0; frame < 8; frame++) expect(needsPosing(0, 300, frame, 5)).toBe(true);
	});

	it("always poses what's close to the player, seen or not", () => {
		for (let frame = 0; frame < 8; frame++) expect(needsPosing(0, -40, frame, 5)).toBe(true);
	});

	it("poses unseen, distant things every few frames, staggered by slot", () => {
		const posedFrames = (slot: number) => Array.from({ length: 8 }, (_, frame) => frame).filter((frame) => needsPosing(0, -300, frame, slot));
		expect(posedFrames(0)).toEqual([0, 4]);
		expect(posedFrames(1)).toEqual([3, 7]);
		// Different slots catch up on different frames, spreading the work.
		expect(posedFrames(0)).not.toEqual(posedFrames(1));
	});
});
