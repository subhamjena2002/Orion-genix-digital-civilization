import { audioBus, type Placement } from "./AudioBus";
import { drivableCars } from "../traffic/Carjack";
import type { OrionVehicle } from "../traffic/OrionVehicle";
import { readWanted } from "../police/Wanted";

/**
 * The siren of the nearest patrol car on a chase.
 *
 * A wail: one tone sweeping up and down about every three seconds. It's built as an oscillator
 * whose pitch is swung by a slow second oscillator, entirely on the audio thread, so the sweep
 * is perfectly smooth whatever the frame rate. Synthesised, like every sound in the game; no
 * recording of any real force's siren.
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

class PoliceSirens {
	private voice: SirenVoice | null = null;
	private readonly place: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };

	/** Once a frame, after the listener has moved. */
	public update(): void {
		const bus = audioBus();
		const context = bus.ensure();
		const master = bus.master;
		if (!context || !master) return;

		let nearest: OrionVehicle | null = null;
		let nearestDistance = RANGE;
		const stars = readWanted().stars;
		for (const car of drivableCars()) {
			// Only units on the chase: a wreck, or one called off and heading back, is silent.
			if (!car.chasing || stars === 0) continue;
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
			return;
		}
		const voice = (this.voice ??= this.createVoice(context, master));
		const position = nearest.entity.getPosition();
		const placed = bus.place(position.x, position.y, position.z, this.place);
		voice.gain.gain.setTargetAtTime(Math.max(0.0001, LEVEL * placed.gain), now, SMOOTHING);
		voice.panner.pan.setTargetAtTime(placed.pan, now, SMOOTHING);
		voice.filter.frequency.setTargetAtTime(Math.min(placed.muffle, 5000), now, SMOOTHING);
	}

	/** Stops the sound for good. */
	public dispose(): void {
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
