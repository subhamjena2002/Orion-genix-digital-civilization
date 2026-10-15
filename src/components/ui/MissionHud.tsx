"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { readCombatHud } from "@/engine/orion/combat/CombatHud";
import { weaponById } from "@/engine/orion/combat/WeaponData";
import { missions, type Faction, type MissionReward } from "@/engine/orion/missions/MissionDirector";
import { retryMission } from "@/engine/orion/missions/MissionFlow";
import { readMissionHud, type HudBonus, type MissionHudState } from "@/engine/orion/missions/MissionHud";
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

/** What each side is called on screen. */
export const FACTION_NAMES: Readonly<Record<Faction, string>> = {
	street: "Street",
	sunset: "Sunset Park",
	law: "OCPD",
	meridian: "Meridian",
};

/** What a mission pays, as lines: "$1,500", "Shotgun", "Red Phoenix in your garage", "Street +1". */
export function rewardLines(reward: MissionReward, withRep = false): string[] {
	const lines: string[] = [];
	if (reward.cash) lines.push(formatCash(reward.cash));
	for (const weapon of reward.weapons ?? []) lines.push(weaponById(weapon).name);
	for (const car of reward.vehicles ?? []) lines.push(`${car.name ?? "A car"} in your garage`);
	if (withRep) {
		for (const [faction, amount] of Object.entries(reward.rep ?? {}) as [Faction, number][]) {
			if (amount) lines.push(`${FACTION_NAMES[faction]} ${amount > 0 ? "+" : "−"}${Math.abs(amount)}`);
		}
	}
	return lines;
}

