/**
 * Car against car, in the plane: the overlap of two vehicles' footprints and the push that parts
 * them.
 *
 * Every vehicle's footprint is the rectangle of its collision box, centred on the car, nose along
 * (sin, cos) of its heading and its left side along (cos, −sin). The overlap test is the
 * separating-axis one for two rectangles, so it is exact for any angle: a corner poking into a
 * door is found, where sweeping a few points of the outline let it slip between them.
 */

export interface Footprint {
	x: number;
	z: number;
	/** Nose direction: (sin, cos) of the heading. */
	sin: number;
	cos: number;
	halfLength: number;
	halfWidth: number;
}

export interface Contact {
	/** Unit normal pointing from B into A: move A along it (and B against it) to part them. */
	normalX: number;
	normalZ: number;
	/** How far they overlap along the normal, m. */
	depth: number;
	/** Where they touch: the middle of the corners each has inside the other. */
	pointX: number;
	pointZ: number;
}

/** Half the footprint's extent along the unit direction (dx, dz). */
export function extentAlong(box: Footprint, dx: number, dz: number): number {
	const along = Math.abs(box.sin * dx + box.cos * dz);
	const across = Math.abs(box.cos * dx - box.sin * dz);
	return box.halfLength * along + box.halfWidth * across;
}

function inside(box: Footprint, x: number, z: number, margin: number): boolean {
	const relX = x - box.x;
	const relZ = z - box.z;
	return Math.abs(relX * box.sin + relZ * box.cos) <= box.halfLength + margin
		&& Math.abs(relX * box.cos - relZ * box.sin) <= box.halfWidth + margin;
}

const corners: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Adds up the corners of `box` that lie inside `other`; returns how many. */
function cornersInside(box: Footprint, other: Footprint, sum: [number, number]): number {
	let count = 0;
	for (const [along, side] of corners) {
		const x = box.x + along * box.halfLength * box.sin + side * box.halfWidth * box.cos;
		const z = box.z + along * box.halfLength * box.cos - side * box.halfWidth * box.sin;
		if (!inside(other, x, z, 0.02)) continue;
		sum[0] += x;
		sum[1] += z;
		count++;
	}
	return count;
}

const pointSum: [number, number] = [0, 0];

/**
 * How A and B overlap, or null if they don't (or only within `margin` of touching, when it's
 * negative; a positive margin counts footprints that close as touching, with depth measured to
 * the inflated outline).
 */
export function footprintContact(a: Footprint, b: Footprint, margin = 0): Contact | null {
	const relX = a.x - b.x;
	const relZ = a.z - b.z;
	const reach = Math.hypot(a.halfLength, a.halfWidth) + Math.hypot(b.halfLength, b.halfWidth) + margin;
	if (relX * relX + relZ * relZ > reach * reach) return null;

	let depth = Infinity;
	let normalX = 0;
	let normalZ = 0;
	// The four candidate axes: each box's forward and side directions.
	const axes: [number, number][] = [[a.sin, a.cos], [a.cos, -a.sin], [b.sin, b.cos], [b.cos, -b.sin]];
	for (const [dx, dz] of axes) {
		const distance = relX * dx + relZ * dz;
		const overlap = extentAlong(a, dx, dz) + extentAlong(b, dx, dz) + margin - Math.abs(distance);
		if (overlap <= 0) return null;
		if (overlap < depth) {
			depth = overlap;
			const sign = distance >= 0 ? 1 : -1;
			normalX = dx * sign;
			normalZ = dz * sign;
		}
	}

	pointSum[0] = 0;
	pointSum[1] = 0;
	const count = cornersInside(a, b, pointSum) + cornersInside(b, a, pointSum);
	let pointX: number;
	let pointZ: number;
	if (count > 0) {
		pointX = pointSum[0] / count;
		pointZ = pointSum[1] / count;
	} else {
		// Edges crossing with no corner in (two long sides overlapping): halfway along the push,
		// on B's face.
		const faceB = extentAlong(b, normalX, normalZ);
		pointX = b.x + normalX * (faceB - depth / 2);
		pointZ = b.z + normalZ * (faceB - depth / 2);
		// Slide it to the middle of the overlap along the face.
		const tangentX = -normalZ;
		const tangentZ = normalX;
		const shift = (relX * tangentX + relZ * tangentZ) / 2;
		pointX += tangentX * shift;
		pointZ += tangentZ * shift;
	}
	return { normalX, normalZ, depth, pointX, pointZ };
}

/** Shares of a separation each body takes, by mass; an immovable B leaves it all to A. */
export function separationShares(massA: number, massB: number, bMovable: boolean): [number, number] {
	if (!bMovable) return [1, 0];
	const total = massA + massB;
	return [massB / total, massA / total];
}
