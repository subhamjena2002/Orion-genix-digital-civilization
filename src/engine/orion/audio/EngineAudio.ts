import { audioBus, AUDIBLE_DISTANCE, type Placement } from "./AudioBus";
import { engineHarmonicTable, engineState, ENGINE_VOICES, firingFrequency } from "./EngineVoices";
import { ENGINE_PROCESSOR_NAME, loadEngineWorklet } from "./EngineWorklet";
import { drivableCars } from "../traffic/Carjack";
import type { OrionVehicle } from "../traffic/OrionVehicle";

/**
 * Engine sound for the traffic, mixed from a small pool of synthesised voices.
 *
 * A city's worth of cars can't each own an oscillator, so only the nearest few are heard — the
 * ones further off are inaudible under the ones in front of you anyway. Voices are handed
 * between cars as they come and go, fading rather than cutting so the swap isn't a click.
 *
 * Each voice is a pulse-by-pulse engine source running on the audio thread (EngineWorklet), a
 * noise source for induction, and an optional turbo. Where AudioWorklet isn't available (an
 * http:// page on a local network, or an old browser) the source falls back to one oscillator
 * carrying the harmonic stack. See EngineVoices for each engine's character.
 */

/** How many engines are audible at once, the player's own car included. */
const MAX_VOICES = 6;
/** Seconds to fade a voice in or out when it changes car. */
const SWAP_SECONDS = 0.12;
/** Smoothing time constants: pitch tracks quickly, level and tone more slowly. */
/** Pitch follows the revs closely, but not so closely that tiny speed changes make it warble. */
const PITCH_SMOOTHING = 0.05;
const TONE_SMOOTHING = 0.06;
/**
 * Sitting in a car, you hear that car — everything else is outside a closed cabin.
 *
 * The first cut got this wrong: the player's car was given a flat 0.85 while a lorry five metres
 * away kept its full distance gain of 0.78, so its bigger engine simply drowned the player's out.
 * Now the car you are in is at full level and everything else is ducked and muffled behind glass,
 * which is both what it should sound like and what the mix needs.
 */
const OWN_CAR_GAIN = 1.25;
/** What other traffic drops to while the player is inside a car. */
const CABIN_DUCK = 0.32;
/** And how far its top end is rolled off (Hz) — glass and steel take the treble out. */
const CABIN_MUFFLE = 1400;
/** Road and wind noise in the player's own car, at this road speed and above. */
const ROAD_NOISE_FULL_SPEED = 30;
const ROAD_NOISE_LEVEL = 0.12;
/** Other traffic idles quietly: a street of idling cars was a constant drone under everything. */
const TRAFFIC_IDLE_SHARE = 0.35;
/** Steady induction hiss under the pulses, relative to each engine's noise level. */
const INDUCTION_LEVEL = 0.4;

interface Voice {
	car: OrionVehicle | null;
	style: string;
	gear: number;
	/** The engine source: the pulse worklet, or the fallback oscillator. */
	source: AudioWorkletNode | OscillatorNode;
	tone: BiquadFilterNode;
	/** The exhaust's own resonance, so the engine has a body rather than being a bare stack. */
	body: BiquadFilterNode;
	noise: AudioBufferSourceNode;
	noiseBand: BiquadFilterNode;
	noiseGain: GainNode;
	/** Turbo whistle: air through a narrow band, not a pure tone (which was piercing). */
	turbo: BiquadFilterNode;
	turboGain: GainNode;
	output: GainNode;
	panner: StereoPannerNode;
}

