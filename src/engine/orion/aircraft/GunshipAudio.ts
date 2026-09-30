import { audioBus, type Placement } from "../audio/AudioBus";

/**
 * The gunship's sound, synthesised like everything else the game plays:
 *  - blade slap: a thud each time a blade passes (four blades, so four a revolution), made by
 *    pulsing band-passed noise at the blade-passing rate;
 *  - the turbines' whine, rising with rotor speed;
 *  - a low rumble of rotor wash under both.
 * All of it follows rotor speed, so spooling up and winding down are heard as they happen.
 */

/** Rotor revolutions a second at governed speed. */
const ROTOR_HZ = 4.8;
const BLADES = 4;

export class GunshipAudio {
	private started = false;
	private output: GainNode | null = null;
	private panner: StereoPannerNode | null = null;
	private muffle: BiquadFilterNode | null = null;
	private slapDepth: GainNode | null = null;
	private slapBase: GainNode | null = null;
	private pulse: OscillatorNode | null = null;
	private whine: OscillatorNode | null = null;
	private whineGain: GainNode | null = null;
	private rumbleGain: GainNode | null = null;
	private readonly placement: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };
	private sources: AudioScheduledSourceNode[] = [];

	private start(): boolean {
		if (this.started) return true;
		const bus = audioBus();
		const context = bus.ensure();
		const master = bus.master;
		if (!context || !master) return false;
		this.started = true;

		const output = context.createGain();
		output.gain.value = 0;
		const muffle = context.createBiquadFilter();
		muffle.type = "lowpass";
		const panner = context.createStereoPanner();
		output.connect(muffle).connect(panner).connect(master);

		// Blade slap: noise through a band around the thud, its level pulsed by a sawtooth at
		// the blade-passing rate (a sharp attack, then decay, per blade).
		const slapNoise = bus.startNoise(context);
		const band = context.createBiquadFilter();
		band.type = "bandpass";
		band.frequency.value = 170;
		band.Q.value = 1.1;
		const slapBase = context.createGain();
		slapBase.gain.value = 0;
		const slapDepth = context.createGain();
		slapDepth.gain.value = 0;
		const pulse = context.createOscillator();
		pulse.type = "sawtooth";
		pulse.frequency.value = ROTOR_HZ * BLADES;
		pulse.connect(slapDepth).connect(slapBase.gain);
		pulse.start();
		if (slapNoise) slapNoise.connect(band).connect(slapBase).connect(output);

		// Turbine whine.
		const whine = context.createOscillator();
		whine.type = "triangle";
		whine.frequency.value = 900;
		const whineGain = context.createGain();
		whineGain.gain.value = 0;
		whine.connect(whineGain).connect(output);
		whine.start();

		// Rotor wash rumble.
		const rumbleNoise = bus.startNoise(context);
		const low = context.createBiquadFilter();
		low.type = "lowpass";
		low.frequency.value = 110;
		const rumbleGain = context.createGain();
		rumbleGain.gain.value = 0;
		if (rumbleNoise) rumbleNoise.connect(low).connect(rumbleGain).connect(output);

		this.output = output;
		this.muffle = muffle;
		this.panner = panner;
		this.slapBase = slapBase;
		this.slapDepth = slapDepth;
		this.pulse = pulse;
		this.whine = whine;
		this.whineGain = whineGain;
		this.rumbleGain = rumbleGain;
		this.sources = [pulse, whine, ...(slapNoise ? [slapNoise] : []), ...(rumbleNoise ? [rumbleNoise] : [])];
		return true;
	}

	/**
	 * Once a frame: where the gunship is, how fast its rotor turns (0..1) and how hard it's
	 * working (collective, 0..1). `inside` is the pilot's own seat: louder, less muffled.
	 */
	public update(x: number, y: number, z: number, rotor: number, load: number, inside: boolean): void {
		if (rotor < 0.01 && !this.started) return;
		if (!this.start()) return;
		const context = audioBus().ensure();
		if (!context || !this.output) return;
		const now = context.currentTime;
		const place = audioBus().place(x, y, z, this.placement);
		const level = inside ? 0.55 : Math.min(1, place.gain * 2.2);
		const smooth = 0.08;
		if (rotor < 0.01) {
			// Stopped (parked, or wrecked): silent at once, not after a fade.
			this.output.gain.cancelScheduledValues(now);
			this.output.gain.setValueAtTime(0, now);
			return;
		}
		this.output.gain.setTargetAtTime(level * Math.min(1, rotor * 1.4), now, smooth);
		this.panner?.pan.setTargetAtTime(inside ? 0 : place.pan, now, smooth);
		this.muffle?.frequency.setTargetAtTime(inside ? 9000 : Math.max(400, place.muffle), now, smooth);
		// Slaps get harder with blade loading (collective).
		const slap = rotor * (0.35 + 0.65 * load);
		this.slapBase?.gain.setTargetAtTime(slap * 0.7, now, smooth);
		this.slapDepth?.gain.setTargetAtTime(slap * 0.6, now, smooth);
		this.pulse?.frequency.setTargetAtTime(Math.max(0.5, ROTOR_HZ * BLADES * rotor), now, smooth);
		this.whine?.frequency.setTargetAtTime(300 + 900 * rotor, now, smooth);
		this.whineGain?.gain.setTargetAtTime(0.018 * rotor, now, smooth);
		this.rumbleGain?.gain.setTargetAtTime(0.9 * rotor * (0.5 + 0.5 * load), now, smooth);
	}

	public destroy(): void {
		for (const source of this.sources) {
			try {
				source.stop();
			} catch {
				// Never started.
			}
		}
		this.output?.disconnect();
		this.sources = [];
		this.started = false;
	}
}
