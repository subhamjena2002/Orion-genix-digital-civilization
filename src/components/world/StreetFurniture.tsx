"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity as PlayCanvasEntity, MeshInstance, StandardMaterial, type GraphicsDevice, type Mesh, type Texture } from "playcanvas";
import { memo, useEffect, useState } from "react";

import { makeCanvas, textureFromCanvas, type Canvas2D } from "@/engine/orion/rendering/CanvasTextures";
import { MeshBuilder } from "@/engine/orion/rendering/MeshBuilder";
import { PAVEMENT_TOP_Y, ROAD_GRID, roadWidthAt } from "@/engine/orion/roads/RoadNetwork";
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
	signalCountdown,
	travelRoadWidth,
	type SignalColour,
	type TrafficAxis,
} from "@/engine/orion/traffic/TrafficSignals";

const MARKING_THICKNESS = 0.01;
/** Painted on top of the asphalt, clear of the lane line. */
const MARKING_Y = ROAD_TOP_Y + 0.007;

const POLE_HEIGHT = 6.2;
/** Centre of the head on the pole, at a driver's eye line through the windscreen. */
const POLE_HEAD_HEIGHT = 3.1;
/** The mast arm leaves the pole this far below its top, rising a little to its tip. */
const ARM_DROP = 0.35;
const ARM_RISE = 0.25;
/** Overhead heads hang this far below the arm (centre of the head). */
const HANG = 0.75;
/** Lamps: 300 mm lenses, as on real signals. */
const LAMP_RADIUS = 0.15;
const LAMP_SPACING = 0.36;
const HEAD_WIDTH = 0.44;
const HEAD_HEIGHT = 1.18;
const HEAD_DEPTH = 0.3;
/** The backplate: black, edged in retroreflective yellow so the head reads against the sky. */
const PLATE_WIDTH = 0.84;
const PLATE_HEIGHT = 1.56;
const PLATE_BORDER = 0.06;
const VISOR_LENGTH = 0.16;
/** Visors are cut away underneath, so the lamp shows to drivers right below it. */
const VISOR_OPENING = Math.PI * 0.6;
/** Glow round a lit lens, metres across. */
const HALO_SIZE = 1.1;
/** The countdown display on the pole, under the head. */
const COUNTDOWN_HEIGHT = 2.15;
const COUNTDOWN_SIZE: readonly [number, number] = [0.6, 0.36];

const COLOURS: readonly SignalColour[] = ["red", "amber", "green"];
const LAMP_TINT: Readonly<Record<SignalColour, { on: string; off: string }>> = {
	red: { on: "#ff2418", off: "#2a0907" },
	amber: { on: "#ffa514", off: "#2a1a05" },
	green: { on: "#14ffa0", off: "#05261a" },
};
/** LEDs: bright enough to read from a block away, not so bright the colour burns out to white. */
const LAMP_ON_INTENSITY = 3.2;
const HALO_INTENSITY = 2;

type LampKey = `${number}-${TrafficAxis}-${SignalColour}`;
type DisplayKey = `${number}-${TrafficAxis}`;

