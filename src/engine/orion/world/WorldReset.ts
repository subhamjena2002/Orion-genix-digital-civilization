/**
 * The street starting over, as in a fresh game, when the player comes back after dying or being
 * arrested: police stood down and out of sight, the dead and wounded replaced, wrecks and
 * stolen cars gone, blood cleaned away.
 *
 * Each system listens and puts itself back; the player controller fires it, after the player
 * has been moved to the spawn point (so anything re-placed "near the player" lands there).
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Calls `listener` on every reset; returns the unsubscribe. */
export function onWorldReset(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function resetWorld(): void {
	for (const listener of [...listeners]) listener();
}
