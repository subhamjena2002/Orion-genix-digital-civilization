import { carSpecFor } from "../traffic/CarPhysics";
import type { VehicleStyle } from "../traffic/Vehicles";
import type { Gearbox } from "./EngineVoices";

/**
 * How each kind of vehicle sounds: which recorded engine it plays (see VehicleSoundManifest and
 * docs/audio/vehicle-sound-manifest.md), how far that recording is pitched for this model, its
 * gearbox, and which extras it has (air brakes, a siren, a gear lever worth hearing).
 *
 * The revs and gears are an audio model, not simulation data. The driving model has no engine
 * speed or gearbox — a car has a road speed, a pedal and a top speed — so the sound picks a gear
 * from the road speed (with a margin so it can't hunt) and the revs from where the speed sits in
 * that gear. Each gear is a share of the vehicle's own top speed in CarPhysics, so a gearbox
 * never runs out before the car does. Nothing here is shown to the player as a reading.
 */

export type VehicleSoundClass =
	| "everyday" | "compact" | "suv" | "luxury" | "executive" | "police" | "sports" | "electric"
	| "van" | "ambulance" | "truck" | "bus" | "fireTruck" | "threeWheeler";

export type SirenKind = "wail" | "hilo" | "fire";

export interface VehicleAudioProfile {
	sound: VehicleSoundClass;
	/** The recorded engine family (VehicleSoundManifest.ENGINE_FAMILIES); null for an electric car. */
	family: string | null;
	/** Pitch against the recording: a bigger engine of the same family a little lower. */
	shift: number;
	/** Level against the other engines. */
	level: number;
	/** Nominal idle and redline and each gear's top as a share of top speed (see above). */
	idleRpm: number;
	redlineRpm: number;
	gearShares: readonly number[];
	/**
	 * Seconds the drive is cut on an upshift: a manual's clutch, an automatic's torque handover,
	 * a lorry's long shift. The engine's load drops for that long and the revs fall to the new gear.
	 */
	shiftSeconds: number;
	/** A gear lever the driver moves: heard inside the player's own car. */
	manual: boolean;
	/** Air brakes: a hiss as it comes to a stop. */
	airBrakes: boolean;
	siren: SirenKind | null;
	/** Tyre noise against an ordinary car's: wide or heavy tyres roar louder. */
	tyres: number;
	/**
	 * Top of the engine's tone (Hz) at full throttle. Raw recordings are close-miked and harsh;
	 * as open-world games do, the mix keeps engines warm, and a luxury car's insulated cabin and
	 * quiet exhaust warmer still.
	 */
	brightness: number;
}

const FIVE_SPEED = [0.18, 0.32, 0.5, 0.72, 1.05];
const SIX_SPEED = [0.15, 0.27, 0.4, 0.55, 0.75, 1.05];
const AUTOMATIC_FOUR = [0.22, 0.4, 0.66, 1.05];
const HEAVY_EIGHT = [0.1, 0.17, 0.25, 0.35, 0.47, 0.6, 0.8, 1.05];
const BUS_SIX = [0.14, 0.26, 0.4, 0.58, 0.8, 1.05];

function profile(sound: VehicleSoundClass, family: string | null, shift: number, level: number, extra: Partial<VehicleAudioProfile> = {}): VehicleAudioProfile {
	return {
		sound, family, shift, level,
		idleRpm: 800, redlineRpm: 6200, gearShares: FIVE_SPEED, shiftSeconds: 0.22,
		manual: true, airBrakes: false, siren: null, tyres: 1, brightness: 6500,
		...extra,
	};
}

const EVERYDAY = profile("everyday", "car", 1, 1);
// Sports cars: the V8, pitched up and revving higher, with a quick gearbox. (They had a race
// engine's recording, whose lumpy, rasping idle grated; a smooth V8 burble is the sound players
// expect from a sports car in an open-world game.)
const SPORTS = profile("sports", "v8", 1.12, 1.05, { idleRpm: 750, redlineRpm: 6800, gearShares: SIX_SPEED, shiftSeconds: 0.15, manual: false, tyres: 1.15, brightness: 6000 });
const AUTOMATIC_SIX = [0.13, 0.24, 0.37, 0.52, 0.72, 1.05];
const LUXURY_SALOON = profile("luxury", "car", 0.86, 0.75, { idleRpm: 650, redlineRpm: 5500, gearShares: AUTOMATIC_SIX, shiftSeconds: 0.35, manual: false, brightness: 3800 });
const EXECUTIVE = profile("executive", "v8", 0.97, 0.85, { idleRpm: 650, redlineRpm: 5000, gearShares: AUTOMATIC_FOUR, shiftSeconds: 0.3, manual: false, brightness: 5000 });
const VAN = profile("van", "van", 1, 0.95, { idleRpm: 800, redlineRpm: 4200, gearShares: SIX_SPEED, shiftSeconds: 0.3, tyres: 1.1 });
const TRUCK = profile("truck", "truck", 1, 1.05, { idleRpm: 600, redlineRpm: 2600, gearShares: HEAVY_EIGHT, shiftSeconds: 0.45, airBrakes: true, tyres: 1.3 });
const BUS = profile("bus", "truck", 0.92, 1, { idleRpm: 600, redlineRpm: 2400, gearShares: BUS_SIX, shiftSeconds: 0.4, manual: false, airBrakes: true, tyres: 1.3 });

