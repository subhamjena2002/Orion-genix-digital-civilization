import { audioBus, AUDIBLE_DISTANCE, type Channel, type Placement } from "../audio/AudioBus";
import { playOneShot } from "../audio/SoundBank";
import type { SoundId } from "./WeaponData";

/**
 * Weapon and impact sounds.
 *
 * Weapons refer to sounds by id. Each id plays studio recordings (see RECORDED, SoundBank and
 * CREDITS.md): real firearms recorded close and far away, real crashes, glass and explosions,
 * several takes of each picked at random. Gunfire and explosions blend the close recording into
 * the distant one with range, so a shot across the city arrives as the crack-and-echo it is,
 * not as a quieter copy of the one at your ear. Until the recordings have loaded, an id falls
 * back to the sound synthesised below.
 *
 * A gunshot outdoors is not one sound, it is four, and the layers are what make it read as real
 * rather than as a click:
 *
 *   crack   a few milliseconds of bright noise — the supersonic snap off the muzzle
 *   blast   the body of the report, a noise burst whose top end falls away as it decays
 *   thump   the low end you feel, a sine dropping through the bottom two octaves
 *   tail    the quiet, slightly delayed wash of the sound coming back off the buildings
 *
 * Drop any of them and it stops sounding like a gun. The tail is the one usually missing, and
 * it is what places the shot in a street rather than in a void.
 *
 * Sounds are placed in the world: quieter with distance and panned left/right from the camera.
 *
 * One trigger pull is one shot. The recording is the shot, whole; the only thing layered under
 * it is the low thump, which starts on the same sample and has no attack of its own to be heard
 * as a second report. The city echo (AudioBus) is a soft tail for the player's own gun, and only
 * grows into the rolling crack-and-echo for fire further off. The player's shots go to their own
 * channel, which ducks everyone else's gunfire for a moment, and each cuts the tail of the one
 * before it short, so rapid fire stays a run of distinct shots instead of a smear.
 */

interface LayerBase {
	/** Seconds after the trigger that this layer starts. */
	at?: number;
	/** Seconds to fade out over. */
	decay: number;
	level: number;
	/** Seconds to reach full level; a crack is instant, a tail swells slightly. */
	attack?: number;
}

interface NoiseLayer extends LayerBase {
	kind: "noise";
	/** Low-pass cutoff (Hz), and where it sweeps to across the decay. */
	cutoff: number;
	cutoffTo?: number;
	highpass?: number;
	/** Above 1 narrows the band, for a ring rather than a hiss. */
	q?: number;
}

interface ToneLayer extends LayerBase {
	kind: "tone";
	/** Start and end frequency (Hz). */
	from: number;
	to: number;
	type?: OscillatorType;
}

type Layer = NoiseLayer | ToneLayer;

interface Recorded {
	/** Sound heard close to. */
	near: string;
	/** Sound heard from far off, blended in with distance; the near one is used alone without it. */
	far?: string;
	/** Heard from very far: a crack and a rolling echo, past the far recording's range. */
	distant?: string;
	/** How far (m) it carries; most things fade out by AUDIBLE_DISTANCE, gunfire much further. */
	range?: number;
	level: number;
	/** The far recording against the near one: distant fire is mostly its echo, and carries. */
	farLevel?: number;
	/** Playback rate: a different gun from the same recording, pitched. */
	rate?: number;
	/** Send to the city's echo (see AudioBus.echo). */
	echo?: number;
	/**
	 * Heard at the speed of sound: a shot or blast 340 m off arrives a second after it's seen.
	 * Only for the loud, far-carrying ones; a punch is never far enough away to notice.
	 */
	travels?: boolean;
}

