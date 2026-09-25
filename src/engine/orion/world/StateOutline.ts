import { CITY_EXTENT_X, CITY_EXTENT_Z } from "../roads/RoadNetwork";

/**
 * The landmass of the Orion state: one irregular mainland plus a few offshore islands.
 *
 * Both the walkable terrain and the map are built from these polygons, so what the map shows
 * as coastline is exactly where the ground ends and the ocean begins.
 *
 * Each polygon is star-shaped around its own centre (every point is a radius along a unique
 * angle), which keeps triangulation a simple fan and guarantees the outline never crosses
 * itself.
 */
export interface LandPolygon {
	id: string;
	name: string;
	centre: [number, number];
	/** Outline points as [x, z], in order around the centre. */
	points: readonly [number, number][];
}

const MAINLAND_SAMPLES = 120;
/** Semi-axes of the ellipse the mainland is shaped from, before coastal features. */
const MAINLAND_RADIUS_X = 720;
const MAINLAND_RADIUS_Z = 520;
/** Clear land kept around the road grid so no street ever runs into the sea. */
const CITY_COAST_MARGIN = 70;
/** Kept well inside the ocean plane (3000 across) so the coast never reaches its edge. */
const MAX_RADIUS = 1300;

interface CoastFeature {
	/** Direction (radians, measured from +X towards +Z). */
	angle: number;
	/** Angular half-width of the feature. */
	width: number;
	/** Positive pushes land out (peninsula / cape), negative cuts in (bay). */
	amount: number;
}

/**
 * Hand-placed coastal features that break the symmetry: a long southern peninsula, a broad
 * north-west cape, and bays on the east and north-east coasts.
 */
const MAINLAND_FEATURES: readonly CoastFeature[] = [
	{ angle: 1.35, width: 0.16, amount: 420 },
	{ angle: 3.55, width: 0.35, amount: 230 },
	{ angle: 5.1, width: 0.22, amount: 170 },
	{ angle: 0.15, width: 0.2, amount: -140 },
	{ angle: 5.75, width: 0.14, amount: -120 },
	{ angle: 2.45, width: 0.12, amount: -90 },
];

function angularGap(a: number, b: number): number {
	const gap = Math.abs(a - b) % (Math.PI * 2);
	return gap > Math.PI ? Math.PI * 2 - gap : gap;
}

/** Distance from the origin to the edge of the (margin-padded) road grid along an angle. */
function cityEdgeRadius(angle: number): number {
	const halfX = CITY_EXTENT_X + CITY_COAST_MARGIN;
	const halfZ = CITY_EXTENT_Z + CITY_COAST_MARGIN;
	const cos = Math.abs(Math.cos(angle));
	const sin = Math.abs(Math.sin(angle));
	return Math.min(cos > 1e-6 ? halfX / cos : Infinity, sin > 1e-6 ? halfZ / sin : Infinity);
}

function buildMainland(): [number, number][] {
	const points: [number, number][] = [];
	for (let i = 0; i < MAINLAND_SAMPLES; i++) {
		const angle = (i / MAINLAND_SAMPLES) * Math.PI * 2;
		// Wide east–west body, then layered waves of different frequency for a ragged coast.
		const body = 1 / Math.hypot(Math.cos(angle) / MAINLAND_RADIUS_X, Math.sin(angle) / MAINLAND_RADIUS_Z);
		const waves = 1
			+ 0.1 * Math.sin(2 * angle + 0.7)
			+ 0.07 * Math.sin(3 * angle + 2.1)
			+ 0.045 * Math.sin(7 * angle + 0.4)
			+ 0.025 * Math.sin(13 * angle + 1.3)
			+ 0.015 * Math.sin(23 * angle + 4.2);
		let radius = body * waves;
		for (const feature of MAINLAND_FEATURES) {
			const t = angularGap(angle, feature.angle) / feature.width;
			radius += feature.amount * Math.exp(-t * t);
		}
		radius = Math.min(MAX_RADIUS, Math.max(cityEdgeRadius(angle), radius));
		points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
	}
	return points;
}

function buildIsland(centre: [number, number], size: number, seed: number, samples = 40): [number, number][] {
	const points: [number, number][] = [];
	for (let i = 0; i < samples; i++) {
		const angle = (i / samples) * Math.PI * 2;
		const radius = size * (1
			+ 0.22 * Math.sin(2 * angle + seed)
			+ 0.12 * Math.sin(3 * angle + seed * 1.7)
			+ 0.06 * Math.sin(6 * angle + seed * 2.3));
		points.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
	}
	return points;
}

export const ORION_LAND: readonly LandPolygon[] = [
	{ id: "mainland", name: "Orion State", centre: [0, 0], points: buildMainland() },
	{ id: "isle-east", name: "Tara Isle", centre: [980, -380], points: buildIsland([980, -380], 70, 1.1) },
	{ id: "isle-north", name: "Kavya Isle", centre: [-260, -760], points: buildIsland([-260, -760], 55, 2.6) },
	{ id: "isle-west", name: "Nila Isle", centre: [-1080, 300], points: buildIsland([-1080, 300], 45, 4.0, 32) },
];

function insidePolygon(x: number, z: number, points: readonly [number, number][]): boolean {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const [xi, zi] = points[i];
		const [xj, zj] = points[j];
		if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
	}
	return inside;
}

export function isOnLand(x: number, z: number): boolean {
	return ORION_LAND.some((land) => insidePolygon(x, z, land.points));
}

/** SVG path data for a polygon, in world [x, z] coordinates. */
export function landPath(points: readonly [number, number][]): string {
	return `M ${points.map(([x, z]) => `${x.toFixed(1)} ${z.toFixed(1)}`).join(" L ")} Z`;
}

export function landBounds() {
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const land of ORION_LAND) {
		for (const [x, z] of land.points) {
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minZ = Math.min(minZ, z);
			maxZ = Math.max(maxZ, z);
		}
	}
	return { minX, maxX, minZ, maxZ };
}
