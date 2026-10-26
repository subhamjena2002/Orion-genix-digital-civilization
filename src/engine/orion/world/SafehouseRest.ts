/**
 * Resting on the safehouse sofa, for the HUD: whether a rest is on offer (the player's on foot by
 * the sofa) and whether they're resting now. components/world/Safehouse runs the rest itself;
 * E there (or the touch screen's Rest button) asks for one, and asks again to get up.
 */

let offered = false;
let resting = false;
let wanted = false;
const listeners = new Set<() => void>();

function changed(): void {
	for (const listener of [...listeners]) listener();
}

export function onRestChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function setRestOffered(next: boolean): void {
	if (offered === next) return;
	offered = next;
	changed();
}

export function restOffered(): boolean {
	return offered;
}

export function setResting(next: boolean): void {
	if (resting === next) return;
	resting = next;
	changed();
}

export function isResting(): boolean {
	return resting;
}

/** Sit down if a rest is on offer, or get up if resting. */
export function toggleRest(): void {
	if (offered || resting) wanted = true;
}

/** The pending sit-down/get-up request, once. */
export function takeRestToggle(): boolean {
	const request = wanted;
	wanted = false;
	return request;
}
