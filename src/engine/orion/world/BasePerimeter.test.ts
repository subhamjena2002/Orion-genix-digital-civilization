import { describe, expect, it } from "vitest";

import { AIRFIELD_LAYOUT } from "./Airfield";
import { PERIMETER_WALL_RUNS, WALL_PANEL_SIZE, wallRuns, type WallRun } from "./BasePerimeter";
import { AIRFIELD_GATE, BASE, BASE_LAYOUT, type Placement } from "./MilitaryBase";

const panels = [...BASE_LAYOUT, ...AIRFIELD_LAYOUT].filter((placement) => placement.piece === "wall");

/** Distance from a point to a run's centre line, and how far along it (0 at the centre). */
function relativeTo(run: WallRun, x: number, z: number) {
	const radians = (run.yaw * Math.PI) / 180;
	const dirX = Math.cos(radians);
	const dirZ = -Math.sin(radians);
	const dx = x - run.x;
	const dz = z - run.z;
	return { along: dx * dirX + dz * dirZ, across: Math.abs(dx * -dirZ + dz * dirX) };
}

const covered = (x: number, z: number) => PERIMETER_WALL_RUNS.some((run) => {
	const { along, across } = relativeTo(run, x, z);
	return across < 0.5 && Math.abs(along) <= run.length / 2;
});

describe("base perimeter runs", () => {
	it("stand in for every wall panel, each exactly once", () => {
		expect(PERIMETER_WALL_RUNS.reduce((sum, run) => sum + run.panels, 0)).toBe(panels.length);
		for (const panel of panels) expect(covered(panel.x, panel.z)).toBe(true);
		// A few long runs rather than hundreds of panels.
		expect(PERIMETER_WALL_RUNS.length).toBeLessThan(20);
	});

	it("leave the north gate and the airfield gate open", () => {
		const north = BASE.centre[1] - BASE.size[1] / 2;
		expect(covered(BASE.centre[0], north)).toBe(false);
		expect(covered(BASE.centre[0] + 3, north)).toBe(false);
		expect(covered(AIRFIELD_GATE.x, AIRFIELD_GATE.z)).toBe(false);
		// ...but close either side of them.
		expect(covered(BASE.centre[0] + BASE.gateWidth / 2 + 3, north)).toBe(true);
		expect(covered(AIRFIELD_GATE.x, AIRFIELD_GATE.z + AIRFIELD_GATE.width / 2 + 3)).toBe(true);
	});

	it("join panels on one line and split them at an opening", () => {
		const row = (xs: number[]): Placement[] => xs.map((x) => ({ piece: "wall", x, z: 10, yaw: 0 }));
		const runs = wallRuns(row([0, 3.1, 6.2, 20, 23.1]));
		expect(runs).toHaveLength(2);
		expect(runs[0]).toMatchObject({ x: 3.1, z: 10, panels: 3 });
		expect(runs[0].length).toBeCloseTo(6.2 + WALL_PANEL_SIZE.length);
		expect(runs[1]).toMatchObject({ x: 21.55, panels: 2 });
		// Turned runs: along z at yaw 90.
		const turned = wallRuns([0, 3.1].map((z): Placement => ({ piece: "wall", x: 5, z, yaw: 90 })));
		expect(turned).toHaveLength(1);
		expect(turned[0].x).toBeCloseTo(5);
		expect(turned[0].z).toBeCloseTo(1.55);
	});
});