class EngineAudio {
	private voices: Voice[] = [];
	private readonly waves = new Map<string, PeriodicWave>();
	private readonly place: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };
	private roadNoise: { source: AudioBufferSourceNode; band: BiquadFilterNode; gain: GainNode } | null = null;
	/** Whether the pulse source loaded; null until it has settled either way. */
	private worklet: boolean | null = null;
	private loadingWorklet = false;

	/** Called once a frame, after the listener has been moved. */
	public update(dt: number): void {
		const bus = audioBus();
		bus.tick(dt);
		const context = bus.ensure();
		const master = bus.master;
		if (!context || !master) return;
		if (this.worklet === null) {
			// Voices wait for the pulse source, so none are built on the fallback by mistake.
			if (!this.loadingWorklet) {
				this.loadingWorklet = true;
				void loadEngineWorklet(context).then((loaded) => {
					this.worklet = loaded;
				});
			}
			return;
		}

		const wanted = this.chooseCars();
		this.assignVoices(context, master, wanted);
		const own = wanted.find((car) => car.driver === "player") ?? null;
		for (const voice of this.voices) this.driveVoice(context, voice, own !== null);
		this.updateRoadNoise(context, master, own);
	}

	/** The nearest cars worth hearing, player's own first. */
	private chooseCars(): OrionVehicle[] {
		const scored: { car: OrionVehicle; distance: number }[] = [];
		for (const car of drivableCars()) {
			// A burnt-out shell has no engine left to run.
			if (car.burnedOut || !car.entity.enabled) continue;
			const position = car.entity.getPosition();
			const placed = audioBus().place(position.x, position.y, position.z, this.place);
			if (placed.distance > AUDIBLE_DISTANCE) continue;
			// The car the player is sitting in is always the one they should hear most.
			scored.push({ car, distance: car.driver === "player" ? -1 : placed.distance });
		}
		scored.sort((a, b) => a.distance - b.distance);
		return scored.slice(0, MAX_VOICES).map((entry) => entry.car);
	}

	private assignVoices(context: AudioContext, master: GainNode, wanted: readonly OrionVehicle[]) {
		while (this.voices.length < Math.min(MAX_VOICES, wanted.length)) {
			this.voices.push(this.createVoice(context, master));
		}
		const taken = new Set<OrionVehicle>();
		for (const voice of this.voices) {
			if (voice.car && wanted.includes(voice.car)) taken.add(voice.car);
			else voice.car = null;
		}
		const free = this.voices.filter((voice) => voice.car === null);
		for (const car of wanted) {
			if (taken.has(car)) continue;
			const voice = free.pop();
			if (!voice) break;
			this.retune(context, voice, car);
		}
	}

	/** Points a voice at a different car: new waveform, new gearbox, faded back in. */
	private retune(context: AudioContext, voice: Voice, car: OrionVehicle) {
		const style = car.style;
		voice.car = car;
		voice.gear = 0;
		if (voice.style !== style) {
			voice.style = style;
			this.voiceSource(context, voice.source, style);
		}
		const now = context.currentTime;
		voice.output.gain.cancelScheduledValues(now);
		voice.output.gain.setValueAtTime(0.0001, now);
	}

	private driveVoice(context: AudioContext, voice: Voice, playerDriving: boolean) {
		const car = voice.car;
		const now = context.currentTime;
		if (!car) {
			voice.output.gain.setTargetAtTime(0.0001, now, SWAP_SECONDS);
			return;
		}
		const voicing = ENGINE_VOICES[car.style] ?? ENGINE_VOICES.sedan;
		const position = car.entity.getPosition();
		const placed = audioBus().place(position.x, position.y, position.z, this.place);
		const state = engineState(voicing, car.currentSpeed, car.throttle, voice.gear);
		voice.gear = state.gear;

		const own = car.driver === "player";
		const firing = firingFrequency(voicing, state.rpm);
		if (voice.source instanceof OscillatorNode) {
			// Half the firing frequency: the waveform carries the firing orders on its even
			// harmonics and the half-orders on the odd ones (see engineHarmonicTable).
			voice.source.frequency.setTargetAtTime(Math.max(8, firing / 2), now, PITCH_SMOOTHING);
		} else {
			voice.source.parameters.get("firing")?.setTargetAtTime(firing, now, PITCH_SMOOTHING);
			voice.source.parameters.get("load")?.setTargetAtTime(state.load, now, TONE_SMOOTHING);
		}
		const revs = (state.rpm - voicing.idleRpm) / Math.max(1, voicing.redlineRpm - voicing.idleRpm);
		const open = voicing.brightness[0] + (voicing.brightness[1] - voicing.brightness[0]) * Math.max(revs, state.load * 0.6);
		// Other traffic is heard through the cabin when the player is in a car.
		const ceiling = playerDriving && !own ? Math.min(placed.muffle, CABIN_MUFFLE) : placed.muffle;
		voice.tone.frequency.setTargetAtTime(Math.min(open, ceiling), now, TONE_SMOOTHING);
		voice.body.frequency.setTargetAtTime(voicing.resonanceHz, now, TONE_SMOOTHING);

		voice.noiseBand.frequency.setTargetAtTime(voicing.noiseCentre * (0.8 + revs * 0.6), now, TONE_SMOOTHING);
		voice.noiseGain.gain.setTargetAtTime(voicing.noiseLevel * INDUCTION_LEVEL * (0.45 + state.load * 0.55), now, TONE_SMOOTHING);

		const boost = Math.max(0, revs - 0.25) * state.load;
		if (voicing.turboHz > 0) voice.turbo.frequency.setTargetAtTime(voicing.turboHz * (0.6 + revs * 0.4), now, TONE_SMOOTHING);
		voice.turboGain.gain.setTargetAtTime(voicing.turboHz > 0 ? Math.max(0.0001, boost * 0.35) : 0.0001, now, TONE_SMOOTHING);

		// Its own car is heard from inside it, so distance doesn't apply; everything else ducks.
		const distanceGain = own ? OWN_CAR_GAIN : placed.gain * (playerDriving ? CABIN_DUCK : 1);
		const idle = own ? 0.5 : TRAFFIC_IDLE_SHARE;
		const level = voicing.level * distanceGain * (idle + state.load * (1 - idle)) * damageRattle(car);
		voice.output.gain.setTargetAtTime(Math.max(0.0001, level), now, SWAP_SECONDS);
		voice.panner.pan.setTargetAtTime(own ? 0 : placed.pan, now, TONE_SMOOTHING);
	}

	/** Tyre and wind noise, only for the car the player is sitting in. */
	private updateRoadNoise(context: AudioContext, master: GainNode, own: OrionVehicle | null) {
		if (!this.roadNoise) {
			const source = audioBus().startNoise(context);
			if (!source) return;
			const band = context.createBiquadFilter();
			band.type = "bandpass";
			// Tyre roar is low; the old band reached 1.8 kHz and was heard as hiss.
			band.frequency.value = 180;
			band.Q.value = 0.6;
			const gain = context.createGain();
			gain.gain.value = 0.0001;
			source.connect(band).connect(gain).connect(master);
			this.roadNoise = { source, band, gain };
		}
		const now = context.currentTime;
		const speed = own ? own.currentSpeed : 0;
		const fraction = Math.min(1, speed / ROAD_NOISE_FULL_SPEED);
		this.roadNoise.band.frequency.setTargetAtTime(140 + fraction * 380, now, TONE_SMOOTHING);
		this.roadNoise.gain.gain.setTargetAtTime(Math.max(0.0001, fraction * ROAD_NOISE_LEVEL), now, TONE_SMOOTHING);
	}

	private createVoice(context: AudioContext, master: GainNode): Voice {
		const output = context.createGain();
		output.gain.value = 0.0001;
		const panner = context.createStereoPanner();
		const tone = context.createBiquadFilter();
		tone.type = "lowpass";
		tone.frequency.value = 2000;
		tone.Q.value = 0.7;
		// A peak where the exhaust resonates, which is most of what gives an engine its chest.
		const body = context.createBiquadFilter();
		body.type = "peaking";
		body.frequency.value = 140;
		body.Q.value = 1.1;
		body.gain.value = 7;
		tone.connect(body).connect(output).connect(panner).connect(master);

		const source = this.worklet
			? new AudioWorkletNode(context, ENGINE_PROCESSOR_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] })
			: context.createOscillator();
		this.voiceSource(context, source, "sedan");
		source.connect(tone);
		if (source instanceof OscillatorNode) {
			source.frequency.value = 60;
			source.start();
		}

		const noiseBand = context.createBiquadFilter();
		noiseBand.type = "bandpass";
		noiseBand.frequency.value = 1500;
		noiseBand.Q.value = 0.7;
		const noiseGain = context.createGain();
		noiseGain.gain.value = 0.0001;
		const noise = audioBus().startNoise(context);
		noise?.connect(noiseBand).connect(noiseGain).connect(tone);

		// One turbo per voice, silent unless the car it's playing has one: the same noise through
		// a narrow band, which whistles like air rather than beeping like a tone generator.
		const turbo = context.createBiquadFilter();
		turbo.type = "bandpass";
		turbo.frequency.value = 3000;
		turbo.Q.value = 9;
		const turboGain = context.createGain();
		turboGain.gain.value = 0.0001;
		noise?.connect(turbo).connect(turboGain).connect(output);

		return {
			car: null, style: "sedan", gear: 0,
			source, tone, body,
			noise: noise as AudioBufferSourceNode, noiseBand, noiseGain,
			turbo, turboGain, output, panner,
		};
	}

	/** Sets a voice's source up for an engine style. */
	private voiceSource(context: AudioContext, source: AudioWorkletNode | OscillatorNode, style: string) {
		if (source instanceof OscillatorNode) {
			source.setPeriodicWave(this.waveFor(context, style));
			return;
		}
		const voicing = ENGINE_VOICES[style as keyof typeof ENGINE_VOICES] ?? ENGINE_VOICES.sedan;
		source.port.postMessage(voicing.pulse);
	}

	/** The harmonic stack of one engine, as a single waveform (the fallback source). Built once per style. */
	private waveFor(context: AudioContext, style: string): PeriodicWave {
		const cached = this.waves.get(style);
		if (cached) return cached;
		const voicing = ENGINE_VOICES[style as keyof typeof ENGINE_VOICES] ?? ENGINE_VOICES.sedan;
		const table = engineHarmonicTable(voicing);
		const wave = context.createPeriodicWave(new Float32Array(table.length), Float32Array.from(table));
		this.waves.set(style, wave);
		return wave;
	}
}

/** A damaged engine runs rough and loud; a healthy one doesn't. */
function damageRattle(car: OrionVehicle): number {
	if (car.integrity >= 60) return 1;
	const hurt = 1 - car.integrity / 60;
	return 1 + hurt * 0.25 * (0.6 + Math.random() * 0.4);
}

let engines: EngineAudio | null = null;

export function engineAudio(): EngineAudio {
	engines ??= new EngineAudio();
	return engines;
}
