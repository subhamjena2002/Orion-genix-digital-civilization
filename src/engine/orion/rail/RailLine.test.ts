import { describe, expect, it } from "vitest";

import { ORION_BUILDING_MAP } from "../buildings/Buildings";
import { ROAD_GRID_SPACING } from "../roads/RoadNetwork";
import {
	distanceFromRail,
	RAIL_CORNER_RADIUS,
	RAIL_CORNERS,
	RAIL_CROSSINGS,
	RAIL_LENGTH,
	RAIL_SEGMENTS,
	RAIL_STRAIGHTS,
	railBlocks,
	railPolyline,
	railPoseAt,
	railWrap,
} from "./RailLine";

describe("the rail loop", () => {
	it("joins up end to end, with no kink between one segment and the next", () => {
		for (const segment of RAIL_SEGMENTS) {
			const end = railPoseAt(segment.startsAt + segment.length);
			const next = railPoseAt(railWrap(segment.startsAt + segment.length));
			expect(end.x).toBeCloseTo(next.x, 6);
			expect(end.z).toBeCloseTo(next.z, 6);
			// Heading is continuous across the join: the arcs are tangent to their straights.
			const before = railPoseAt(segment.startsAt + segment.length - 0.01).heading;
			const after = railPoseAt(segment.startsAt + segment.length + 0.01).heading;
			const turn = Math.abs(((after - before + 540) % 360) - 180);
			expect(turn, `join after segment at ${segment.startsAt}`).toBeLessThan(0.5);
		}
	});

	it("straightens between the corners and curves through them", () => {
		expect(RAIL_STRAIGHTS.length).toBe(RAIL_CORNERS.length);
		expect(RAIL_SEGMENTS.filter((segment) => segment.kind === "arc").length).toBe(RAIL_CORNERS.length);
		for (const leg of RAIL_STRAIGHTS) {
			expect(Math.abs(leg.dx) < 1e-9 || Math.abs(leg.dz) < 1e-9, `leg from ${leg.from.x},${leg.from.z}`).toBe(true);
		}
	});

	it("measures one lap: four straights cut back by the corners, plus four quarter circles", () => {
		const straights = 2 * (240 - 2 * RAIL_CORNER_RADIUS) + 2 * (400 - 2 * RAIL_CORNER_RADIUS);
		expect(RAIL_LENGTH).toBeCloseTo(straights + 2 * Math.PI * RAIL_CORNER_RADIUS, 6);
	});

	it("keeps going round for ever", () => {
		const start = railPoseAt(0);
		const lap = railPoseAt(RAIL_LENGTH);
		expect(lap.x).toBeCloseTo(start.x, 6);
		expect(lap.z).toBeCloseTo(start.z, 6);
		// Backwards wraps too, so a train never falls off the end of the route.
		expect(railWrap(-10)).toBeCloseTo(RAIL_LENGTH - 10, 6);
		expect(railPoseAt(RAIL_LENGTH * 3 + 25).x).toBeCloseTo(railPoseAt(25).x, 6);
	});

	it("never leaves the track between one step and the next", () => {
		// Walking the whole loop, every point is on the line and the step is the distance asked for.
		let previous = railPoseAt(0);
		for (let along = 0.5; along <= RAIL_LENGTH; along += 0.5) {
			const pose = railPoseAt(along);
			expect(distanceFromRail(pose.x, pose.z), `at ${along}`).toBeLessThan(0.001);
			const step = Math.hypot(pose.x - previous.x, pose.z - previous.z);
			// 0.5 m along the track; a fraction less across the chord of a curve.
			expect(step, `step at ${along}`).toBeLessThanOrEqual(0.5001);
			expect(step, `step at ${along}`).toBeGreaterThan(0.49);
			previous = pose;
		}
	});

	it("points the train the way it is travelling", () => {
		// The first straight runs north (+Z); a quarter of a lap on it is heading west.
		expect(railPoseAt(10).heading).toBeCloseTo(0, 4);
		expect(railPoseAt(300).heading).toBeCloseTo(-90, 4);
	});

	it("runs between the roads, never along one", () => {
		// The grid is on multiples of 80; the line is offset half a block from all of them.
		for (const corner of RAIL_CORNERS) {
			expect(Math.abs(corner.x) % ROAD_GRID_SPACING).toBe(ROAD_GRID_SPACING / 2);
			expect(Math.abs(corner.z) % ROAD_GRID_SPACING).toBe(ROAD_GRID_SPACING / 2);
		}
	});

	it("crosses the roads that carry traffic", () => {
		expect(RAIL_CROSSINGS.length).toBe(16);
		for (const crossing of RAIL_CROSSINGS) {
			expect(distanceFromRail(crossing.x, crossing.z), crossing.id).toBeLessThan(0.001);
			const pose = railPoseAt(crossing.distance);
			expect(pose.x, crossing.id).toBeCloseTo(crossing.x, 4);
			expect(pose.z, crossing.id).toBeCloseTo(crossing.z, 4);
			// Every crossing is on a straight, so the booms sit square to the road.
			expect(Math.abs(pose.heading) % 90, crossing.id).toBeCloseTo(0, 4);
		}
	});

	it("names each crossing once", () => {
		const ids = RAIL_CROSSINGS.map((crossing) => crossing.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("knows what stands on the line", () => {
		expect(railBlocks(200, 0, 20, 20)).toBe(true);
		expect(railBlocks(0, 0, 20, 20)).toBe(false);
	});

	it("leaves no building standing on the line", () => {
		for (const placement of ORION_BUILDING_MAP) {
			const clear = distanceFromRail(placement.position[0], placement.position[2]) - Math.max(...placement.footprint) / 2;
			expect(clear, placement.id).toBeGreaterThan(0);
		}
	});

	it("draws as a closed line", () => {
		const points = railPolyline(8);
		expect(points[0].x).toBeCloseTo(points[points.length - 1].x, 6);
		expect(points[0].z).toBeCloseTo(points[points.length - 1].z, 6);
	});
});
