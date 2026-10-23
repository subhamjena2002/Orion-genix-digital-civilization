import { AIRFIELD_LAYOUT } from "./Airfield";
import { BASE, BASE_LAYOUT, type Placement } from "./MilitaryBase";

/**
 * The army base's and the airfield's perimeter walls as a handful of long straight runs, for the
 * stand-in walls that hold the line until the base's kit has downloaded (see MilitaryBase).
 *
 * Worked out from the same wall-panel placements the kit is laid by, so every run starts and
 * stops where the real panels do and the gates are left open exactly where the real ones are.
 */

/** The kit's wall panel, measured from military-base-kit.glb (node Plane.011_19), metres. */
export const WALL_PANEL_SIZE = { length: 3.056, height: 2.901, thickness: 0.2 } as const;

export interface WallRun {
	/** Centre of the run on the ground, world x/z. */
	x: number;
	z: number;
	/** Degrees about Y, as the panels in it are turned. */
	yaw: number;
	/** End to end, metres. */
	length: number;
	/** How many kit panels the run stands in for. */
	panels: number;
}

/** Panels further apart than this (centre to centre) are either side of an opening. */
const MAX_GAP = BASE.wallPanel * 1.5;
/** Panels this far off a run's line, or turned this much from it, start a new run. */
const LINE_TOLERANCE = 0.05;
const YAW_TOLERANCE = 0.5;

/**
 * Joins wall panels laid end to end into runs. A panel continues the run before it when it is
 * turned the same way, sits on its line and is no more than one panel on from its last panel.
 */
export function wallRuns(placements: readonly Placement[]): WallRun[] {
	const walls = placements.filter((placement) => placement.piece === "wall");
	// Group by direction and line, then walk each line in order along it.
	const lines: { yaw: number; dirX: number; dirZ: number; offset: number; panels: Placement[] }[] = [];
	for (const panel of walls) {
		const radians = (panel.yaw * Math.PI) / 180;
		// A panel at yaw 0 runs along +X; turned by yaw about Y, +X goes to (cos, -sin).
		const dirX = Math.cos(radians);
		const dirZ = -Math.sin(radians);
		const offset = panel.x * -dirZ + panel.z * dirX;
		const line = lines.find((candidate) => (
			Math.abs(normaliseYaw(candidate.yaw - panel.yaw)) < YAW_TOLERANCE && Math.abs(candidate.offset - offset) < LINE_TOLERANCE
		));
		if (line) line.panels.push(panel);
		else lines.push({ yaw: panel.yaw, dirX, dirZ, offset, panels: [panel] });
	}

	const runs: WallRun[] = [];
	for (const line of lines) {
		const along = (panel: Placement) => panel.x * line.dirX + panel.z * line.dirZ;
		const ordered = [...line.panels].sort((a, b) => along(a) - along(b));
		let first = ordered[0];
		let last = ordered[0];
		let count = 1;
		const close = () => {
			const span = along(last) - along(first);
			runs.push({
				x: (first.x + last.x) / 2,
				z: (first.z + last.z) / 2,
				yaw: line.yaw,
				length: span + WALL_PANEL_SIZE.length,
				panels: count,
			});
		};
		for (let index = 1; index < ordered.length; index++) {
			const panel = ordered[index];
			if (along(panel) - along(last) > MAX_GAP) {
				close();
				first = panel;
				count = 0;
			}
			last = panel;
			count++;
		}
		close();
	}
	return runs;
}

function normaliseYaw(degrees: number): number {
	return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** Every perimeter run of the base and the airfield, which the kit's one batch lays together. */
export const PERIMETER_WALL_RUNS: readonly WallRun[] = wallRuns([...BASE_LAYOUT, ...AIRFIELD_LAYOUT]);
