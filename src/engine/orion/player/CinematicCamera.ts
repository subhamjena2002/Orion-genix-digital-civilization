/**
 * The camera taken over for a cutscene. Whoever plays the scene (MissionRuntime, from the mission
 * director's shot) sets where the camera stands and what it looks at each frame. The player
 * controller puts the camera there instead of behind the player, kept out of walls, and turns
 * the player on foot to face `face`, the person they're talking to.
 */

export interface CinematicView {
	fromX: number;
	fromY: number;
	fromZ: number;
	atX: number;
	atY: number;
	atZ: number;
	/** Who the player turns to face, on foot; NaN for no one. */
	faceX: number;
	faceZ: number;
}

const view: CinematicView = { fromX: 0, fromY: 0, fromZ: 0, atX: 0, atY: 0, atZ: 0, faceX: Number.NaN, faceZ: Number.NaN };
let active = false;

/** The camera for this frame (copied), or null to give it back to the player. */
export function setCinematicView(next: Readonly<CinematicView> | null): void {
	active = next !== null;
	if (next) Object.assign(view, next);
}

export function readCinematicView(): Readonly<CinematicView> | null {
	return active ? view : null;
}