interface SignalBuilders {
	metal: MeshBuilder;
	housing: MeshBuilder;
	border: MeshBuilder;
	lamps: Map<LampKey, MeshBuilder>;
	halos: Map<LampKey, MeshBuilder>;
	displays: Map<DisplayKey, MeshBuilder>;
}

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
		const builders: SignalBuilders = { metal: new MeshBuilder(), housing: new MeshBuilder(), border: new MeshBuilder(), lamps: new Map(), halos: new Map(), displays: new Map() };
		for (const approach of SIGNAL_APPROACHES) addSignal(approach, builders);

		const paintMaterial = makeMaterial("#ebe8df", 0.25);
		// Galvanised steel, the dark powder-coat of the heads, and the yellow edge of the backplates.
		const metalMaterial = makeMaterial("#9ba3a8", 0.62, 0.75);
		const housingMaterial = makeMaterial("#121518", 0.5);
		// Visors are open tubes: their insides are seen through the open end.
		housingMaterial.cull = CULLFACE_NONE;
		housingMaterial.update();
		const borderMaterial = makeMaterial("#f2c300", 0.35);
		borderMaterial.emissive = new Color(0.12, 0.09, 0);
		borderMaterial.update();
		const haloTexture = makeHaloTexture(device);
		const lampMaterials = new Map<LampKey, StandardMaterial>();
		const haloInstances = new Map<LampKey, MeshInstance>();
		const displays = new Map<DisplayKey, { context: Canvas2D; texture: Texture; material: StandardMaterial; shown: string }>();
		const meshes: Mesh[] = [];
		const holder = new PlayCanvasEntity("street-furniture-geometry");

		const paintMesh = paint.build(device);
		const metalMesh = builders.metal.build(device);
		meshes.push(paintMesh, metalMesh);

		const markingInstances = [new MeshInstance(paintMesh, paintMaterial)];
		const signalInstances = [new MeshInstance(metalMesh, metalMaterial)];
		for (const [builder, material] of [[builders.housing, housingMaterial], [builders.border, borderMaterial]] as const) {
			const mesh = builder.build(device);
			meshes.push(mesh);
			signalInstances.push(new MeshInstance(mesh, material));
		}
		const ledTexture = makeLedTexture(device);
		for (const [key, builder] of builders.lamps) {
			const material = makeMaterial(LAMP_TINT[key.split("-")[2] as SignalColour].off, 0.55);
			material.emissiveMap = ledTexture;
			lampMaterials.set(key, material);
			const mesh = builder.build(device);
			meshes.push(mesh);
			signalInstances.push(new MeshInstance(mesh, material));
		}
		const glowInstances: MeshInstance[] = [];
		for (const [key, builder] of builders.halos) {
			const material = makeHaloMaterial(haloTexture, LAMP_TINT[key.split("-")[2] as SignalColour].on);
			const mesh = builder.build(device);
			meshes.push(mesh);
			const instance = new MeshInstance(mesh, material);
			instance.visible = false;
			haloInstances.set(key, instance);
			glowInstances.push(instance);
		}
		for (const [key, builder] of builders.displays) {
			const context = makeCanvas(128, 64);
			paintCountdown(context, 0, "#000");
			const texture = textureFromCanvas(device, context, { name: `signal-countdown-${key}`, srgb: true, anisotropy: 4 });
			const material = new StandardMaterial();
			material.diffuse = new Color(0, 0, 0);
			material.emissive = new Color(1, 1, 1);
			material.emissiveMap = texture;
			material.emissiveIntensity = 2.2;
			material.update();
			displays.set(key, { context, texture, material, shown: "" });
			const mesh = builder.build(device);
			meshes.push(mesh);
			signalInstances.push(new MeshInstance(mesh, material));
		}

		const markings = new PlayCanvasEntity("road-markings");
		markings.addComponent("render", { meshInstances: markingInstances, castShadows: false, receiveShadows: true });
		const poles = new PlayCanvasEntity("signal-poles");
		poles.addComponent("render", { meshInstances: signalInstances, castShadows: true, receiveShadows: true });
		// Poles and arms are solid: the collision component only reads `meshes` from a render resource.
		poles.addComponent("collision", { type: "mesh", render: { meshes: [metalMesh] } as never });
		poles.addComponent("rigidbody", { type: "static" });
		const glow = new PlayCanvasEntity("signal-glow");
		glow.addComponent("render", { meshInstances: glowInstances, castShadows: false, receiveShadows: false });
		holder.addChild(markings);
		holder.addChild(poles);
		holder.addChild(glow);
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
						const halo = haloInstances.get(key);
						if (halo) halo.visible = on;
					}
					// The countdown: repainted only when its number (or colour) changes.
					const display = displays.get(`${group}-${axis}`);
					if (display) {
						const { colour, seconds } = signalCountdown(group, axis);
						const text = `${colour}:${seconds}`;
						if (text !== display.shown) {
							display.shown = text;
							paintCountdown(display.context, seconds, LAMP_TINT[colour].on);
							const pixels = display.texture.lock() as Uint8Array;
							pixels.set(display.context.getImageData(0, 0, 128, 64).data);
							display.texture.unlock();
						}
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
			for (const material of [paintMaterial, metalMaterial, housingMaterial, borderMaterial, ...lampMaterials.values()]) material.destroy();
			for (const instance of haloInstances.values()) instance.material.destroy();
			for (const display of displays.values()) {
				display.material.destroy();
				display.texture.destroy();
			}
			haloTexture.destroy();
			ledTexture.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="street-furniture" />;
});

