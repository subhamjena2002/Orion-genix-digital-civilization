/**
 * Everyone vehicles need to watch out for: other vehicles, pedestrians and standing officers.
 * Each agent owns its record and updates it in place every frame, so lookups allocate nothing.
 * The player isn't listed here — vehicles read the player pose directly.
 */
export type TrafficAgentKind = "vehicle" | "person";

export interface TrafficAgent {
	readonly id: number;
	readonly kind: TrafficAgentKind;
	x: number;
	z: number;
	/** Unit heading (zero for someone standing still). */
	headingX: number;
	headingZ: number;
	/** Half the agent's length along its heading (a person is treated as a small circle). */
	halfLength: number;
	/** Half the agent's width across its heading. */
	halfWidth: number;
	speed: number;
	/** Set on people who can be run over; called with the striking car's velocity (m/s). */
	onStruck?: (velocityX: number, velocityZ: number) => void;
	/** False while someone is knocked down, so the same body isn't struck again. */
	alive: boolean;
	/**
	 * A car that isn't following traffic (parked, crashed, or the player's). Traffic waits
	 * behind it, then changes lane round it where the road has a second lane.
	 */
	stalled: boolean;
	/** The car the player is driving: traffic never assumes right of way over it. */
	playerControlled: boolean;
}

const agents = new Set<TrafficAgent>();
let nextId = 1;

export function registerTrafficAgent(kind: TrafficAgentKind, halfLength: number, halfWidth = halfLength): TrafficAgent {
	// Off the map until its owner places it, so nothing spawning meanwhile sees it at the origin.
	const agent: TrafficAgent = { id: nextId++, kind, x: 1e6, z: 1e6, headingX: 0, headingZ: 0, halfLength, halfWidth, speed: 0, alive: true, stalled: false, playerControlled: false };
	agents.add(agent);
	return agent;
}

export function unregisterTrafficAgent(agent: TrafficAgent): void {
	agents.delete(agent);
}

export function trafficAgents(): ReadonlySet<TrafficAgent> {
	return agents;
}