/** Recordings for each id; ids not listed stay synthesised. */
const RECORDED: Partial<Record<SoundId, Recorded>> = {
	pistol: { near: "pistol-close", far: "pistol-far", distant: "gun-distant", level: 1, farLevel: 1.7, echo: 0.55, travels: true, range: 600 },
	rifle: { near: "rifle-close", far: "rifle-far", distant: "gun-distant", level: 0.95, farLevel: 1.6, echo: 0.6, travels: true, range: 800 },
	shotgun: { near: "shotgun-close", far: "shotgun-far", distant: "gun-distant", level: 1.1, farLevel: 1.4, echo: 0.65, travels: true, range: 600 },
	rocket: { near: "rocket", level: 1, echo: 0.4, travels: true, range: 400 },
	explosion: { near: "explosion", far: "explosion-far", level: 1.5, farLevel: 1.8, echo: 0.9, travels: true, range: 900 },
	punch: { near: "punch", level: 0.85 },
	swing: { near: "whoosh", level: 0.5 },
	slash: { near: "whoosh", level: 0.55, rate: 1.15 },
	empty: { near: "empty", level: 0.55 },
	reload: { near: "reload", level: 0.7 },
	equip: { near: "equip", level: 0.55 },
	// Where the bullets land: well under the shot, and dry — sent to the echo, a hit on a wall a
	// few metres off came back as another crack.
	impact: { near: "impact", level: 0.32, rate: 1.25 },
	bulletHit: { near: "hit-wall", level: 0.42 },
	bulletGround: { near: "hit-ground", level: 0.4 },
	bulletGlass: { near: "hit-glass", level: 0.45 },
	bulletFlesh: { near: "hit-flesh", level: 0.6 },
};
/** Gunfire and launches: the sounds that are someone's weapon going off. */
const SHOTS: ReadonlySet<SoundId> = new Set<SoundId>(["pistol", "rifle", "shotgun", "rocket"]);
/** Where the bullets land. */
const IMPACTS: ReadonlySet<SoundId> = new Set<SoundId>(["impact", "bulletHit", "bulletGround", "bulletGlass", "bulletFlesh"]);
/** In rapid fire, how much of the previous shot's tail is left as the next one goes off. */
const CHOKE = 0.5;
/** Range (m) over which the far recording gives way to the distant one. */
const DISTANT_FROM = 150;
const DISTANT_BY = 380;
/** Shots felt in the chest: within this range (m), and how hard. */
const THUMPS: ReadonlySet<SoundId> = new Set<SoundId>(["pistol", "rifle", "shotgun", "rocket", "explosion"]);
const THUMP_WITHIN = 12;
const THUMP_LEVEL = 0.35;
/** Speed of sound, m/s. */
const SOUND_SPEED = 343;
/** Nearer than this, the delay is too short to notice and only makes the gun feel laggy. */
const DELAY_FROM = 20;
/** Range (m) over which close fire gives way to its distant recording. */
const FAR_FROM = 25;
const FAR_BY = 140;

/** How much the level and pitch of each shot wander, so a burst isn't a loop. */
const VARIATION = 0.12;

