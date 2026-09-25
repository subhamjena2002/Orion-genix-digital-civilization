import type { VehicleStyle } from "../traffic/Vehicles";
import type { EnginePulseVoicing } from "./EngineWorklet";

/**
 * What each kind of engine sounds like, and how it revs.
 *
 * Every engine here is synthesised from these numbers rather than played from a recording. That
 * is partly cheap — one oscillator and a noise source per car instead of streaming audio — and
 * partly deliberate: a recording of a real car is that manufacturer's, and the sound of a
 * specific car can be protected in its own right. Nothing here is sampled from anything.
 *
 * The sound of a piston engine is mostly its firing frequency and the harmonics above it. A
 * four-stroke fires `cylinders / 2` times per revolution, so a V12 at 8,600 rpm has a
 * fundamental of 860 Hz and screams, while a six-cylinder diesel at 2,600 rpm sits at 130 Hz and
 * lugs. Everything else is voicing: which harmonics are loud, how much induction and combustion
 * noise sits behind them, and how bright the whole thing gets as the revs rise.
 */

export interface EngineVoice {
	/** Cylinders in a four-stroke; sets how many times it fires per revolution. */
	cylinders: number;
	idleRpm: number;
	redlineRpm: number;
	/**
	 * Level of each harmonic of the firing frequency, fundamental first. This is the engine's
	 * character: a big diesel leans on the low ones, a flat-plane V12 on the higher ones.
	 */
	harmonics: readonly number[];
	/**
	 * How much sits between the firing harmonics, 0..1 — the half-orders.
	 *
	 * A four-stroke cylinder fires once every two revolutions, so an engine also radiates at half
	 * its firing order. That content is what you hear as burble and lope: a V12 has almost none
	 * and sounds like a turbine, a single cylinder is mostly half-order and sounds like a
	 * thumping bag of spanners. Without it every engine here sounded like an organ pipe.
	 */
	halfOrder: number;
	/** Exhaust body: a resonant peak (Hz) the whole engine is heard through. */
	resonanceHz: number;
	/** Induction and combustion noise behind the harmonics, 0..1. */
	noiseLevel: number;
	/** Where that noise sits (Hz) and how tight it is. */
	noiseCentre: number;
	noiseQ: number;
	/** Low-pass cutoff (Hz) at idle and at the redline: engines open up as they rev. */
	brightness: readonly [number, number];
	/** Overall level relative to other engines. */
	level: number;
	/** Road speed (m/s) at the redline in each gear — this is the gearbox. */
	gearTops: readonly number[];
	/** Turbo whistle at full boost (Hz); 0 for none. */
	turboHz: number;
	/**
	 * How its firings vary (see EngineWorklet): the pulse-by-pulse source that replaced the
	 * fixed waveform. `harmonics` and `halfOrder` remain as the fallback where it can't run.
	 */
	pulse: EnginePulseVoicing;
}

/**
 * A mid-engined V12: idles hard and high, and the fundamental climbs past 800 Hz at the
 * redline, which is where the wail comes from. Little noise — these are tight engines.
 */
const V12: EngineVoice = {
	cylinders: 12,
	idleRpm: 900,
	redlineRpm: 8600,
	harmonics: [1, 0.82, 0.68, 0.55, 0.46, 0.34, 0.27, 0.2, 0.15, 0.11, 0.08, 0.06],
	halfOrder: 0.1,
	resonanceHz: 190,
	noiseLevel: 0.1,
	noiseCentre: 2600,
	noiseQ: 0.8,
	brightness: [1100, 4200],
	level: 0.62,
	gearTops: [11, 19, 28, 38, 48, 58],
	turboHz: 0,
	pulse: { pattern: [1, 0.97, 0.99, 0.96, 1, 0.98, 0.97, 1, 0.96, 0.99, 0.98, 0.97], roughness: 0.05, jitter: 0.004, noise: 0.22, noiseDecay: 0.0015, pulseHz: 420 },
};

/**
 * A big turbo-diesel six. Low, uneven, and far more combustion clatter than tone — most of what
 * you hear from a lorry is the noise layer, not the harmonics. Short gearing, low redline.
 */
const DIESEL_SIX: EngineVoice = {
	cylinders: 6,
	idleRpm: 600,
	redlineRpm: 2600,
	// Weak fundamental (30 Hz at idle is below most speakers) with the low harmonics carrying it.
	harmonics: [0.55, 1, 0.9, 0.72, 0.5, 0.38, 0.3, 0.22, 0.16, 0.1],
	halfOrder: 0.5,
	resonanceHz: 95,
	noiseLevel: 0.42,
	noiseCentre: 900,
	noiseQ: 0.55,
	brightness: [600, 2000],
	level: 0.85,
	gearTops: [5, 8.5, 13, 18, 24, 31],
	turboHz: 3200,
	pulse: { pattern: [1, 0.8, 0.93, 0.75, 0.97, 0.82], roughness: 0.2, jitter: 0.02, noise: 0.9, noiseDecay: 0.006, pulseHz: 170 },
};

/** A coarse four-cylinder on a raised chassis: throaty, plenty of induction noise. */
const UTILITY_FOUR: EngineVoice = {
	cylinders: 4,
	idleRpm: 750,
	redlineRpm: 4800,
	harmonics: [0.9, 1, 0.74, 0.52, 0.4, 0.28, 0.2, 0.14, 0.1],
	halfOrder: 0.34,
	resonanceHz: 130,
	noiseLevel: 0.28,
	noiseCentre: 1500,
	noiseQ: 0.7,
	brightness: [800, 3000],
	level: 0.7,
	gearTops: [7, 12, 18, 25, 33],
	turboHz: 0,
	pulse: { pattern: [1, 0.82, 0.94, 0.78], roughness: 0.16, jitter: 0.015, noise: 0.55, noiseDecay: 0.004, pulseHz: 200 },
};

