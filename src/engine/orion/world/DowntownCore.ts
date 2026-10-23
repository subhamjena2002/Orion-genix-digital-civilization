import {
	bench, billboard, bin, booth, box, busShelter, cafeTable, COLOURS, fence, hedge, LAWN_Y, newBuilder, newsstand, PAD_TOP, pad, PAVEMENT_Y, planter,
	type DistrictGeometry, type ParkedCarSpot, type Rect,
} from "./DistrictProps";
import type { DressingItem } from "./StreetDressing";

/**
 * Downtown Core (centred on 0, 160), dressed like the spawn district (see SpawnDistrict).
 *
 * The rail loop runs east–west through its two southern blocks at z = 120, and the parcels it
 * passes through were left as lawn: two bare fields between the road to the south and the row of
 * shops to the north. West of the avenue is now a surface car park with a pay booth; east, a
 * market square with food kiosks, café tables, planters and benches. The line itself is fenced
 * both sides, with billboards facing it from the strip behind the shops, and the avenues get
 * benches, bins and a bus shelter on the building side of the pavements.
 *
 * One mesh and one collider, as there; palms and lamps join the street dressing.
 */

/** The rail's centreline here, and the clearance nothing may be built within (RailLine). */
const RAIL_Z = 120;
const RAIL_CLEAR = 7;

export const DOWNTOWN_LOT: Rect = { minX: -66, maxX: -30, minZ: 90, maxZ: 110 };
export const DOWNTOWN_SQUARE: Rect = { minX: 14, maxX: 66, minZ: 90, maxZ: 110 };

const BAY_WIDTH = 2.7;
const BAYS_PER_ROW = 12;
const bayX = (k: number) => DOWNTOWN_LOT.minX + 2.5 + BAY_WIDTH * k;
const ROW_A_Z = DOWNTOWN_LOT.minZ + 3;
const ROW_B_Z = DOWNTOWN_LOT.maxZ - 3;

/** One car left in the car park (a whole car costs some 30 draws: see SpawnDistrict). */
export const DOWNTOWN_PARKED_CARS: readonly ParkedCarSpot[] = [
	{ id: "parked-downtown-1", style: "suv", colour: "#1f4f8a", x: bayX(3), z: ROW_B_Z, yaw: 180, ground: PAD_TOP },
];

/** The fences either side of the line, and how far along it they run each side of the avenue. */
export const DOWNTOWN_FENCES = { south: RAIL_Z - 5.4, north: RAIL_Z + 5.4, from: 11, to: 72 } as const;

