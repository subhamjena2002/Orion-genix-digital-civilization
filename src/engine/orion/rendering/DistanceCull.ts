import { readCameraView } from "../player/PlayerPose";

/**
 * Hides big set pieces the camera is too far from to make out: the army base and airfield
 * batches, the parked gunship and jets. Seen from across the city through the haze they're a
 * smudge, but they cost dozens of draw calls and tens of thousands of triangles every frame.
 *
 * Each target is a box on the ground; its distance is from the camera to the nearest point of
 * the box, so a long runway counts as near when any of it is. Shown again a little nearer than
 * hidden (hysteresis), so nothing flickers at the edge. Checked every few frames — a camera
 * covers a few metres between checks, nowhere near the margin.
 *
 * `apply` does the hiding; `isShown` reads the real state each check, so if something else
 * shows the piece again (React re-applying a prop, a batch being rebuilt) it's corrected.
 */

export interface CullTarget {
	x: number;
	z: number;
	halfX: number;
	halfZ: number;
	/** Hidden beyond this many metres from the camera. */
	maxDistance: number;
	isShown(): boolean;
	apply(shown: boolean): void;
}

/** Shown again this much nearer than it's hidden. */
const HYSTERESIS = 25;
/** Frames between checks. */
const CHECK_EVERY = 8;

const targets = new Set<CullTarget>();
let frame = 0;

/** Starts culling `target`; returns the function that stops it (and shows it again). */
export function registerDistanceCull(target: CullTarget): () => void {
	targets.add(target);
	return () => {
		targets.delete(target);
		if (!target.isShown()) target.apply(true);
	};
}

/** Distance from (x, z) to the nearest point of the target's box. */
export function distanceToBox(target: Pick<CullTarget, "x" | "z" | "halfX" | "halfZ">, x: number, z: number): number {
	const dx = Math.max(0, Math.abs(x - target.x) - target.halfX);
	const dz = Math.max(0, Math.abs(z - target.z) - target.halfZ);
	return Math.hypot(dx, dz);
}

/** Should it be shown, given whether it is now and how far the camera is. */
export function wantShown(shown: boolean, distance: number, maxDistance: number): boolean {
	return shown ? distance <= maxDistance : distance <= maxDistance - HYSTERESIS;
}

/** Once a frame (cheap: the work happens every CHECK_EVERY frames). */
export function updateDistanceCull(): void {
	if (++frame % CHECK_EVERY !== 0) return;
	const camera = readCameraView();
	if (!camera.known) return;
	for (const target of targets) {
		const shown = target.isShown();
		const want = wantShown(shown, distanceToBox(target, camera.x, camera.z), target.maxDistance);
		if (want !== shown) target.apply(want);
	}
}
