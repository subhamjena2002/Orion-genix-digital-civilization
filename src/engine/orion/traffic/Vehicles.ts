/**
 * The vehicle mix on Orion's streets. Each style is drawn by a real model where VEHICLE_MODELS has
 * one, and otherwise by a generic, unbranded body built from primitives: everyday hatchbacks,
 * SUVs and three-wheeler autos are still those.
 */
export type VehicleStyle =
	| "hatchback" | "sedan" | "suv" | "luxury" | "auto" | "police" | "truck" | "militaryWagon"
	// The civic fleet (see VEHICLE_MODELS): public and service vehicles.
	| "taxi" | "van" | "serviceTruck" | "towTruck" | "bus" | "schoolBus" | "garbageTruck" | "ambulance" | "fireTruck";

export interface VehicleShape {
	length: number;
	width: number;
	/** Lower body height, above the ground clearance. */
	bodyHeight: number;
	clearance: number;
	cabinLength: number;
	cabinHeight: number;
	/** Cabin centre along the car (positive = towards the front). */
	cabinOffset: number;
	wheelRadius: number;
	maxSpeed: number;
}

export const VEHICLE_SHAPES: Readonly<Record<VehicleStyle, VehicleShape>> = {
	hatchback: { length: 3.8, width: 1.66, bodyHeight: 0.72, clearance: 0.18, cabinLength: 2.1, cabinHeight: 0.62, cabinOffset: -0.2, wheelRadius: 0.3, maxSpeed: 10 },
	// The taxi's sedan in plain paint (see VEHICLE_MODELS), at its measured size.
	sedan: { length: 4.7, width: 1.8, bodyHeight: 0.66, clearance: 0.17, cabinLength: 2.3, cabinHeight: 0.56, cabinOffset: -0.15, wheelRadius: 0.32, maxSpeed: 11.5 },
	suv: { length: 4.6, width: 1.86, bodyHeight: 0.92, clearance: 0.26, cabinLength: 2.8, cabinHeight: 0.7, cabinOffset: -0.35, wheelRadius: 0.38, maxSpeed: 11 },
	// The Vesper GT (see VEHICLE_MODELS), at its built size: the supercar the races and the
	// garage use.
	luxury: { length: 4.6, width: 2.0, bodyHeight: 0.6, clearance: 0.11, cabinLength: 1.9, cabinHeight: 0.43, cabinOffset: -0.2, wheelRadius: 0.35, maxSpeed: 13 },
	auto: { length: 2.7, width: 1.35, bodyHeight: 0.62, clearance: 0.16, cabinLength: 2.0, cabinHeight: 0.95, cabinOffset: -0.2, wheelRadius: 0.22, maxSpeed: 7.5 },
	police: { length: 4.6, width: 1.86, bodyHeight: 0.92, clearance: 0.26, cabinLength: 2.8, cabinHeight: 0.7, cabinOffset: -0.35, wheelRadius: 0.38, maxSpeed: 11.5 },
	// A flat-bed lorry: cab at the front over the front axle, a long bed behind it, and the ground
	// clearance and wheels of something built to leave the road.
	truck: { length: 9.6, width: 2.1, bodyHeight: 1, clearance: 0.5, cabinLength: 2.2, cabinHeight: 1.2, cabinOffset: 3.4, wheelRadius: 0.44, maxSpeed: 8 },
	// An army estate car: a civilian wagon body on a raised chassis and oversized tyres.
	militaryWagon: { length: 4.8, width: 2, bodyHeight: 0.85, clearance: 0.32, cabinLength: 2.6, cabinHeight: 0.75, cabinOffset: -0.25, wheelRadius: 0.4, maxSpeed: 10.5 },
	// The civic fleet, at real-world sizes. The heights set the collision box; the cabin numbers
	// only matter for the fallback seat, as each model's own seat is measured (VehicleModels).
	taxi: { length: 4.7, width: 1.8, bodyHeight: 0.68, clearance: 0.17, cabinLength: 2.3, cabinHeight: 0.6, cabinOffset: -0.15, wheelRadius: 0.32, maxSpeed: 11 },
	van: { length: 5, width: 2, bodyHeight: 1.1, clearance: 0.2, cabinLength: 1.6, cabinHeight: 0.7, cabinOffset: 1.4, wheelRadius: 0.34, maxSpeed: 9.5 },
	serviceTruck: { length: 5.5, width: 2, bodyHeight: 0.9, clearance: 0.3, cabinLength: 1.9, cabinHeight: 0.8, cabinOffset: 1.2, wheelRadius: 0.38, maxSpeed: 10 },
	towTruck: { length: 6.5, width: 2.2, bodyHeight: 1, clearance: 0.35, cabinLength: 2, cabinHeight: 1.05, cabinOffset: 1.8, wheelRadius: 0.42, maxSpeed: 9 },
	bus: { length: 11, width: 2.55, bodyHeight: 1.5, clearance: 0.3, cabinLength: 9.5, cabinHeight: 1.2, cabinOffset: 0, wheelRadius: 0.5, maxSpeed: 8 },
	schoolBus: { length: 10, width: 2.45, bodyHeight: 1.4, clearance: 0.3, cabinLength: 8.4, cabinHeight: 1.2, cabinOffset: -0.4, wheelRadius: 0.48, maxSpeed: 8 },
	garbageTruck: { length: 8.5, width: 2.5, bodyHeight: 1.6, clearance: 0.35, cabinLength: 2, cabinHeight: 1.25, cabinOffset: 3, wheelRadius: 0.5, maxSpeed: 7 },
	ambulance: { length: 6.5, width: 2.2, bodyHeight: 1.3, clearance: 0.3, cabinLength: 1.8, cabinHeight: 1.1, cabinOffset: 2, wheelRadius: 0.4, maxSpeed: 11 },
	fireTruck: { length: 9.5, width: 2.5, bodyHeight: 1.5, clearance: 0.35, cabinLength: 2.4, cabinHeight: 1.25, cabinOffset: 3.3, wheelRadius: 0.5, maxSpeed: 10 },
};

