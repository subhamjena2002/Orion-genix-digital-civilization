import { describe, expect, it, vi } from "vitest";

import { calmGate, perFrameAllowance, runInFrames, timeSlicer } from "./FrameBudget";

/** A frame queue driven by hand, and a clock each job advances by `jobMs`. */
function harness(jobMs = 1) {
	let clock = 0;
	const pending: (() => void)[] = [];
	const nextFrame = (run: () => void) => {
		pending.push(run);
		return () => {
			const index = pending.indexOf(run);
			if (index >= 0) pending.splice(index, 1);
		};
	};
	const ran: number[] = [];
	const jobs = (count: number) => Array.from({ length: count }, (_, index) => () => {
		clock += jobMs;
		ran.push(index);
	});
	const frame = () => {
		const run = pending.shift();
		run?.();
		return run !== undefined;
	};
	return { nextFrame, now: () => clock, ran, jobs, frame, pending };
}

describe("frame budget", () => {
	it("runs nothing in the call itself, then a budget's worth per frame", async () => {
		const h = harness(1);
		const run = runInFrames(h.jobs(10), { budgetMs: 4, nextFrame: h.nextFrame, now: h.now });
		expect(h.ran).toEqual([]);
		h.frame();
		expect(h.ran).toEqual([0, 1, 2, 3]);
		h.frame();
		expect(h.ran).toHaveLength(8);
		h.frame();
		expect(h.ran).toHaveLength(10);
		await expect(run.done).resolves.toBe(true);
		// Finished: nothing more is scheduled.
		expect(h.pending).toHaveLength(0);
	});

	it("always makes progress, even when one job outlasts the budget", async () => {
		const h = harness(50);
		const run = runInFrames(h.jobs(3), { budgetMs: 4, nextFrame: h.nextFrame, now: h.now });
		h.frame();
		expect(h.ran).toEqual([0]);
		h.frame();
		h.frame();
		expect(h.ran).toEqual([0, 1, 2]);
		await expect(run.done).resolves.toBe(true);
	});

	it("completes an empty list at once without scheduling a frame", async () => {
		const h = harness();
		const run = runInFrames([], { budgetMs: 4, nextFrame: h.nextFrame, now: h.now });
		expect(h.pending).toHaveLength(0);
		await expect(run.done).resolves.toBe(true);
	});

	it("runs nothing more once cancelled, and says it didn't finish", async () => {
		const h = harness(1);
		const run = runInFrames(h.jobs(10), { budgetMs: 4, nextFrame: h.nextFrame, now: h.now });
		h.frame();
		run.cancel();
		run.cancel();
		expect(h.pending).toHaveLength(0);
		expect(h.frame()).toBe(false);
		expect(h.ran).toHaveLength(4);
		await expect(run.done).resolves.toBe(false);
	});

	it("stops mid-frame when a job cancels the run (an unmount during the work)", async () => {
		const h = harness(1);
		let run: ReturnType<typeof runInFrames> | null = null;
		const jobs = [...h.jobs(2), () => run?.cancel(), ...h.jobs(5)];
		run = runInFrames(jobs, { budgetMs: 100, nextFrame: h.nextFrame, now: h.now });
		h.frame();
		expect(h.ran).toEqual([0, 1]);
		await expect(run.done).resolves.toBe(false);
	});

	it("reports a failing job and carries on with the rest", async () => {
		const h = harness(1);
		const onError = vi.fn();
		const jobs = [...h.jobs(2), () => {
			throw new Error("broken piece");
		}, ...h.jobs(2)];
		const run = runInFrames(jobs, { budgetMs: 100, nextFrame: h.nextFrame, now: h.now, onError });
		h.frame();
		await expect(run.done).resolves.toBe(true);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][1]).toBe(2);
		expect(h.ran).toHaveLength(4);
	});

	it("runs each job exactly once, however the frames fall", async () => {
		const h = harness(3);
		const run = runInFrames(h.jobs(7), { budgetMs: 5, nextFrame: h.nextFrame, now: h.now });
		while (h.frame()) {
			// Drain.
		}
		await expect(run.done).resolves.toBe(true);
		expect(h.ran).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});
});

describe("time slicer", () => {
	it("yields only once a slice has used its budget, then starts a new slice", async () => {
		let clock = 0;
		let waits = 0;
		const slice = timeSlicer(8, () => clock, async () => {
			waits++;
		});
		clock = 5;
		await slice();
		expect(waits).toBe(0);
		clock = 9;
		await slice();
		expect(waits).toBe(1);
		clock = 12;
		await slice();
		expect(waits).toBe(1);
		clock = 30;
		await slice();
		expect(waits).toBe(2);
	});
});

