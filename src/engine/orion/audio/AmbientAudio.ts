import { isOnLand } from "../world/StateOutline";
import { AT_LISTENER, LoopVoice } from "./SoundBank";
import type { Placement } from "./AudioBus";

/**
 * The bed of sound under everything: a recorded city street (distant traffic, the hum of a
 * neighbourhood) wherever there's land around, and surf as the shore comes close. Without it,
 * the gaps between engines and gunfire were dead silence, which is the clearest sign a world
 * is a game.
 *
 * How much sea is near is found by testing a ring of points round the listener against the
 * coastline, a few times a second, and easing towards it.
 */

/** Seconds between coastline checks. */
const CHECK_SECONDS = 0.5;
/** Rings (m) and points per ring tested for open water. */
const RINGS = [12, 30, 60];
const POINTS = 10;
const STREET_LEVEL = 0.22;
const WAVES_LEVEL = 0.75;
/** Higher than this, the street fades (it's a ground-level sound); the sea carries further. */
const STREET_CEILING = 60;

class AmbientAudio {
	private readonly street = new LoopVoice("amb-street", 1.2, "ambience");
	private readonly waves = new LoopVoice("amb-waves", 1.2, "ambience");
	private readonly placed: Placement = { ...AT_LISTENER };
	private sinceCheck = CHECK_SECONDS;
	private sea = 0;
	private height = 0;

	/** Once a frame, with the listener's position and how far it is above the ground (m). */
	public update(dt: number, x: number, z: number, aboveGround: number): void {
		this.sinceCheck += dt;
		if (this.sinceCheck >= CHECK_SECONDS) {
			this.sinceCheck = 0;
			let water = 0;
			let weight = 0;
			for (const [ring, radius] of RINGS.entries()) {
				// Nearer rings count for more: surf close by is loud, a bay a block away is not.
				const w = RINGS.length - ring;
				for (let k = 0; k < POINTS; k++) {
					const a = (k / POINTS) * Math.PI * 2;
					if (!isOnLand(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) water += w;
					weight += w;
				}
			}
			this.sea = water / weight;
			this.height = aboveGround;
		}
		const high = Math.min(1, Math.max(0, this.height / STREET_CEILING));
		// Out at sea there's no street to hear; on the shore both.
		const land = 1 - Math.min(1, this.sea * 1.4);
		this.street.set(STREET_LEVEL * land * (1 - high), this.placed);
		this.waves.set(WAVES_LEVEL * Math.min(1, this.sea * 2.2), this.placed);
	}
}

let ambient: AmbientAudio | null = null;

export function ambientAudio(): AmbientAudio {
	ambient ??= new AmbientAudio();
	return ambient;
}
