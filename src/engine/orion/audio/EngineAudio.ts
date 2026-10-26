import { audioBus, AUDIBLE_DISTANCE, type Placement } from "./AudioBus";
import { ENGINE_GRAIN_PROCESSOR, loadEngineGrainWorklet, setEngineAwake, setEngineFamily, type EngineFamilyData, type EngineLoop, type EngineRamp } from "./EngineGrainWorklet";
import { engineState } from "./EngineVoices";
import { AT_LISTENER, LoopVoice, playAt, playOneShot, preloadSounds, takeOf } from "./SoundBank";
import { gearboxFor, VEHICLE_AUDIO, type VehicleAudioProfile } from "./VehicleAudioProfiles";
import { ENGINE_FAMILIES, type EngineLoopMap } from "./VehicleSoundManifest";
import { drivableCars } from "../traffic/Carjack";
import type { OrionVehicle } from "../traffic/OrionVehicle";

/**
 * The sound of the traffic: every vehicle's engine, tyres, gear changes, air brakes, start and
 * stop, mixed from a small pool of voices.
 *
 * A city's worth of cars can't each own a voice, so only the nearest few are heard (the player's
 * own car always, emergency vehicles ahead of the queue) — the ones further off are inaudible
 * under the ones in front of you anyway. Voices are handed between cars as they come and go,
 * fading rather than cutting, and a voice with no car is put to sleep on the audio thread.
 *
 * Each vehicle plays the recorded engine its profile names (VehicleAudioProfiles): a seamless
 * idle loop, handing over to a granular rev ramp or to RPM layers as the revs rise
 * (EngineGrainWorklet). Revs and gears are an audio model from road speed and pedal (see
 * EngineVoices) — the driving model has no engine speed. Its tyres roll (a recorded tyre-only
 * loop), squeal when the tyres are past their grip, and scrub under hard braking.
 *
 * Positions come from AudioBus: distance roll-off, pan, air absorption, and a physical Doppler
 * shift from the vehicle's and the listener's real velocities (capped, and smoothed on the audio
 * thread), so a car passing at speed drops a semitone as it goes by. Sitting in a car, the
 * player hears that car from inside and everything else through the cabin.
 *
 * Nothing here loads or decodes in the frame loop: the recordings are fetched once the game is
 * audible (SoundBank.preloadSounds) and each family is sent to the audio thread once.
 */

/** Rear or front slide (see OrionVehicle) below which the tyres are only scrubbing, not squealing. */
const SKID_FROM = 0.1;
/** Slide above SKID_FROM at which the squeal is full. */
const SKID_SPAN = 0.45;
const SKID_LEVEL = 0.7;
/**
 * Seconds for the squeal to build and to die away. The slide itself switches on and off in a
 * frame; real rubber takes a moment to start singing and keeps going a moment after.
 */
const SKID_ATTACK = 0.09;
const SKID_RELEASE = 0.28;
/** Hard braking in a straight line (deceleration, m/s²): the tyres scrub on the edge of grip. */
const SCRUB_FROM = 8;
const SCRUB_FULL = 12;
const SCRUB_LEVEL = 0.32;
/** The recorded engines' level in the mix. */
const ENGINE_LEVEL = 1.5;
/**
 * Bottom of the low-pass (Hz) with the throttle shut; it opens towards the profile's brightness
 * under load. (It used to open to 16 kHz: every close-miked rasp and valve tick came through.)
 */
const TONE_DARK = 1800;
/** Tyres rolling: full at this road speed (m/s), and how loud in the player's car and outside. */
const ROLL_FULL_SPEED = 30;
const ROLL_LEVEL_OWN = 0.3;
const ROLL_LEVEL = 0.55;