/** Everything downtown adds, as one mesh and one collider. */
export function downtownGeometry(): DistrictGeometry {
	const b = newBuilder();

	// The car park: asphalt, bay lines, a kerb along the road side, a pay booth at the way in.
	pad(b, DOWNTOWN_LOT, 2, () => COLOURS.asphalt);
	for (const row of [ROW_A_Z, ROW_B_Z]) {
		for (let k = 0; k <= BAYS_PER_ROW; k++) box(b, [bayX(k) - BAY_WIDTH / 2, PAD_TOP + 0.003, row], [0.1, 0.006, 5], COLOURS.line);
	}
	box(b, [(DOWNTOWN_LOT.minX + DOWNTOWN_LOT.maxX) / 2, PAD_TOP + 0.08, DOWNTOWN_LOT.minZ], [DOWNTOWN_LOT.maxX - DOWNTOWN_LOT.minX, 0.16, 0.25], COLOURS.kerb, 0, true);
	booth(b, DOWNTOWN_LOT.maxX + 1.8, (DOWNTOWN_LOT.minZ + DOWNTOWN_LOT.maxZ) / 2);
	// Between the car park and the avenue: planters, and a billboard facing the avenue's traffic.
	for (const z of [93, 107]) planter(b, -19, z, 2.2);
	billboard(b, -21, 100, 90, [COLOURS.adSky, COLOURS.adSun, COLOURS.adCoral]);

	// The market square: terracotta and cream paving, two food kiosks, café tables, planters,
	// benches, bins, and a sculpture in the middle.
	const sq = DOWNTOWN_SQUARE;
	pad(b, sq, 2, (i, j) => ((i + j) % 2 === 0 ? COLOURS.terracotta : COLOURS.cream));
	newsstand(b, 22, 106, 180, COLOURS.kioskOrange, COLOURS.awningRed);
	newsstand(b, 58, 106, 180, COLOURS.kioskBlue, COLOURS.awningWhite);
	for (const [x, z, k] of [[28, 98, 0], [33, 102, 1], [38, 97, 0], [46, 101, 1], [51, 96, 0], [56, 100, 1]] as const) {
		cafeTable(b, x, z, k ? COLOURS.umbrellaB : COLOURS.umbrellaA);
	}
	for (const [x, z] of [[18, 93], [62, 93]]) planter(b, x, z);
	const [cx, cz] = [(sq.minX + sq.maxX) / 2, 104];
	box(b, [cx, PAD_TOP + 0.4, cz], [2.4, 0.8, 2.4], COLOURS.coping, 0, true);
	box(b, [cx, PAD_TOP + 2.0, cz], [0.7, 2.4, 0.7], COLOURS.adSun);
	box(b, [cx + 0.5, PAD_TOP + 3.0, cz], [1.6, 0.5, 0.5], COLOURS.adSky);
	bench(b, 30, PAD_TOP, 108.4, 180);
	bench(b, 50, PAD_TOP, 108.4, 180);
	for (const [x, z] of [[26, 108.6], [54, 108.6], [42, 92]]) bin(b, x, PAD_TOP, z);

	// The line: post-and-rail fences on both sides, east and west of the avenue's crossing.
	const f = DOWNTOWN_FENCES;
	for (const side of [-1, 1]) {
		const [x0, x1] = side > 0 ? [f.from, f.to] : [-f.to, -f.from];
		fence(b, x0, x1, f.south);
		fence(b, x0, x1, f.north);
	}
	// Behind the shops, across the line: billboards facing it, and a hedge along the shops' backs.
	billboard(b, -45, 130, 180, [COLOURS.adNight, COLOURS.adSun, COLOURS.adMint]);
	billboard(b, 40, 130, 180, [COLOURS.adCoral, COLOURS.cream, COLOURS.adSky]);
	for (const side of [-1, 1]) hedge(b, side * 12, 135.5, side * 62, 135.5, 1.0, 0.9);

	// The avenues: a bus shelter on the north side of the east–west one, benches and bins on the
	// building side of both pavements, clear of the junction and the level crossing.
	busShelter(b, -42, 169.0, 180);
	for (const [x, z, yaw] of [[-8.4, 140, 90], [8.4, 140, -90], [-8.4, 190, 90], [8.4, 215, -90], [25, 151.6, 0], [-50, 151.6, 0], [52, 168.4, 180], [-22, 168.4, 180]] as const) {
		bench(b, x, PAVEMENT_Y, z, yaw);
		const along = yaw === 0 || yaw === 180 ? [1.4, 0] : [0, 1.4];
		bin(b, x + along[0], PAVEMENT_Y, z + along[1]);
	}

	return { props: b.mesh, collider: b.collider };
}

/** Palms round the square and the car park, lamps over both: merged with the street dressing. */
export function downtownTrees(): DressingItem[] {
	const items: DressingItem[] = [];
	const palm = (x: number, z: number, variant: number) => items.push({ kind: "palm", x, y: LAWN_Y, z, yaw: (variant * 83) % 360, variant });
	const lamp = (x: number, z: number, yaw: number) => items.push({ kind: "lamp", x, y: PAD_TOP, z, yaw, variant: 0 });
	for (const [x, z, v] of [[15.5, 109, 0], [64.5, 109, 1], [15.5, 91.5, 2], [64.5, 91.5, 3], [-28, 111.5, 1], [-68, 111.5, 2]] as const) palm(x, z, v);
	lamp(-48, 100, 0);
	lamp(40, 109, 180);
	return items;
}

/** Areas laid on open ground, for tests: the car park and the square. */
export const DOWNTOWN_AREAS: readonly (readonly [string, Rect])[] = [["car park", DOWNTOWN_LOT], ["square", DOWNTOWN_SQUARE]];
/** Kept clear of the line (the fences stand inside this, by design). */
export const DOWNTOWN_RAIL = { z: RAIL_Z, clearance: RAIL_CLEAR } as const;