function makeMaterial(colour: string, gloss: number, metalness?: number): StandardMaterial {
	const material = new StandardMaterial();
	material.diffuse = new Color().fromString(colour);
	material.gloss = gloss;
	if (metalness !== undefined) {
		material.useMetalness = true;
		material.metalness = metalness;
	}
	material.update();
	return material;
}

/** An LED lens up close: a grid of round emitters, each glowing at its centre. */
function makeLedTexture(device: GraphicsDevice): Texture {
	const size = 128;
	const context = makeCanvas(size, size);
	context.fillStyle = "rgb(70,70,70)";
	context.fillRect(0, 0, size, size);
	const pitch = size / 11;
	for (let row = 0; row < 11; row++) {
		for (let column = 0; column < 11; column++) {
			const x = (column + 0.5) * pitch + (row % 2 ? pitch / 2 : 0);
			const y = (row + 0.5) * pitch;
			const gradient = context.createRadialGradient(x, y, 0, x, y, pitch * 0.48);
			gradient.addColorStop(0, "rgb(255,255,255)");
			gradient.addColorStop(0.6, "rgb(215,215,215)");
			gradient.addColorStop(1, "rgb(70,70,70)");
			context.fillStyle = gradient;
			context.beginPath();
			context.arc(x, y, pitch * 0.48, 0, Math.PI * 2);
			context.fill();
		}
	}
	return textureFromCanvas(device, context, { name: "signal-led", srgb: true, anisotropy: 4 });
}

/** A soft round glow, bright in the middle and gone at the edge. */
function makeHaloTexture(device: GraphicsDevice): Texture {
	const context = makeCanvas(64, 64);
	const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0, "rgba(255,255,255,1)");
	gradient.addColorStop(0.18, "rgba(255,255,255,0.55)");
	gradient.addColorStop(0.5, "rgba(255,255,255,0.12)");
	gradient.addColorStop(1, "rgba(255,255,255,0)");
	context.fillStyle = "#000";
	context.fillRect(0, 0, 64, 64);
	context.fillStyle = gradient;
	context.fillRect(0, 0, 64, 64);
	return textureFromCanvas(device, context, { name: "signal-halo", srgb: true });
}

/** Light added over whatever is behind it, like the haze round a bright lamp. */
function makeHaloMaterial(texture: Texture, colour: string): StandardMaterial {
	const material = new StandardMaterial();
	material.diffuse = new Color(0, 0, 0);
	material.emissive = new Color().fromString(colour);
	material.emissiveMap = texture;
	material.emissiveIntensity = HALO_INTENSITY;
	material.blendType = BLEND_ADDITIVE;
	material.depthWrite = false;
	material.useLighting = false;
	material.update();
	return material;
}

/** Which of the seven segments (a to g) each digit lights. */
const SEGMENTS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];

/**
 * Two LED seven-segment digits, as on the countdown timers at city junctions: lit segments in the
 * signal's colour, the unlit ones faintly visible behind them.
 */
