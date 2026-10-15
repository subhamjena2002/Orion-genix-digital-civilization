import { alertMissionHostiles, missionHostileMarkers, missionPersonState, placeMissionHostile, releaseMissionHostiles, setMissionFollow } from "../characters/OrionPedestrian";
import { missionVehicleMarkers, missionVehicleProgress, missionVehicleState, paceMissionVehicle, placeMissionVehicle, releaseMissionVehicles, rerouteMissionVehicle, startMissionRacers } from "../traffic/OrionVehicle";
import { readPlayerPose } from "../player/PlayerPose";
import { raiseWanted } from "../police/Wanted";
import type { MissionSpawn, MissionStage } from "./MissionDirector";

/**
 * The mission director's stage: puts a mission's cars and people into the world from the pools
 * kept for them (OrionVehicle and OrionPedestrian with a missionSlot), and takes them out again.
 *
 * A pool slot whose model is still loading has no script yet, so whatever couldn't be placed is
 * tried again each frame (`updateMissionActors`) until it can.
 */

const vehicles = new Set<string>();
const people = new Set<string>();
let pending: MissionSpawn[] = [];
/** Opponents given the green light — one whose model only arrives after it goes straight off. */
const racing = new Set<string>();

function place(spawn: MissionSpawn): boolean {
	if (spawn.type === "vehicle") {
		vehicles.add(spawn.id);
		const placed = placeMissionVehicle(spawn.id, spawn.x, spawn.z, spawn.yaw, spawn.route ?? null, { cruise: spawn.cruise, racer: spawn.racer, disableBelow: spawn.disableBelow });
		if (placed && racing.has(spawn.id)) startMissionRacers([spawn.id]);
		return placed;
	}
	people.add(spawn.id);
	const placed = placeMissionHostile(spawn.id, spawn.x, spawn.z, spawn.armed, spawn.toughness ?? 1, spawn.role ?? "guard", spawn.yaw ?? 0);
	if (placed && following.has(spawn.id)) setMissionFollow(spawn.id, true);
	return placed;
}

/** People asked to follow the player — kept, so one whose model arrives late still does. */
const following = new Set<string>();

export const missionStage: MissionStage = {
	spawn(spawns) {
		for (const spawn of spawns) if (!place(spawn)) pending.push(spawn);
	},
	clear() {
		pending = [];
		releaseMissionVehicles(vehicles);
		releaseMissionHostiles(people);
		vehicles.clear();
		people.clear();
		racing.clear();
		following.clear();
	},
	startRace(racers) {
		for (const id of racers) racing.add(id);
		startMissionRacers(racers);
	},
	racerProgress(id) {
		return missionVehicleProgress(id);
	},
	alarm(stars) {
		const player = readPlayerPose();
		raiseWanted(stars, player.x, player.z);
	},
	actor(id) {
		if (vehicles.has(id)) return missionVehicleState(id);
		if (!people.has(id)) return null;
		const person = missionPersonState(id);
		return person ? { x: person.x, z: person.z, integrity: 100, aboard: person.aboard } : null;
	},
	follow(id, on) {
		if (on) following.add(id);
		else following.delete(id);
		setMissionFollow(id, on);
	},
	alertAll() {
		alertMissionHostiles(people);
	},
	reroute(id, route, cruise) {
		rerouteMissionVehicle(id, route, cruise);
	},
	pace(id, cruise) {
		paceMissionVehicle(id, cruise);
	},
};

/** Once a frame: anything still waiting on its model goes in once it's there. */
export function updateMissionActors(): void {
	if (pending.length === 0) return;
	pending = pending.filter((spawn) => !place(spawn));
}

export interface ActorMarker {
	id: string;
	x: number;
	z: number;
}

const vehicleScratch: ActorMarker[] = [];
const peopleScratch: ActorMarker[] = [];

/** The current mission's cars still in one piece, and its people still standing, for the map. */
export function missionActorMarkers(): { vehicles: readonly ActorMarker[]; people: readonly ActorMarker[] } {
	const carCount = missionVehicleMarkers(vehicleScratch);
	const personCount = missionHostileMarkers(peopleScratch);
	return {
		vehicles: vehicleScratch.slice(0, carCount).filter((marker) => vehicles.has(marker.id)),
		people: peopleScratch.slice(0, personCount).filter((marker) => people.has(marker.id)),
	};
}
