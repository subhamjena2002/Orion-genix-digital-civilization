/**
 * The city terrain plane sits at y = -0.65, so the waterline is placed just below it: the
 * land reads as dry ground standing above the sea, and walking off the terrain edge drops
 * you straight into open water.
 */
export const ORION_OCEAN = {
	level: -1.2,
	/** Extends well past the camera's far clip so no edge is ever visible. */
	size: 3000,
	/** How far under the surface counts as submerged rather than wading. */
	submergeDepth: 0.9,
	/** Seconds underwater before the player drowns and respawns. */
	drownSeconds: 3.5,
	/** Terminal sink speed, so going under reads as sinking rather than free-fall. */
	sinkSpeed: 1.4,
	/** Horizontal damping while submerged (per second); water should slow you, not glue you. */
	drag: 2.2,
} as const;
