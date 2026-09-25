"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import { Color, Entity as PlayCanvasEntity, MeshInstance, StandardMaterial, type Mesh } from "playcanvas";
import { memo, useEffect, useState } from "react";

import { MeshBuilder } from "@/engine/orion/rendering/MeshBuilder";
import { PAVEMENT_TOP_Y, ROAD_GRID } from "@/engine/orion/roads/RoadNetwork";
import {
	crossRoadWidth,
	HEADINGS,
	JUNCTION_LAYOUT,
	junctionExists,
	leftOf,
	ROAD_TOP_Y,
	SIGNAL_APPROACHES,
	SIGNAL_GROUP_COUNT,
	signalColour,
	travelRoadWidth,
	type SignalColour,
	type TrafficAxis,
} from "@/engine/orion/traffic/TrafficSignals";

const MARKING_THICKNESS = 0.01;
/** Painted on top of the asphalt, clear of the lane line. */
const MARKING_Y = ROAD_TOP_Y + 0.007;

const POLE_HEIGHT = 5.6;
const POLE_HEAD_HEIGHT = 3;
const ARM_HEAD_HEIGHT = 5.05;
const LAMP_RADIUS = 0.11;
const LAMP_SPACING = 0.3;

const COLOURS: readonly SignalColour[] = ["red", "amber", "green"];
const LAMP_TINT: Readonly<Record<SignalColour, { on: string; off: string }>> = {
	red: { on: "#ff2a1f", off: "#3a0d0b" },
	amber: { on: "#ffb21a", off: "#3a2a0b" },
	green: { on: "#1fff6a", off: "#0b3a1c" },
};
const LAMP_ON_INTENSITY = 4;

type LampKey = `${number}-${TrafficAxis}-${SignalColour}`;

/**
 * Zebra crossings, stop lines and traffic signals for every junction in the city.
 *
 * All of it is merged into a handful of meshes: one for road paint, one for poles and signal
 * housings, and one per lamp *state group*. Junctions only differ by which of the two signal
 * groups they belong to, so every lamp of the same group, axis and colour switches together
 * by changing one shared material — the whole city's signals cost a dozen draw calls.
 */
export const StreetFurniture = memo(function StreetFurniture() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;

		const paint = buildRoadMarkings();
		const hardware = new MeshBuilder();
		const lamps = new Map<LampKey, MeshBuilder>();
		for (const approach of SIGNAL_APPROACHES) addSignal(approach, hardware, lamps);

		const paintMaterial = makeMaterial("#ebe8df", 0.25);
		const poleMaterial = makeMaterial("#2a2f33", 0.55);
		const lampMaterials = new Map<LampKey, StandardMaterial>();
		const meshes: Mesh[] = [];
		const holder = new PlayCanvasEntity("street-furniture-geometry");

		const paintMesh = paint.build(device);
		const hardwareMesh = hardware.build(device);
		meshes.push(paintMesh, hardwareMesh);

		const instances = [new MeshInstance(paintMesh, paintMaterial)];
		const hardwareInstance = new MeshInstance(hardwareMesh, poleMaterial);
		for (const [key, builder] of lamps) {
			const material = makeMaterial(LAMP_TINT[key.split("-")[2] as SignalColour].off, 0.8);
			lampMaterials.set(key, material);
			const mesh = builder.build(device);
			meshes.push(mesh);
			instances.push(new MeshInstance(mesh, material));
		}

		const markings = new PlayCanvasEntity("road-markings");
		markings.addComponent("render", { meshInstances: instances, castShadows: false, receiveShadows: true });
		const poles = new PlayCanvasEntity("signal-poles");
		poles.addComponent("render", { meshInstances: [hardwareInstance], castShadows: true, receiveShadows: true });
		// Poles are solid: the collision component only reads `meshes` from a render resource.
		poles.addComponent("collision", { type: "mesh", render: { meshes: [hardwareMesh] } as never });
		poles.addComponent("rigidbody", { type: "static" });
		holder.addChild(markings);
		holder.addChild(poles);
		root.addChild(holder);

		const lit = new Map<LampKey, boolean>();
		const updateLamps = () => {
			for (let group = 0; group < SIGNAL_GROUP_COUNT; group++) {
				for (const axis of ["ns", "ew"] as const) {
					const current = signalColour(group, axis);
					for (const colour of COLOURS) {
						const key: LampKey = `${group}-${axis}-${colour}`;
						const material = lampMaterials.get(key);
						const on = current === colour;
						if (!material || lit.get(key) === on) continue;
						lit.set(key, on);
						const tint = LAMP_TINT[colour];
						material.diffuse = new Color().fromString(on ? tint.on : tint.off);
						material.emissive = on ? new Color().fromString(tint.on) : new Color(0, 0, 0);
						material.emissiveIntensity = on ? LAMP_ON_INTENSITY : 0;
						material.update();
					}
				}
			}
		};
		updateLamps();
		app.on("update", updateLamps);

		return () => {
			app.off("update", updateLamps);
			holder.destroy();
			for (const mesh of meshes) mesh.destroy();
			for (const material of [paintMaterial, poleMaterial, ...lampMaterials.values()]) material.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="street-furniture" />;
});

