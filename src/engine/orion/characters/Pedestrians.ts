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
 */
const CHARACTER_MODELS: readonly { path: string; nativeHeight: number }[] = [
	{ path: `${BASE}/citizen-woman-a.glb`, nativeHeight: 1.8 },
	{ path: `${BASE}/citizen-woman-b.glb`, nativeHeight: 1.8 },
	{ path: `${BASE}/citizen-woman-suit.glb`, nativeHeight: 1.8 },
	{ path: `${BASE}/citizen-woman-worker.glb`, nativeHeight: 1.8 },
	{ path: `${BASE}/citizen-woman-casual.glb`, nativeHeight: 1.8 },
	{ path: `${BASE}/orion-citizen-casual.glb`, nativeHeight: 4.74 },
	{ path: `${BASE}/orion-citizen.glb`, nativeHeight: 4.75 },
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

function buildPedestrians(): PedestrianSpawn[] {
	const random = mulberry32(20260916);
	return Array.from({ length: PEDESTRIAN_POOL_SIZE }, (_, index) => {
		const model = CHARACTER_MODELS[Math.floor(random() * CHARACTER_MODELS.length)];
		return {
		id: `pedestrian-${index}`,
		assetPath: model.path,
		scale: HUMAN_HEIGHT / model.nativeHeight,
		// An unhurried strolling range — people on a pavement, not joggers.
		speed: 1.05 + random() * 0.45,
		seed: Math.floor(random() * 1_000_000),
		palette: {
			skin: SKIN_TONES[Math.floor(random() * SKIN_TONES.length)],
			shirt: SHIRT_COLOURS[Math.floor(random() * SHIRT_COLOURS.length)],
			pants: PANTS_COLOURS[Math.floor(random() * PANTS_COLOURS.length)],
			hair: HAIR_COLOURS[Math.floor(random() * HAIR_COLOURS.length)],
			},
		};
	});
}

export const ORION_PEDESTRIANS: readonly PedestrianSpawn[] = buildPedestrians();
