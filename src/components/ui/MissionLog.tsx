"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { readCombatHud } from "@/engine/orion/combat/CombatHud";
import { MANIFESTS } from "@/engine/orion/missions/Collectibles";
import { MISSIONS } from "@/engine/orion/missions/MissionCatalog";
import { missions, type MissionChapter, type MissionDefinition } from "@/engine/orion/missions/MissionDirector";
import { abandonMission, playMissionFromGiver } from "@/engine/orion/missions/MissionFlow";
import { availableMissions, FACTIONS, missionOpen, onProgressChange, progressVersion, readProgress } from "@/engine/orion/missions/Progress";
import { setWaypoint } from "@/engine/orion/navigation/Navigation";
import { FACTION_NAMES, formatCash, formatClock, rewardLines } from "./MissionHud";
import { releasePointer } from "./pause";

const SECTIONS: readonly { chapter: MissionChapter; title: string }[] = [
	{ chapter: "story", title: "Story · The Meridian Job" },
	{ chapter: "side", title: "Side jobs" },
	{ chapter: "race", title: "Street races" },
];

/**
 * The mission list (J): the story and the side missions — passed ones to replay (with the best
 * time or rating), the ones on offer to set a waypoint to, and what's still locked — with where
 * the player stands with each side, and the manifest pages found. A mission running can be
 * abandoned from here.
 */
export function MissionLog() {
	const [open, setOpen] = useState(false);
	useSyncExternalStore(onProgressChange, progressVersion, progressVersion);
	const progress = readProgress();
	const offered = new Set(availableMissions(MISSIONS).map((mission) => mission.id));
	const found = MANIFESTS.filter((manifest) => progress.collected.includes(manifest.id)).length;
	const listed = MISSIONS.filter((mission) => missionOpen(mission) || progress.passed.includes(mission.id));

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.code === "KeyJ" && !event.repeat) setOpen((value) => !value);
			if (event.code === "Escape") setOpen(false);
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	useEffect(() => {
		// The cursor is needed on the list: let go of mouse-look.
		if (open) releasePointer();
	}, [open]);

	const busy = () => {
		const combat = readCombatHud();
		return missions.phase === "active" || missions.phase === "briefing" || combat.wasted || combat.busted;
	};

	const item = (mission: MissionDefinition) => {
		const passed = progress.passed.includes(mission.id);
		const available = offered.has(mission.id);
		const best = progress.bestTimes[mission.id];
		const rating = progress.ratings[mission.id];
		return (
			<li key={mission.id} className={`orion-mission-log-item${passed ? " is-passed" : available ? " is-available" : " is-locked"}`}>
				<div className="min-w-0">
					<p className="orion-mission-log-title">
						{passed || available ? mission.title : "Locked"}
						{rating ? <span className="orion-mission-log-stars" aria-label={`Rated ${rating} of 3`}> {"★".repeat(rating)}{"☆".repeat(3 - rating)}</span> : null}
					</p>
					<p className="orion-mission-log-detail">
						{passed || available ? `${mission.giver.name} · ${rewardLines(mission.reward).join(" · ")}` : "Keep going to unlock"}
						{best !== undefined ? ` · Best ${formatClock(best)}` : ""}
					</p>
				</div>
				{available ? (
					<button type="button" className="orion-mission-button orion-focus" onClick={() => { setWaypoint(mission.giver.x, mission.giver.z); setOpen(false); }}>
						Waypoint
					</button>
				) : passed ? (
					<button type="button" className="orion-mission-button orion-focus" onClick={() => { if (!busy() && playMissionFromGiver(mission.id)) setOpen(false); }}>
						Replay
					</button>
				) : null}
			</li>
		);
	};

	const storyPassed = MISSIONS.filter((mission) => (mission.chapter ?? "story") === "story" && progress.passed.includes(mission.id)).length;
	const storyTotal = MISSIONS.filter((mission) => (mission.chapter ?? "story") === "story").length;

	return (
		<>
			<button type="button" className="orion-map-toggle orion-mission-log-toggle pointer-events-auto orion-focus" onClick={() => setOpen((value) => !value)}>
				Missions · J
			</button>
			{open ? (
				<section className="orion-mission-log pointer-events-auto" role="dialog" aria-label="Missions">
					<header className="orion-mission-log-header">
						<div>
							<p className="orion-kicker">Missions</p>
							<p className="orion-mission-log-summary">
								Story {storyPassed}/{storyTotal} · {formatCash(progress.cash)} · Manifests {found}/{MANIFESTS.length} · Street jobs {progress.jobs}
							</p>
							<p className="orion-mission-log-rep" aria-label="Standing">
								{FACTIONS.map((faction) => (
									<span key={faction}>{FACTION_NAMES[faction]} <strong>{progress.rep[faction] > 0 ? "+" : ""}{progress.rep[faction]}</strong></span>
								))}
							</p>
						</div>
						<div className="flex flex-col items-end gap-2">
							<button type="button" className="orion-map-toggle orion-focus" onClick={() => setOpen(false)}>Close · Esc</button>
							{missions.phase === "active" && missions.mission ? (
								<button type="button" className="orion-mission-button orion-focus" onClick={() => { if (abandonMission()) setOpen(false); }}>
									Abandon {missions.mission.title}
								</button>
							) : null}
						</div>
					</header>
					{SECTIONS.map((section) => {
						const entries = listed.filter((mission) => (mission.chapter ?? "story") === section.chapter);
						if (entries.length === 0) return null;
						return (
							<div key={section.chapter}>
								<p className="orion-mission-log-section">{section.title}</p>
								<ol className="orion-mission-log-list">{entries.map(item)}</ol>
							</div>
						);
					})}
				</section>
			) : null}
		</>
	);
}