/** An ordinary road car: nothing distinctive, which is the point. */
const ROAD_FOUR: EngineVoice = {
	cylinders: 4,
	idleRpm: 800,
	redlineRpm: 6200,
	harmonics: [0.8, 1, 0.66, 0.45, 0.32, 0.22, 0.15, 0.1],
	halfOrder: 0.28,
	resonanceHz: 150,
	noiseLevel: 0.2,
	noiseCentre: 1800,
	noiseQ: 0.8,
	brightness: [900, 3400],
	level: 0.55,
	gearTops: [8, 14, 21, 29, 38],
	turboHz: 0,
	pulse: { pattern: [1, 0.9, 0.96, 0.88], roughness: 0.1, jitter: 0.008, noise: 0.35, noiseDecay: 0.003, pulseHz: 240 },
};

/** A three-wheeler's single cylinder: buzzy, loud for its size, nearly all noise and rasp. */
const AUTO_SINGLE: EngineVoice = {
	cylinders: 1,
	idleRpm: 1100,
	redlineRpm: 5400,
	harmonics: [1, 0.85, 0.7, 0.62, 0.5, 0.42, 0.34, 0.26, 0.2, 0.15],
	halfOrder: 0.7,
	resonanceHz: 240,
	noiseLevel: 0.34,
	noiseCentre: 2200,
	noiseQ: 0.6,
	brightness: [1300, 3800],
	level: 0.5,
	gearTops: [6, 11, 17, 24],
	turboHz: 0,
	pulse: { pattern: [1], roughness: 0.25, jitter: 0.03, noise: 0.7, noiseDecay: 0.005, pulseHz: 140 },
};

export const ENGINE_VOICES: Readonly<Record<VehicleStyle, EngineVoice>> = {
	luxury: V12,
	truck: DIESEL_SIX,
	militaryWagon: UTILITY_FOUR,
	suv: UTILITY_FOUR,
	police: ROAD_FOUR,
	sedan: ROAD_FOUR,
	hatchback: ROAD_FOUR,
	auto: AUTO_SINGLE,
};

export interface EngineState {
	rpm: number;
	gear: number;
	/** How hard the engine is working, 0..1: sets noise, brightness and level. */
	load: number;
}

/** A gear is held until the road speed is well below its own range, so it can't hunt. */
const DOWNSHIFT_MARGIN = 0.82;
/** Off the line the engine revs ahead of the wheels; this is how far. */
const CLUTCH_SLIP = 0.42;
/** Below this road speed the car counts as pulling away rather than driving. */
const PULLING_AWAY = 1.5;

/**
 * Which gear a car is in and what the engine is doing, from its road speed and throttle.
 *
 * There is no gearbox in the driving model — cars just have a speed — so this invents one for
 * the sound. It is what makes an engine recognisable: revs climbing, dropping on the shift, and
 * climbing again.
 */
export function engineState(voice: EngineVoice, speed: number, throttle: number, previousGear: number): EngineState {
	const gear = selectGear(voice, speed, previousGear);
	const top = voice.gearTops[gear];
	const fraction = Math.min(1, Math.max(0, speed) / top);
	let rpm = voice.idleRpm + (voice.redlineRpm - voice.idleRpm) * fraction;
	if (speed < PULLING_AWAY) {
		// Standing still with the throttle open: the engine revs against a slipping clutch.
		const revving = voice.idleRpm + (voice.redlineRpm - voice.idleRpm) * CLUTCH_SLIP * Math.max(0, throttle);
		rpm = Math.max(rpm, revving);
	}
	// Working hard means climbing in gear or on the throttle, not just moving.
	const load = Math.min(1, Math.max(0, throttle) * 0.7 + fraction * 0.5);
	return { rpm: Math.min(rpm, voice.redlineRpm), gear, load };
}

function selectGear(voice: EngineVoice, speed: number, previousGear: number): number {
	const gears = voice.gearTops.length;
	const held = Math.min(Math.max(previousGear, 0), gears - 1);
	// Stay put while the speed still suits this gear.
	if (speed <= voice.gearTops[held] && (held === 0 || speed > voice.gearTops[held - 1] * DOWNSHIFT_MARGIN)) return held;
	for (let gear = 0; gear < gears; gear++) {
		if (speed <= voice.gearTops[gear]) return gear;
	}
	return gears - 1;
}

/**
 * The engine as one waveform, for an oscillator running at HALF the firing frequency.
 *
 * Running at half and putting the firing harmonics on the even slots leaves the odd slots free
 * for the half-orders, which is the only way to get them out of a single oscillator. Index 0 is
 * DC and stays zero; index 1 is the half-order fundamental; index 2 is the firing frequency.
 *
 * Returned as the sine (imaginary) terms of a Fourier series — what createPeriodicWave wants.
 */
export function engineHarmonicTable(voice: EngineVoice): number[] {
	const table = new Array<number>(voice.harmonics.length * 2 + 1).fill(0);
	for (let i = 0; i < voice.harmonics.length; i++) {
		const level = voice.harmonics[i];
		table[(i + 1) * 2] = level;
		// Each half-order sits below the firing harmonic it comes before, fading faster.
		table[(i + 1) * 2 - 1] = level * voice.halfOrder * (1 - i / (voice.harmonics.length * 1.5));
	}
	return table;
}

/** Firing frequency (Hz): a four-stroke fires half its cylinders each revolution. */
export function firingFrequency(voice: EngineVoice, rpm: number): number {
	return (rpm / 60) * (voice.cylinders / 2);
}
