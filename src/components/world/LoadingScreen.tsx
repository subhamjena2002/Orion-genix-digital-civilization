"use client";

import { useEffect, useState } from "react";

/**
 * The one loading screen between pressing Play and the city: a progress bar, the step it's on,
 * and a tip to read while the world comes down the wire. `progress` is 0..1 and only ever moves
 * forward; at 1 the screen fades away (`done`).
 */

const TIPS = [
	"Press F next to a car to take it — the driver may not agree.",
	"Lose the police by breaking their line of sight. More stars, longer search.",
	"The air base keeps its jets on the apron and its gunship on the pad.",
	"Press J for the mission list, M for the map.",
	"Crash too hard and the car catches fire. Get out before it goes up.",
	"Win all three street races and the gold Phoenix is yours.",
];

export function LoadingScreen({ progress, label, done = false, error = false }: Readonly<{ progress: number; label: string; done?: boolean; error?: boolean }>) {
	const [tip, setTip] = useState(0);
	const [gone, setGone] = useState(false);
	const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);

	useEffect(() => {
		const id = window.setInterval(() => setTip((value) => (value + 1) % TIPS.length), 4500);
		return () => window.clearInterval(id);
	}, []);

	useEffect(() => {
		if (!done) return;
		// Off the screen entirely once the fade has played, so it can't catch a click.
		const id = window.setTimeout(() => setGone(true), 700);
		return () => window.clearTimeout(id);
	}, [done]);

	if (gone) return null;

	return (
		<div className={`orion-loading${done ? " is-done" : ""}${error ? " is-error" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Loading OrionGenix">
			<div className="orion-loading-inner">
				<p className="orion-loading-wordmark">ORION<span>GENIX</span></p>
				<div className="orion-loading-bar" aria-hidden="true">
					<span style={{ width: `${percent}%` }} />
				</div>
				<div className="orion-loading-status">
					<span>{label}</span>
					<span className="orion-loading-percent">{percent}%</span>
				</div>
				{error ? null : <p className="orion-loading-tip">{TIPS[tip]}</p>}
			</div>
		</div>
	);
}
