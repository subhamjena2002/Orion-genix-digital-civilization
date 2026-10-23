/**
 * Things that happen in the game that a mission may be waiting on: the player getting into or
 * out of something, dying or being arrested, someone killed, a vehicle destroyed.
 *
 * The systems that know fire them (the player controller, the vehicle and pedestrian scripts);
 * the mission director listens. A plain set of listeners, like WorldReset — nothing is queued,
 * so a listener sees each event as it happens, mid-frame.
 */

import type { VehicleStyle } from "../traffic/Vehicles";

export type GameVehicleKind = "car" | "jet" | "gunship";

export type GameEvent =
	/** The player is in the seat and in control (after any carjack, not at its start). */
	| { type: "vehicleEntered"; id: string; kind: GameVehicleKind; police: boolean; style?: VehicleStyle }
	| { type: "vehicleExited"; id: string; kind: GameVehicleKind }
	| { type: "playerDied" }
	| { type: "playerBusted" }
	| { type: "personKilled"; id: string; byPlayer: boolean }
	| { type: "vehicleDestroyed"; id: string; byPlayer: boolean }
	/** A mission's car reached the end of its route: whoever was meant to stop it didn't. */
	| { type: "actorEscaped"; id: string }
	/** A race opponent crossed the finish line. */
	| { type: "racerFinished"; id: string }
	/** A mission guard noticed the player (or the trouble they made) and is raising the alarm. */
	| { type: "hostileAlerted"; id: string };

type Listener = (event: GameEvent) => void;

const listeners = new Set<Listener>();

/** Calls `listener` on every game event; returns the unsubscribe. */
export function onGameEvent(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function emitGameEvent(event: GameEvent): void {
	for (const listener of [...listeners]) listener(event);
}
