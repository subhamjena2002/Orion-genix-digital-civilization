import { afterEach, describe, expect, it } from "vitest";

import { HOUSE_LOTS } from "../world/Estates";
import { activeTarget, checkArrival, clearWaypoint, getWaypoint, roadGraph, routeTo, setObjective, setWaypoint } from "./Navigation";
import { RoadGraph, remainingRoute } from "./RoadGraph";

afterEach(() => {
	clearWaypoint();
	setObjective(null);
});

describe("RoadGraph", () => {
	it("routes round a block by road, not across it", () => {
		const graph = new RoadGraph([
			{ id: "a", points: [[0, 0], [100, 0]] },
			{ id: "b", points: [[100, 0], [100, 100]] },
			{ id: "c", points: [[0, 0], [0, 100]] },
			{ id: "d", points: [[0, 100], [100, 100]] },
		]);
		const route = graph.route(0, 0, 100, 100);
		expect(route).not.toBeNull();
		expect(route!.length).toBeCloseTo(200);
	});

	it("joins a side road that meets a street part-way along", () => {
		const graph = new RoadGraph([
			{ id: "street", points: [[0, 0], [200, 0]] },
			{ id: "side", points: [[100, 3], [100, 80]] },
		]);
		const route = graph.route(10, 0, 100, 80);
		expect(route).not.toBeNull();
		expect(route!.length).toBeCloseTo(90 + 80, 0);
	});

	it("starts and ends at the nearest road to an off-road place", () => {
		const graph = new RoadGraph([{ id: "street", points: [[0, 0], [100, 0]] }]);
		const route = graph.route(20, 15, 80, -10);
		expect(route!.points[0]).toEqual([20, 0]);
		expect(route!.points[route!.points.length - 1]).toEqual([80, 0]);
	});

	it("trims a route to what's left as you drive it", () => {
		const route = { points: [[0, 0], [100, 0], [100, 100]] as [number, number][], length: 200 };
		expect(remainingRoute(route, 50, 2).length).toBeCloseTo(150);
	});
});

describe("the city's network", () => {
	it("connects across the city", () => {
		const route = routeTo(-390, -230, 390, 230);
		expect(route).not.toBeNull();
		// By road, so no shorter than going round the blocks.
		expect(route!.length).toBeGreaterThanOrEqual(780 + 460 - 30);
	});

	it("reaches every estate house from the city centre", () => {
		for (const lot of HOUSE_LOTS) {
			const route = routeTo(0, 0, lot.x, lot.z);
			expect(route, lot.id).not.toBeNull();
			// The route ends at the road in front of the house.
			const end = route!.points[route!.points.length - 1];
			expect(Math.hypot(end[0] - lot.x, end[1] - lot.z)).toBeLessThan(lot.depth / 2 + 25);
		}
	});

	it("reaches into the army base", () => {
		const route = routeTo(0, 0, 0, 300);
		expect(route).not.toBeNull();
		expect(route!.points[route!.points.length - 1][1]).toBeCloseTo(300);
	});

	it("reaches both highway ends", () => {
		expect(roadGraph().nodeCount).toBeGreaterThan(70);
		expect(routeTo(0, 0, -800, -410)).not.toBeNull();
		expect(routeTo(0, 0, 965, -382)).not.toBeNull();
	});
});

describe("destinations", () => {
	it("leads to the waypoint, and clears it on arrival", () => {
		setWaypoint(100, 50);
		expect(activeTarget()?.kind).toBe("waypoint");
		expect(checkArrival(0, 0)).toBe(false);
		expect(checkArrival(102, 48)).toBe(true);
		expect(getWaypoint()).toBeNull();
	});

	it("puts a mission objective ahead of the waypoint", () => {
		setWaypoint(100, 50);
		setObjective({ x: 5, z: 5, label: "Meet Rico", radius: 8 });
		expect(activeTarget()?.label).toBe("Meet Rico");
		setObjective(null);
		expect(activeTarget()?.kind).toBe("waypoint");
	});
});
