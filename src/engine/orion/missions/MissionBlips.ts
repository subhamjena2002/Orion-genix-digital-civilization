import type { Blip } from "../navigation/Navigation";
import { streetLeads } from "./Leads";
import { missionActorMarkers } from "./MissionActors";
import { MISSIONS, SAFEHOUSE } from "./MissionCatalog";
import { missions, missionSpawns, type MissionDefinition, type Objective } from "./MissionDirector";
import { availableMissions } from "./Progress";

/**
 * The map's mission blips: the safehouse always; between missions, an M at each giver with a
 * mission on offer and a $ at a street lead; during one, its people and cars — red for what it
 * wants dealt with (and anyone who'll shoot), blue for a car it wants the player in and for
 * people on the player's side.
 */
export function missionBlips(): Blip[] {
	const blips: Blip[] = [{ id: "safehouse", kind: "safehouse", x: SAFEHOUSE.x, z: SAFEHOUSE.z, label: SAFEHOUSE.label }];
	if (missions.phase !== "active") {
		for (const mission of availableMissions(MISSIONS)) {
			blips.push({ id: `giver-${mission.id}`, kind: "mission", x: mission.giver.x, z: mission.giver.z, label: mission.title });
		}
		const lead = streetLeads.lead;
		if (lead) blips.push({ id: `lead-${lead.id}`, kind: "lead", x: lead.giver.x, z: lead.giver.z, label: lead.title });
		return blips;
	}
	const mission = missions.mission;
	const quarry = quarryOf(missions.objective);
	const actors = missionActorMarkers();
	for (const person of actors.people) {
		const ally = mission ? isPassive(mission, person.id) : false;
		blips.push({ id: person.id, kind: ally ? "ally" : "target", x: person.x, z: person.z, label: ally ? "Contact" : "Target" });
	}
	for (const car of actors.vehicles) {
		const target = quarry.includes(car.id);
		blips.push({ id: car.id, kind: target ? "target" : "missionVehicle", x: car.x, z: car.z, label: target ? "Target" : "Mission vehicle" });
	}
	return blips;
}

/** The cars an objective wants destroyed or stopped. */
export function quarryOf(objective: Objective | null): readonly string[] {
	if (objective?.kind === "destroyVehicles") return objective.ids;
	if (objective?.kind === "disable") return objective.targets;
	if (objective?.kind === "tail") return [objective.target];
	return [];
}

const passiveCache = new WeakMap<MissionDefinition, ReadonlySet<string>>();

/** Someone in the mission who won't fight: a witness, a hostage. */
export function isPassive(mission: MissionDefinition, id: string): boolean {
	let passive = passiveCache.get(mission);
	if (!passive) {
		passive = new Set(missionSpawns(mission).flatMap((spawn) => (spawn.type === "hostile" && spawn.role === "passive" ? [spawn.id] : [])));
		passiveCache.set(mission, passive);
	}
	return passive.has(id);
}