function paintCountdown(context: Canvas2D, seconds: number, colour: string): void {
	context.fillStyle = "#020303";
	context.fillRect(0, 0, 128, 64);
	const digits = seconds > 0 ? String(Math.min(99, seconds)).padStart(2, " ") : "  ";
	const w = 30;
	const h = 46;
	const t = 6;
	const segment = (x: number, y: number, name: string) => {
		const rects: Record<string, [number, number, number, number]> = {
			a: [x + t, y, w - 2 * t, t],
			b: [x + w - t, y + t, t, h / 2 - t],
			c: [x + w - t, y + h / 2, t, h / 2 - t],
			d: [x + t, y + h - t, w - 2 * t, t],
			e: [x, y + h / 2, t, h / 2 - t],
			f: [x, y + t, t, h / 2 - t],
			g: [x + t, y + h / 2 - t / 2, w - 2 * t, t],
		};
		const [rx, ry, rw, rh] = rects[name];
		context.fillRect(rx, ry, rw, rh);
	};
	context.fillStyle = colour;
	context.shadowColor = colour;
	digits.split("").forEach((digit, index) => {
		const x = 26 + index * 42;
		context.globalAlpha = 0.08;
		context.shadowBlur = 0;
		for (const name of "abcdefg") segment(x, 9, name);
		if (digit === " ") return;
		context.globalAlpha = 1;
		context.shadowBlur = 8;
		for (const name of SEGMENTS[Number(digit)]) segment(x, 9, name);
	});
	context.globalAlpha = 1;
	context.shadowBlur = 0;
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
	addEdgeLines(builder);
	return builder;
}

/** Edge lines sit this far in from the kerb, and are this wide. */
const EDGE_LINE_INSET = 0.35;
const EDGE_LINE_WIDTH = 0.15;

/**
 * Solid white edge lines along both sides of every street, from one junction's stop line to the
 * next: stopping at the junctions, as painted lines do, rather than running across them.
 */
function addEdgeLines(builder: MeshBuilder): void {
	const gap = JUNCTION_LAYOUT.stopLine;
	// North–south streets run along z between the east–west ones, and the other way round.
	for (const [lines, crossings, northSouth] of [[ROAD_GRID.xs, ROAD_GRID.zs, true], [ROAD_GRID.zs, ROAD_GRID.xs, false]] as const) {
		for (const line of lines) {
			const inset = roadWidthAt(line) / 2 - EDGE_LINE_INSET;
			for (let i = 1; i < crossings.length; i++) {
				const start = crossings[i - 1] + roadWidthAt(crossings[i - 1]) / 2 + gap;
				const end = crossings[i] - roadWidthAt(crossings[i]) / 2 - gap;
				if (end - start < 1) continue;
				const middle = (start + end) / 2;
				for (const side of [-1, 1]) {
					const across = line + side * inset;
					builder.addBox(
						northSouth ? [across, MARKING_Y, middle] : [middle, MARKING_Y, across],
						northSouth ? [EDGE_LINE_WIDTH, MARKING_THICKNESS, end - start] : [end - start, MARKING_THICKNESS, EDGE_LINE_WIDTH],
					);
				}
			}
		}
	}
}

/**
 * One signal: a round galvanised pole with a head at a driver's eye line and a countdown under it,
 * and a mast arm out over the lanes with a head hanging above them (two on a wide road).
 */
