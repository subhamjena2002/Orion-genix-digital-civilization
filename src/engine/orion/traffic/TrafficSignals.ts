import { ROAD_GEOMETRY, ROAD_GRID, roadWidthAt } from "../roads/RoadNetwork";

/**
 * Signal timing and junction geometry shared by the lights, the cars that obey them and the
 * pedestrians who wait for them.
 *
 * "ns" traffic moves along Z (on the north–south roads); "ew" traffic moves along X.
 */
export type TrafficAxis = "ns" | "ew";
export type SignalColour = "red" | "amber" | "green";

const GREEN_SECONDS = 14;
const AMBER_SECONDS = 3;
/** Both directions held on red between phases, so the junction clears. */
const ALL_RED_SECONDS = 2;
const HALF_CYCLE = GREEN_SECONDS + AMBER_SECONDS + ALL_RED_SECONDS;
export const SIGNAL_CYCLE_SECONDS = HALF_CYCLE * 2;

/**
 * Neighbouring junctions are staggered in two groups so the city doesn't switch in unison.
 * Only two groups keep the lamp materials shared (see StreetFurniture).
 */
export const SIGNAL_GROUP_COUNT = 2;
const GROUP_OFFSET_SECONDS = 8;

/** Where things sit relative to the kerb of the road being crossed, in metres. */
export const JUNCTION_LAYOUT = {
	/** Zebra band, measured outward from the junction box. */
	zebraStart: 0.3,
	zebraEnd: 2.7,
	stripeWidth: 0.5,
	stripeGap: 0.5,
	/** Stop line sits just before the zebra. */
	stopLine: 3.2,
	stopLineThickness: 0.35,
	/** Signal poles stand near the back of the 2 m pavement. */
	poleInset: 1.75,
} as const;

/** Top of the carriageway, where markings are painted. */
export const ROAD_TOP_Y = ROAD_GEOMETRY.surfaceY + ROAD_GEOMETRY.thickness / 2 + ROAD_GEOMETRY.axisEpsilon;

export function trafficClock(): number {
	return performance.now() / 1000;
}

export function signalGroup(xIndex: number, zIndex: number): number {
	return (xIndex + zIndex) % SIGNAL_GROUP_COUNT;
}

function phaseTime(group: number, time: number): number {
	const t = (time + group * GROUP_OFFSET_SECONDS) % SIGNAL_CYCLE_SECONDS;
	return t < 0 ? t + SIGNAL_CYCLE_SECONDS : t;
}

export function signalColour(group: number, axis: TrafficAxis, time = trafficClock()): SignalColour {
	// Each axis gets the first part of its own half-cycle as green, then amber, then all-red.
	const t = (phaseTime(group, time) - (axis === "ns" ? 0 : HALF_CYCLE) + SIGNAL_CYCLE_SECONDS) % SIGNAL_CYCLE_SECONDS;
	if (t < GREEN_SECONDS) return "green";
	if (t < GREEN_SECONDS + AMBER_SECONDS) return "amber";
	return "red";
}

/** Seconds of red left for `axis` (0 if it isn't red). Pedestrians use it to judge a crossing. */
export function redRemaining(group: number, axis: TrafficAxis, time = trafficClock()): number {
	const t = (phaseTime(group, time) - (axis === "ns" ? 0 : HALF_CYCLE) + SIGNAL_CYCLE_SECONDS) % SIGNAL_CYCLE_SECONDS;
	return t < GREEN_SECONDS + AMBER_SECONDS ? 0 : SIGNAL_CYCLE_SECONDS - t;
}

/** Unit direction for each of the four travel headings. */
export const HEADINGS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function axisOf(dx: number): TrafficAxis {
	return dx !== 0 ? "ew" : "ns";
}

/** Traffic keeps left (India). Left of heading (dx, dz) with Y up. */
export function leftOf(dx: number, dz: number): [number, number] {
	return [dz, -dx];
}

export function junctionExists(xIndex: number, zIndex: number): boolean {
	return xIndex >= 0 && zIndex >= 0 && xIndex < ROAD_GRID.xs.length && zIndex < ROAD_GRID.zs.length;
}

/** Width of the road a vehicle heading (dx, dz) through this junction is driving on. */
export function travelRoadWidth(xIndex: number, zIndex: number, dx: number): number {
	return dx !== 0 ? roadWidthAt(ROAD_GRID.zs[zIndex]) : roadWidthAt(ROAD_GRID.xs[xIndex]);
}

/** Width of the road a vehicle heading (dx, dz) has to cross at this junction. */
export function crossRoadWidth(xIndex: number, zIndex: number, dx: number): number {
	return dx !== 0 ? roadWidthAt(ROAD_GRID.xs[xIndex]) : roadWidthAt(ROAD_GRID.zs[zIndex]);
}

/** Lane-centre offsets from the road centreline for a road of this width. */
export function laneOffsets(roadWidth: number): readonly number[] {
	return roadWidth >= 14 ? [1.75, 5.25] : [2.5];
}

export interface SignalApproach {
	xIndex: number;
	zIndex: number;
	/** Direction traffic on this approach is travelling. */
	dx: number;
	dz: number;
	group: number;
	axis: TrafficAxis;
	/** Pole position (world X/Z) on the near-left corner, as seen by approaching drivers. */
	pole: [number, number];
	roadWidth: number;
}

/** Every signalled approach in the city: one per road arm that actually carries traffic in. */
export const SIGNAL_APPROACHES: readonly SignalApproach[] = ROAD_GRID.xs.flatMap((x, xIndex) => (
	ROAD_GRID.zs.flatMap((z, zIndex) => HEADINGS.flatMap(([dx, dz]): SignalApproach[] => {
		// Traffic arrives from the neighbouring junction behind it; grid-edge arms have none.
		if (!junctionExists(xIndex - dx, zIndex - dz)) return [];
		const roadWidth = travelRoadWidth(xIndex, zIndex, dx);
		const crossWidth = crossRoadWidth(xIndex, zIndex, dx);
		const [lx, lz] = leftOf(dx, dz);
		const back = crossWidth / 2 + JUNCTION_LAYOUT.poleInset;
		const side = roadWidth / 2 + JUNCTION_LAYOUT.poleInset;
		return [{
			xIndex,
			zIndex,
			dx,
			dz,
			group: signalGroup(xIndex, zIndex),
			axis: axisOf(dx),
			pole: [x - dx * back + lx * side, z - dz * back + lz * side],
			roadWidth,
		}];
	}))
));
