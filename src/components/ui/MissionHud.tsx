"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { readCombatHud } from "@/engine/orion/combat/CombatHud";
import { weaponById } from "@/engine/orion/combat/WeaponData";
import { missions, type MissionReward } from "@/engine/orion/missions/MissionDirector";
import { retryMission } from "@/engine/orion/missions/MissionFlow";
import { readMissionHud, type MissionHudState } from "@/engine/orion/missions/MissionHud";
import { onProgressChange, progressVersion, readProgress } from "@/engine/orion/missions/Progress";

/** Samples the mission state on a timer, re-rendering only when the director has published. */
function useMissionHud(intervalMs: number): MissionHudState {
	const [state, setState] = useState<MissionHudState>(() => ({ ...readMissionHud() }));
	useEffect(() => {
		const id = window.setInterval(() => {
			const next = readMissionHud();
			setState((previous) => (previous.version === next.version ? previous : { ...next }));
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return state;
}

export function formatCash(amount: number): string {
	return `$${amount.toLocaleString("en-US")}`;
}

export function formatClock(seconds: number): string {
	const whole = Math.max(0, Math.ceil(seconds));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** What a mission pays, as lines: "$1,500", "Shotgun", "Red Vesper in your garage". */
export function rewardLines(reward: MissionReward): string[] {
	const lines: string[] = [];
	if (reward.cash) lines.push(formatCash(reward.cash));
	for (const weapon of reward.weapons ?? []) lines.push(weaponById(weapon).name);
	for (const car of reward.vehicles ?? []) lines.push(`${car.name ?? "A car"} in your garage`);
	return lines;
}

/** The player's money, top right. */
export function CashCounter() {
	useSyncExternalStore(onProgressChange, progressVersion, progressVersion);
	const cash = readProgress().cash;
	return (
		<div className="orion-cash" role="status" aria-label={`Cash ${formatCash(cash)}`}>
			{formatCash(cash)}
		</div>
	);
}

/**
 * Missions on screen: the giver's briefing when the player steps into a marker, then the
 * objective line (with a counter and a clock when it has them) and the "passed" or "failed"
 * banner at the end. Keys: E or Enter to take a mission, Esc to turn it down, R to retry.
 */
export function MissionHud() {
	const hud = useMissionHud(100);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.repeat) return;
			const phase = missions.phase;
			if (phase === "briefing" && (event.code === "KeyE" || event.code === "Enter")) missions.accept();
			else if (phase === "briefing" && (event.code === "Escape" || event.code === "Backspace")) missions.decline();
			else if (phase === "failed" && event.code === "KeyR" && canRetry()) retryMission();
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	if (hud.phase === "briefing") {
		const reward = rewardLines(hud.reward);
		return (
			<section className="orion-mission-brief pointer-events-auto" role="dialog" aria-label={`Mission: ${hud.title}`}>
				<p className="orion-kicker">{hud.giver}</p>
				<h2 className="orion-mission-title">{hud.title}</h2>
				<p className="orion-mission-text">{hud.briefing}</p>
				{reward.length > 0 ? <p className="orion-mission-reward">Pays {reward.join(" · ")}</p> : null}
				<div className="orion-mission-actions">
					<button type="button" className="orion-mission-button is-primary orion-focus" onClick={() => missions.accept()}>Start · E</button>
					<button type="button" className="orion-mission-button orion-focus" onClick={() => missions.decline()}>Not now · Esc</button>
				</div>
			</section>
		);
	}

	if (hud.phase === "active") {
		return (
			<>
				{hud.countdown ? (
					<div key={hud.countdown} className={`orion-race-countdown${hud.countdown === "GO" ? " is-go" : ""}`} role="status" aria-live="assertive">
						{hud.countdown}
					</div>
				) : null}
				<div className="orion-mission-objective" role="status" aria-live="polite">
				<div className="orion-mission-objective-line">
					<span>{hud.objective}</span>
					{hud.counter ? <span className="orion-mission-chip">{hud.counter}</span> : null}
					{hud.timeLeft !== null ? <span className={`orion-mission-chip${hud.timeLeft < 10 ? " is-urgent" : ""}`}>{formatClock(hud.timeLeft)}</span> : null}
				</div>
				{hud.outsideArea !== null ? (
					<div className="orion-mission-warning">Get back to the area · {Math.ceil(hud.outsideArea)}</div>
				) : null}
				</div>
			</>
		);
	}

	if (hud.phase === "passed") {
		const reward = rewardLines(hud.reward);
		return (
			<div className="orion-mission-result is-passed" role="alert">
				<span className="orion-mission-result-title">Mission passed</span>
				{reward.length > 0 ? <span className="orion-mission-result-detail">{reward.join(" · ")}</span> : null}
			</div>
		);
	}

	if (hud.phase === "failed") return <FailedBanner reason={hud.failReason} />;
	return null;
}

/** Can't go again while the "wasted" or "busted" screen is still up. */
function canRetry(): boolean {
	const combat = readCombatHud();
	return !combat.wasted && !combat.busted;
}

function FailedBanner({ reason }: Readonly<{ reason: string }>) {
	const [ready, setReady] = useState(canRetry);
	useEffect(() => {
		const id = window.setInterval(() => setReady(canRetry()), 200);
		return () => window.clearInterval(id);
	}, []);
	// The "wasted" or "busted" screen says it first.
	if (!ready) return null;
	return (
		<div className="orion-mission-result is-failed" role="alert">
			<span className="orion-mission-result-title">Mission failed</span>
			<span className="orion-mission-result-detail">{reason}</span>
			<button type="button" className="orion-mission-button is-primary pointer-events-auto orion-focus" onClick={() => retryMission()}>Retry · R</button>
		</div>
	);
}
