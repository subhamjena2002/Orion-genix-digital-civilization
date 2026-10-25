import { audioBus, type Placement } from "./AudioBus";
import { LoopVoice } from "./SoundBank";

/**
 * What fires and the fight against them sound like: the roar and crackle of the nearest fires,
 * as loud and as deep as each is strong (dying back to a thin crackle as it's put out), the jet of
 * the nearest hose, and steam hissing where water lands on flames. The effects layer reports each
 * frame's fires and jets; this mixes the nearest of them into a few looping voices, so a street
 * of burning cars doesn't pile up dozens of loops, and everything stops the moment it's over.
 */

interface Source {
	x: number;
	y: number;
	z: number;
	level: number;
	extra: number;
	distance: number;
}

const FIRE_VOICES = 2;
const MAX_SOURCES = 12;

class FireAudio {
	private readonly fireLoops = Array.from({ length: FIRE_VOICES }, () => new LoopVoice("fire-loop", 0.35, "world"));
	private readonly water = new LoopVoice("water-loop", 0.18, "world");
	private readonly steam = new LoopVoice("steam-loop", 0.25, "world");
	private readonly fires: Source[] = Array.from({ length: MAX_SOURCES }, () => ({ x: 0, y: 0, z: 0, level: 0, extra: 0, distance: 0 }));
	private readonly jets: Source[] = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0, level: 0, extra: 0, distance: 0 }));
	private fireCount = 0;
	private jetCount = 0;
	private readonly placed: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };
	private readonly silent: Placement = { gain: 0, pan: 0, muffle: 20000, distance: 0 };

	/** A fire this frame, `intensity` 0..1. */
	public reportFire(x: number, y: number, z: number, intensity: number): void {
		if (this.fireCount >= this.fires.length || intensity <= 0.01) return;
		const source = this.fires[this.fireCount++];
		source.x = x;
		source.y = y;
		source.z = z;
		source.level = intensity;
	}

	/** A hose this frame: where its water lands, and how much steam it raises there (0..1). */
	public reportJet(x: number, y: number, z: number, steam: number): void {
		if (this.jetCount >= this.jets.length) return;
		const source = this.jets[this.jetCount++];
		source.x = x;
		source.y = y;
		source.z = z;
		source.level = 1;
		source.extra = steam;
	}

	/** Mixes this frame's reports; call once a frame after they're in. */
	public update(): void {
		const bus = audioBus();
		for (let i = 0; i < this.fireCount; i++) {
			const fire = this.fires[i];
			fire.distance = bus.place(fire.x, fire.y, fire.z, this.placed).distance;
		}
		// The nearest few, by a partial selection sort (a handful at most).
		for (let i = 0; i < Math.min(FIRE_VOICES, this.fireCount); i++) {
			let nearest = i;
			for (let j = i + 1; j < this.fireCount; j++) if (this.fires[j].distance < this.fires[nearest].distance) nearest = j;
			if (nearest !== i) [this.fires[i], this.fires[nearest]] = [this.fires[nearest], this.fires[i]];
		}
		this.fireLoops.forEach((loop, index) => {
			if (index >= this.fireCount) {
				loop.set(0, this.silent);
				return;
			}
			const fire = this.fires[index];
			bus.place(fire.x, fire.y, fire.z, this.placed);
			// A big fire roars low; a dying one is a thinner, higher crackle.
			loop.set(0.1 + 0.5 * fire.level, this.placed, 1.18 - 0.3 * fire.level);
		});
		let nearestJet: Source | null = null;
		let nearest = Infinity;
		for (let i = 0; i < this.jetCount; i++) {
			const jet = this.jets[i];
			const distance = bus.place(jet.x, jet.y, jet.z, this.placed).distance;
			if (distance < nearest) {
				nearest = distance;
				nearestJet = jet;
			}
		}
		if (nearestJet) {
			bus.place(nearestJet.x, nearestJet.y, nearestJet.z, this.placed);
			this.water.set(0.42, this.placed);
			this.steam.set(0.38 * nearestJet.extra, this.placed);
		} else {
			this.water.set(0, this.silent);
			this.steam.set(0, this.silent);
		}
		this.fireCount = 0;
		this.jetCount = 0;
	}
}

let instance: FireAudio | null = null;

export function fireAudio(): FireAudio {
	instance ??= new FireAudio();
	return instance;
}
