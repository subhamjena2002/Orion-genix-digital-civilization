import type { ImpactSurface } from "../traffic/CrashEffects";

/**
 * What the world is made of where a round strikes it, from the collider's name (the world's
 * colliders are named by what they are: see components/world). Rendering (dust, sparks, marks)
 * and sound both follow from it: plaster walls puff pale grit, tarmac dark dust, a pole sparks.
 */

const RULES: readonly [RegExp, ImpactSurface][] = [
	[/carriageway|road|highway|asphalt|runway|taxiway/i, "asphalt"],
	[/pole|post|signal|lamp|barrier|rail|train|carriage|fence|gunship|jet/i, "metal"],
	[/terrain|mountain|beach|sand|grass|hill|dune/i, "dirt"],
	// Before the ground: a building's lot id is in its name.
	[/building|house|station|hospital|tower|wall|estate-house/i, "plaster"],
	[/pavement|plaza|pad|lot|apron|shelter|deck|bridge|quay|pier|base/i, "concrete"],
];

/** The surface for a hit on the collider named `name`, whose surface faces up by `normalY`. */
export function surfaceOf(name: string, normalY: number): ImpactSurface {
	for (const [pattern, surface] of RULES) {
		if (!pattern.test(name)) continue;
		// A building's roof or a wall's top is a slab, not a plastered face.
		if (surface === "plaster" && normalY > 0.6) return "concrete";
		return surface;
	}
	return normalY > 0.6 ? "asphalt" : "concrete";
}

/** The decal a surface takes from a round, if any. */
export function markOf(surface: ImpactSurface): "plaster" | "metal" | null {
	switch (surface) {
		case "plaster":
		case "concrete":
		case "asphalt":
		case "hard":
			return "plaster";
		case "metal":
			return "metal";
		default:
			return null;
	}
}
