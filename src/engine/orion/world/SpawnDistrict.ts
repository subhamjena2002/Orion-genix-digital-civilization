import type { DressingItem } from "./StreetDressing";
import {
	bench, bin, box, busShelter, COLOURS, hedge, LAWN_Y, newBuilder, newsstand, PAD_TOP, pad, PAVEMENT_Y, planter, signpost, wall,
	type DistrictGeometry, type ParkedCarSpot, type Rect, type Vec3,
} from "./DistrictProps";

/**
 * The spawn district (Low-Density Residential, centred on 0, 0): where every session starts and
 * most cars are seen, dressed so it reads as a lived-in neighbourhood rather than buildings on a
 * lawn (Phase 3.0 audit, E2).
 *
 * Its south-west quarter held one house on a bare field. It now has a car park with parked cars
 * the player can take, a paved plaza round a fountain, a walled garden, and, along the two
 * avenues, a bus shelter, benches and bins on the building side of the pavement (the kerb side
 * already has the palms and street lights).
 *
 * All of it is plain boxes, vertex coloured, merged into one mesh and one static collider by the
 * component that shows it: one draw call (and its shadow) for the lot. Palms and lamps for the
 * plaza and garden join the street dressing's chunks instead (`spawnDistrictTrees`). Pure, so
 * it's testable without a GPU.
 */

/** The car park, the plaza and the garden: each clear of the roads, pavements and the house. */
export type { Rect } from "./DistrictProps";

export const SPAWN_LOT: Rect = { minX: -70, maxX: -44, minZ: -70, maxZ: -50 };
export const SPAWN_PLAZA: Rect = { minX: -70, maxX: -34, minZ: -44, maxZ: -13 };
export const SPAWN_GARDEN: Rect = { minX: -30, maxX: -12, minZ: -70, maxZ: -33 };

const BAY_WIDTH = 2.7;
const BAYS_PER_ROW = 9;
/** Bay centres along each row; row A faces north into the aisle, row B south. */
const bayX = (k: number) => SPAWN_LOT.minX + 2.5 + BAY_WIDTH * k;
const ROW_A_Z = SPAWN_LOT.minZ + 3;
const ROW_B_Z = SPAWN_LOT.maxZ - 3;

/**
 * Cars left in the car park: real ones, nobody in them, there for the taking (see ParkedVehicle).
 * Two, not a full lot: each is a whole car, some 30 draws and 24 shadow casters even simplified,
 * and four of them doubled the district's budget (+60 draw calls) at the spawn.
 */
export const SPAWN_PARKED_CARS: readonly ParkedCarSpot[] = [
	{ id: "parked-spawn-1", style: "hatchback", colour: "#2f6d5a", x: bayX(1), z: ROW_A_Z, yaw: 0, ground: PAD_TOP },
	{ id: "parked-spawn-2", style: "suv", colour: "#8f1d1d", x: bayX(6), z: ROW_B_Z, yaw: 180, ground: PAD_TOP },
];

const FOUNTAIN: Vec3 = [-52, PAD_TOP, -28.5];

