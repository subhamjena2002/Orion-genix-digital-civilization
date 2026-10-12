"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { readCombatHud } from "@/engine/orion/combat/CombatHud";
import { MISSIONS } from "@/engine/orion/missions/MissionCatalog";
import { missions } from "@/engine/orion/missions/MissionDirector";
import { playMissionFromGiver } from "@/engine/orion/missions/MissionFlow";
import { availableMissions, onProgressChange, progressVersion, readProgress } from "@/engine/orion/missions/Progress";
import { setWaypoint } from "@/engine/orion/navigation/Navigation";
import { formatCash, formatClock, rewardLines } from "./MissionHud";

/**
 * The mission list (J): every mission in the arc — passed ones to replay (with the best time on
 * a race), the ones on offer to set a waypoint to, and what's still locked.
 */
export function MissionLog() {
	const [open, setOpen] = useState(false);
	useSyncExternalStore(onProgressChange, progressVersion, progressVersion);
	const progress = readProgress();
	const offered = new Set(availableMissions(MISSIONS).map((mission) => mission.id));

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
		if (open && document.pointerLockElement) document.exitPointerLock();
	}, [open]);

	const busy = () => {
		const combat = readCombatHud();
		return missions.phase === "active" || missions.phase === "briefing" || combat.wasted || combat.busted;
	};

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
							<p className="orion-mission-log-summary">{progress.passed.length} of {MISSIONS.length} passed · {formatCash(progress.cash)}</p>
						</div>
						<button type="button" className="orion-map-toggle orion-focus" onClick={() => setOpen(false)}>Close · Esc</button>
					</header>
					<ol className="orion-mission-log-list">
						{MISSIONS.map((mission) => {
							const passed = progress.passed.includes(mission.id);
							const available = offered.has(mission.id);
							const best = progress.bestTimes[mission.id];
							return (
								<li key={mission.id} className={`orion-mission-log-item${passed ? " is-passed" : available ? " is-available" : " is-locked"}`}>
									<div className="min-w-0">
										<p className="orion-mission-log-title">{passed || available ? mission.title : "Locked"}</p>
										<p className="orion-mission-log-detail">
											{passed || available ? `${mission.giver.name} · ${rewardLines(mission.reward).join(" · ")}` : "Pass the mission before it to unlock"}
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
						})}
					</ol>
				</section>
			) : null}
		</>
	);
}