function makeMaterial(colour: string, gloss: number): StandardMaterial {
	const material = new StandardMaterial();
	material.diffuse = new Color().fromString(colour);
	material.gloss = gloss;
	material.update();
	return material;
}

/** Zebra stripes on every junction arm and a stop line across the incoming lanes. */
function buildRoadMarkings(): MeshBuilder {
	const builder = new MeshBuilder();
	const { zebraStart, zebraEnd, stripeWidth, stripeGap, stopLine, stopLineThickness } = JUNCTION_LAYOUT;
	const bandLength = zebraEnd - zebraStart;

	ROAD_GRID.xs.forEach((x, xIndex) => {
		ROAD_GRID.zs.forEach((z, zIndex) => {
			for (const [dx, dz] of HEADINGS) {
				if (!junctionExists(xIndex + dx, zIndex + dz)) continue;
				const roadWidth = travelRoadWidth(xIndex, zIndex, dx);
				const back = crossRoadWidth(xIndex, zIndex, dx) / 2;
				const [lx, lz] = leftOf(dx, dz);
				const sized = (along: number, across: number): [number, number, number] => (
					dx !== 0 ? [along, MARKING_THICKNESS, across] : [across, MARKING_THICKNESS, along]
				);

				const bandCentre = back + zebraStart + bandLength / 2;
				const pitch = stripeWidth + stripeGap;
				const count = Math.floor((roadWidth - stripeGap) / pitch);
				const first = -((count - 1) * pitch) / 2;
				for (let i = 0; i < count; i++) {
					const offset = first + i * pitch;
					builder.addBox(
						[x + dx * bandCentre + lx * offset, MARKING_Y, z + dz * bandCentre + lz * offset],
						sized(bandLength, stripeWidth),
					);
				}

				// Traffic on this arm heading *into* the junction keeps left of its own heading
				// (-dx, -dz), which is the opposite side from this arm's own left.
				const halfRoad = roadWidth / 2;
				const incomingSide = -1;
				const lineOffset = incomingSide * (halfRoad / 2);
				const lineAlong = back + stopLine;
				builder.addBox(
					[x + dx * lineAlong + lx * lineOffset, MARKING_Y, z + dz * lineAlong + lz * lineOffset],
					sized(stopLineThickness, halfRoad - 0.3),
				);
			}
		});
	});
	return builder;
}

/** One signal pole with a head at eye level and a second on an arm over the lanes. */
function addSignal(approach: (typeof SIGNAL_APPROACHES)[number], hardware: MeshBuilder, lamps: Map<LampKey, MeshBuilder>) {
	const { dx, dz, pole, roadWidth, group, axis } = approach;
	const [lx, lz] = leftOf(dx, dz);
	const base = PAVEMENT_TOP_Y;
	const armLength = roadWidth * 0.42;
	// Facing oncoming drivers.
	const fx = -dx;
	const fz = -dz;
	const faceSize = (depth: number, width: number, height: number): [number, number, number] => (
		dx !== 0 ? [depth, height, width] : [width, height, depth]
	);

	hardware.addBox([pole[0], base + POLE_HEIGHT / 2, pole[1]], [0.16, POLE_HEIGHT, 0.16]);
	const armMidX = pole[0] - lx * (armLength / 2);
	const armMidZ = pole[1] - lz * (armLength / 2);
	hardware.addBox([armMidX, base + POLE_HEIGHT - 0.25, armMidZ], dx !== 0 ? [0.1, 0.1, armLength] : [armLength, 0.1, 0.1]);

	const heads: [number, number, number][] = [
		[pole[0] + fx * 0.2, base + POLE_HEAD_HEIGHT, pole[1] + fz * 0.2],
		[pole[0] - lx * armLength, base + ARM_HEAD_HEIGHT, pole[1] - lz * armLength],
	];
	for (const [hx, hy, hz] of heads) {
		hardware.addBox([hx, hy, hz], faceSize(0.26, 0.36, 1.0));
		hardware.addBox([hx - fx * 0.14, hy, hz - fz * 0.14], faceSize(0.03, 0.56, 1.2));
		COLOURS.forEach((colour, index) => {
			const key: LampKey = `${group}-${axis}-${colour}`;
			let builder = lamps.get(key);
			if (!builder) {
				builder = new MeshBuilder();
				lamps.set(key, builder);
			}
			const lampY = hy + LAMP_SPACING * (1 - index);
			builder.addDisc([hx + fx * 0.135, lampY, hz + fz * 0.135], LAMP_RADIUS, fx, fz);
			// A small visor above each lamp, as on real signal heads.
			hardware.addBox([hx + fx * 0.19, lampY + 0.13, hz + fz * 0.19], faceSize(0.12, 0.26, 0.02));
		});
	}
}
