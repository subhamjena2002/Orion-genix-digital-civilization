import { BAY_METRES, BAYS, GROUND_METRES } from "./FacadeTextures";

/**
 * Where the shop windows are on a building's ground floor, in the building's own space (base
 * centred on the origin, front facing +Z), worked out from the same mapping that lays the
 * painted shopfront texture onto it (CityBuildingMesh.facadeBand + FacadeTextures.paintShop), so
 * a round that strikes the painted glass is known to have struck glass, and which pane.
 *
 * Pure, so it's testable without a GPU.
 */

/** In each texture cell (one bay), the glass runs between these shares of its width... */
const GLASS_FROM = 0.08;
const GLASS_TO = 0.94;
/** ...and between these heights (m), from the pavement up (the plinth below, the sign above). */
export const SHOP_GLASS_BOTTOM = GROUND_METRES * (1 - 0.93);
export const SHOP_GLASS_TOP = GROUND_METRES * (1 - 0.22);
/** How close to a face (m) a point must be to be on it. */
const ON_FACE = 0.08;

export interface ShopPane {
	/** Which face: 0 front (+Z), 1 right (+X), 2 back (−Z), 3 left (−X). */
	side: number;
	/** The pane's number along that face. */
	bay: number;
	/** The pane's middle and half-size across the face (m), in building space. */
	x: number;
	y: number;
	z: number;
	halfWidth: number;
	halfHeight: number;
	/** Outward normal of the face. */
	nx: number;
	nz: number;
}

interface Side {
	nx: number;
	nz: number;
	fromX: number;
	fromZ: number;
	toX: number;
	toZ: number;
}

function sides(halfW: number, halfD: number): Side[] {
	return [
		{ nx: 0, nz: 1, fromX: -halfW, fromZ: halfD, toX: halfW, toZ: halfD },
		{ nx: 1, nz: 0, fromX: halfW, fromZ: halfD, toX: halfW, toZ: -halfD },
		{ nx: 0, nz: -1, fromX: halfW, fromZ: -halfD, toX: -halfW, toZ: -halfD },
		{ nx: -1, nz: 0, fromX: -halfW, fromZ: -halfD, toX: -halfW, toZ: halfD },
	];
}

/**
 * The shop pane at building-space point (x, y, z), or null if the point isn't on shop glass.
 * `uOffset` is the facade's texture offset (CityBuildingMesh: bayOffset / BAYS).
 */
export function shopPaneAt(width: number, depth: number, uOffset: number, x: number, y: number, z: number): ShopPane | null {
	if (y < SHOP_GLASS_BOTTOM || y > SHOP_GLASS_TOP) return null;
	const halfW = width / 2;
	const halfD = depth / 2;
	const all = sides(halfW, halfD);
	for (let index = 0; index < all.length; index++) {
		const side = all[index];
		// On this face: at its plane, within its length.
		const off = (x - side.fromX) * side.nx + (z - side.fromZ) * side.nz;
		if (Math.abs(off) > ON_FACE) continue;
		const length = Math.hypot(side.toX - side.fromX, side.toZ - side.fromZ);
		const dirX = (side.toX - side.fromX) / length;
		const dirZ = (side.toZ - side.fromZ) / length;
		const along = (x - side.fromX) * dirX + (z - side.fromZ) * dirZ;
		if (along < 0 || along > length) continue;
		const bays = Math.max(1, Math.round(length / BAY_METRES));
		// Texture coordinate along the face, as the facade band lays it.
		const perMetre = bays / BAYS / length;
		const u = uOffset + along * perMetre;
		const cells = u * BAYS;
		const cell = Math.floor(cells);
		const within = cells - cell;
		if (within < GLASS_FROM || within > GLASS_TO) continue;
		// The pane's extent along the face, back from texture space.
		const start = ((cell + GLASS_FROM) / BAYS - uOffset) / perMetre;
		const end = ((cell + GLASS_TO) / BAYS - uOffset) / perMetre;
		const clippedStart = Math.max(0, start);
		const clippedEnd = Math.min(length, end);
		const middle = (clippedStart + clippedEnd) / 2;
		return {
			side: index,
			bay: cell,
			x: side.fromX + dirX * middle,
			y: (SHOP_GLASS_BOTTOM + SHOP_GLASS_TOP) / 2,
			z: side.fromZ + dirZ * middle,
			halfWidth: (clippedEnd - clippedStart) / 2,
			halfHeight: (SHOP_GLASS_TOP - SHOP_GLASS_BOTTOM) / 2,
			nx: side.nx,
			nz: side.nz,
		};
	}
	return null;
}