describe("per-frame allowance", () => {
	it("lets `limit` through per frame, and the rest wait for the next one", () => {
		const allow = perFrameAllowance(2);
		expect([allow(1), allow(1), allow(1)]).toEqual([true, true, false]);
		expect([allow(2), allow(2), allow(2)]).toEqual([true, true, false]);
		// One per frame: each car's setup on a frame of its own.
		const one = perFrameAllowance(1);
		expect([one(7), one(7), one(8), one(8)]).toEqual([true, false, true, false]);
	});
});

describe("calm gate", () => {
	/** Feeds frames of the given lengths, asking once per frame; returns each frame's answer. */
	function run(gate: ReturnType<typeof calmGate>, lengths: readonly number[], active = true, start = 0, firstFrame = 0) {
		let now = start;
		return lengths.map((length, index) => {
			now += length;
			return gate.allows(firstFrame + index, now, active);
		});
	}

	it("is open while inactive, whatever the frames", () => {
		const gate = calmGate({ frames: 3, frameMs: 50, maxWaitMs: 2000 });
		expect(run(gate, [200, 300, 200], false)).toEqual([true, true, true]);
	});

	it("waits for the set number of calm frames in a row once active", () => {
		const gate = calmGate({ frames: 3, frameMs: 50, maxWaitMs: 10_000 });
		// The first ask has no previous frame to measure; then two slow frames, then calm ones.
		expect(run(gate, [20, 120, 200, 20, 20, 20, 20])).toEqual([false, false, false, false, false, true, true]);
	});

	it("starts over after a slow frame", () => {
		const gate = calmGate({ frames: 3, frameMs: 50, maxWaitMs: 10_000 });
		expect(run(gate, [20, 20, 20, 80, 20, 20, 20])).toEqual([false, false, false, false, false, false, true]);
	});

	it("measures a frame once, however many ask in it", () => {
		const gate = calmGate({ frames: 2, frameMs: 50, maxWaitMs: 10_000 });
		gate.allows(0, 0, true);
		gate.allows(1, 20, true);
		expect(gate.allows(2, 40, true)).toBe(true);
		// Later asks in frame 2 (other cars) don't count it again or measure from it.
		expect(gate.allows(2, 45, true)).toBe(true);
		expect(gate.allows(2, 49, true)).toBe(true);
	});

	it("spaces work apart: after a piece runs, the next waits for a fresh calm run", () => {
		const gate = calmGate({ frames: 2, frameMs: 50, maxWaitMs: 10_000 });
		expect(run(gate, [20, 20, 20])).toEqual([false, false, true]);
		gate.used(60);
		expect(run(gate, [20, 20, 20], true, 60, 3)).toEqual([false, true, true]);
	});

	it("lets work through after the longest wait, even if it never gets calm", () => {
		const gate = calmGate({ frames: 5, frameMs: 50, maxWaitMs: 500 });
		const answers = run(gate, Array.from({ length: 8 }, () => 100));
		// Waiting starts at the first active ask (t=100): open from t=600.
		expect(answers).toEqual([false, false, false, false, false, true, true, true]);
		gate.used(800);
		expect(gate.allows(8, 900, true)).toBe(false);
		expect(gate.allows(9, 1300, true)).toBe(true);
	});

	it("stays open in a frame until work actually runs: a caller that couldn't use it doesn't spend it", () => {
		const gate = calmGate({ frames: 2, frameMs: 50, maxWaitMs: 10_000 });
		run(gate, [20, 20]);
		// Frame 2 is open; the first caller has nothing ready (no used()), so the next caller still gets in.
		expect(gate.allows(2, 60, true)).toBe(true);
		expect(gate.allows(2, 61, true)).toBe(true);
		gate.used(62);
		expect(gate.allows(2, 63, true)).toBe(false);
	});

	it("times the longest wait from the last piece of work done by anyone, not per caller", () => {
		const gate = calmGate({ frames: 99, frameMs: 50, maxWaitMs: 2000 });
		// Never calm (every frame 100 ms). Waiting starts at the first active ask, t=100.
		expect(gate.allows(0, 100, true)).toBe(false);
		expect(gate.allows(20, 2100, true)).toBe(true);
		gate.used(2100);
		// A caller that has been waiting since t=100 is held again for a full 2 s from the last piece:
		// pieces run at most once per maxWaitMs while frames stay slow, whoever has waited longest.
		expect(gate.allows(21, 2200, true)).toBe(false);
		expect(gate.allows(40, 4099, true)).toBe(false);
		expect(gate.allows(41, 4100, true)).toBe(true);
	});

	it("waits afresh when it becomes active again", () => {
		const gate = calmGate({ frames: 2, frameMs: 50, maxWaitMs: 300 });
		run(gate, [200, 200, 200], true);
		expect(run(gate, [200], false, 600, 3)).toEqual([true]);
		expect(run(gate, [200], true, 800, 4)).toEqual([false]);
	});
});
