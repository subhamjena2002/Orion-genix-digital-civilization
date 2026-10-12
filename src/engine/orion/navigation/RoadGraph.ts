/**
 * The drivable network as a graph, for the GPS: shortest routes along real roads, as the minimap
 * and map draw them and as missions will lead the player.
 *
 * Built from polylines ("links"). Where one link ends on another — a side road meeting a street
 * part-way along — the street is split there, so the two connect as they do on the ground. Routes
 * start and end at the nearest point on any road, so a destination off the road (a house, a field)
 * still gets a route to its door.
 */

export type Point = readonly [number, number];

export interface RoadLink {
	id: string;
	points: readonly Point[];
}

interface Edge {
	to: number;
	length: number;
	/** Points from this edge's start node to its end node, both included. */
	points: Point[];
}

/** Ends this close together are the same junction. */
const MERGE_DISTANCE = 3;
/** An end this close to another road's side joins it there. */
const JOIN_DISTANCE = 14;

function distance(a: Point, b: Point): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polylineLength(points: readonly Point[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
	return total;
}

interface Projection {
	link: number;
	/** Segment index within the link, and how far along that segment (0..1). */
	segment: number;
	t: number;
	point: Point;
	distance: number;
}

function project(points: readonly Point[], x: number, z: number): { segment: number; t: number; point: Point; distance: number } {
	let best = { segment: 0, t: 0, point: points[0], distance: Infinity };
	for (let i = 1; i < points.length; i++) {
		const [ax, az] = points[i - 1];
		const [bx, bz] = points[i];
		const dx = bx - ax;
		const dz = bz - az;
		const lengthSq = dx * dx + dz * dz;
		const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
		const point: Point = [ax + dx * t, az + dz * t];
		const d = Math.hypot(x - point[0], z - point[1]);
		if (d < best.distance) best = { segment: i, t, point, distance: d };
	}
	return best;
}

/** `points` cut at (segment, t): the part before and the part after, sharing the cut point. */
function split(points: readonly Point[], segment: number, t: number): [Point[], Point[]] {
	const [ax, az] = points[segment - 1];
	const [bx, bz] = points[segment];
	const cut: Point = [ax + (bx - ax) * t, az + (bz - az) * t];
	return [[...points.slice(0, segment), cut], [cut, ...points.slice(segment)]];
}

export interface Route {
	points: Point[];
	length: number;
}

export class RoadGraph {
	private readonly nodes: Point[] = [];
	private readonly edges: Edge[][] = [];
	/** The links as finally split, for snapping onto. */
	private readonly links: { points: Point[]; from: number; to: number }[] = [];

	public constructor(links: readonly RoadLink[]) {
		// Pass 1: join ends that land on another link's side by cutting that link there.
		let pieces: Point[][] = links.filter((link) => link.points.length >= 2).map((link) => [...link.points]);
		for (let i = 0; i < pieces.length; i++) {
			for (const end of [pieces[i][0], pieces[i][pieces[i].length - 1]]) {
				for (let j = 0; j < pieces.length; j++) {
					if (j === i) continue;
					const target = pieces[j];
					if (distance(end, target[0]) < MERGE_DISTANCE || distance(end, target[target.length - 1]) < MERGE_DISTANCE) continue;
					const hit = project(target, end[0], end[1]);
					if (hit.distance > JOIN_DISTANCE) continue;
					const [before, after] = split(target, hit.segment, hit.t);
					const piece = pieces[i];
					const atStart = distance(end, piece[0]) < 1e-9;
					if (polylineLength(before) < MERGE_DISTANCE || polylineLength(after) < MERGE_DISTANCE) {
						// It lands at that link's end — a junction — just short of it: reach the junction
						// rather than cutting (the army base's road stopped 5 m shy of the grid's corner).
						const corner = polylineLength(before) < MERGE_DISTANCE ? target[0] : target[target.length - 1];
						pieces[i] = atStart ? [corner, ...piece] : [...piece, corner];
						break;
					}
					pieces[j] = before;
					pieces.push(after);
					// The end reaches the cut point.
					pieces[i] = atStart ? [hit.point, ...piece] : [...piece, hit.point];
					break;
				}
			}
		}
		pieces = pieces.filter((piece) => polylineLength(piece) > 0.01);
		// Pass 2: nodes at the ends, edges both ways.
		for (const piece of pieces) {
			const from = this.nodeAt(piece[0]);
			const to = this.nodeAt(piece[piece.length - 1]);
			if (from === to) continue;
			const length = polylineLength(piece);
			this.edges[from].push({ to, length, points: piece });
			this.edges[to].push({ to: from, length, points: [...piece].reverse() });
			this.links.push({ points: piece, from, to });
		}
	}

	public get nodeCount(): number {
		return this.nodes.length;
	}

	private nodeAt(point: Point): number {
		for (let i = 0; i < this.nodes.length; i++) if (distance(this.nodes[i], point) < MERGE_DISTANCE) return i;
		this.nodes.push(point);
		this.edges.push([]);
		return this.nodes.length - 1;
	}

	/** The nearest point on any road. */
	public nearest(x: number, z: number): Projection | null {
		let best: Projection | null = null;
		this.links.forEach((link, index) => {
			const hit = project(link.points, x, z);
			if (!best || hit.distance < best.distance) best = { link: index, ...hit };
		});
		return best;
	}

	/**
	 * Shortest route by road from one place to another (A*), from and to the nearest points on the
	 * network. Null if they aren't connected.
	 */
	public route(fromX: number, fromZ: number, toX: number, toZ: number): Route | null {
		const start = this.nearest(fromX, fromZ);
		const goal = this.nearest(toX, toZ);
		if (!start || !goal) return null;

		// Both on the same stretch of road: straight along it.
		if (start.link === goal.link) {
			const link = this.links[start.link].points;
			const a = start.segment + start.t;
			const b = goal.segment + goal.t;
			const points: Point[] = [start.point];
			if (a <= b) for (let i = start.segment; i < goal.segment; i++) points.push(link[i]);
			else for (let i = start.segment - 1; i >= goal.segment; i--) points.push(link[i]);
			points.push(goal.point);
			return { points, length: polylineLength(points) };
		}

		// Temporary nodes where the two snapped points sit, linked to their stretch's ends.
		const START = -1;
		const GOAL = -2;
		const startLink = this.links[start.link];
		const goalLink = this.links[goal.link];
		const toStartEnds: { to: number; points: Point[] }[] = [
			{ to: startLink.from, points: [start.point, ...startLink.points.slice(0, start.segment).reverse()] },
			{ to: startLink.to, points: [start.point, ...startLink.points.slice(start.segment)] },
		];
		const fromGoalEnds = new Map<number, Point[]>([
			[goalLink.from, [...goalLink.points.slice(0, goal.segment), goal.point]],
			[goalLink.to, [...goalLink.points.slice(goal.segment).reverse(), goal.point]],
		]);

		const g = new Map<number, number>();
		const came = new Map<number, { from: number; points: Point[] }>();
		const open = new Set<number>();
		const h = (node: number) => (node === GOAL ? 0 : distance(this.nodes[node], goal.point));
		for (const option of toStartEnds) {
			const length = polylineLength(option.points);
			if (length < (g.get(option.to) ?? Infinity)) {
				g.set(option.to, length);
				came.set(option.to, { from: START, points: option.points });
				open.add(option.to);
			}
		}
		let reached = false;
		while (open.size > 0) {
			let current = -3;
			let bestF = Infinity;
			for (const node of open) {
				const f = (g.get(node) ?? Infinity) + h(node);
				if (f < bestF) {
					bestF = f;
					current = node;
				}
			}
			open.delete(current);
			if (current === GOAL) {
				reached = true;
				break;
			}
			const here = g.get(current) ?? Infinity;
			const finish = fromGoalEnds.get(current);
			if (finish) {
				const total = here + polylineLength(finish);
				if (total < (g.get(GOAL) ?? Infinity)) {
					g.set(GOAL, total);
					came.set(GOAL, { from: current, points: finish });
					open.add(GOAL);
				}
			}
			for (const edge of this.edges[current]) {
				const total = here + edge.length;
				if (total < (g.get(edge.to) ?? Infinity)) {
					g.set(edge.to, total);
					came.set(edge.to, { from: current, points: edge.points });
					open.add(edge.to);
				}
			}
		}
		if (!reached) return null;

		const legs: Point[][] = [];
		let node = GOAL;
		while (node !== START) {
			const step = came.get(node);
			if (!step) return null;
			legs.push(step.points);
			node = step.from;
		}
		const points: Point[] = [];
		for (const leg of legs.reverse()) {
			for (const point of leg) {
				const last = points[points.length - 1];
				if (!last || distance(last, point) > 0.01) points.push(point);
			}
		}
		return { points, length: polylineLength(points) };
	}
}

/** How far along a route a point is, and the rest of the route from there (for redrawing as you go). */
export function remainingRoute(route: Route, x: number, z: number): Route {
	const hit = project(route.points, x, z);
	const points: Point[] = [hit.point, ...route.points.slice(hit.segment)];
	return { points, length: polylineLength(points) };
}
