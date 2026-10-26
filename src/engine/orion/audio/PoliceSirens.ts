import { audioBus, type Placement } from "./AudioBus";
import { LoopVoice } from "./SoundBank";
import { VEHICLE_AUDIO, type SirenKind } from "./VehicleAudioProfiles";
import { drivableCars } from "../traffic/Carjack";
import type { OrionVehicle } from "../traffic/OrionVehicle";
import { readWanted } from "../police/Wanted";

/**
 * The siren of the nearest patrol car on a chase, or ambulance or fire engine with its beacons
 * going (driven by the player, out on a call, or turned on by a mission).
 *
 * Recorded sirens (generic electronic tones, no force's own), looped over whole sweeps so the
 * repeat isn't heard: a police car wails, an ambulance plays the hi-lo, and a fire engine the
 * wail pitched down a little (a stand-in until there's a mechanical siren recording; see
 * docs/audio/vehicle-sound-manifest.md). The siren carries the same physical Doppler shift as
 * the engines, so it drops as the vehicle passes; it plays into the player's "Sirens" level.
 *
 * One siren at a time: several at once turn into noise, and the nearest one is the one that
 * tells the player where the danger is. When the nearest changes kind, one fades out as the
 * other fades in.
 */

const LEVEL = 0.42;
/** Heard up to this far away, fading out over the last stretch rather than cut at the edge. */
const RANGE = 220;
const FADE_FROM = 120;
/**
 * An ambulance or fire engine sounds its siren only while it's on the move (and for a few
 * seconds after stopping, through a junction): parked at a scene, a crew leaves the beacons on
 * and the siren off. It used to wail for as long as the beacons flashed, which at a call meant
 * for good, from anywhere within 300 m: a siren the player could never get away from.
 */
const MOVING_SPEED = 2;
const SIREN_HOLD = 4;
const SMOOTHING = 0.08;
/** The fire engine's wail against the police car's. */
const FIRE_RATE = 0.86;
/**
 * A siren is a horn speaker: its top end stops at this (Hz) however close. Its fundamental is
 * under 2 kHz; above about 6 kHz is only the harsh edge that makes a siren grate.
 */
const CEILING = 6000;

class PoliceSirens {
	private readonly voices: Record<SirenKind, LoopVoice> = {
		wail: new LoopVoice("siren-wail", SMOOTHING, "sirens"),
		hilo: new LoopVoice("siren-hilo", SMOOTHING, "sirens"),
		fire: new LoopVoice("siren-wail", SMOOTHING, "sirens"),
	};
	private readonly place: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };
	/** When each emergency vehicle was last moving (audio-clock seconds). */
	private readonly lastMoving = new WeakMap<OrionVehicle, number>();

	/** Whether an emergency vehicle with its beacons on should have its siren going. */
	private emergencySiren(car: OrionVehicle, now: number): boolean {
		// The player's own ambulance or fire engine: beacons, but no siren the player didn't ask for.
		if (car.driver === "player" || !car.emergency || !car.lightsFlashing) return false;
		if (Math.abs(car.currentSpeed) > MOVING_SPEED) this.lastMoving.set(car, now);
		return now - (this.lastMoving.get(car) ?? -Infinity) < SIREN_HOLD;
	}

	/** Once a frame, after the listener has moved. */
	public update(): void {
		const bus = audioBus();
		const context = bus.ensure();
		if (!context) return;
		const now = context.currentTime;

		let nearest: OrionVehicle | null = null;
		let nearestDistance = RANGE;
		const stars = readWanted().stars;
		for (const car of drivableCars()) {
			// Only units on the chase (a wreck, or one called off and heading back, is silent), and
			// emergency vehicles with their lights on.
			const sounding = (car.chasing && stars > 0) || this.emergencySiren(car, now);
			if (!sounding) continue;
			const position = car.entity.getPosition();
			const placed = bus.place(position.x, position.y, position.z, this.place);
			if (placed.distance < nearestDistance) {
				nearestDistance = placed.distance;
				nearest = car;
			}
		}

		const kind: SirenKind | null = nearest ? VEHICLE_AUDIO[nearest.style].siren ?? "wail" : null;
		let doppler = 1;
		if (nearest) {
			const position = nearest.entity.getPosition();
			bus.place(position.x, position.y, position.z, this.place);
			if (nearest.driver !== "player") doppler = bus.doppler(position.x, position.y, position.z, nearest.velocityX, nearest.velocityZ);
		}
		const fade = nearest ? 1 - Math.max(0, Math.min(1, (this.place.distance - FADE_FROM) / (RANGE - FADE_FROM))) : 0;
		for (const key of Object.keys(this.voices) as SirenKind[]) {
			const rate = (key === "fire" ? FIRE_RATE : 1) * doppler;
			this.voices[key].set(key === kind ? LEVEL * fade * fade : 0, this.place, rate, CEILING);
		}
	}

	/** Stops the sound for good. */
	public dispose(): void {
		for (const voice of Object.values(this.voices)) voice.stop();
	}
}

let sirens: PoliceSirens | null = null;

/**
 * The live instance, kept where a reloaded copy of this module can find it. A hot reload in
 * development starts the module over with no sirens; the old voice stayed wired to the speakers
 * at whatever level it last had, wailing on with no one left to turn it down or off.
 */
const holder = globalThis as { __orionPoliceSirens?: PoliceSirens };
holder.__orionPoliceSirens?.dispose();
holder.__orionPoliceSirens = undefined;

export function policeSirens(): PoliceSirens {
	sirens ??= holder.__orionPoliceSirens = new PoliceSirens();
	return sirens;
}
