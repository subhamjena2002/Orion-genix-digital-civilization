/**
 * The city's hospitals: where they stand, and where their ambulances wait.
 *
 * Ambulances don't cruise with the traffic: they're parked in each hospital's bay, facing the
 * road, as real ones stand ready. Each compound takes the place of two ordinary grid buildings,
 * like the police station does.
 */

export interface ParkedAmbulance {
	id: string;
	position: readonly [number, number];
	/** Heading, degrees about Y (0 = +Z). */
	yaw: number;
}

export interface HospitalDef {
	id: string;
	name: string;
	/** Ground-floor centre. */
	position: readonly [number, number];
	footprint: readonly [number, number];
	/** Which way the entrance faces: +1 towards +Z, -1 towards -Z (always onto the main road). */
	facing: 1 | -1;
	/** The ambulance bay beside it. */
	bay: { position: readonly [number, number]; size: readonly [number, number] };
	ambulances: readonly ParkedAmbulance[];
	/** Grid buildings the compound replaces. */
	replacesBuildings: readonly string[];
}

export const HOSPITALS: readonly HospitalDef[] = [
	{
		// Across the main arterial from the police station, facing it.
		id: "city-hospital",
		name: "City Hospital",
		position: [-35, 17],
		footprint: [18, 12],
		facing: -1,
		bay: { position: [-57, 17], size: [20, 12] },
		ambulances: [
			{ id: "ambulance-city-1", position: [-61.5, 16], yaw: 180 },
			{ id: "ambulance-city-2", position: [-54.5, 16], yaw: 180 },
		],
		replacesBuildings: ["building-014", "building-015"],
	},
	{
		id: "sunrise-hospital",
		name: "Sunrise Hospital",
		position: [285, -17],
		footprint: [18, 12],
		facing: 1,
		bay: { position: [267, -17], size: [20, 12] },
		ambulances: [
			{ id: "ambulance-sunrise-1", position: [263.5, -18], yaw: 0 },
			{ id: "ambulance-sunrise-2", position: [270.5, -18], yaw: 0 },
		],
		replacesBuildings: ["building-290", "building-291"],
	},
];

export const HOSPITAL_REPLACED_BUILDINGS: readonly string[] = HOSPITALS.flatMap((hospital) => hospital.replacesBuildings);