function addSignal(approach: (typeof SIGNAL_APPROACHES)[number], builders: SignalBuilders) {
	const { dx, dz, pole, roadWidth, group, axis } = approach;
	const [lx, lz] = leftOf(dx, dz);
	const base = PAVEMENT_TOP_Y;
	const [px, pz] = pole;
	const armLength = roadWidth * 0.62;
	// Facing oncoming drivers.
	const fx = -dx;
	const fz = -dz;
	const faceSize = (depth: number, width: number, height: number): [number, number, number] => (
		dx !== 0 ? [depth, height, width] : [width, height, depth]
	);
	const { metal, housing, border } = builders;

	// The pole on its foundation flange, and the mast arm out over the road with a brace under it.
	metal.addTube([px, base, pz], [px, base + 0.1, pz], 0.21, 0.21, 16, true);
	metal.addTube([px, base, pz], [px, base + POLE_HEIGHT, pz], 0.12, 0.085, 16, true);
	const armRoot: [number, number, number] = [px, base + POLE_HEIGHT - ARM_DROP, pz];
	const armTip: [number, number, number] = [px - lx * armLength, base + POLE_HEIGHT - ARM_DROP + ARM_RISE, pz - lz * armLength];
	metal.addTube(armRoot, armTip, 0.085, 0.05, 12, true);
	metal.addTube([px, base + POLE_HEIGHT - 1.5, pz], [px - lx * armLength * 0.32, armRoot[1] + ARM_RISE * 0.32 - 0.04, pz - lz * armLength * 0.32], 0.035, 0.03, 8, true);

	const head = (hx: number, hy: number, hz: number) => {
		border.addBox([hx - fx * 0.17, hy, hz - fz * 0.17], faceSize(0.02, PLATE_WIDTH, PLATE_HEIGHT));
		housing.addBox([hx - fx * 0.155, hy, hz - fz * 0.155], faceSize(0.022, PLATE_WIDTH - 2 * PLATE_BORDER, PLATE_HEIGHT - 2 * PLATE_BORDER));
		housing.addBox([hx, hy, hz], faceSize(HEAD_DEPTH, HEAD_WIDTH, HEAD_HEIGHT));
		COLOURS.forEach((colour, index) => {
			const key: LampKey = `${group}-${axis}-${colour}`;
			const lampY = hy + LAMP_SPACING * (1 - index);
			// Proud of the housing face by enough not to flicker against it from down the street.
			const front = HEAD_DEPTH / 2 + 0.015;
			builderFor(builders.lamps, key).addDisc([hx + fx * front, lampY, hz + fz * front], LAMP_RADIUS, fx, fz, 20);
			// A tunnel visor over each lens, open underneath.
			housing.addTube([hx + fx * (front - 0.01), lampY, hz + fz * (front - 0.01)], [hx + fx * (front + VISOR_LENGTH), lampY + 0.015, hz + fz * (front + VISOR_LENGTH)], LAMP_RADIUS + 0.02, LAMP_RADIUS + 0.03, 16, false, VISOR_OPENING);
			builderFor(builders.halos, key).addQuad([hx + fx * (front + VISOR_LENGTH + 0.02), lampY, hz + fz * (front + VISOR_LENGTH + 0.02)], HALO_SIZE, HALO_SIZE, fx, fz);
		});
	};

	// The head on the pole, facing the stop line, and the countdown under it.
	head(px + fx * 0.32, base + POLE_HEAD_HEIGHT, pz + fz * 0.32);
	housing.addTube([px, base + POLE_HEAD_HEIGHT, pz], [px + fx * 0.2, base + POLE_HEAD_HEIGHT, pz + fz * 0.2], 0.04, 0.04, 8, true);
	housing.addBox([px + fx * 0.16, base + COUNTDOWN_HEIGHT, pz + fz * 0.16], faceSize(0.12, COUNTDOWN_SIZE[0] + 0.08, COUNTDOWN_SIZE[1] + 0.08));
	builderFor(builders.displays, `${group}-${axis}` as DisplayKey).addQuad([px + fx * 0.225, base + COUNTDOWN_HEIGHT, pz + fz * 0.225], COUNTDOWN_SIZE[0], COUNTDOWN_SIZE[1], fx, fz);

	// Overhead heads, hanging from the arm over the lanes.
	for (const share of roadWidth > 11 ? [0.55, 0.95] : [0.9]) {
		const along = armLength * share;
		const armY = armRoot[1] + ARM_RISE * share;
		const hx = px - lx * along;
		const hz = pz - lz * along;
		housing.addTube([hx, armY, hz], [hx, armY - HANG + HEAD_HEIGHT / 2, hz], 0.03, 0.03, 8, true);
		head(hx, armY - HANG, hz);
	}
}

function builderFor<K>(map: Map<K, MeshBuilder>, key: K): MeshBuilder {
	let builder = map.get(key);
	if (!builder) {
		builder = new MeshBuilder();
		map.set(key, builder);
	}
	return builder;
}
