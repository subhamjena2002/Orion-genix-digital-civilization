import type { Blip } from "../navigation/Navigation";
import { missionActorMarkers } from "./MissionActors";
import { MISSIONS, SAFEHOUSE } from "./MissionCatalog";
import { missions } from "./MissionDirector";
import { availableMissions } from "./Progress";

/**
 * The map's mission blips: the safehouse always; between missions, an M at each giver with a
 * mission on offer; during one, its people and cars — red for what it wants destroyed, blue for
 * a car it wants the player in.
 */
export function missionBlips(): Blip[] {
	const blips: Blip[] = [{ id: "safehouse", kind: "safehouse", x: SAFEHOUSE.x, z: SAFEHOUSE.z, label: SAFEHOUSE.label }];
	if (missions.phase !== "active") {
		for (const mission of availableMissions(MISSIONS)) {
			blips.push({ id: `giver-${mission.id}`, kind: "mission", x: mission.giver.x, z: mission.giver.z, label: mission.title });
		}
		return blips;
	}
	const objective = missions.objective;
	const quarry = objective?.kind === "destroyVehicles" ? objective.ids : [];
	const actors = missionActorMarkers();
	for (const person of actors.people) blips.push({ id: person.id, kind: "target", x: person.x, z: person.z, label: "Target" });
	for (const car of actors.vehicles) {
		const target = quarry.includes(car.id);
		blips.push({ id: car.id, kind: target ? "target" : "missionVehicle", x: car.x, z: car.z, label: target ? "Target" : "Mission vehicle" });
	}
	return blips;
}
