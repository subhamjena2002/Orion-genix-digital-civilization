import { HIGHWAYS } from "../world/Highways";

/**
 * Story pieces lying about the city: ten pages torn from Meridian Logistics' shipping manifests.
 * Each one picked up says a line of what Crane's firm has been moving; all ten pay a bonus. They
 * aren't on the map — they're found by looking, glinting on a pavement or at the end of a road.
 */

export interface Manifest {
	id: string;
	x: number;
	z: number;
	/** What's on the page. */
	text: string;
}

/** Paid for each page, and for the set. */
export const MANIFEST_CASH = 250;
export const ALL_MANIFESTS_CASH = 5000;
/** Picked up from this close on foot, or this close driving past. */
export const PICKUP_ON_FOOT = 2.2;
export const PICKUP_IN_VEHICLE = 4.5;

function highwayEnd(id: string, back: number, left: number): { x: number; z: number } {
	const samples = HIGHWAYS.find((road) => road.id === id)?.samples ?? [];
	const end = samples[samples.length - 1];
	const at = samples[Math.max(0, samples.length - 1 - Math.round(back / 4))] ?? end;
	return { x: at.x + at.dirZ * left, z: at.z - at.dirX * left };
}

export const MANIFESTS: readonly Manifest[] = [
	{ id: "manifest-1", x: -247.5, z: -167.5, text: "Unit 14 — reclassified as scrap. Do not inspect. Do not weigh." },
	{ id: "manifest-2", x: 87.5, z: 87.5, text: "Consignee: 'Mr. C. Personal'. Contents: none listed. Insurance: excessive." },
	{ id: "manifest-3", x: 247.5, z: -87.5, text: "Sunset Park parcels 3 to 19: 'acquisition pending tenant cooperation'." },
	{ id: "manifest-4", x: -327.5, z: 232.5, text: "Cinder Boys — monthly retainer. Cost centre: Community Relations." },
	{ id: "manifest-5", x: 392.5, z: 7.5, text: "Twelve crates, army stencils painted over. Driver: J. Ruelle." },
	{ id: "manifest-6", x: -7.5, z: -247.5, text: "Kasper Motors: client vehicle, silver Phoenix. Retrieve the item in the glovebox." },
	{ id: "manifest-7", ...highwayEnd("sea-link", 30, -8), text: "Depot ledger moved to the Sea Link office. Paper only. Mr. Crane insists." },
	{ id: "manifest-8", ...highwayEnd("ghats-expressway", 30, 8), text: "Lookout site: 'temporary storage'. For what, the page doesn't say." },
	{ id: "manifest-9", x: -195, z: 384, text: "Payment to an informant at Kasper Motors: two thousand, 'consulting'." },
	{ id: "manifest-10", x: 410, z: 368, text: "Buyer meeting, Marina Heights. If followed, abort and run for the bridge." },
];

/** The page the player is close enough to pick up, if any of those not yet found. */
export function manifestInReach(x: number, z: number, inVehicle: boolean, found: (id: string) => boolean): Manifest | null {
	const reach = inVehicle ? PICKUP_IN_VEHICLE : PICKUP_ON_FOOT;
	for (const manifest of MANIFESTS) {
		if (!found(manifest.id) && Math.hypot(manifest.x - x, manifest.z - z) <= reach) return manifest;
	}
	return null;
}
