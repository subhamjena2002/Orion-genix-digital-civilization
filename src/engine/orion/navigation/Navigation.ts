import { HIGHWAYS } from "../world/Highways";
import { HOSPITALS } from "../world/Hospitals";
import { ACCESS_ROAD, BASE } from "../world/MilitaryBase";
import { AIRFIELD_BOUNDS } from "../world/Airfield";
import { POLICE_STATION } from "../police/Police";
import { CITY_EXTENT_X, CITY_EXTENT_Z, ROAD_GRID } from "../roads/RoadNetwork";
import { ESTATE_ROAD_LINKS } from "../world/Estates";
import { RoadGraph, type Point, type RoadLink, type Route } from "./RoadGraph";

/**
 * Where the player is being sent, and the map's points of interest ("blips").
 *
 * Two kinds of destination lead the GPS: a waypoint the player sets on the map, and an objective
 * a mission sets (see missions/MissionDirector). An objective outranks the waypoint while it lasts,
 * as in most open-world games; clearing it hands the route back to the waypoint. Anything that
 * draws or follows the route asks `activeTarget()` and listens with `onNavigationChange`.
 */

export type BlipKind =
	| "player" | "waypoint" | "objective" | "mission" | "hospital" | "police" | "airport" | "army" | "safehouse" | "shop"
	/** A mission's quarry: someone to take out, a vehicle to destroy. */
	| "target"
	/** A car a mission wants the player in. */
	| "missionVehicle"
	/** Someone on the player's side in a mission: a witness, a hostage. */
	| "ally"
	/** A street job waiting to be picked up. */
	| "lead";

export interface Blip {
	id: string;
	kind: BlipKind;
	x: number;
	z: number;
	label: string;
}

export interface Target extends Blip {
	/** Within this many metres counts as arrived. */
	radius: number;
	/** A place in the air (a ring to fly through), not on the ground. */
	y?: number;
	/**
	 * False when there's no spot to light up in the world — the objective is a car or a person,
	 * marked where they are (see MissionRuntime) — though it's still on the map and the GPS.
	 */
	beacon?: boolean;
}

/** A waypoint is done with once you're this close. */
const WAYPOINT_ARRIVAL = 14;

/** Places that are always on the map, with their legend icons. */
export const LANDMARK_BLIPS: readonly Blip[] = [
	...HOSPITALS.map((hospital): Blip => ({ id: hospital.id, kind: "hospital", x: hospital.position[0], z: hospital.position[1], label: hospital.name })),
	{ id: "police-hq", kind: "police", x: POLICE_STATION.position[0], z: POLICE_STATION.position[1], label: "Police HQ" },
	{ id: "airfield", kind: "airport", x: (AIRFIELD_BOUNDS.minX + AIRFIELD_BOUNDS.maxX) / 2, z: AIRFIELD_BOUNDS.minZ + 120, label: "Air Base" },
	{ id: "army-base", kind: "army", x: BASE.centre[0], z: BASE.centre[1], label: BASE.name },
];

// ---- The road network ----------------------------------------------------------------------------

/** Every street of the grid as links between neighbouring junctions. */
function gridLinks(): RoadLink[] {
	const links: RoadLink[] = [];
	const { xs, zs } = ROAD_GRID;
	for (const x of xs) {
		for (let i = 1; i < zs.length; i++) links.push({ id: `ns-${x}-${i}`, points: [[x, zs[i - 1]], [x, zs[i]]] });
	}
	for (const z of zs) {
		for (let i = 1; i < xs.length; i++) links.push({ id: `ew-${z}-${i}`, points: [[xs[i - 1], z], [xs[i], z]] });
	}
	// The grid's roads run on past the last junction to the city's edge.
	for (const x of xs) {
		if (zs[0] > -CITY_EXTENT_Z) links.push({ id: `ns-${x}-n`, points: [[x, -CITY_EXTENT_Z], [x, zs[0]]] });
		if (zs[zs.length - 1] < CITY_EXTENT_Z) links.push({ id: `ns-${x}-s`, points: [[x, zs[zs.length - 1]], [x, CITY_EXTENT_Z]] });
	}
	for (const z of zs) {
		if (xs[0] > -CITY_EXTENT_X) links.push({ id: `ew-${z}-w`, points: [[-CITY_EXTENT_X, z], [xs[0], z]] });
		if (xs[xs.length - 1] < CITY_EXTENT_X) links.push({ id: `ew-${z}-e`, points: [[xs[xs.length - 1], z], [CITY_EXTENT_X, z]] });
	}
	return links;
}

function highwayLinks(): RoadLink[] {
	return HIGHWAYS.map((highway) => {
		const points: Point[] = [];
		for (let i = 0; i < highway.samples.length; i += 4) points.push([highway.samples[i].x, highway.samples[i].z]);
		const last = highway.samples[highway.samples.length - 1];
		points.push([last.x, last.z]);
		return { id: highway.id, points };
	});
}

export const ROAD_LINKS: readonly RoadLink[] = [
	...gridLinks(),
	...highwayLinks(),
	{ id: "army-access", points: [[ACCESS_ROAD.x, ACCESS_ROAD.fromZ], [ACCESS_ROAD.x, ACCESS_ROAD.toZ]] },
	...ESTATE_ROAD_LINKS,
];

let graph: RoadGraph | null = null;

/** Built on first use: the map and the GPS are what need it. */
export function roadGraph(): RoadGraph {
	graph ??= new RoadGraph(ROAD_LINKS);
	return graph;
}

export function routeTo(fromX: number, fromZ: number, toX: number, toZ: number): Route | null {
	return roadGraph().route(fromX, fromZ, toX, toZ);
}

// ---- Destinations ----------------------------------------------------------------------------------

let waypoint: Target | null = null;
let objective: Target | null = null;
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
	version++;
	for (const listener of listeners) listener();
}

/** Subscribes to waypoint and objective changes; returns the unsubscribe. */
export function onNavigationChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Bumps whenever anything here changes (for useSyncExternalStore). */
export function navigationVersion(): number {
	return version;
}

export function setWaypoint(x: number, z: number): void {
	waypoint = { id: "waypoint", kind: "waypoint", x, z, label: "Waypoint", radius: WAYPOINT_ARRIVAL };
	changed();
}

export function clearWaypoint(): void {
	if (!waypoint) return;
	waypoint = null;
	changed();
}

export function getWaypoint(): Target | null {
	return waypoint;
}

/** For missions: the place the current objective is at, or null to stand down. */
export function setObjective(target: Omit<Target, "id" | "kind"> & { kind?: "objective" | "mission" } | null): void {
	objective = target ? { id: "objective", kind: target.kind ?? "objective", ...target } : null;
	changed();
}

/** What the GPS leads to: a mission objective first, else the player's waypoint. */
export function activeTarget(): Target | null {
	return objective ?? waypoint;
}

/**
 * Called as the player moves: reaching the waypoint clears it (an objective is the mission's to
 * clear). Returns true when it did.
 */
export function checkArrival(x: number, z: number): boolean {
	if (waypoint && Math.hypot(waypoint.x - x, waypoint.z - z) <= waypoint.radius) {
		clearWaypoint();
		return true;
	}
	return false;
}