/** How many vehicles are audible at once, the player's own included. */
const MAX_VOICES = 6;
/** Emergency vehicles with their lights on count as this much nearer when choosing who's heard. */
const EMERGENCY_PRIORITY = 0.5;
/** Seconds to fade a voice in or out when it changes car. */
const SWAP_SECONDS = 0.12;
/** A voice with no car sleeps once it has faded out. */
const SLEEP_AFTER = 0.6;
/**
 * Pitch follows the revs, eased so small speed changes and on/off keys glide rather than twitch;
 * level and tone more slowly still.
 */
const PITCH_SMOOTHING = 0.14;
const TONE_SMOOTHING = 0.25;
/** The Doppler shift is eased over this long on the audio thread as well. */
const DOPPLER_SMOOTHING = 0.25;
/** The car the player sits in is heard from inside it, at this level. */
const OWN_CAR_GAIN = 1.0;
/** Share of the own car's full level it idles at: present, but a hum you can talk over. */
const OWN_IDLE_SHARE = 0.4;
/** What other traffic drops to, and how far its top end is rolled off (Hz), heard from a cabin. */
const CABIN_DUCK = 0.32;
const CABIN_MUFFLE = 1400;
/** Other traffic idles quietly: a street of idling cars was a constant drone under everything. */
const TRAFFIC_IDLE_SHARE = 0.35;
/** Starts, stops and air brakes are heard within this distance (m). */
const EVENT_RANGE = 70;
/** Seconds the start one-shot's tail overlaps the engine fading in (prepare-vehicle-sounds.py OVERLAP). */
const START_OVERLAP = 0.6;
/** Air brakes: armed above this speed (m/s), released below this one, no more often than this (s). */
const AIR_ARM_SPEED = 4;
const AIR_RELEASE_SPEED = 0.6;
const AIR_GAP = 8;
/** The drive eases to this share of the load during a gear change: a dip, not a drop-out. */
const SHIFT_LOAD = 0.45;

/** What's remembered about each vehicle between frames, whether or not it has a voice. */
interface CarSound {
	running: boolean;
	gear: number;
	/** Audio-clock time the current gear change ends. */
	shiftUntil: number;
	/** Audio-clock time the engine started, and how long its start one-shot holds the idle back. */
	startedAt: number;
	startHold: number;
	airArmed: boolean;
	lastAir: number;
}

interface Voice {
	car: OrionVehicle | null;
	/** The engine family the grain node is set to; null until set (or for an electric car). */
	family: string | null;
	grain: AudioWorkletNode | null;
	awake: boolean;
	/** Audio-clock time after which a voice with no car goes to sleep. */
	sleepAt: number;
	tone: BiquadFilterNode;
	output: GainNode;
	panner: StereoPannerNode;
	/** Tyres rolling, and tyres squealing. */
	roll: LoopVoice;
	rollPlace: Placement;
	skid: LoopVoice;
	skidPlace: Placement;
	/** The squeal as it's heard, 0..1, eased towards how hard the tyres are working. */
	skidAmount: number;
	/** Speed last frame (m/s), for the deceleration; NaN until the voice has a car to measure. */
	lastSpeed: number;
}

interface Candidate {
	car: OrionVehicle;
	score: number;
}

