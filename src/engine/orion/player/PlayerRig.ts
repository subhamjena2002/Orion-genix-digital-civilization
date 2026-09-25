import type { GraphNode } from "playcanvas";

import type { HoldRequest } from "./WeaponPose";

/**
 * The player's retargeted body, when there is one (see OrionPlayerBody). The controller applies
 * the pose once animation has run and before anything reads the hands — the held weapon sits in
 * `hand`.
 */
export interface PlayerRig {
	/** Poses the body for this frame; `dt` is the frame time in seconds. */
	apply(dt: number): void;
	hand: GraphNode | null;
	/** The right hand's middle finger base: the palm's centre is a little way from the wrist towards it. */
	palm: GraphNode | null;
	/** True when the body can hold weapons itself (arms reached onto them); otherwise the weapon is carried at the hand. */
	readonly holds: boolean;
	/** What is held and how it's posed, for the next `apply`; null leaves the arms to the clips. */
	setHold(request: HoldRequest | null): void;
	/**
	 * Puts the animating skeleton back to its rest pose over the next moment. A clip that plays
	 * once and holds its last frame leaves any bone the next clip doesn't animate exactly where it
	 * finished — which left a respawned player still folded over from the death clip.
	 */
	resetPose(): void;
}

let rig: PlayerRig | null = null;
const listeners = new Set<(rig: PlayerRig | null) => void>();

export function setPlayerRig(next: PlayerRig | null): void {
	rig = next;
	for (const listener of listeners) listener(next);
}

export function playerRig(): PlayerRig | null {
	return rig;
}

/** Calls `listener` whenever the rig is set or cleared; returns the unsubscribe. */
export function onPlayerRig(listener: (rig: PlayerRig | null) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
