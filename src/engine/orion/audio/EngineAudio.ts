import { audioBus, AUDIBLE_DISTANCE, type Placement } from "./AudioBus";
import { ENGINE_GRAIN_PROCESSOR, loadEngineGrainWorklet, setEngineFamily, type EngineRamp } from "./EngineGrainWorklet";
import { engineHarmonicTable, engineState, ENGINE_VOICES, firingFrequency } from "./EngineVoices";
import { ENGINE_PROCESSOR_NAME, loadEngineWorklet } from "./EngineWorklet";
import { LoopVoice, preloadSounds, takeOf } from "./SoundBank";
import { ENGINE_RAMPS } from "./SoundManifest";
import type { VehicleStyle } from "../traffic/Vehicles";
import { drivableCars } from "../traffic/Carjack";
import type { OrionVehicle } from "../traffic/OrionVehicle";

/**
 * Engine sound for the traffic, mixed from a small pool of synthesised voices.
 *
 * A city's worth of cars can't each own an oscillator, so only the nearest few are heard — the
 * ones further off are inaudible under the ones in front of you anyway. Voices are handed
 * between cars as they come and go, fading rather than cutting so the swap isn't a click.
 *
 * Each voice plays a recorded engine: a studio recording of a real engine revving, scrubbed
 * granularly to the car's revs (EngineGrainWorklet) and blended between on-throttle and overrun
 * by load. Until the recordings have loaded, or where AudioWorklet isn't available, it falls back
 * to the synthesised engine: a pulse-by-pulse source (EngineWorklet) with induction noise and an
 * optional turbo, or as a last resort one oscillator carrying the harmonic stack.
 */

/**
 * Which recorded engine each kind of vehicle uses, and how far it's pitched from the recording:
 * a van is the lorry's diesel a little higher, a wagon the saloon's engine a little lower.
 */
const RECORDED_ENGINE: Readonly<Record<VehicleStyle, { family: string; shift: number; level: number }>> = {
	sedan: { family: "car", shift: 1, level: 1 },
	taxi: { family: "car", shift: 1, level: 1 },
	police: { family: "car", shift: 0.94, level: 1.1 },
	hatchback: { family: "car", shift: 1.08, level: 0.95 },
	suv: { family: "car", shift: 0.86, level: 1.05 },
	militaryWagon: { family: "car", shift: 0.8, level: 1.1 },
	auto: { family: "car", shift: 1.45, level: 0.8 },
	luxury: { family: "sport", shift: 1, level: 1.15 },
	van: { family: "diesel", shift: 1.35, level: 0.85 },
	ambulance: { family: "diesel", shift: 1.3, level: 0.9 },
	serviceTruck: { family: "diesel", shift: 1.25, level: 0.9 },
	towTruck: { family: "truck", shift: 1.08, level: 1 },
	truck: { family: "truck", shift: 1, level: 1.05 },
	bus: { family: "truck", shift: 0.95, level: 1 },
	schoolBus: { family: "truck", shift: 1.02, level: 1 },
	garbageTruck: { family: "truck", shift: 0.92, level: 1.05 },
	fireTruck: { family: "truck", shift: 0.97, level: 1.1 },
};
/** Rear slide (see OrionVehicle.rearSlide) below which the tyres are only scrubbing, not squealing. */
const SKID_FROM = 0.1;
/** Rear slide above SKID_FROM at which the squeal is full. */
const SKID_SPAN = 0.45;
const SKID_LEVEL = 0.7;
/**
 * Seconds for the squeal to build and to die away. The slide itself switches on and off in a
 * frame (the tyre is either past its grip or not); a squeal that followed it cut in and out like
 * a switch. Real rubber takes a moment to start singing and keeps going a moment after.
 */
const SKID_ATTACK = 0.09;
const SKID_RELEASE = 0.28;
/**
 * Hard braking in a straight line: the tyres scrub on the edge of grip (deceleration, m/s²,
 * from where it starts to where it's at its loudest), well under a slide's squeal.
 */
const SCRUB_FROM = 8;
const SCRUB_FULL = 12;
const SCRUB_LEVEL = 0.32;
/** Recorded engines against the synthesised ones' level scale. */
const GRAIN_LEVEL = 1.5;
/** Top of the low-pass (Hz) with the throttle shut and wide open: an engine opens up under load. */
const GRAIN_DARK = 2600;
const GRAIN_OPEN = 16000;