export interface VehicleSpawn {
	id: string;
	style: VehicleStyle;
	colour: string;
	seed: number;
	/** Per-car variation on the style's top speed. */
	speedFactor: number;
}

const EVERYDAY_COLOURS = ["#f1f1ee", "#b9bcc0", "#8f1d1d", "#5c6166", "#1f4f8a", "#1a1a1c", "#d8cfbd", "#7a2f2f", "#e3e1dc", "#2f6d5a"];
const LUXURY_COLOURS = ["#0d0d10", "#0f2a5c", "#b3121b", "#e8e8e8", "#3b3f45"];
/** Autos wear the familiar green-and-yellow or black-and-yellow liveries. */
const AUTO_COLOURS = ["#2e8b3d", "#1c1c1c", "#2e8b3d"];

/**
 * What drives the streets. Only styles with a real model in VEHICLE_MODELS are here: a style
 * without one falls back to a box built from primitives, and those are off the streets until
 * there is art for them.
 *
 * That leaves TWO models to fill a city, which is thin — the counts below are up against how
 * much repetition is bearable rather than what the city wants. Every ordinary car added to
 * VEHICLE_MODELS (a hatchback, a sedan, a taxi) can take its style's line back.
 *
 * `luxury` is the Vesper GT: a handful of them, in the luxury paints, so a supercar turns up now
 * and then rather than on every corner. `sedan` (the taxi out of livery) is still kept for the
 * missions. (The two supercars that once served `luxury` were real manufacturers' designs, taken
 * out of the build: see reference-assets/README.md.)
 */
const FLEET: readonly [VehicleStyle, number][] = [
	["truck", 6],
	["militaryWagon", 6],
	["taxi", 6],
	["van", 3],
	["serviceTruck", 2],
	["towTruck", 2],
	["bus", 3],
	["schoolBus", 2],
	["garbageTruck", 2],
	["luxury", 4],
	// Ambulances wait outside the hospitals and fire trucks only turn out to fires: neither
	// drives around in ordinary traffic (see Hospital and FireService).
];

export const ORION_VEHICLES: readonly VehicleSpawn[] = FLEET.flatMap(([style, count]) => (
	Array.from({ length: count }, (_, index): VehicleSpawn => {
		const palette = style === "luxury" ? LUXURY_COLOURS : style === "auto" ? AUTO_COLOURS : EVERYDAY_COLOURS;
		return {
			id: `vehicle-${style}-${index + 1}`,
			style,
			colour: style === "police" ? "#f4f4f2" : palette[index % palette.length],
			seed: 7919 * (index + 1) + style.length * 104729,
			speedFactor: 0.85 + ((index * 37) % 25) / 100,
		};
	})
));
