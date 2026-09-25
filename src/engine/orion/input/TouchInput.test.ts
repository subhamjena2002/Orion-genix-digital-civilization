import { beforeEach, describe, expect, it } from "vitest";

import {
	cycleTouchWeapon,
	pressTouch,
	readTouchHeld,
	releaseAllTouch,
	selectTouchSlot,
	setTouchButton,
	setTouchStick,
	takeTouchEdges,
} from "./TouchInput";

describe("TouchInput", () => {
	beforeEach(() => {
		releaseAllTouch();
		takeTouchEdges();
	});

	it("latches a tap until the controller takes it, then clears it", () => {
		pressTouch("interact");
		selectTouchSlot(3);
		cycleTouchWeapon(1);
		cycleTouchWeapon(1);
		const first = takeTouchEdges();
		expect(first.interact).toBe(true);
		expect(first.slot).toBe(3);
		expect(first.cycle).toBe(2);
		const second = takeTouchEdges();
		expect(second.interact).toBe(false);
		expect(second.slot).toBeNull();
		expect(second.cycle).toBe(0);
	});

	it("reports a fire press once, however long it's held", () => {
		setTouchButton("fire", true);
		setTouchButton("fire", true);
		expect(takeTouchEdges().fire).toBe(true);
		expect(readTouchHeld().fire).toBe(true);
		expect(takeTouchEdges().fire).toBe(false);
		setTouchButton("fire", false);
		setTouchButton("fire", true);
		expect(takeTouchEdges().fire).toBe(true);
	});

	it("lets go of every held control at once", () => {
		setTouchStick(0.4, -1);
		setTouchButton("gas", true);
		setTouchButton("handbrake", true);
		releaseAllTouch();
		expect(readTouchHeld()).toMatchObject({ moveX: 0, moveY: 0, gas: false, handbrake: false, fire: false });
	});
});
