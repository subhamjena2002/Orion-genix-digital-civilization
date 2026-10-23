import { audioBus, type Placement } from "./AudioBus";
import { LoopVoice } from "./SoundBank";
import { drivableCars } from "../traffic/Carjack";
import type { OrionVehicle } from "../traffic/OrionVehicle";
import { readWanted } from "../police/Wanted";

/**
 * The siren of the nearest patrol car on a chase, or ambulance or fire engine with its beacons
 * going (driven by the player, out on a call, or turned on by a mission).
 *
 * A wail: a recorded siren (a generic electronic wail, no force's own tones), looped over whole
 * sweeps so the repeat isn't heard. Until it has loaded, a synthesised wail stands in: one tone
 * swept up and down by a slow second oscillator on the audio thread.
 *
 * One voice is plenty: several sirens at once turn into noise, and the nearest one is the one
 * that tells the player where the danger is.
 */

/** Centre of the sweep and how far either side of it it goes (Hz). */
const WAIL_CENTRE = 1050;
const WAIL_DEPTH = 430;
/** One full sweep up and down, in seconds. */
const WAIL_PERIOD = 3.2;
const LEVEL = 0.32;
/** Heard up to this far away. */
const RANGE = 300;
const SMOOTHING = 0.08;

interface SirenVoice {
	tone: OscillatorNode;
	sweep: OscillatorNode;
	filter: BiquadFilterNode;
	gain: GainNode;
	panner: StereoPannerNode;
}

/** The recording's level against the synthesised wail's. */
const RECORDED_LEVEL = 1.6;

class PoliceSirens {
	private voice: SirenVoice | null = null;
	private readonly recorded = new LoopVoice("siren-wail", SMOOTHING, "vehicles");
	private readonly place: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };

	/** Once a frame, after the listener has moved. */
	public update(): void {
		const bus = audioBus();
		const context = bus.ensure();
		const master = bus.channel("vehicles");
		if (!context || !master) return;

		let nearest: OrionVehicle | null = null;
		let nearestDistance = RANGE;
		const stars = readWanted().stars;
		for (const car of drivableCars()) {
			// Only units on the chase (a wreck, or one called off and heading back, is silent), and
			// emergency vehicles with their lights on.
			const sounding = (car.chasing && stars > 0) || (car.emergency && car.lightsFlashing);
			if (!sounding) continue;
			const position = car.entity.getPosition();
			const placed = bus.place(position.x, position.y, position.z, this.place);
			if (placed.distance < nearestDistance) {
				nearestDistance = placed.distance;
				nearest = car;
			}
		}

		const now = context.currentTime;
		if (!nearest) {
			if (this.voice) this.voice.gain.gain.setTargetAtTime(0.0001, now, SMOOTHING * 3);
			this.recorded.set(0, this.place);
			return;
		}
		const position = nearest.entity.getPosition();
		const placed = bus.place(position.x, position.y, position.z, this.place);
		if (this.recorded.ready) {
			this.recorded.set(LEVEL * RECORDED_LEVEL, placed, 1, 9000);
			if (this.voice) this.voice.gain.gain.setTargetAtTime(0.0001, now, SMOOTHING);
			return;
		}
		const voice = (this.voice ??= this.createVoice(context, master));
		voice.gain.gain.setTargetAtTime(Math.max(0.0001, LEVEL * placed.gain), now, SMOOTHING);
		voice.panner.pan.setTargetAtTime(placed.pan, now, SMOOTHING);
		voice.filter.frequency.setTargetAtTime(Math.min(placed.muffle, 5000), now, SMOOTHING);
	}

	/** Stops the sound for good. */
	public dispose(): void {
		this.recorded.stop();
		const voice = this.voice;
		this.voice = null;
		if (!voice) return;
		voice.tone.stop();
		voice.sweep.stop();
		voice.panner.disconnect();
	}

	private createVoice(context: AudioContext, master: GainNode): SirenVoice {
		const tone = context.createOscillator();
		// A square wave filtered down: the hard, horn-like edge of a real siren speaker.
		tone.type = "square";
		tone.frequency.value = WAIL_CENTRE;
		const sweep = context.createOscillator();
		sweep.type = "triangle";
		sweep.frequency.value = 1 / WAIL_PERIOD;
		const depth = context.createGain();
		depth.gain.value = WAIL_DEPTH;
		sweep.connect(depth).connect(tone.frequency);

		const filter = context.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = 5000;
		filter.Q.value = 0.8;
		const gain = context.createGain();
		gain.gain.value = 0.0001;
		const panner = context.createStereoPanner();
		tone.connect(filter).connect(gain).connect(panner).connect(master);
		tone.start();
		sweep.start();
		return { tone, sweep, filter, gain, panner };
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
