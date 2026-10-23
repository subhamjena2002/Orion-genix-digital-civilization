import { ESTATE_NAMES } from "./Estates";
import { ORION_DISTRICTS, type DistrictDefinition } from "./WorldModel";

/**
 * What a place is called, for the location card and the map: an estate by its name, a district
 * by the name people would use for it, or just the state.
 */

/** Districts known by a neighbourhood's name rather than their planning category. */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
	"low-density-residential": "Palm Row",
};

/** The district at (x, z), with a little slack at the edges (the roads between them). */
export function districtAt(x: number, z: number): DistrictDefinition | null {
	return ORION_DISTRICTS.find((candidate) => (
		Math.abs(candidate.bounds.center[0] - x) <= candidate.bounds.size[0] / 2 + 20
		&& Math.abs(candidate.bounds.center[2] - z) <= candidate.bounds.size[1] / 2 + 20
	)) ?? null;
}

export function districtName(district: DistrictDefinition): string {
	return DISPLAY_NAMES[district.id] ?? district.name;
}

/** Where (x, z) is, by name: an estate, a district, or just the state. */
export function placeName(x: number, z: number): string {
	const estate = ESTATE_NAMES.find((candidate) => Math.hypot(candidate.x - x, candidate.z - z) < 140);
	if (estate) return estate.name;
	const district = districtAt(x, z);
	return district ? districtName(district) : "Orion State";
}

/** What kind of place it is, in a few words: "Low-density residential", "Estate". */
export function placeKind(x: number, z: number): string {
	if (ESTATE_NAMES.some((candidate) => Math.hypot(candidate.x - x, candidate.z - z) < 140)) return "Estate";
	const district = districtAt(x, z);
	if (!district) return "Open country";
	const kind = district.kind.replace(/-/g, " ");
	return kind.charAt(0).toUpperCase() + kind.slice(1);
}