class EngineAudio {
	private voices: Voice[] = [];
	private readonly place: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };
	private readonly states = new WeakMap<OrionVehicle, CarSound>();
	/** Reused every frame: the vehicles worth hearing, best first. */
	private readonly candidates: Candidate[] = [];
	private candidateCount = 0;
	private readonly wanted: OrionVehicle[] = [];
	/** Whether the engine player loaded; null until it has settled either way. */
	private grains: boolean | null = null;
	private loadingWorklet = false;
	private preloaded = false;
	/** Each family's recordings, once decoded. */
	private readonly families = new Map<string, EngineFamilyData>();
	private dt = 0;
	private now = 0;

	/** Called once a frame, after the listener has been moved. */
	public update(dt: number): void {
		this.dt = dt;
		const bus = audioBus();
		bus.tick(dt);
		const context = bus.ensure();
		const master = bus.channel("engines");
		if (!context || !master) return;
		// Not while the loading screen is up: nothing is heard until it goes, and the recordings
		// would only compete with the files the game needs to start.
		if (!this.preloaded && bus.isAudible()) {
			this.preloaded = true;
			preloadSounds(context);
			if (process.env.NODE_ENV !== "production") (globalThis as Record<string, unknown>).__orionVehicleAudio = this;
		}
		if (this.grains === null) {
			if (!this.loadingWorklet) {
				this.loadingWorklet = true;
				void loadEngineGrainWorklet(context).then((loaded) => {
					this.grains = loaded;
				});
			}
			return;
		}
		this.now = context.currentTime;
		this.chooseCars();
		this.assignVoices(context, master);
		let playerDriving = false;
		for (const car of this.wanted) if (car.driver === "player") playerDriving = true;
		for (const voice of this.voices) this.driveVoice(voice, playerDriving);
	}

	/** The cars currently voiced, for checking the mix in development. */
	public get voiced(): readonly (OrionVehicle | null)[] {
		return this.voices.map((voice) => voice.car);
	}

	private stateOf(car: OrionVehicle): { state: CarSound; known: boolean } {
		const existing = this.states.get(car);
		if (existing) return { state: existing, known: true };
		const state: CarSound = { running: false, gear: 0, shiftUntil: 0, startedAt: -Infinity, startHold: 0, airArmed: false, lastAir: -Infinity };
		this.states.set(car, state);
		return { state, known: false };
	}

	/** The cars worth hearing, best first; plays starts and stops as engines go on and off. */
	private chooseCars() {
		this.candidateCount = 0;
		const bus = audioBus();
		for (const car of drivableCars()) {
			const position = car.entity.getPosition();
			const placed = bus.place(position.x, position.y, position.z, this.place);
			const running = car.engineRunning && car.entity.enabled;
			const { state, known } = this.stateOf(car);
			if (known && running !== state.running && placed.distance < EVENT_RANGE) this.engineSwitched(car, state, running, position.x, position.y, position.z);
			state.running = running;
			if (!running || placed.distance > AUDIBLE_DISTANCE) continue;
			let score = placed.distance;
			if (car.driver === "player") score = -1;
			else if (car.emergency && car.lightsFlashing) score *= EMERGENCY_PRIORITY;
			const slot = this.candidates[this.candidateCount] ?? (this.candidates[this.candidateCount] = { car, score });
			slot.car = car;
			slot.score = score;
			this.candidateCount++;
		}
		// Only the first few matter: a partial selection, no sort of the whole city.
		const wanted = this.wanted;
		wanted.length = 0;
		for (let pick = 0; pick < MAX_VOICES && pick < this.candidateCount; pick++) {
			let best = pick;
			for (let i = pick + 1; i < this.candidateCount; i++) if (this.candidates[i].score < this.candidates[best].score) best = i;
			const swap = this.candidates[pick];
			this.candidates[pick] = this.candidates[best];
			this.candidates[best] = swap;
			wanted.push(this.candidates[pick].car);
		}
	}

	/** An engine starting (someone got in) or being switched off (they got out). */
	private engineSwitched(car: OrionVehicle, state: CarSound, running: boolean, x: number, y: number, z: number) {
		const profile = VEHICLE_AUDIO[car.style];
		const family = profile.family ? ENGINE_FAMILIES[profile.family] : null;
		if (running) {
			state.startedAt = this.now;
			state.startHold = 0;
			state.gear = 0;
			if (family?.start && playAt(family.start.sound, x, y, z, { level: profile.level * 1.1, variation: 0.02, channel: "engines" })) {
				state.startHold = Math.max(0, family.start.seconds - START_OVERLAP);
			}
			return;
		}
		// Switched off, not stalled in a crash or burnt out: those have their own noise.
		if (car.driver === "parked" && family?.stop) playAt(family.stop.sound, x, y, z, { level: profile.level * 1.1, variation: 0.02, channel: "engines" });
	}

	private assignVoices(context: AudioContext, master: GainNode) {
		const wanted = this.wanted;
		while (this.voices.length < Math.min(MAX_VOICES, wanted.length)) this.voices.push(this.createVoice(context, master));
		for (const voice of this.voices) {
			if (voice.car && !wanted.includes(voice.car)) {
				voice.car = null;
				voice.sleepAt = this.now + SLEEP_AFTER;
			}
		}
		for (const car of wanted) {
			if (this.voices.some((voice) => voice.car === car)) continue;
			const free = this.voices.find((voice) => voice.car === null);
			if (!free) break;
			this.retune(free, car);
		}
	}

	/** Points a voice at a different car, faded back in from silence. */
	private retune(voice: Voice, car: OrionVehicle) {
		voice.car = car;
		voice.skidAmount = 0;
		voice.lastSpeed = Number.NaN;
		const family = VEHICLE_AUDIO[car.style].family;
		if (voice.family !== family) voice.family = null;
		const now = this.now;
		voice.output.gain.cancelScheduledValues(now);
		voice.output.gain.setValueAtTime(0.0001, now);
	}

	private driveVoice(voice: Voice, playerDriving: boolean) {
		const car = voice.car;
		const now = this.now;
		if (!car) {
			voice.output.gain.setTargetAtTime(0.0001, now, SWAP_SECONDS);
			voice.skidAmount = 0;
			voice.lastSpeed = Number.NaN;
			voice.skid.set(0, voice.skidPlace);
			voice.roll.set(0, voice.rollPlace);
			if (voice.awake && voice.grain && now >= voice.sleepAt) {
				setEngineAwake(voice.grain, false);
				voice.awake = false;
			}
			return;
		}
		const profile = VEHICLE_AUDIO[car.style];
		const { state } = this.stateOf(car);
		const bus = audioBus();
		const position = car.entity.getPosition();
		const placed = bus.place(position.x, position.y, position.z, this.place);
		const own = car.driver === "player";
		const doppler = own ? 1 : bus.doppler(position.x, position.y, position.z, car.velocityX, car.velocityZ);
		const speed = Math.abs(car.currentSpeed);

		// The audio gearbox, and a gear change: the drive cut for a moment, the revs falling to the new gear.
		const throttle = car.throttle;
		const engine = engineState(gearboxFor(car.style), speed, throttle, state.gear);
		if (engine.gear > state.gear && throttle > 0.2 && profile.shiftSeconds > 0) {
			state.shiftUntil = now + profile.shiftSeconds;
			if (own && profile.manual) playOneShot("gear-lever", AT_LISTENER, { level: 0.3, variation: 0.06, channel: "transmission" });
		}
		state.gear = engine.gear;
		const shifting = now < state.shiftUntil;
		const load = shifting ? engine.load * SHIFT_LOAD : engine.load;
		const revs = Math.max(0, Math.min(1, (engine.rpm - profile.idleRpm) / Math.max(1, profile.redlineRpm - profile.idleRpm)));

		// Heard from inside the player's own car; everything else ducked and muffled by the cabin.
		const distanceGain = own ? OWN_CAR_GAIN : placed.gain * (playerDriving ? CABIN_DUCK : 1);
		const ceiling = own ? 20000 : playerDriving ? Math.min(placed.muffle, CABIN_MUFFLE) : placed.muffle;
		const startGate = Math.max(0, Math.min(1, (now - state.startedAt - state.startHold) / START_OVERLAP));

		const sounding = this.driveEngine(voice, profile, revs, load, shifting, doppler, ceiling);
		const idle = own ? OWN_IDLE_SHARE : TRAFFIC_IDLE_SHARE;
		const level = sounding ? ENGINE_LEVEL * profile.level * distanceGain * (idle + load * (1 - idle)) * startGate * damageRattle(car, now) : 0;
		// Lifting off or flooring it (keys aren't analogue) swells and settles rather than switching.
		voice.output.gain.setTargetAtTime(Math.max(0.0001, level), now, TONE_SMOOTHING);
		voice.panner.pan.setTargetAtTime(own ? 0 : placed.pan, now, TONE_SMOOTHING);

		this.driveTyres(voice, car, profile, speed, placed, own, playerDriving, doppler);
		this.driveAirBrakes(car, profile, state, speed, position.x, position.y, position.z, placed.distance);
	}

	/** Steers the recorded engine; false (and silent) until its recordings have loaded, or for an electric car. */
	private driveEngine(voice: Voice, profile: VehicleAudioProfile, revs: number, load: number, shifting: boolean, doppler: number, ceiling: number): boolean {
		const grain = voice.grain;
		const familyName = profile.family;
		if (!grain || !familyName) return false;
		const data = this.familyData(familyName);
		if (!data) return false;
		if (voice.family !== familyName) {
			if (!setEngineFamily(grain, familyName, () => data)) return false;
			voice.family = familyName;
		}
		if (!voice.awake) {
			setEngineAwake(grain, true);
			voice.awake = true;
		}
		const now = this.now;
		const low = data.idle?.hz ?? lowestPitch(data);
		const high = highestPitch(data);
		const hz = low + (high - low) * revs;
		// Through a gear change the revs fall to the new gear over the shift, not in one jump.
		grain.parameters.get("hz")?.setTargetAtTime(hz, now, shifting ? profile.shiftSeconds * 0.35 : PITCH_SMOOTHING);
		grain.parameters.get("load")?.setTargetAtTime(Math.max(0, Math.min(1, (load - 0.15) / 0.6)), now, TONE_SMOOTHING);
		grain.parameters.get("shift")?.setTargetAtTime(profile.shift * doppler, now, DOPPLER_SMOOTHING);
		const dark = Math.min(TONE_DARK, profile.brightness * 0.6);
		const open = dark + (profile.brightness - dark) * (0.25 + 0.75 * load) * (0.6 + 0.4 * revs);
		voice.tone.frequency.setTargetAtTime(Math.min(open, ceiling), now, TONE_SMOOTHING);
		return true;
	}

	/**
	 * Tyres: rolling on the road with speed; squealing from how far the rear or front is past its
	 * grip (eased in and out, squared, so a light slip whispers and only a real slide screams);
	 * and a lighter scrub under hard braking. Ordinary cornering is within grip and is silent.
	 */
	private driveTyres(voice: Voice, car: OrionVehicle, profile: VehicleAudioProfile, speed: number, placed: Placement, own: boolean, playerDriving: boolean, doppler: number) {
		const roll = Math.min(1, speed / ROLL_FULL_SPEED);
		const rollPlace = voice.rollPlace;
		rollPlace.gain = own ? 1 : placed.gain * (playerDriving ? CABIN_DUCK : 1);
		rollPlace.pan = own ? 0 : placed.pan;
		rollPlace.muffle = own ? 9000 : playerDriving ? Math.min(placed.muffle, CABIN_MUFFLE) : placed.muffle;
		rollPlace.distance = placed.distance;
		voice.roll.set(profile.tyres * (own ? ROLL_LEVEL_OWN : ROLL_LEVEL) * roll ** 1.3, rollPlace, (0.8 + 0.4 * roll) * doppler, 12000);

		const dt = this.dt;
		const decel = dt > 0 && Number.isFinite(voice.lastSpeed) ? (voice.lastSpeed - speed) / dt : 0;
		voice.lastSpeed = speed;
		const slip = Math.max(car.rearSlide, car.frontSlide * 0.8);
		const slide = smoothstep((slip - SKID_FROM) / SKID_SPAN) * Math.min(1, speed / 6);
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
		voice.skid.set(SKID_LEVEL * amount * amount, place, (0.9 + 0.14 * roll + 0.06 * amount) * doppler, 15000);
	}

	/** A lorry or bus coming to a stop lets its air brakes go: once per stop, not on every crawl. */
	private driveAirBrakes(car: OrionVehicle, profile: VehicleAudioProfile, state: CarSound, speed: number, x: number, y: number, z: number, distance: number) {
		if (!profile.airBrakes) return;
		if (speed > AIR_ARM_SPEED) state.airArmed = true;
		if (!state.airArmed || speed > AIR_RELEASE_SPEED) return;
		state.airArmed = false;
		if (distance > EVENT_RANGE || this.now - state.lastAir < AIR_GAP) return;
		state.lastAir = this.now;
		playAt("air-brake", x, y + 1, z, { level: 0.55, variation: 0.06, channel: "transmission" });
	}

	/** A family's recordings from the manifest and the decoded files; null until they've all loaded. */
	private familyData(name: string): EngineFamilyData | null {
		const cached = this.families.get(name);
		if (cached) return cached;
		const map = ENGINE_FAMILIES[name];
		if (!map) return null;
		const idle = map.idle ? loopOf(map.idle) : null;
		if (map.idle && !idle) return null;
		const layers: EngineLoop[] = [];
		for (const layer of map.layers) {
			const loop = loopOf(layer);
			if (!loop) return null;
			layers.push(loop);
		}
		const ramps: EngineRamp[] = [];
		for (const ramp of map.ramps) {
			const buffer = takeOf(ramp.sound);
			if (!buffer) return null;
			const rate = buffer.sampleRate;
			ramps.push({ samples: buffer.getChannelData(0), pitch: Float32Array.from(ramp.pitch), position: Float32Array.from(ramp.time, (t) => t * rate) });
		}
		const data: EngineFamilyData = { idle, ramps, layers };
		this.families.set(name, data);
		return data;
	}

	private createVoice(context: AudioContext, master: GainNode): Voice {
		const output = context.createGain();
		output.gain.value = 0.0001;
		const panner = context.createStereoPanner();
		const tone = context.createBiquadFilter();
		tone.type = "lowpass";
		tone.frequency.value = 8000;
		tone.Q.value = 0.5;
		tone.connect(output).connect(panner).connect(master);
		const grain = this.grains
			? new AudioWorkletNode(context, ENGINE_GRAIN_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] })
			: null;
		grain?.connect(tone);
		return {
			car: null, family: null, grain, awake: false, sleepAt: 0, tone, output, panner,
			roll: new LoopVoice("tyre-roll", 0.12, "tyres"), rollPlace: { gain: 0, pan: 0, muffle: 20000, distance: 0 },
			skid: new LoopVoice("skid", 0.04, "tyres"), skidPlace: { gain: 0, pan: 0, muffle: 20000, distance: 0 },
			skidAmount: 0, lastSpeed: Number.NaN,
		};
	}
}

function loopOf(map: EngineLoopMap): EngineLoop | null {
	const buffer = takeOf(map.sound);
	return buffer ? { samples: buffer.getChannelData(0), hz: map.hz } : null;
}

function lowestPitch(data: EngineFamilyData): number {
	return data.ramps.length > 0 ? data.ramps[0].pitch[0] : data.layers[0]?.hz ?? 40;
}

function highestPitch(data: EngineFamilyData): number {
	if (data.ramps.length > 0) return data.ramps[0].pitch[data.ramps[0].pitch.length - 1];
	return data.layers[data.layers.length - 1]?.hz ?? 200;
}

/** A damaged engine runs rough and loud: a slow, uneven surge rather than a steady note. */
function damageRattle(car: OrionVehicle, time: number): number {
	if (car.integrity >= 60) return 1;
	const hurt = 1 - car.integrity / 60;
	const surge = 0.5 + 0.5 * Math.sin(time * 7.3) * Math.sin(time * 2.9 + 1.3);
	return 1 + hurt * 0.25 * (0.6 + 0.4 * surge);
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
