/**
 * The pause menu's state, shared by the menu (PauseMenu), the game loop (GamePause, which stops
 * the world while paused) and the panels that need the mouse.
 *
 * Escape opens the menu. In most browsers the Escape that ends mouse-look never reaches the page
 * as a key press: the browser takes it to release the pointer. So the menu also opens when the
 * pointer is released by anything but the game itself. Panels that need the cursor (map, sound,
 * missions, shops) release it with `releasePointer`, which says so, and don't pause the game.
 */

type Listener = () => void;

let paused = false;
let ready = false;
let releasedAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<Listener>();
const mapRequests = new Set<Listener>();
const mapClosings = new Set<Listener>();

/** How long after `releasePointer` a lost pointer still counts as on purpose. */
const RELEASE_GRACE_MS = 600;

function emit(): void {
	for (const listener of listeners) listener();
}

export const isPaused = () => paused;

/** The game is up (the loading screen has gone): only then is there anything to pause. */
export const isGameReady = () => ready;

export function setPaused(next: boolean): void {
	if (paused === next || (next && !ready)) return;
	paused = next;
	emit();
}

export function markGameReady(): void {
	if (ready) return;
	ready = true;
	emit();
}

export function onPauseChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Lets go of mouse-look because a panel needs the cursor: not a pause. */
export function releasePointer(): void {
	if (!document.pointerLockElement) return;
	releasedAt = performance.now();
	document.exitPointerLock();
}

export const releasedOnPurpose = () => performance.now() - releasedAt < RELEASE_GRACE_MS;

/** The pause menu's Map: the full map opens over the paused game (WorldMap listens). */
export function requestMap(): void {
	for (const listener of mapRequests) listener();
}

export function onMapRequest(listener: Listener): () => void {
	mapRequests.add(listener);
	return () => mapRequests.delete(listener);
}

/** The full map has closed: the pause menu, if the map came from it, shows again. */
export function mapClosed(): void {
	for (const listener of mapClosings) listener();
}

export function onMapClosed(listener: Listener): () => void {
	mapClosings.add(listener);
	return () => mapClosings.delete(listener);
}
