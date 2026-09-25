/**
 * The vehicle mix on Orion's streets. Bodies are generic, unbranded shapes built from
 * primitives: everyday hatchbacks and sedans, SUVs, low luxury coupés, three-wheeler autos and
 * police SUVs.
 */
export type VehicleStyle = "hatchback" | "sedan" | "suv" | "luxury" | "auto" | "police" | "truck" | "militaryWagon";

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
	sedan: { length: 4.5, width: 1.76, bodyHeight: 0.66, clearance: 0.17, cabinLength: 2.3, cabinHeight: 0.56, cabinOffset: -0.15, wheelRadius: 0.32, maxSpeed: 11.5 },
	suv: { length: 4.6, width: 1.86, bodyHeight: 0.92, clearance: 0.26, cabinLength: 2.8, cabinHeight: 0.7, cabinOffset: -0.35, wheelRadius: 0.38, maxSpeed: 11 },
	luxury: { length: 4.6, width: 1.94, bodyHeight: 0.56, clearance: 0.12, cabinLength: 1.9, cabinHeight: 0.46, cabinOffset: -0.25, wheelRadius: 0.34, maxSpeed: 13 },
	auto: { length: 2.7, width: 1.35, bodyHeight: 0.62, clearance: 0.16, cabinLength: 2.0, cabinHeight: 0.95, cabinOffset: -0.2, wheelRadius: 0.22, maxSpeed: 7.5 },
	police: { length: 4.6, width: 1.86, bodyHeight: 0.92, clearance: 0.26, cabinLength: 2.8, cabinHeight: 0.7, cabinOffset: -0.35, wheelRadius: 0.38, maxSpeed: 11.5 },
	// A flat-bed lorry: cab at the front over the front axle, a long bed behind it, and the ground
	// clearance and wheels of something built to leave the road.
	truck: { length: 9.6, width: 2.1, bodyHeight: 1, clearance: 0.5, cabinLength: 2.2, cabinHeight: 1.2, cabinOffset: 3.4, wheelRadius: 0.44, maxSpeed: 8 },
	// An army estate car: a civilian wagon body on a raised chassis and oversized tyres.
	militaryWagon: { length: 4.8, width: 2, bodyHeight: 0.85, clearance: 0.32, cabinLength: 2.6, cabinHeight: 0.75, cabinOffset: -0.25, wheelRadius: 0.4, maxSpeed: 10.5 },
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
 * `luxury` is deliberately absent: the two supercars that served it were real manufacturers'
 * designs and have been taken out of the build (see reference-assets/README.md). Spawning the
 * style anyway would fall back to a primitive box body, which is worse than a repetitive street.
 */
const FLEET: readonly [VehicleStyle, number][] = [
	["truck", 9],
	["militaryWagon", 9],
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
