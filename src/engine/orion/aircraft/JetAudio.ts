import { audioBus, type Placement } from "../audio/AudioBus";

/**
 * The jet's engines, synthesised like everything else the game plays:
 *  - the turbines' whine, two tones a fifth apart rising with the spool;
 *  - the roar of the exhaust: noise, opening up and getting louder with power;
 *  - the afterburner's deep rumble, only while it's lit.
 * It follows the engines' actual output, so spooling up and down is heard as it happens.
 */
export class JetAudio {
	private started = false;
	private output: GainNode | null = null;
	private panner: StereoPannerNode | null = null;
	private muffle: BiquadFilterNode | null = null;
	private whine: OscillatorNode | null = null;
	private whineHigh: OscillatorNode | null = null;
	private whineGain: GainNode | null = null;
	private roarFilter: BiquadFilterNode | null = null;
	private roarGain: GainNode | null = null;
	private burnerGain: GainNode | null = null;
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

		const whineGain = context.createGain();
		whineGain.gain.value = 0;
		const whine = context.createOscillator();
		whine.type = "triangle";
		whine.frequency.value = 600;
		const whineHigh = context.createOscillator();
		whineHigh.type = "sine";
		whineHigh.frequency.value = 900;
		whine.connect(whineGain);
		whineHigh.connect(whineGain);
		whineGain.connect(output);
		whine.start();
		whineHigh.start();

		const roarNoise = bus.startNoise(context);
		const roarFilter = context.createBiquadFilter();
		roarFilter.type = "lowpass";
		roarFilter.frequency.value = 500;
		roarFilter.Q.value = 0.7;
		const roarGain = context.createGain();
		roarGain.gain.value = 0;
		if (roarNoise) roarNoise.connect(roarFilter).connect(roarGain).connect(output);

		const burnerNoise = bus.startNoise(context);
		const burnerFilter = context.createBiquadFilter();
		burnerFilter.type = "lowpass";
		burnerFilter.frequency.value = 140;
		const burnerGain = context.createGain();
		burnerGain.gain.value = 0;
		if (burnerNoise) burnerNoise.connect(burnerFilter).connect(burnerGain).connect(output);

		this.output = output;
		this.muffle = muffle;
		this.panner = panner;
		this.whine = whine;
		this.whineHigh = whineHigh;
		this.whineGain = whineGain;
		this.roarFilter = roarFilter;
		this.roarGain = roarGain;
		this.burnerGain = burnerGain;
		this.sources = [whine, whineHigh, ...(roarNoise ? [roarNoise] : []), ...(burnerNoise ? [burnerNoise] : [])];
		return true;
	}

	/**
	 * Once a frame: where the jet is, the engines' output (0..1, afterburner above ~0.85) and
	 * whether the afterburner is lit. `inside` is the pilot's seat: louder, less muffled.
	 */
	public update(x: number, y: number, z: number, spool: number, afterburner: boolean, inside: boolean): void {
		if (spool < 0.01 && !this.started) return;
		if (!this.start()) return;
		const context = audioBus().ensure();
		if (!context || !this.output) return;
		const now = context.currentTime;
		const place = audioBus().place(x, y, z, this.placement);
		const smooth = 0.1;
		if (spool < 0.01) {
			this.output.gain.cancelScheduledValues(now);
			this.output.gain.setValueAtTime(0, now);
			return;
		}
		// A jet carries: heard further off than a car at the same distance.
		const level = inside ? 0.5 : Math.min(1, place.gain * 3.5);
		this.output.gain.setTargetAtTime(level * Math.min(1, spool * 3), now, smooth);
		this.panner?.pan.setTargetAtTime(inside ? 0 : place.pan, now, smooth);
		this.muffle?.frequency.setTargetAtTime(inside ? 7000 : Math.max(500, place.muffle), now, smooth);
		const power = Math.min(1, spool / 0.85);
		this.whine?.frequency.setTargetAtTime(420 + 1100 * power, now, smooth);
		this.whineHigh?.frequency.setTargetAtTime((420 + 1100 * power) * 1.5, now, smooth);
		this.whineGain?.gain.setTargetAtTime(0.012 + 0.02 * power, now, smooth);
		this.roarFilter?.frequency.setTargetAtTime(350 + 1500 * power, now, smooth);
		this.roarGain?.gain.setTargetAtTime(0.25 + 0.75 * power, now, smooth);
		this.burnerGain?.gain.setTargetAtTime(afterburner ? 1.6 : 0, now, afterburner ? 0.05 : 0.3);
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
