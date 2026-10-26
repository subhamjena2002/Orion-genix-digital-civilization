/**
 * Somewhere for the player to sit on foot: the safehouse sofa. Whoever offers the seat sets it;
 * the player controller sits the player there (the car seat's clip, body switched off) while it
 * stands, and stands them up at `stand` once it's cleared.
 */

export interface Seat {
	/** Where the hips go, and which way the player faces (degrees about Y, 0 = +Z). */
	x: number;
	y: number;
	z: number;
	yaw: number;
	/** Where they're stood up again, on the floor. */
	standX: number;
	standY: number;
	standZ: number;
}

let seat: Seat | null = null;

export function sitDown(next: Seat): void {
	seat = next;
}

export function standUp(): void {
	seat = null;
}

export function currentSeat(): Readonly<Seat> | null {
	return seat;
}
