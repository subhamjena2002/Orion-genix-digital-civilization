"use client";

import { useApp } from "@playcanvas/react/hooks";
import type { AppBase } from "playcanvas";
import { useEffect } from "react";

import { isPaused, onPauseChange } from "@/components/ui/pause";
import { audioBus } from "@/engine/orion/audio/AudioBus";

/**
 * Stops the world while the pause menu is open (components/ui/pause.ts): the engine's frame loop
 * is cancelled, so nothing updates — traffic, police, physics, timers that run on frame time —
 * and the last frame stays on screen under the menu. The sound fades out with it.
 *
 * Not `app.timeScale = 0`: a zero frame time reaches code that divides by it (flight, vehicles,
 * missiles). Resuming asks for the next frame; the engine caps that first step (maxDeltaTime),
 * so the time spent paused doesn't arrive as one huge step.
 */

/** Follows the pause state from now on; returns the way to stop (running the world again). */
function followPause(app: AppBase): () => void {
	let stopped = false;
	const apply = () => {
		if (isPaused() && !stopped) {
			if (app.frameRequestId) cancelAnimationFrame(app.frameRequestId);
			app.frameRequestId = null;
			stopped = true;
			audioBus().setAudible(false);
		} else if (!isPaused() && stopped) {
			stopped = false;
			app.requestAnimationFrame();
			audioBus().setAudible(true);
		}
	};
	apply();
	const off = onPauseChange(apply);
	return () => {
		off();
		if (stopped) app.requestAnimationFrame();
	};
}

export function GamePause() {
	const app = useApp();
	useEffect(() => (app ? followPause(app) : undefined), [app]);
	return null;
}