/** How many engines are audible at once, the player's own car included. */
const MAX_VOICES = 6;
/** Seconds to fade a voice in or out when it changes car. */
const SWAP_SECONDS = 0.12;
/** Smoothing time constants: pitch tracks quickly, level and tone more slowly. */
/** Pitch follows the revs closely, but not so closely that tiny speed changes make it warble. */
// Lifting off or braking flips the throttle from full to none in one frame (keys aren't
// analogue); the engine's note, level and brightness follow over a beat instead of snapping.
const PITCH_SMOOTHING = 0.08;
const TONE_SMOOTHING = 0.15;
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
	/** The synthesised engine's level: shut once the recorded one is playing. */
	synth: GainNode;
	/** The recorded engine, scrubbed by revs; null where AudioWorklet isn't available. */
	grain: AudioWorkletNode | null;
	grainTone: BiquadFilterNode;
	grainGain: GainNode;
	/** The recorded engine family this voice is set to, once its recordings have loaded. */
	family: string | null;
	/** Tyres screeching when the car slides. */
	skid: LoopVoice;
	/** Where the skid is heard from: the car, or the cabin for the player's own. */
	skidPlace: Placement;
	/** The squeal as it's heard, 0..1, eased towards how hard the tyres are working. */
	skidAmount: number;
	/** Speed last frame (m/s), for the deceleration; NaN until the voice has a car to measure. */
	lastSpeed: number;
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
	/** Whether the granular player loaded; null until settled. */
	private grains: boolean | null = null;
	private preloaded = false;
	/** Each family's ramps, once their recordings have been decoded. */
	private readonly ramps = new Map<string, EngineRamp[]>();
	/** This frame's time step (s). */
	private dt = 0;

	/** Called once a frame, after the listener has been moved. */
	public update(dt: number): void {
		this.dt = dt;
		const bus = audioBus();
		bus.tick(dt);
		const context = bus.ensure();
		const master = bus.channel("vehicles");
		if (!context || !master) return;
		if (!this.preloaded) {
			this.preloaded = true;
			preloadSounds(context);
		}
		if (this.worklet === null || this.grains === null) {
			// Voices wait for both sources, so none are built on the fallback by mistake.
			if (!this.loadingWorklet) {
				this.loadingWorklet = true;
				void loadEngineWorklet(context).then((loaded) => {
					this.worklet = loaded;
				});
				void loadEngineGrainWorklet(context).then((loaded) => {
					this.grains = loaded;
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
		voice.skidAmount = 0;
		voice.lastSpeed = Number.NaN;
		if (voice.style !== style) {
			voice.style = style;
			this.voiceSource(context, voice.source, style);
			voice.family = null;
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
			voice.skidAmount = 0;
			voice.lastSpeed = Number.NaN;
			voice.skid.set(0, voice.skidPlace);
			return;
		}
		const voicing = ENGINE_VOICES[car.style] ?? ENGINE_VOICES.sedan;
		const position = car.entity.getPosition();
		const placed = audioBus().place(position.x, position.y, position.z, this.place);
		const state = engineState(voicing, car.currentSpeed, car.throttle, voice.gear);
		voice.gear = state.gear;

		const own = car.driver === "player";
		const recorded = this.driveGrain(voice, car.style, state, voicing, placed, own, playerDriving, now);
		this.driveSkid(voice, car, placed, own, playerDriving);
		// The synthesised engine stands in only until the recorded one is playing.
		voice.synth.gain.setTargetAtTime(recorded ? 0 : 1, now, SWAP_SECONDS);
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
		voice.noiseGain.gain.setTargetAtTime(recorded ? 0.0001 : voicing.noiseLevel * INDUCTION_LEVEL * (0.45 + state.load * 0.55), now, TONE_SMOOTHING);

		const boost = Math.max(0, revs - 0.25) * state.load;
		if (voicing.turboHz > 0) voice.turbo.frequency.setTargetAtTime(voicing.turboHz * (0.6 + revs * 0.4), now, TONE_SMOOTHING);
		voice.turboGain.gain.setTargetAtTime(voicing.turboHz > 0 && !recorded ? Math.max(0.0001, boost * 0.35) : 0.0001, now, TONE_SMOOTHING);

		// Its own car is heard from inside it, so distance doesn't apply; everything else ducks.
		const distanceGain = own ? OWN_CAR_GAIN : placed.gain * (playerDriving ? CABIN_DUCK : 1);
		const idle = own ? 0.5 : TRAFFIC_IDLE_SHARE;
		const level = voicing.level * distanceGain * (idle + state.load * (1 - idle)) * damageRattle(car);
		voice.output.gain.setTargetAtTime(Math.max(0.0001, level), now, SWAP_SECONDS);
		voice.panner.pan.setTargetAtTime(own ? 0 : placed.pan, now, TONE_SMOOTHING);
	}

	/**
	 * Steers the recorded engine for this voice's car. Returns false (leaving the synthesised one
	 * playing) until that engine's recordings have loaded.
	 */
	private driveGrain(
		voice: Voice,
		style: VehicleStyle,
		state: { rpm: number; load: number },
		voicing: { idleRpm: number; redlineRpm: number },
		placed: Placement,
		own: boolean,
		playerDriving: boolean,
		now: number,
	): boolean {
		const grain = voice.grain;
		const recording = RECORDED_ENGINE[style] ?? RECORDED_ENGINE.sedan;
		if (!grain) return false;
		if (voice.family !== recording.family) {
			if (!setEngineFamily(grain, recording.family, () => this.rampsFor(recording.family))) return false;
			voice.family = recording.family;
		}
		const ramps = this.ramps.get(recording.family);
		if (!ramps) return false;
		const pitch = ramps[0].pitch;
		const low = pitch[0];
		const high = pitch[pitch.length - 1];
		const revs = Math.max(0, Math.min(1, (state.rpm - voicing.idleRpm) / Math.max(1, voicing.redlineRpm - voicing.idleRpm)));
		const load = Math.max(0, Math.min(1, (state.load - 0.15) / 0.6));
		grain.parameters.get("hz")?.setTargetAtTime(low + (high - low) * revs, now, PITCH_SMOOTHING);
		grain.parameters.get("load")?.setTargetAtTime(load, now, TONE_SMOOTHING);
		grain.parameters.get("shift")?.setTargetAtTime(recording.shift, now, TONE_SMOOTHING);
		const open = GRAIN_DARK + (GRAIN_OPEN - GRAIN_DARK) * (0.25 + 0.75 * load) * (0.6 + 0.4 * revs);
		const ceiling = playerDriving && !own ? Math.min(placed.muffle, CABIN_MUFFLE) : placed.muffle;
		voice.grainTone.frequency.setTargetAtTime(Math.min(open, own ? 20000 : ceiling), now, TONE_SMOOTHING);
		voice.grainGain.gain.setTargetAtTime(GRAIN_LEVEL * recording.level * (0.65 + 0.35 * load), now, TONE_SMOOTHING);
		return true;
	}

	/**
	 * Tyre squeal from how hard the car's rear is sliding, and a lighter scrub under hard braking;
	 * eased in and out, and growing gently from a slip into a full slide.
	 */
	private driveSkid(voice: Voice, car: OrionVehicle, placed: Placement, own: boolean, playerDriving: boolean) {
		const dt = this.dt;
		const speed = Math.abs(car.currentSpeed);
		const decel = dt > 0 && Number.isFinite(voice.lastSpeed) ? (voice.lastSpeed - speed) / dt : 0;
		voice.lastSpeed = speed;
		const slide = smoothstep((car.rearSlide - SKID_FROM) / SKID_SPAN) * Math.min(1, speed / 6);
		const scrub = SCRUB_LEVEL * smoothstep((decel - SCRUB_FROM) / (SCRUB_FULL - SCRUB_FROM)) * smoothstep((speed - 2) / 10);
		const target = Math.max(slide, scrub);
		const time = target > voice.skidAmount ? SKID_ATTACK : SKID_RELEASE;
		voice.skidAmount += (target - voice.skidAmount) * (dt > 0 ? 1 - Math.exp(-dt / time) : 0);
		const amount = voice.skidAmount;
		const place = voice.skidPlace;
		place.gain = own ? 0.9 : placed.gain * (playerDriving ? CABIN_DUCK : 1);
		place.pan = own ? 0 : placed.pan;
		place.muffle = own ? 14000 : playerDriving ? Math.min(placed.muffle, CABIN_MUFFLE) : placed.muffle;
		place.distance = placed.distance;
		// Squared: a light slip whispers, only a real slide screams. The pitch rises a touch with
		// speed and with how hard it's sliding, as a tyre's does.
		voice.skid.set(SKID_LEVEL * amount * amount, place, 0.9 + 0.14 * Math.min(1, speed / 30) + 0.06 * amount, 15000);
	}

	/** A family's ramps from its decoded recordings and the manifest's pitch maps; null until loaded. */
	private rampsFor(family: string): EngineRamp[] | null {
		const cached = this.ramps.get(family);
		if (cached) return cached;
		const maps = ENGINE_RAMPS[family];
		if (!maps) return null;
		const ramps: EngineRamp[] = [];
		for (const map of maps) {
			const buffer = takeOf(map.sound);
			if (!buffer) return null;
			const rate = buffer.sampleRate;
			ramps.push({
				samples: buffer.getChannelData(0),
				pitch: Float32Array.from(map.pitch),
				position: Float32Array.from(map.time, (t) => t * rate),
			});
		}
		this.ramps.set(family, ramps);
		return ramps;
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
		const synth = context.createGain();
		source.connect(synth).connect(tone);
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

		// The recorded engine: its own brightness control, straight to the output (the recording
		// already has the exhaust body that the synthesised engine needs the peak filter for).
		const grain = this.grains
			? new AudioWorkletNode(context, ENGINE_GRAIN_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] })
			: null;
		const grainTone = context.createBiquadFilter();
		grainTone.type = "lowpass";
		grainTone.frequency.value = 8000;
		grainTone.Q.value = 0.5;
		const grainGain = context.createGain();
		grainGain.gain.value = 0;
		grain?.connect(grainTone).connect(grainGain).connect(output);

		return {
			car: null, style: "sedan", gear: 0, family: null,
			skid: new LoopVoice("skid", 0.04, "vehicles"), skidPlace: { gain: 0, pan: 0, muffle: 20000, distance: 0 },
			skidAmount: 0, lastSpeed: Number.NaN,
			source, synth, grain, grainTone, grainGain, tone, body,
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

/** 0 below 0, 1 above 1, and an S-curve between: no corner to hear where a sound starts or stops. */
function smoothstep(x: number): number {
	const t = Math.max(0, Math.min(1, x));
	return t * t * (3 - 2 * t);
}