const SYNTHS: Readonly<Record<SoundId, readonly Layer[]>> = {
	pistol: [
		{ kind: "noise", decay: 0.012, level: 0.55, cutoff: 8000, highpass: 2400 },
		{ kind: "noise", decay: 0.12, level: 0.8, cutoff: 4200, cutoffTo: 700 },
		{ kind: "tone", decay: 0.1, level: 0.55, from: 190, to: 52 },
		{ kind: "noise", at: 0.022, decay: 0.42, level: 0.16, cutoff: 2200, cutoffTo: 500, attack: 0.03 },
		// The slide coming back and closing again.
		{ kind: "noise", at: 0.05, decay: 0.03, level: 0.12, cutoff: 7000, highpass: 2200 },
	],
	rifle: [
		{ kind: "noise", decay: 0.009, level: 0.6, cutoff: 9000, highpass: 3200 },
		{ kind: "noise", decay: 0.1, level: 0.85, cutoff: 5600, cutoffTo: 900 },
		{ kind: "tone", decay: 0.09, level: 0.5, from: 170, to: 46 },
		{ kind: "noise", at: 0.026, decay: 0.55, level: 0.2, cutoff: 2600, cutoffTo: 420, attack: 0.035 },
		{ kind: "noise", at: 0.04, decay: 0.025, level: 0.1, cutoff: 8000, highpass: 2800 },
	],
	shotgun: [
		{ kind: "noise", decay: 0.02, level: 0.5, cutoff: 6500, highpass: 1600 },
		{ kind: "noise", decay: 0.3, level: 1, cutoff: 2600, cutoffTo: 420 },
		{ kind: "tone", decay: 0.28, level: 0.9, from: 120, to: 34 },
		{ kind: "noise", at: 0.03, decay: 0.8, level: 0.26, cutoff: 1600, cutoffTo: 300, attack: 0.05 },
		// Pumping the action.
		{ kind: "noise", at: 0.26, decay: 0.05, level: 0.14, cutoff: 5000, highpass: 1400 },
	],
	rocket: [
		{ kind: "noise", decay: 0.06, level: 0.6, cutoff: 3000, highpass: 800 },
		{ kind: "noise", decay: 0.9, level: 0.7, cutoff: 1400, cutoffTo: 5200, attack: 0.04 },
		{ kind: "tone", decay: 0.25, level: 0.6, from: 95, to: 38 },
	],
	explosion: [
		{ kind: "noise", decay: 0.05, level: 0.6, cutoff: 7000, highpass: 1200 },
		{ kind: "noise", decay: 1.1, level: 1, cutoff: 1100, cutoffTo: 200 },
		{ kind: "tone", decay: 1.2, level: 1, from: 74, to: 22 },
		{ kind: "noise", at: 0.06, decay: 2, level: 0.34, cutoff: 900, cutoffTo: 180, attack: 0.09 },
	],
	punch: [
		// Body: the dull one you feel rather than hear.
		{ kind: "tone", decay: 0.085, level: 0.85, from: 155, to: 47 },
		// Skin on cloth, right at the front.
		{ kind: "noise", decay: 0.035, level: 0.4, cutoff: 2400, highpass: 600, q: 1.4 },
		{ kind: "noise", at: 0.01, decay: 0.09, level: 0.12, cutoff: 5200, highpass: 1800 },
	],
	swing: [{ kind: "noise", decay: 0.14, level: 0.16, cutoff: 1400, cutoffTo: 2800, highpass: 500, attack: 0.05 }],
	slash: [
		{ kind: "noise", decay: 0.18, level: 0.18, cutoff: 5000, cutoffTo: 7000, highpass: 1600, attack: 0.03 },
		{ kind: "noise", at: 0.09, decay: 0.12, level: 0.07, cutoff: 7500, highpass: 3500 },
	],
	empty: [{ kind: "noise", decay: 0.02, level: 0.28, cutoff: 7000, highpass: 2500, q: 2 }],
	reload: [
		{ kind: "noise", decay: 0.03, level: 0.3, cutoff: 6000, highpass: 1500 },
		{ kind: "noise", at: 0.28, decay: 0.04, level: 0.3, cutoff: 5200, highpass: 1300 },
	],
	equip: [{ kind: "noise", decay: 0.04, level: 0.2, cutoff: 5000, highpass: 1200 }],
	impact: [
		{ kind: "noise", decay: 0.05, level: 0.22, cutoff: 3000, q: 1.6 },
		{ kind: "tone", decay: 0.04, level: 0.18, from: 320, to: 120 },
	],
	bulletHit: [
		{ kind: "noise", decay: 0.04, level: 0.22, cutoff: 4200, highpass: 900, q: 1.2 },
		{ kind: "noise", at: 0.01, decay: 0.12, level: 0.08, cutoff: 2500, highpass: 400 },
	],
	bulletGround: [{ kind: "noise", decay: 0.06, level: 0.2, cutoff: 3000, highpass: 300 }],
	bulletGlass: [{ kind: "noise", decay: 0.18, level: 0.2, cutoff: 9000, highpass: 2500 }],
	bulletFlesh: [{ kind: "tone", decay: 0.06, level: 0.4, from: 140, to: 60 }],
	// Two tonnes of bodywork: the crunch, the thud through the floor, the panels ringing
	// afterwards, and a scatter of glass and trim.
	crash: [
		{ kind: "noise", decay: 0.05, level: 0.8, cutoff: 5000, highpass: 300 },
		{ kind: "tone", decay: 0.13, level: 0.6, from: 145, to: 42 },
		{ kind: "noise", at: 0.02, decay: 0.35, level: 0.3, cutoff: 3200, cutoffTo: 800, q: 2.2 },
		{ kind: "noise", at: 0.05, decay: 0.5, level: 0.08, cutoff: 8000, highpass: 4000 },
	],
};