export const VEHICLE_AUDIO: Readonly<Record<VehicleStyle, VehicleAudioProfile>> = {
	sedan: EVERYDAY,
	taxi: EVERYDAY,
	hatchback: profile("compact", "car", 1.07, 0.9),
	suv: profile("suv", "car", 0.9, 1.05, { tyres: 1.1 }),
	militaryWagon: profile("suv", "car", 0.84, 1.1, { tyres: 1.2 }),
	executive: EXECUTIVE,
	// The premium saloon and SUV: a smooth, quiet engine (the everyday car's continuous recording,
	// lower and softer) through an automatic, not a V8's layers or a race engine pitched down.
	flagship: LUXURY_SALOON,
	police: profile("police", "v8", 1, 1.05, { idleRpm: 650, redlineRpm: 5000, gearShares: AUTOMATIC_FOUR, shiftSeconds: 0.25, manual: false, siren: "wail", brightness: 5000 }),
	luxury: SPORTS,
	roadster: SPORTS,
	grandTourer: profile("sports", "v8", 1.04, 1, { idleRpm: 700, redlineRpm: 6400, gearShares: SIX_SPEED, shiftSeconds: 0.18, manual: false, tyres: 1.15, brightness: 5500 }),
	grandSuv: profile("luxury", "car", 0.8, 0.75, { idleRpm: 650, redlineRpm: 5500, gearShares: AUTOMATIC_SIX, shiftSeconds: 0.35, manual: false, tyres: 1.1, brightness: 3800 }),
	// Electric: no engine recording to play (and no recording of a motor's whine yet, see the
	// manifest). It's heard by its tyres and the wind, as an electric car is.
	hypercar: profile("electric", null, 1, 1, { gearShares: [1.05], shiftSeconds: 0, manual: false, tyres: 1.2 }),
	auto: profile("threeWheeler", "ape", 1, 0.85, { idleRpm: 1800, redlineRpm: 6000, gearShares: [0.25, 0.45, 0.7, 1.05], shiftSeconds: 0.2, tyres: 0.6 }),
	van: VAN,
	serviceTruck: VAN,
	ambulance: profile("ambulance", "van", 1, 0.95, { idleRpm: 800, redlineRpm: 4200, gearShares: SIX_SPEED, shiftSeconds: 0.3, manual: false, siren: "hilo", tyres: 1.1 }),
	truck: TRUCK,
	towTruck: TRUCK,
	garbageTruck: profile("truck", "truck", 0.94, 1.05, { idleRpm: 600, redlineRpm: 2400, gearShares: BUS_SIX, shiftSeconds: 0.45, manual: false, airBrakes: true, tyres: 1.3 }),
	bus: BUS,
	schoolBus: BUS,
	fireTruck: profile("fireTruck", "truck", 0.96, 1.1, { idleRpm: 600, redlineRpm: 2600, gearShares: BUS_SIX, shiftSeconds: 0.45, manual: false, airBrakes: true, siren: "fire", tyres: 1.3 }),
};

const gearboxes = new Map<VehicleStyle, Gearbox>();

/** The audio gearbox of a vehicle: its profile's gears against its own top speed. */
export function gearboxFor(style: VehicleStyle): Gearbox {
	let gearbox = gearboxes.get(style);
	if (!gearbox) {
		const audio = VEHICLE_AUDIO[style];
		const top = carSpecFor(style, 4, 2).topSpeed;
		gearbox = { idleRpm: audio.idleRpm, redlineRpm: audio.redlineRpm, gearTops: audio.gearShares.map((share) => share * top) };
		gearboxes.set(style, gearbox);
	}
	return gearbox;
}
