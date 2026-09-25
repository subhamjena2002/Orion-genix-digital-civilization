/**
 * A uniform grid over the ground plane for "who is near here" questions (explosion radius, melee
 * reach, bullet candidates, pedestrian avoidance). Items are re-bucketed only when they cross a
 * cell boundary, so a crowd walking around costs a comparison per item per update, and a query
 * touches only the few cells it overlaps instead of every item in the world.
 */
export interface GridItem {
	x: number;
	z: number;
}

export class SpatialGrid<T extends GridItem> {
	private readonly cells = new Map<number, T[]>();
	private readonly cellOf = new Map<T, number>();

	public constructor(private readonly cellSize = 8) {}

	public get size(): number {
		return this.cellOf.size;
	}

	/** Adds the item, or re-buckets it after it moved. Call whenever its x/z change. */
	public update(item: T): void {
		const key = this.keyAt(item.x, item.z);
		const previous = this.cellOf.get(item);
		if (previous === key) return;
		if (previous !== undefined) this.removeFromCell(previous, item);
		let cell = this.cells.get(key);
		if (!cell) this.cells.set(key, (cell = []));
		cell.push(item);
		this.cellOf.set(item, key);
	}

	public remove(item: T): void {
		const previous = this.cellOf.get(item);
		if (previous === undefined) return;
		this.removeFromCell(previous, item);
		this.cellOf.delete(item);
	}

	/**
	 * Items within `radius` of (x, z) (by their stored position), appended to `out`, which is
	 * cleared first. Returns `out`.
	 */
	public queryRadius(x: number, z: number, radius: number, out: T[]): T[] {
		out.length = 0;
		const radiusSquared = radius * radius;
		this.forEachCandidate(x - radius, z - radius, x + radius, z + radius, (item) => {
			const dx = item.x - x;
			const dz = item.z - z;
			if (dx * dx + dz * dz <= radiusSquared) out.push(item);
		});
		return out;
	}

	/**
	 * Items in the cells a segment passes near (within `margin`), appended to `out` after clearing
	 * it. A coarse filter for ray tests: callers still do the exact shape test.
	 */
	public querySegment(x0: number, z0: number, x1: number, z1: number, margin: number, out: T[]): T[] {
		out.length = 0;
		const seen = new Set<T>();
		const length = Math.hypot(x1 - x0, z1 - z0);
		const steps = Math.max(1, Math.ceil(length / this.cellSize));
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const x = x0 + (x1 - x0) * t;
			const z = z0 + (z1 - z0) * t;
			const reach = this.cellSize / 2 + margin;
			this.forEachCandidate(x - reach, z - reach, x + reach, z + reach, (item) => {
				if (seen.has(item)) return;
				seen.add(item);
				out.push(item);
			});
		}
		return out;
	}

	private forEachCandidate(minX: number, minZ: number, maxX: number, maxZ: number, visit: (item: T) => void) {
		const x0 = Math.floor(minX / this.cellSize);
		const x1 = Math.floor(maxX / this.cellSize);
		const z0 = Math.floor(minZ / this.cellSize);
		const z1 = Math.floor(maxZ / this.cellSize);
		for (let cx = x0; cx <= x1; cx++) {
			for (let cz = z0; cz <= z1; cz++) {
				const cell = this.cells.get(packKey(cx, cz));
				if (!cell) continue;
				for (let i = 0; i < cell.length; i++) visit(cell[i]);
			}
		}
	}

	private keyAt(x: number, z: number): number {
		return packKey(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
	}

	private removeFromCell(key: number, item: T) {
		const cell = this.cells.get(key);
		if (!cell) return;
		const index = cell.indexOf(item);
		if (index >= 0) {
			// Swap-remove: order within a cell doesn't matter.
			cell[index] = cell[cell.length - 1];
			cell.pop();
		}
		if (cell.length === 0) this.cells.delete(key);
	}
}

/** Packs two cell coordinates (each within +-2^20) into one number key. */
function packKey(cx: number, cz: number): number {
	return (cx + 1048576) * 2097152 + (cz + 1048576);
}
