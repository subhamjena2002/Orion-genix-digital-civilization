/**
 * What the loading screen checks, beyond files having arrived, before it calls the game ready:
 * set by the systems themselves as they come up, read by OrionCanvas's loading gate.
 */

let controllerUp = false;

/** The player's controller has started: input is being listened for and it moves the body. */
export function setPlayerControllerReady(ready: boolean): void {
	controllerUp = ready;
}

export function playerControllerReady(): boolean {
	return controllerUp;
}

let showing = false;

/** The loading screen has called the game ready (set by OrionCanvas's loading gate, once). */
export function setGameShowing(): void {
	showing = true;
}

/**
 * Whether the game has been called ready. Exact, unlike `deferredLoadingStarted` (set a render
 * later, when the deferred models start): for work that must not run once the player can see.
 */
export function gameShowing(): boolean {
	return showing;
}
