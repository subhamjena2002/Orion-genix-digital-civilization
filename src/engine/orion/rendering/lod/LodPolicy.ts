/**
 * When to use which level of detail.
 *
 * Levels are chosen by how big the object is on screen (its bounding sphere's projected
 * height in pixels), not by raw distance: a car filling 300 px needs its full mesh whether
 * that's 20 m away on a laptop or 30 m on a 1440p monitor. Each level's geometry is simplified
 * to an error budget that stays below about a pixel at the size it switches in (see
 * `lodErrorBudget`), so a switch is not something the eye can pick out.
 *
 * Categories differ in how much they matter: the car being driven never drops detail, traffic
 * keeps its silhouette to long range, and small props give detail up early.
 */

export type LodCategory = "playerVehicle" | "vehicle" | "character" | "building" | "prop" | "weapon" | "environment";

export interface LodProfile {
	/**
	 * Projected height (px) at or above which each level is used, best first. The last level
	 * covers everything smaller. `[300, 120]` means LOD0 above 300 px, LOD1 down to 120, LOD2 below.
	 */
	thresholds: readonly number[];
	/** Fraction a threshold must be crossed by before switching back, so nothing flickers. */
	hysteresis: number;
	/** Closer than this (m) to the player, always full detail: it can be touched, hit or entered. */
	fullDetailWithin: number;
}

export const LOD_PROFILES: Readonly<Record<LodCategory, LodProfile>> = {
	// The car the player is in fills the screen and is always full detail.
	playerVehicle: { thresholds: [0], hysteresis: 0, fullDetailWithin: Infinity },
	// Traffic: full detail (spinning wheels, doors, interior) until ~30 m at 1080p, then
	// simplified meshes that keep the body shape — the last level is still a recognisable car.
	vehicle: { thresholds: [230, 95, 38], hysteresis: 0.12, fullDetailWithin: 14 },
	// Skinned characters are cheap to draw once their skinning is skipped off-screen; the
	// animation update rate is what scales (see NPC update tiers).
	character: { thresholds: [0], hysteresis: 0, fullDetailWithin: Infinity },
	building: { thresholds: [60], hysteresis: 0.15, fullDetailWithin: 40 },
	prop: { thresholds: [24], hysteresis: 0.15, fullDetailWithin: 10 },
	weapon: { thresholds: [0], hysteresis: 0, fullDetailWithin: Infinity },
	environment: { thresholds: [40], hysteresis: 0.15, fullDetailWithin: 25 },
};

/**
 * Height in pixels a sphere of `radius` at `distance` covers on a viewport `viewportHeight` px
 * tall with a vertical field of view of `fovDegrees`.
 */
export function projectedPixels(radius: number, distance: number, fovDegrees: number, viewportHeight: number): number {
	const halfFov = (fovDegrees * Math.PI) / 360;
	return (radius * viewportHeight) / (Math.max(distance, 1e-3) * Math.tan(halfFov));
}

/**
 * The level for an object `pixels` tall that is currently at `current`. Moving to a coarser
 * level needs the size to drop `hysteresis` below that level's threshold; moving to a finer
 * one needs it to rise the same share above.
 */
export function selectLod(pixels: number, current: number, profile: LodProfile): number {
	const { thresholds, hysteresis } = profile;
	let target = thresholds.length;
	for (let level = 0; level < thresholds.length; level++) {
		if (pixels >= thresholds[level]) {
			target = level;
			break;
		}
	}
	if (target === current || current < 0 || current > thresholds.length) return target;
	if (target > current) {
		// Coarser: the boundary crossed is the threshold of the level being left.
		return pixels < thresholds[current] * (1 - hysteresis) ? target : current;
	}
	// Finer: the boundary crossed is the threshold of the level being entered, one above current.
	return pixels >= thresholds[current - 1] * (1 + hysteresis) ? target : current;
}

/**
 * Geometric error (in world units) a level may have: what one pixel spans at the size the level
 * switches in, times `pixelBudget`. Level 0 is the source mesh, with no error.
 */
export function lodErrorBudget(level: number, profile: LodProfile, radius: number, pixelBudget = 0.6): number {
	if (level <= 0) return 0;
	const switchInPixels = profile.thresholds[level - 1];
	if (!(switchInPixels > 0)) return 0;
	// A sphere `switchInPixels` tall spans 2 * radius, so a pixel is 2 * radius / pixels.
	return (2 * radius * pixelBudget) / switchInPixels;
}
