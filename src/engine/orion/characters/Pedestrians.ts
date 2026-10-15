export interface PedestrianPalette {
	skin: string;
	shirt: string;
	pants: string;
	hair: string;
}

export interface PedestrianSpawn {
	id: string;
	assetPath: string;
	/** Uniform scale that brings this particular model to human height. */
	scale: number;
	speed: number;
	/** Ground speed (m/s) this model's walk clip covers at its authored rate (see CHARACTER_MODELS). */
	walkSpeed: number;
	/** Seeds this individual's route choices so the crowd doesn't move as one. */
	seed: number;
	palette: PedestrianPalette;
}

/**
 * Character meshes are untextured with named materials, so appearance is driven by tinting.
 * Skin tones cover a South Asian range and the clothing palette leans on the saturated
 * colours common on Indian streets.
 *
 * Caveat: this changes colour, not tailoring. Garment *geometry* is still western
 * shirt-and-trousers — kurtas, sarees and uniforms need modelled assets.
 */
const SKIN_TONES = ["#8d5a3b", "#a9724a", "#6f4526", "#c08b5c", "#7d4f30", "#b07f52", "#94603f"];
const SHIRT_COLOURS = ["#d94f4f", "#e8a33d", "#2f8f6b", "#3f6bbf", "#8e4fa8", "#f2e6d0", "#d9762b", "#2c6e8f", "#c2185b", "#00897b", "#7e57c2", "#ef6c00"];
const PANTS_COLOURS = ["#2b2f38", "#3a3f33", "#d8d2c4", "#4a3b2f", "#1f2933", "#5b4636"];
const HAIR_COLOURS = ["#141010", "#1d1512", "#2a1f1a"];

const BASE = "/models/characters/orion-citizen";

/** Target height for an adult, matching the player's collision capsule. */
const HUMAN_HEIGHT = 1.8;

/**
 * Five women models against two men, so the crowd is mixed rather than all-male.
 *
 * `nativeHeight` is each GLB's measured skeleton height and differs by pack: the men's
 * armature carries a baked 100x scale and measures 4.75, while the women are already authored
 * at real-world 1.8. Scaling both by one shared constant rendered the women at a third size,
 * so the factor has to be per model.
 *
 * `walkSpeed` is how fast each pack's walk clip moves over the ground at its authored rate,
 * measured in game from the planted foot's speed against the body: about 1.0 m/s for the
 * women's pack (a shorter stride) and 1.5 m/s for the men's. With one 1.5 m/s figure for all,
 * the women's feet skated forward about a third of the ground they covered.
 */
const WOMEN_WALK_SPEED = 1.0;
const MEN_WALK_SPEED = 1.5;
const CHARACTER_MODELS: readonly { path: string; nativeHeight: number; walkSpeed: number }[] = [
	{ path: `${BASE}/citizen-woman-a.glb`, nativeHeight: 1.8, walkSpeed: WOMEN_WALK_SPEED },
	{ path: `${BASE}/citizen-woman-b.glb`, nativeHeight: 1.8, walkSpeed: WOMEN_WALK_SPEED },
	{ path: `${BASE}/citizen-woman-suit.glb`, nativeHeight: 1.8, walkSpeed: WOMEN_WALK_SPEED },
	{ path: `${BASE}/citizen-woman-worker.glb`, nativeHeight: 1.8, walkSpeed: WOMEN_WALK_SPEED },
	{ path: `${BASE}/citizen-woman-casual.glb`, nativeHeight: 1.8, walkSpeed: WOMEN_WALK_SPEED },
	{ path: `${BASE}/orion-citizen-casual.glb`, nativeHeight: 4.74, walkSpeed: MEN_WALK_SPEED },
	{ path: `${BASE}/orion-citizen.glb`, nativeHeight: 4.75, walkSpeed: MEN_WALK_SPEED },
];

/** How many pedestrians exist at once. They roam and recycle, so this is the on-screen crowd. */
export const PEDESTRIAN_POOL_SIZE = 34;

function mulberry32(seed: number) {
	let state = seed | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Every model the same number of times (give or take one), shuffled: picked at random, one
 * model could fill a third of the street while another hardly appeared.
 */
function modelDeck(random: () => number): (typeof CHARACTER_MODELS)[number][] {
	const deck = Array.from({ length: PEDESTRIAN_POOL_SIZE }, (_, index) => CHARACTER_MODELS[index % CHARACTER_MODELS.length]);
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[deck[i], deck[j]] = [deck[j], deck[i]];
	}
	return deck;
}

/** Relative luminance of a #rrggbb colour, 0..1 (gamma ignored: only used to compare). */
function lightness(hex: string): number {
	const value = parseInt(hex.slice(1), 16);
	return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
}

/** A person's colours. A pale shirt over pale trousers washed the whole figure out to one cream shape, so the trousers go dark then. */
function outfit(random: () => number): PedestrianPalette {
	const skin = SKIN_TONES[Math.floor(random() * SKIN_TONES.length)];
	const shirt = SHIRT_COLOURS[Math.floor(random() * SHIRT_COLOURS.length)];
	let pants = PANTS_COLOURS[Math.floor(random() * PANTS_COLOURS.length)];
	const hair = HAIR_COLOURS[Math.floor(random() * HAIR_COLOURS.length)];
	if (lightness(shirt) > 0.6 && lightness(pants) > 0.6) pants = PANTS_COLOURS[0];
	return { skin, shirt, pants, hair };
}

function buildPedestrians(): PedestrianSpawn[] {
	const random = mulberry32(20260916);
	const deck = modelDeck(random);
	return Array.from({ length: PEDESTRIAN_POOL_SIZE }, (_, index) => {
		const model = deck[index];
		return {
		id: `pedestrian-${index}`,
		assetPath: model.path,
		scale: HUMAN_HEIGHT / model.nativeHeight,
		// An unhurried strolling range around the pace the model's clip was made for, so the
		// stride is played no more than a little faster or slower than authored.
		speed: model.walkSpeed * (0.8 + random() * 0.3),
		walkSpeed: model.walkSpeed,
		seed: Math.floor(random() * 1_000_000),
		palette: outfit(random),
		};
	});
}

export const ORION_PEDESTRIANS: readonly PedestrianSpawn[] = buildPedestrians();