/** Everything a run paid: the mission's reward and whatever its choices added, rep summed by side. */
function totalReward(base: MissionReward, extras: readonly MissionReward[]): MissionReward {
	const rep: Partial<Record<Faction, number>> = { ...base.rep };
	for (const extra of extras) for (const [faction, amount] of Object.entries(extra.rep ?? {}) as [Faction, number][]) rep[faction] = (rep[faction] ?? 0) + amount;
	return {
		cash: [base, ...extras].reduce((sum, reward) => sum + (reward.cash ?? 0), 0),
		weapons: [base, ...extras].flatMap((reward) => reward.weapons ?? []),
		vehicles: [base, ...extras].flatMap((reward) => reward.vehicles ?? []),
		rep,
	};
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

/** Keys for the options of a choice, in order. */
const CHOICE_KEYS = ["KeyZ", "KeyX", "KeyV"] as const;
const CHOICE_KEY_LABELS = ["Z", "X", "V"] as const;

/** Out of three, as stars. */
function Rating({ stars }: Readonly<{ stars: number }>) {
	return (
		<span className="orion-mission-rating" aria-label={`Rated ${stars} of 3`}>
			{[1, 2, 3].map((star) => <span key={star} className={star <= stars ? "is-lit" : ""}>★</span>)}
		</span>
	);
}

function BonusList({ bonuses, className }: Readonly<{ bonuses: readonly HudBonus[]; className: string }>) {
	if (bonuses.length === 0) return null;
	return (
		<ul className={className} aria-label="Optional objectives">
			{bonuses.map((bonus) => (
				<li key={bonus.label} className={`is-${bonus.state}`}>
					<span aria-hidden="true">{bonus.state === "met" ? "✓" : bonus.state === "failed" ? "✕" : "◇"}</span> {bonus.label}
				</li>
			))}
		</ul>
	);
}

/**
 * Missions on screen: the giver's briefing when the player steps into a marker, then the
 * objective line (with a counter and a clock when it has them), any choice to make, the optional
 * objectives, subtitles as people talk, and the "passed" or "failed" banner at the end. Keys: E
 * or Enter to take a mission, Esc to turn it down, Z / X / V to choose, R to retry (from the last
 * checkpoint, if there was one), T to restart from the top.
 */
export function MissionHud() {
	const hud = useMissionHud(100);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.repeat) return;
			const phase = missions.phase;
			if (phase === "briefing" && (event.code === "KeyE" || event.code === "Enter")) missions.accept();
			else if (phase === "briefing" && (event.code === "Escape" || event.code === "Backspace")) missions.decline();
			else if (phase === "failed" && missions.mission?.chapter !== "job" && canRetry()) {
				if (event.code === "KeyR") retryMission(true);
				else if (event.code === "KeyT") retryMission(false);
			} else if (phase === "active") {
				const key = CHOICE_KEYS.indexOf(event.code as (typeof CHOICE_KEYS)[number]);
				const choice = key >= 0 ? missions.choices[key] : undefined;
				if (choice) missions.choose(choice.index);
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	return (
		<>
			<MissionPanel hud={hud} />
			{hud.notice ? <div key={hud.notice} className="orion-mission-notice" role="status">{hud.notice}</div> : null}
			{hud.subtitle ? (
				<p key={`${hud.subtitle.who}:${hud.subtitle.text}`} className="orion-subtitle" role="status" aria-live="polite">
					<span className="orion-subtitle-who">{hud.subtitle.who}</span> {hud.subtitle.text}
				</p>
			) : null}
		</>
	);
}

function MissionPanel({ hud }: Readonly<{ hud: MissionHudState }>) {
	const job = hud.chapter === "job";

	if (hud.phase === "briefing") {
		const reward = rewardLines(hud.reward, true);
		return (
			<section className="orion-mission-brief pointer-events-auto" role="dialog" aria-label={`Mission: ${hud.title}`}>
				<p className="orion-kicker">{hud.role ? `${hud.giver} · ${hud.role}` : hud.giver}</p>
				<h2 className="orion-mission-title">{hud.title}</h2>
				<p className="orion-mission-text">{hud.briefing}</p>
				{reward.length > 0 ? <p className="orion-mission-reward">Pays {reward.join(" · ")}</p> : null}
				{hud.bonuses.length > 0 ? <p className="orion-mission-optional">Optional: {hud.bonuses.map((bonus) => bonus.label).join(" · ")}</p> : null}
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
					<div key={hud.objectiveIndex} className="orion-mission-objective-line">
						<span>{hud.objective}</span>
						{hud.counter ? <span className="orion-mission-chip">{hud.counter}</span> : null}
						{hud.timeLeft !== null ? <span className={`orion-mission-chip${hud.timeLeft < 10 ? " is-urgent" : ""}`}>{formatClock(hud.timeLeft)}</span> : null}
					</div>
					{hud.outsideArea !== null ? (
						<div className="orion-mission-warning">Get back to the area · {Math.ceil(hud.outsideArea)}</div>
					) : null}
				</div>
				{hud.choices && hud.choices.length > 0 ? (
					<div className="orion-mission-choices pointer-events-auto" role="group" aria-label={hud.objective}>
						{hud.choices.map((choice, order) => (
							<button key={choice.index} type="button" className="orion-mission-choice orion-focus" onClick={() => missions.choose(choice.index)}>
								<span className="orion-mission-choice-key">{CHOICE_KEY_LABELS[order]}</span>
								<span className="orion-mission-choice-label">{choice.label}</span>
								{choice.detail ? <span className="orion-mission-choice-detail">{choice.detail}</span> : null}
							</button>
						))}
					</div>
				) : null}
				<BonusList bonuses={hud.bonuses} className="orion-mission-bonuses" />
			</>
		);
	}

	if (hud.phase === "passed") {
		const reward = rewardLines(totalReward(hud.reward, hud.extras), true);
		return (
			<div className="orion-mission-result is-passed" role="alert">
				<span className="orion-mission-result-title">{job ? "Job done" : "Mission passed"}</span>
				{hud.rating !== null ? <Rating stars={hud.rating} /> : null}
				{reward.length > 0 ? <span className="orion-mission-result-detail">{reward.join(" · ")}</span> : null}
				<BonusList bonuses={hud.bonuses} className="orion-mission-result-bonuses" />
			</div>
		);
	}

	if (hud.phase === "failed") return <FailedBanner reason={hud.failReason} job={job} canResume={hud.canResume} />;
	return null;
}

/** Can't go again while the "wasted" or "busted" screen is still up. */
function canRetry(): boolean {
	const combat = readCombatHud();
	return !combat.wasted && !combat.busted;
}

function FailedBanner({ reason, job, canResume }: Readonly<{ reason: string; job: boolean; canResume: boolean }>) {
	const [ready, setReady] = useState(canRetry);
	useEffect(() => {
		const id = window.setInterval(() => setReady(canRetry()), 200);
		return () => window.clearInterval(id);
	}, []);
	// The "wasted" or "busted" screen says it first.
	if (!ready) return null;
	return (
		<div className="orion-mission-result is-failed" role="alert">
			<span className="orion-mission-result-title">{job ? "Lead lost" : "Mission failed"}</span>
			<span className="orion-mission-result-detail">{reason}</span>
			{job ? null : (
				<div className="orion-mission-actions is-centred">
					<button type="button" className="orion-mission-button is-primary pointer-events-auto orion-focus" onClick={() => retryMission(true)}>
						{canResume ? "Retry from checkpoint · R" : "Retry · R"}
					</button>
					{canResume ? (
						<button type="button" className="orion-mission-button pointer-events-auto orion-focus" onClick={() => retryMission(false)}>Restart · T</button>
					) : null}
				</div>
			)}
		</div>
	);
}
