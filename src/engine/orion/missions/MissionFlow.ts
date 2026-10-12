import { clearWaypoint } from "../navigation/Navigation";
import { clearWanted } from "../police/Wanted";
import { requestTeleport } from "../player/Teleport";
import { missionById } from "./MissionCatalog";
import { missions } from "./MissionDirector";

/**
 * Starting a mission from somewhere other than its giver's marker: a retry after failing it, or a
 * replay from the mission list. The player is put at the giver first, as if they'd walked there.
 */

/** A little way off the giver, so the player isn't stood in the marker when it comes back. */
const GIVER_OFFSET = 4;

export function playMissionFromGiver(id: string): boolean {
	const mission = missionById(id);
	if (!mission) return false;
	requestTeleport(mission.giver.x + GIVER_OFFSET, mission.giver.z, 270);
	clearWanted();
	clearWaypoint();
	missions.start(mission);
	return true;
}

/** The mission just failed, again from the top. */
export function retryMission(): boolean {
	const mission = missions.mission;
	if (!mission || missions.phase !== "failed") return false;
	return playMissionFromGiver(mission.id);
}
