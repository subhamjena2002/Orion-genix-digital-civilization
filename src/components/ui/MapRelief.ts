import { HIGHWAYS, type Highway } from "@/engine/orion/world/Highways";
import { MASSIFS, massifHeight, toLocal, type Massif } from "@/engine/orion/world/Mountains";

/**
 * The map's picture of the hills and the expressways, worked out once.
 *
 * Each mountain range is drawn as a small hill-shaded image (lit from the north-west, as maps
 * are) and placed over the land as a single SVG image, so a whole range costs the map one
 * element rather than thousands.
 */

export interface ReliefImage {
	id: string;
	name: string;
	href: string;
	x: number;
	z: number;
	width: number;
	height: number;
	/** Highest point, for the label. */
	peakX: number;
	peakZ: number;
	peak: number;
}

/** World metres per relief pixel. */
const RELIEF_CELL = 4;

function heightAt(massif: Massif, x: number, z: number): number {
	const { u, v } = toLocal(massif, x, z);
	if (Math.abs(u) > massif.halfLength || Math.abs(v) > massif.halfWidth) return 0;
	const inTunnel = massif.tunnel !== null && Math.abs(u) < massif.tunnel.halfLength;
	return massifHeight(massif, u, v, inTunnel ? "roof" : "open");
}

function reliefFor(massif: Massif): ReliefImage | null {
	// The rotated rectangle's world-aligned bounds.
	const extentX = Math.abs(massif.ux) * massif.halfLength + Math.abs(massif.uz) * massif.halfWidth;
	const extentZ = Math.abs(massif.uz) * massif.halfLength + Math.abs(massif.ux) * massif.halfWidth;
	const minX = massif.centreX - extentX;
	const minZ = massif.centreZ - extentZ;
	const columns = Math.ceil((extentX * 2) / RELIEF_CELL);
	const rows = Math.ceil((extentZ * 2) / RELIEF_CELL);
	const heights = new Float32Array(columns * rows);
	let peak = 0;
	let peakX = massif.centreX;
	let peakZ = massif.centreZ;
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const x = minX + (column + 0.5) * RELIEF_CELL;
			const z = minZ + (row + 0.5) * RELIEF_CELL;
			const h = heightAt(massif, x, z);
			heights[row * columns + column] = h;
			if (h > peak) {
				peak = h;
				peakX = x;
				peakZ = z;
			}
		}
	}
	const canvas = document.createElement("canvas");
	canvas.width = columns;
	canvas.height = rows;
	const context = canvas.getContext("2d");
	if (!context) return null;
	const image = context.createImageData(columns, rows);
	const at = (column: number, row: number) => heights[Math.max(0, Math.min(rows - 1, row)) * columns + Math.max(0, Math.min(columns - 1, column))];
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const h = at(column, row);
			const offset = (row * columns + column) * 4;
			if (h < 0.5) continue;
			// Hill shading: slope towards the light (north-west, i.e. −x −z) is lit.
			const dx = (at(column + 1, row) - at(column - 1, row)) / (2 * RELIEF_CELL);
			const dz = (at(column, row + 1) - at(column, row - 1)) / (2 * RELIEF_CELL);
			const light = Math.max(0, Math.min(1, 0.62 - (dx + dz) * 0.55));
			const t = Math.min(1, h / 70);
			// Olive foothills to pale rock at the tops.
			const r = 70 + t * 95;
			const g = 84 + t * 78;
			const b = 58 + t * 72;
			image.data[offset] = r * (0.55 + light * 0.75);
			image.data[offset + 1] = g * (0.55 + light * 0.75);
			image.data[offset + 2] = b * (0.55 + light * 0.75);
			image.data[offset + 3] = Math.min(235, 60 + h * 6);
		}
	}
	context.putImageData(image, 0, 0);
	return {
		id: massif.id,
		name: massif.name,
		href: canvas.toDataURL(),
		x: minX,
		z: minZ,
		width: columns * RELIEF_CELL,
		height: rows * RELIEF_CELL,
		peakX,
		peakZ,
		peak,
	};
}

let relief: ReliefImage[] | null = null;

/** Built on first use (it needs a canvas). */
export function mapRelief(): readonly ReliefImage[] {
	if (!relief) relief = MASSIFS.map(reliefFor).filter((image): image is ReliefImage => image !== null);
	return relief;
}

export interface HighwayMapLine {
	id: string;
	name: string;
	/** The whole route, as SVG polyline points. */
	route: string;
	tunnels: string[];
	bridges: string[];
	/** Where the name goes, and at what angle (degrees). */
	labelX: number;
	labelZ: number;
	labelAngle: number;
	endX: number;
	endZ: number;
}

function points(highway: Highway, from: number, to: number): string {
	return highway.samples
		.filter((sample) => sample.distance >= from && sample.distance <= to)
		.map((sample) => `${sample.x.toFixed(1)},${sample.z.toFixed(1)}`)
		.join(" ");
}

export const HIGHWAY_MAP: readonly HighwayMapLine[] = HIGHWAYS.map((highway) => {
	const label = highway.samples[Math.floor(highway.samples.length * 0.3)];
	let angle = (Math.atan2(label.dirZ, label.dirX) * 180) / Math.PI;
	// Keep the text the right way up.
	if (angle > 90) angle -= 180;
	if (angle < -90) angle += 180;
	const end = highway.samples[highway.samples.length - 1];
	return {
		id: highway.id,
		name: highway.name,
		route: points(highway, 0, highway.length),
		tunnels: highway.spans.filter((span) => span.kind === "tunnel").map((span) => points(highway, span.from, span.to)),
		bridges: highway.spans.filter((span) => span.kind === "bridge").map((span) => points(highway, span.from, span.to)),
		labelX: label.x,
		labelZ: label.z,
		labelAngle: angle,
		endX: end.x,
		endZ: end.z,
	};
});
