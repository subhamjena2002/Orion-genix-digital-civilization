import { afterEach, describe, expect, it } from "vitest";

import { RAIL_CROSSINGS, RAIL_LENGTH, railPoseAt, railWrap } from "./RailLine";
import {
	BARRIER_LEAD,
	BARRIER_TRAIL,
	crossingClosed,
	RAIL_STOP_SETBACK,
	railStopAhead,
	setTrainFront,
	TRAIN_LENGTH,
	TRAIN_SPEED,
} from "./RailTraffic";

const crossing = RAIL_CROSSINGS[4];
/** A saloon: the gap is measured from the nose, so the car's own length matters. */
const HALF_LENGTH = 2.3;
/** A car on that crossing's road, approaching from 60 m back. */
function approach(distanceBack: number) {
	const heading = (crossing.heading * Math.PI) / 180;
	// The road runs across the track, so the direction of travel is square to the rail heading.
	const towardsX = Math.cos(heading);
	const towardsZ = -Math.sin(heading);
	return {
		x: crossing.x - towardsX * distanceBack,
		z: crossing.z - towardsZ * distanceBack,
		headingX: towardsX,
		headingZ: towardsZ,
	};
}

afterEach(() => setTrainFront(null));

describe("level crossings", () => {
	it("stay open while there is no train", () => {
		setTrainFront(null);
		for (const item of RAIL_CROSSINGS) expect(crossingClosed(item)).toBe(false);
	});

	it("shut ahead of the train and reopen once it has gone by", () => {
		// Well short of the warning distance: still open.
		setTrainFront(railWrap(crossing.distance - BARRIER_LEAD - 20));
		expect(crossingClosed(crossing)).toBe(false);

		setTrainFront(railWrap(crossing.distance - BARRIER_LEAD + 1));
		expect(crossingClosed(crossing)).toBe(true);

		// Front past the crossing, tail still on it.
		setTrainFront(railWrap(crossing.distance + TRAIN_LENGTH / 2));
		expect(crossingClosed(crossing)).toBe(true);

		// Tail clear, plus the margin.
		setTrainFront(railWrap(crossing.distance + TRAIN_LENGTH + BARRIER_TRAIL + 1));
		expect(crossingClosed(crossing)).toBe(false);
	});

	it("gives a queue enough warning to stop", () => {
		// Braking comfortably (4.5 m/s^2) from an urban limit, inside the warning distance.
		const warningSeconds = BARRIER_LEAD / TRAIN_SPEED;
		expect(warningSeconds).toBeGreaterThan(5);
	});

	it("never shuts the whole loop at once", () => {
		setTrainFront(0);
		const closed = RAIL_CROSSINGS.filter(crossingClosed).length;
		expect(closed).toBeLessThan(RAIL_CROSSINGS.length / 2);
	});
});

describe("what the traffic sees", () => {
	it("finds nothing to stop for on a clear road", () => {
		setTrainFront(railWrap(crossing.distance - BARRIER_LEAD - 200));
		const car = approach(40);
		expect(railStopAhead(car.x, car.z, car.headingX, car.headingZ, 60, HALF_LENGTH)).toBe(Infinity);
	});

	it("stops short of the track when the barriers are down", () => {
		setTrainFront(railWrap(crossing.distance - 40));
		const car = approach(40);
		const gap = railStopAhead(car.x, car.z, car.headingX, car.headingZ, 60, HALF_LENGTH);
		// The gap is measured from the car's nose to the stop line.
		expect(gap).toBeCloseTo(40 - RAIL_STOP_SETBACK - HALF_LENGTH, 6);
		// Clear of the bed, so a car waiting there isn't standing on the rails.
		expect(RAIL_STOP_SETBACK).toBeGreaterThan(3);
	});

	it("waves through a car that is already over the line", () => {
		setTrainFront(railWrap(crossing.distance - 40));
		// Nose well past the stop line: stopping now would leave it parked on the rails.
		const car = approach(RAIL_STOP_SETBACK + HALF_LENGTH - 3);
		expect(railStopAhead(car.x, car.z, car.headingX, car.headingZ, 60, HALF_LENGTH)).toBe(Infinity);
	});

	it("still holds a car stopped a hair over the line", () => {
		setTrainFront(railWrap(crossing.distance - 40));
		const car = approach(RAIL_STOP_SETBACK + HALF_LENGTH - 0.4);
		expect(railStopAhead(car.x, car.z, car.headingX, car.headingZ, 60, HALF_LENGTH)).toBeLessThanOrEqual(0);
	});

	it("ignores a shut crossing already behind the car", () => {
		setTrainFront(railWrap(crossing.distance - 40));
		const car = approach(-20);
		expect(railStopAhead(car.x, car.z, car.headingX, car.headingZ, 60, HALF_LENGTH)).toBe(Infinity);
	});

	it("ignores a shut crossing on a road the car is not on", () => {
		setTrainFront(railWrap(crossing.distance - 40));
		const car = approach(40);
		// Same heading, but a block off to the side.
		const asideX = car.x + Math.sin((crossing.heading * Math.PI) / 180) * 40;
		const asideZ = car.z + Math.cos((crossing.heading * Math.PI) / 180) * 40;
		expect(railStopAhead(asideX, asideZ, car.headingX, car.headingZ, 60, HALF_LENGTH)).toBe(Infinity);
	});

	it("holds traffic for about as long as the train takes to pass", () => {
		// Walk the train round and count the seconds this crossing spends shut.
		const step = TRAIN_SPEED * (1 / 60);
		let shut = 0;
		for (let along = 0; along < RAIL_LENGTH; along += step) {
			setTrainFront(along);
			if (crossingClosed(crossing)) shut++;
		}
		const seconds = shut / 60;
		expect(seconds).toBeGreaterThan(8);
		expect(seconds).toBeLessThan(16);
	});

	it("has a crossing to test that really is on a road across the track", () => {
		const pose = railPoseAt(crossing.distance);
		expect(pose.x).toBeCloseTo(crossing.x, 4);
		expect(pose.z).toBeCloseTo(crossing.z, 4);
	});
});