/** Everything the district adds, as one mesh and one collider. */
export function spawnDistrictGeometry(): DistrictGeometry {
	const b = newBuilder();

	// The car park: asphalt, a kerb round it, bay lines, two rows of bays either side of an aisle.
	pad(b, SPAWN_LOT, 2, () => COLOURS.asphalt);
	for (const row of [ROW_A_Z, ROW_B_Z]) {
		for (let k = 0; k <= BAYS_PER_ROW; k++) {
			box(b, [bayX(k) - BAY_WIDTH / 2, PAD_TOP + 0.003, row], [0.1, 0.006, 5], COLOURS.line);
		}
	}
	box(b, [(SPAWN_LOT.minX + SPAWN_LOT.maxX) / 2, PAD_TOP + 0.08, SPAWN_LOT.minZ], [SPAWN_LOT.maxX - SPAWN_LOT.minX, 0.16, 0.25], COLOURS.kerb, 0, true);
	box(b, [SPAWN_LOT.minX, PAD_TOP + 0.08, (SPAWN_LOT.minZ + SPAWN_LOT.maxZ) / 2], [0.25, 0.16, SPAWN_LOT.maxZ - SPAWN_LOT.minZ], COLOURS.kerb, 0, true);
	// A hedge down the open east side, leaving the aisle as the way in from the plaza road.
	hedge(b, SPAWN_LOT.maxX + 0.6, SPAWN_LOT.minZ, SPAWN_LOT.maxX + 0.6, SPAWN_LOT.minZ + 7);
	hedge(b, SPAWN_LOT.maxX + 0.6, SPAWN_LOT.maxZ - 7, SPAWN_LOT.maxX + 0.6, SPAWN_LOT.maxZ);

	// The plaza: paving in two tones, a fountain, planters, benches facing the fountain, bins, a
	// newsstand by the avenue, a signpost and bollards along the pavement side.
	pad(b, SPAWN_PLAZA, 2, (i, j) => ((i + j) % 2 === 0 ? COLOURS.stoneA : COLOURS.stoneB));
	const [fx, , fz] = FOUNTAIN;
	box(b, [fx, PAD_TOP + 0.3, fz], [5, 0.6, 5], COLOURS.coping, 0, true);
	box(b, [fx, PAD_TOP + 0.56, fz], [4.4, 0.04, 4.4], COLOURS.water);
	box(b, [fx, PAD_TOP + 1.0, fz], [0.8, 1.4, 0.8], COLOURS.coping);
	box(b, [fx, PAD_TOP + 1.75, fz], [1.6, 0.15, 1.6], COLOURS.coping);
	box(b, [fx, PAD_TOP + 1.84, fz], [1.4, 0.03, 1.4], COLOURS.water);
	for (const [px, pz] of [[-63, -20], [-41, -20], [-63, -37], [-41, -37]]) planter(b, px, pz);
	bench(b, fx, PAD_TOP, fz - 5.5, 0);
	bench(b, fx, PAD_TOP, fz + 5.5, 180);
	bench(b, fx - 5.5, PAD_TOP, fz, 90);
	bench(b, fx + 5.5, PAD_TOP, fz, -90);
	for (const [bx, bz] of [[fx - 2, fz - 5.6], [fx + 2, fz + 5.6], [-66, -15], [-38, -40]]) bin(b, bx, PAD_TOP, bz);
	newsstand(b, -38.5, -16.5, 0);
	signpost(b, -35.5, -14);
	for (let x = -68; x <= -46; x += 3) box(b, [x, PAD_TOP + 0.45, -13.6], [0.22, 0.9, 0.22], COLOURS.bollard, 0, true);

	// The garden: a low wall round it with a gate on the avenue side, hedged beds, a gravel path,
	// two benches.
	const g = SPAWN_GARDEN;
	wall(b, g.minX, g.minZ, g.maxX, g.minZ);
	wall(b, g.minX, g.minZ, g.minX, g.maxZ);
	wall(b, g.maxX, g.minZ, g.maxX, g.maxZ);
	wall(b, g.minX, g.maxZ, (g.minX + g.maxX) / 2 - 1.5, g.maxZ);
	wall(b, (g.minX + g.maxX) / 2 + 1.5, g.maxZ, g.maxX, g.maxZ);
	pad(b, { minX: (g.minX + g.maxX) / 2 - 1.2, maxX: (g.minX + g.maxX) / 2 + 1.2, minZ: g.minZ + 1, maxZ: g.maxZ }, 2.4, () => COLOURS.gravel);
	for (const side of [-1, 1]) {
		const x = (g.minX + g.maxX) / 2 + side * 5;
		hedge(b, x, g.minZ + 4, x, g.minZ + 14, 0.9, 1.2);
		hedge(b, x, g.minZ + 20, x, g.maxZ - 4, 0.9, 1.2);
	}
	bench(b, (g.minX + g.maxX) / 2 - 2.2, PAD_TOP, g.minZ + 17, 90);
	bench(b, (g.minX + g.maxX) / 2 + 2.2, PAD_TOP, g.minZ + 17, -90);

	// The back yards between the other blocks' buildings and the side roads: hedged, with a gap
	// at each house, so the edge of the district reads as gardens rather than open field.
	for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1]]) {
		const edge = 72.5;
		for (const along of [[11, 26], [32, 44], [50, 64]]) {
			hedge(b, sx * along[0], sz * edge, sx * along[1], sz * edge);
			hedge(b, sx * edge, sz * along[0], sx * edge, sz * along[1]);
		}
	}

	// The avenues: a bus shelter on the westbound side, benches and bins on the building side of
	// the pavements, facing the road.
	busShelter(b, -45, -10.3, 0);
	for (const [x, z, yaw] of [[20, 8.4, 180], [-22, 8.4, 180], [26, -8.4, 0], [62, -8.4, 0], [8.4, 26, -90], [8.4, -46, -90], [-8.4, 46, 90], [-8.4, -26, 90]] as const) {
		bench(b, x, PAVEMENT_Y, z, yaw);
		const along = yaw === 0 || yaw === 180 ? [1.4, 0] : [0, 1.4];
		bin(b, x + along[0], PAVEMENT_Y, z + along[1]);
	}

	return { props: b.mesh, collider: b.collider };
}

/** Palms round the plaza and in the garden, and lamps on the plaza: merged with the street dressing. */
export function spawnDistrictTrees(): DressingItem[] {
	const items: DressingItem[] = [];
	const palm = (x: number, z: number, variant: number) => items.push({ kind: "palm", x, y: LAWN_Y, z, yaw: (variant * 97) % 360, variant });
	const lamp = (x: number, z: number, yaw: number) => items.push({ kind: "lamp", x, y: PAD_TOP, z, yaw, variant: 0 });
	for (const [x, z, v] of [[-67, -42, 0], [-37, -42, 1], [-67, -24, 2], [-37, -30, 3]] as const) palm(x, z, v);
	for (const [x, z, v] of [[-27, -66, 1], [-15, -66, 2], [-27, -40, 3], [-15, -44, 0]] as const) palm(x, z, v);
	lamp(-58, -16, 0);
	lamp(-46, -40, 180);
	return items;
}