class CombatAudio {
	private readonly place: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };

	/** Where the camera is and which way its right-hand side points (flat, unit). */
	public setListener(x: number, y: number, z: number, rightX: number, rightZ: number): void {
		audioBus().setListener(x, y, z, rightX, rightZ);
	}

	/**
	 * Plays `id` at a point. `own` marks the player's own weapon (on foot, or the aircraft they
	 * fly): it goes in its own channel at the top of the mix and briefly ducks other gunfire.
	 */
	public play(id: SoundId, x: number, y: number, z: number, volume = 1, own = false): void {
		const bus = audioBus();
		const placed = bus.place(x, y, z, this.place);
		if (placed.distance > (RECORDED[id]?.range ?? AUDIBLE_DISTANCE)) return;
		const context = bus.ensure();
		const channelId = channelFor(id, own);
		const master = bus.channel(channelId);
		if (!context || !master) return;
		if (own && SHOTS.has(id)) bus.duckForOwnShot();
		if (this.playRecorded(id, placed, volume, channelId)) {
			// Close to a gun, a shot is felt as much as heard: under the recording, the synthesised
			// version's low thump alone (its tone layers), for the punch a microphone doesn't keep.
			// On the same sample as the recording and with no attack of its own, so it's heard as
			// the weight of the one shot, never as a second one.
			if (placed.distance < THUMP_WITHIN && THUMPS.has(id)) {
				const thump = context.createGain();
				thump.gain.value = volume * THUMP_LEVEL * placed.gain * (1 - placed.distance / THUMP_WITHIN);
				const panner = context.createStereoPanner();
				panner.pan.value = placed.pan;
				thump.connect(panner).connect(master);
				const at = context.currentTime;
				for (const layer of SYNTHS[id]) if (layer.kind === "tone") this.playLayer(context, layer, thump, at, 1);
			}
			return;
		}

		const output = context.createGain();
		output.gain.value = volume * placed.gain;
		const panner = context.createStereoPanner();
		panner.pan.value = placed.pan;
		const air = context.createBiquadFilter();
		air.type = "lowpass";
		// Capped even up close: the top octave of synthesised noise is pure fizz.
		air.frequency.value = Math.min(placed.muffle, 12000);
		output.connect(air).connect(panner).connect(master);

		// No two shots identical: a little level and pitch wander, and a fresh slice of noise.
		const wobble = 1 + (Math.random() * 2 - 1) * VARIATION;
		const at = context.currentTime;
		for (const layer of SYNTHS[id]) this.playLayer(context, layer, output, at, wobble);
	}

	/** The recorded version of a sound; false if it hasn't loaded (the synthesised one plays). */
	private playRecorded(id: SoundId, placed: Placement, volume: number, channel: Channel): boolean {
		if (id === "crash") return this.playCrash(placed, volume);
		const recorded = RECORDED[id];
		if (!recorded) return false;
		const far = recorded.far ? Math.max(0, Math.min(1, (placed.distance - FAR_FROM) / (FAR_BY - FAR_FROM))) : 0;
		const rate = recorded.rate ?? 1;
		const delay = recorded.travels && placed.distance > DELAY_FROM ? placed.distance / SOUND_SPEED : 0;
		const echo = recorded.echo ?? 0;
		// Gunfire far away keeps more of its level than the distance roll-off allows: the report of
		// a rifle carries across a city.
		const carry = recorded.range && placed.distance > AUDIBLE_DISTANCE * 0.5 ? Math.min(3, placed.distance / (AUDIBLE_DISTANCE * 0.5)) : 1;
		const distant = recorded.distant ? Math.max(0, Math.min(1, (placed.distance - DISTANT_FROM) / (DISTANT_BY - DISTANT_FROM))) : 0;
		const farShare = Math.sin((far * Math.PI) / 2) * Math.cos((distant * Math.PI) / 2);
		const farLevel = recorded.level * (recorded.farLevel ?? 1) * volume * carry;
		const choke = SHOTS.has(id) ? CHOKE : undefined;
		let played = false;
		if (far < 1) played = playOneShot(recorded.near, placed, { level: recorded.level * volume * Math.cos((far * Math.PI) / 2), rate, delay, echo, channel, choke }) || played;
		if (recorded.far && far > 0 && farShare > 0.01) {
			played = playOneShot(recorded.far, placed, { level: farLevel * farShare, rate, delay, echo, channel, choke }) || played;
		}
		if (recorded.distant && distant > 0) {
			played = playOneShot(recorded.distant, placed, { level: farLevel * 1.2 * Math.sin((distant * Math.PI) / 2), delay, echo: echo * 1.3, channel }) || played;
		}
		return played;
	}

	/**
	 * A collision, by how hard it was (`severity`, about 0.2 for a scrape to 1.5 for a write-off):
	 * metal on metal for the light ones, the heavy crunch above that, and glass going on the worst.
	 */
	private playCrash(placed: Placement, severity: number): boolean {
		const heavy = severity >= 0.9;
		// Level follows the hit: a bump at walking pace is a soft knock, not most of a full crunch.
		const played = playOneShot(heavy ? "crash-heavy" : "crash-light", placed, { level: 0.15 + Math.min(1.5, severity), variation: 0.08, echo: heavy ? 0.35 : 0.15, channel: "vehicles" });
		if (played && severity >= 1.15) playOneShot("glass", placed, { level: 0.55 * Math.min(1.4, severity), delay: 0.03, echo: 0.1, channel: "vehicles" });
		return played;
	}

	private playLayer(context: AudioContext, layer: Layer, output: AudioNode, at: number, wobble: number) {
		const start = at + (layer.at ?? 0);
		const level = Math.max(0.0001, layer.level * wobble);
		const attack = layer.attack ?? 0.003;
		const envelope = context.createGain();
		envelope.gain.setValueAtTime(0.0001, start);
		envelope.gain.exponentialRampToValueAtTime(level, start + attack);
		envelope.gain.exponentialRampToValueAtTime(0.0001, start + attack + layer.decay);
		envelope.connect(output);

		if (layer.kind === "tone") {
			const oscillator = context.createOscillator();
			oscillator.type = layer.type ?? "sine";
			oscillator.frequency.setValueAtTime(layer.from * wobble, start);
			oscillator.frequency.exponentialRampToValueAtTime(layer.to * wobble, start + layer.decay);
			oscillator.connect(envelope);
			oscillator.start(start);
			oscillator.stop(start + layer.decay + 0.05);
			return;
		}

		const noise = audioBus().noise;
		if (!noise) return;
		const source = context.createBufferSource();
		source.buffer = noise;
		const lowpass = context.createBiquadFilter();
		lowpass.type = "lowpass";
		lowpass.frequency.setValueAtTime(layer.cutoff * wobble, start);
		if (layer.cutoffTo) lowpass.frequency.exponentialRampToValueAtTime(layer.cutoffTo, start + layer.decay);
		if (layer.q) lowpass.Q.value = layer.q;
		let chain: AudioNode = source.connect(lowpass);
		if (layer.highpass) {
			const filter = context.createBiquadFilter();
			filter.type = "highpass";
			filter.frequency.value = layer.highpass;
			chain = chain.connect(filter);
		}
		chain.connect(envelope);
		// Start somewhere random in the loop so repeated shots don't share a waveform.
		const span = layer.decay + attack + 0.05;
		source.start(start, Math.random() * Math.max(0.01, noise.duration - span), span);
	}
}

/** The part of the mix a sound belongs to (see AudioBus). */
function channelFor(id: SoundId, own: boolean): Channel {
	if (SHOTS.has(id)) return own ? "own" : "gunfire";
	if (id === "explosion") return "gunfire";
	if (IMPACTS.has(id)) return "impacts";
	if (id === "crash") return "vehicles";
	return "world";
}

let audio: CombatAudio | null = null;

export function combatAudio(): CombatAudio {
	audio ??= new CombatAudio();
	return audio;
}
