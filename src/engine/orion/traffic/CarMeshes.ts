import type { GraphicsDevice, Mesh } from "playcanvas";

import { MeshBuilder } from "../rendering/MeshBuilder";
import { VEHICLE_SHAPES, type VehicleStyle } from "./Vehicles";

/** Parts that switch material at runtime are kept as their own meshes. */
export interface CarMeshes {
	/** Everything static, vertex-coloured, in one draw call. */
	body: Mesh;
	/** Windows, drawn see-through so the driver shows. */
	glass: Mesh;
	brake: Mesh;
	beaconRed: Mesh | null;
	beaconBlue: Mesh | null;
}

const COLOURS = {
	trim: "#202124",
	tyre: "#121212",
	hub: "#8d9195",
	headlight: "#fff8e0",
	policeStripe: "#1b3f94",
	canopy: "#f2c418",
	lightBar: "#18181b",
} as const;

const cache = new WeakMap<GraphicsDevice, Map<string, CarMeshes>>();

/**
 * Builds (once per style and paint colour) the merged meshes for a car, front facing +Z,
 * standing on y = 0. Cars sharing a style and colour share the same GPU buffers.
 */
export function getCarMeshes(device: GraphicsDevice, style: VehicleStyle, paint: string): CarMeshes {
	let byKey = cache.get(device);
	if (!byKey) {
		byKey = new Map();
		cache.set(device, byKey);
	}
	const key = `${style}:${paint}`;
	const cached = byKey.get(key);
	if (cached) return cached;

	const shape = VEHICLE_SHAPES[style];
	const { length, width, bodyHeight, clearance, cabinLength, cabinHeight, cabinOffset, wheelRadius } = shape;
	const isAuto = style === "auto";
	const bodyTop = clearance + bodyHeight;
	const cabinTop = bodyTop + cabinHeight;
	const front = length / 2;
	const lampY = clearance + bodyHeight * 0.72;

	const body = new MeshBuilder();
	const glass = new MeshBuilder();
	body.withColour(paint)
		.addBox([0, clearance + bodyHeight / 2, 0], [width, bodyHeight, length])
		// A slightly narrower shoulder line breaks up the slab sides.
		.addBox([0, bodyTop - 0.04, 0], [width + 0.03, 0.06, length * 0.94]);
	// A raised bonnet deck between the windscreen and the nose.
	const cabinFront = cabinOffset + cabinLength / 2;
	if (!isAuto) body.addBox([0, bodyTop + 0.02, (front + cabinFront) / 2], [width * 0.96, 0.04, front - cabinFront]);

	if (isAuto) {
		body.withColour(COLOURS.trim).addBox([0, bodyTop + cabinHeight / 2, cabinOffset - cabinLength * 0.3], [width * 0.98, cabinHeight, cabinLength * 0.4]);
		// Open sides: only corner posts under the canopy.
		for (const x of [-1, 1]) {
			body.addBox([x * (width / 2 - 0.05), bodyTop + cabinHeight / 2, cabinOffset + cabinLength / 2 - 0.05], [0.06, cabinHeight, 0.06]);
		}
		glass.addBox([0, bodyTop + cabinHeight * 0.55, cabinOffset + cabinLength / 2], [width * 0.84, cabinHeight * 0.6, 0.04]);
		body.withColour(COLOURS.canopy).addBox([0, cabinTop + 0.04, cabinOffset], [width * 1.04, 0.08, cabinLength * 1.06]);
	} else {
		glass.addBox([0, bodyTop + cabinHeight / 2, cabinOffset], [width * 0.88, cabinHeight, cabinLength]);
		// Pillars and roof in body colour so the glasshouse reads as windows, not a black box.
		body.withColour(paint);
		for (const x of [-1, 1]) {
			for (const z of [-1, 1]) {
				body.addBox([x * width * 0.44, bodyTop + cabinHeight / 2, cabinOffset + z * (cabinLength / 2 - 0.05)], [0.08, cabinHeight, 0.1]);
			}
		}
		body.addBox([0, cabinTop + 0.035, cabinOffset], [width * 0.9, 0.07, cabinLength * 0.96]);
	}

	body.withColour(COLOURS.trim)
		.addBox([0, clearance + 0.1, front + 0.04], [width * 0.98, 0.2, 0.1])
		.addBox([0, clearance + 0.1, -front - 0.04], [width * 0.98, 0.2, 0.1])
		.addBox([0, lampY - 0.1, front + 0.015], [width * 0.42, 0.14, 0.04]);
	body.withColour(COLOURS.headlight);
	for (const side of [-1, 1]) {
		body.addBox([side * (width / 2 - 0.28), lampY, front + 0.02], [0.34, 0.12, 0.04]);
	}
	if (!isAuto) {
		body.withColour(paint);
		for (const side of [-1, 1]) {
			body.addBox([side * (width / 2 + 0.08), bodyTop + 0.12, cabinOffset + cabinLength / 2 - 0.2], [0.14, 0.1, 0.18]);
		}
	}

	const wheels: [number, number, number][] = isAuto
		? [[0, wheelRadius, front - 0.35], [-width / 2 + 0.12, wheelRadius, -front + 0.45], [width / 2 - 0.12, wheelRadius, -front + 0.45]]
		: [-1, 1].flatMap((side) => [-1, 1].map((end): [number, number, number] => [side * (width / 2 - 0.1), wheelRadius, end * (front - wheelRadius - 0.45)]));
	for (const wheel of wheels) {
		body.withColour(COLOURS.tyre).addCylinderX(wheel, wheelRadius, 0.24);
		const outward = wheel[0] === 0 ? 0 : Math.sign(wheel[0]);
		if (outward !== 0) {
			body.withColour(COLOURS.hub).addCylinderX([wheel[0] + outward * 0.125, wheel[1], wheel[2]], wheelRadius * 0.55, 0.02, 10);
		}
	}

	const brake = new MeshBuilder();
	for (const side of [-1, 1]) {
		brake.addBox([side * (width / 2 - 0.24), lampY, -front - 0.02], [0.3, 0.12, 0.04]);
	}

	let beaconRed: MeshBuilder | null = null;
	let beaconBlue: MeshBuilder | null = null;
	if (style === "police") {
		body.withColour(COLOURS.policeStripe).addBox([0, clearance + bodyHeight * 0.45, 0], [width + 0.02, 0.16, length * 0.86]);
		body.withColour(COLOURS.lightBar).addBox([0, cabinTop + 0.11, cabinOffset + 0.2], [width * 0.62, 0.07, 0.3]);
		beaconRed = new MeshBuilder().addBox([-width * 0.16, cabinTop + 0.2, cabinOffset + 0.2], [width * 0.28, 0.12, 0.26]);
		beaconBlue = new MeshBuilder().addBox([width * 0.16, cabinTop + 0.2, cabinOffset + 0.2], [width * 0.28, 0.12, 0.26]);
	}

	const meshes: CarMeshes = {
		body: body.build(device),
		glass: glass.build(device),
		brake: brake.build(device),
		beaconRed: beaconRed?.build(device) ?? null,
		beaconBlue: beaconBlue?.build(device) ?? null,
	};
	// The cache keeps a reference of its own: a MeshInstance frees the mesh when the last
	// instance of it is destroyed, which would leave the next car using a freed buffer.
	for (const mesh of [meshes.body, meshes.glass, meshes.brake, meshes.beaconRed, meshes.beaconBlue]) mesh?.incRefCount();
	byKey.set(key, meshes);
	return meshes;
}

/** Height of the cabin roof above the road. */
export function carRoofHeight(style: VehicleStyle): number {
	const shape = VEHICLE_SHAPES[style];
	return shape.clearance + shape.bodyHeight + shape.cabinHeight;
}

/** Paint a burnt-out shell is repainted with. */
export const BURNT_PAINT = "#161514";

/**
 * Builds the burnt-out body for every style up front. A car burning out swaps to one of these,
 * and building it at that moment stalled the frame the explosion happened in.
 */
export function prewarmBurntBodies(device: GraphicsDevice): void {
	for (const style of Object.keys(VEHICLE_SHAPES) as VehicleStyle[]) getCarMeshes(device, style, BURNT_PAINT);
}

export function carHalfHeight(style: VehicleStyle): number {
	const shape = VEHICLE_SHAPES[style];
	return (shape.clearance + shape.bodyHeight + shape.cabinHeight) / 2;
}
