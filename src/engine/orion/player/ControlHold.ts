/**
 * Holding the player's vehicle still — on the grid through a race's countdown. Whoever holds it
 * (MissionRuntime, from the director's countdown) sets it each frame; the controller keeps the
 * handbrake on and ignores the throttle while it's set.
 */

let held = false;

export function setControlsHeld(hold: boolean): void {
	held = hold;
}

export function controlsHeld(): boolean {
	return held;
}
