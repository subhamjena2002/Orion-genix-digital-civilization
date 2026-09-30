/**
 * The jet's model, prepared by scripts/prepare-jet.mjs from "Fictional Fighter/Bomber Aircraft"
 * by yoshikawa_Kosuke (CC-BY-4.0, see CREDITS.md): merged by material, re-based to metres with
 * Y up and the nose along +Z, national insignia painted out, and split into the parts the game
 * moves (canopy, airbrake, three gear legs, four missiles).
 */
export const JET_MODEL = "/models/aircraft/jet.glb";

/** Its name in the game: a made-up one, as the aircraft appears unbranded. */
export const JET_NAME = "OG-7 Striker";

/**
 * Model space, from the preparation script. The wheels touch the ground at `groundY`; the
 * centre of mass (the flight model's origin) sits at `centreOfMass`.
 */
export const JET_GEOMETRY = {
	groundY: -0.12,
	/** Ahead of the main wheels, so about a sixth of the weight is on the nose wheel. */
	centreOfMass: [0, 2.1, -2.9] as const,
	/** The canopy and airbrake are modelled open: these turns (degrees, about the part's X axis) shut them. */
	canopyClosed: 22,
	airbrakeClosed: -45,
	/** The airbrake raised this far past closed when it's out. */
	airbrakeOpen: 32,
	/** The engines' nozzles, model space: where the afterburner flames come out. */
	nozzles: [[1.25, 1.89, -9.15], [-1.25, 1.89, -9.15]] as const,
	nozzleRadius: 0.46,
	/** The cannon's muzzle, beside the cockpit on the left. */
	muzzle: [0.69, 2.35, 4.6] as const,
	/** The front seat: where the pilot's root goes. */
	seat: [0, 2.95, 4.95] as const,
};

/** Height of the centre of mass above the ground when parked on its wheels. */
export const JET_CG_HEIGHT = JET_GEOMETRY.centreOfMass[1] - JET_GEOMETRY.groundY;
