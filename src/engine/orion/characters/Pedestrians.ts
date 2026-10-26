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
 * Skin tones cover a South Asian range; clothing comes as styled outfits (OUTFITS) in the
 * city's warm coastal look.
 *
 * Caveat: this changes colour, not tailoring. Garment *geometry* is still western
 * shirt-and-trousers — kurtas, sarees and uniforms need modelled assets.
 */
const SKIN_TONES = ["#8d5a3b", "#a9724a", "#6f4526", "#c08b5c", "#7d4f30", "#b07f52", "#94603f"];
/**
 * Whole outfits rather than a shirt and trousers drawn separately: random pairs gave the crowd
 * clashing primaries (orange over olive, purple over brown). These are styled pairs in the
 * city's warm coastal look: pastels and whites with navy, charcoal and tan, a few deep jewel
 * tones, and the odd all-black. [top, bottom].
 */
const OUTFITS: readonly (readonly [string, string])[] = [
	["#f4ede1", "#1f2a44"], // ivory linen, navy
	["#e8837a", "#f2ece0"], // coral, white
	["#7fc8b8", "#2a2f3a"], // mint, charcoal
	["#f2c4ce", "#3b4a6b"], // blush, denim
	["#1c1c22", "#1c1c22"], // all black
	["#2d6f8f", "#d9cfbd"], // ocean blue, stone
	["#f6d98c", "#33302b"], // butter yellow, espresso
	["#9b2335", "#202226"], // wine, black
	["#ffffff", "#8a6a4a"], // white, tan
	["#4b3f72", "#e6dfd2"], // aubergine, cream
	["#3f7a5a", "#e9e2d3"], // palm green, cream
	["#b9d7ef", "#262b33"], // sky, slate
	["#c96f3b", "#f0e8da"], // terracotta, off-white
	["#262a33", "#a89a84"], // graphite, khaki
	["#e3b6d6", "#ffffff"], // orchid, white
	["#0f4c5c", "#c8b79e"], // teal, sand
];
const HAIR_COLOURS = ["#141010", "#1d1512", "#2a1f1a", "#3b2516", "#4a2c1c"];

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

/**
 * A person's colours: one styled outfit, sometimes worn the other way round. Flipping is
 * skipped when it would put two pale halves together, which washes the figure out to one
 * cream shape.
 */
function outfit(random: () => number): PedestrianPalette {
	const skin = SKIN_TONES[Math.floor(random() * SKIN_TONES.length)];
	const [top, bottom] = OUTFITS[Math.floor(random() * OUTFITS.length)];
	const flip = random() < 0.25 && !(lightness(top) > 0.6 && lightness(bottom) > 0.6);
	const hair = HAIR_COLOURS[Math.floor(random() * HAIR_COLOURS.length)];
	return { skin, shirt: flip ? bottom : top, pants: flip ? top : bottom, hair };
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
