/**
 * A request to put the player somewhere else at once — a mission retried or replayed from its
 * start. Anything can ask; the player controller takes it on its next update, getting the player
 * out of whatever they're in first.
 */

export interface TeleportRequest {
	x: number;
	z: number;
	/** Facing, in degrees. */
	yaw: number;
}

let pending: TeleportRequest | null = null;

export function requestTeleport(x: number, z: number, yaw = 0): void {
	pending = { x, z, yaw };
}

/** The request to carry out, once. */
export function takeTeleport(): TeleportRequest | null {
	const request = pending;
	pending = null;
	return request;
}
