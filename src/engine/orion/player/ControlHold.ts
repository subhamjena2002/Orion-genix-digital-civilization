/**
 * Holding the player still: on the grid through a race's countdown, through a cutscene, at a shop
 * counter. Each holder sets its own reason (MissionRuntime each frame from the director, a shop
 * while it's open); the player's held while any reason stands. The controller keeps the
 * handbrake on and ignores the throttle in a car, and ignores movement and weapons on foot.
 */

const reasons = new Set<string>();

/** Holds (or lets go) for this reason; the missions' reason by default. */
export function setControlsHeld(hold: boolean, reason = "missions"): void {
	if (hold) reasons.add(reason);
	else reasons.delete(reason);
}

export function controlsHeld(): boolean {
	return reasons.size > 0;
}
