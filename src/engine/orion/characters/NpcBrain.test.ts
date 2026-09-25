import { describe, expect, it } from "vitest";

import { NPC_TIMING, NpcBrain, paceFor, runsThisFrame, updateInterval } from "./NpcBrain";

const player = { id: 1, x: 0, z: 0, attackable: true };
const blast = { id: 2, x: 0, z: 0, attackable: false };

function advance(brain: NpcBrain, seconds: number, distance: number) {
	for (let t = 0; t < seconds; t += 0.05) brain.update(0.05, distance);
}

describe("NpcBrain", () => {
	it("roams until something happens", () => {
		const brain = new NpcBrain(0);
		advance(brain, 10, Infinity);
		expect(brain.state).toBe("PATROL");
		expect(brain.roaming).toBe(true);
	});

	it("freezes on hearing a gunshot, then flees, then calms down and walks on", () => {
		const brain = new NpcBrain(0, () => 0);
		brain.onDisturbance(blast);
		expect(brain.state).toBe("ALERT");
		advance(brain, NPC_TIMING.alert[0] + 0.1, 10);
		expect(brain.state).toBe("FLEE");
		// Still close to the danger: keeps running.
		advance(brain, NPC_TIMING.fleeMin + 1, 10);
		expect(brain.state).toBe("FLEE");
		advance(brain, 0.2, NPC_TIMING.fleeSafeDistance + 5);
		expect(brain.state).toBe("WALK");
		advance(brain, NPC_TIMING.calmWalk + 0.1, 100);
		expect(brain.state).toBe("PATROL");
		expect(brain.threat).toBeNull();
	});

	it("staggers when hit and a timid person then flees", () => {
		const brain = new NpcBrain(0, () => 0.5);
		brain.onDamaged(player, false);
		expect(brain.state).toBe("HIT");
		advance(brain, NPC_TIMING.hit + 0.05, 3);
		expect(brain.state).toBe("FLEE");
	});

	it("a brave person fights back: runs in, swings in reach, gives chase", () => {
		const brain = new NpcBrain(1, () => 0.5);
		brain.onDamaged(player, false);
		advance(brain, NPC_TIMING.hit + 0.05, 5);
		expect(brain.state).toBe("RUN");
		brain.update(0.05, 1);
		expect(brain.state).toBe("ATTACK");
		brain.update(0.05, 4);
		expect(brain.state).toBe("RUN");
		brain.update(0.05, NPC_TIMING.chaseGiveUp + 1);
		expect(brain.state).toBe("WALK");
	});

	it("never fights back against something it can't attack", () => {
		const brain = new NpcBrain(1, () => 0);
		brain.onDamaged(blast, false);
		advance(brain, NPC_TIMING.hit + 0.05, 5);
		expect(brain.state).toBe("FLEE");
	});

	it("dies from a killing blow and ignores everything after", () => {
		const brain = new NpcBrain(1);
		brain.onDamaged(player, true);
		expect(brain.state).toBe("DEAD");
		brain.onDamaged(player, false);
		brain.onDisturbance(blast);
		advance(brain, 30, 0);
		expect(brain.state).toBe("DEAD");
		brain.reset();
		expect(brain.state).toBe("PATROL");
	});

	it("waits at crossings only while roaming", () => {
		const brain = new NpcBrain(0);
		brain.setWaiting(true);
		expect(brain.state).toBe("IDLE");
		brain.setWaiting(false);
		expect(brain.state).toBe("PATROL");
		brain.onDisturbance(blast);
		brain.setWaiting(true);
		expect(brain.state).toBe("ALERT");
	});

	it("runs faster fleeing than walking, and stands still when staggered or dead", () => {
		expect(paceFor("FLEE")).toBeGreaterThan(paceFor("PATROL"));
		expect(paceFor("HIT")).toBe(0);
		expect(paceFor("DEAD")).toBe(0);
	});
});

describe("update scheduling", () => {
	it("updates close NPCs every frame and distant unseen ones rarely", () => {
		expect(updateInterval(10, false)).toBe(1);
		expect(updateInterval(60, true)).toBe(1);
		expect(updateInterval(60, false)).toBe(2);
		expect(updateInterval(200, false)).toBe(8);
		expect(updateInterval(200, true)).toBeLessThan(updateInterval(200, false));
	});

	it("staggers slots so the work spreads over frames", () => {
		const frames = (slot: number) => Array.from({ length: 8 }, (_, frame) => frame).filter((frame) => runsThisFrame(frame, slot, 4));
		expect(frames(0)).toEqual([0, 4]);
		expect(frames(1)).toEqual([3, 7]);
		expect(runsThisFrame(3, 5, 1)).toBe(true);
	});
});
