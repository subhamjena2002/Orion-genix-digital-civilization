"use client";

import { useEffect, useState } from "react";

import { readCombatHud, type CombatHudState } from "@/engine/orion/combat/CombatHud";
import { RESERVED_SLOTS } from "@/engine/orion/combat/WeaponData";
import { usePlayerPose } from "@/components/world/usePlayerPose";

const SLOT_KEYS = [1, 2, 3, 4, 5, 6, 7];

/** Samples the combat state on a timer, re-rendering only when something shown changed. */
function useCombatHud(intervalMs: number): CombatHudState {
	const [state, setState] = useState<CombatHudState>(() => ({ ...readCombatHud() }));
	useEffect(() => {
		const id = window.setInterval(() => {
			const next = readCombatHud();
			setState((previous) => (
				previous.weaponId === next.weaponId && previous.magazine === next.magazine && previous.reserve === next.reserve
					&& previous.reloading === next.reloading && Math.round(previous.reloadProgress * 20) === Math.round(next.reloadProgress * 20)
					&& Math.round(previous.health) === Math.round(next.health) && previous.wasted === next.wasted
					&& previous.slots === next.slots
					? previous
					: { ...next }
			));
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return state;
}

/**
 * Weapon wheel strip (number keys), ammunition, health, a crosshair while a gun is out, and the
 * "wasted" screen. Hidden while driving, except health.
 */
export function CombatHud() {
	const combat = useCombatHud(60);
	const { inVehicle } = usePlayerPose(200);
	const health = Math.max(0, Math.round((combat.health / combat.maxHealth) * 100));
	const usesAmmo = combat.magazineSize > 0;

	return (
		<>
			{combat.showCrosshair && !inVehicle && !combat.wasted ? (
				<div className="orion-crosshair" aria-hidden="true">
					<span />
				</div>
			) : null}

			{combat.wasted ? (
				<div className="orion-wasted" role="alert">
					<span>Wasted</span>
				</div>
			) : null}

			<div className="absolute right-5 top-5 flex flex-col items-end gap-2 sm:right-8 sm:top-8">
				{!inVehicle ? (
					<div className="orion-weapon-panel" role="status" aria-label={`${combat.weaponName}${usesAmmo ? `, ${combat.magazine} of ${combat.magazineSize}, ${combat.reserve} spare` : ""}`}>
						<div className="orion-weapon-slots" aria-hidden="true">
							{SLOT_KEYS.map((slot) => {
								const weapon = combat.slots.find((candidate) => candidate.slot === slot);
								const reserved = RESERVED_SLOTS.includes(slot);
								return (
									<span
										key={slot}
										title={weapon?.name ?? (reserved ? "Reserved" : "Empty")}
										className={`orion-weapon-slot${slot === combat.slot ? " is-active" : ""}${weapon ? "" : " is-empty"}`}
									>
										{slot}
									</span>
								);
							})}
						</div>
						<div className="orion-weapon-name">{combat.weaponName}</div>
						{usesAmmo ? (
							<div className="orion-weapon-ammo">
								<span className={combat.magazine === 0 ? "is-empty" : ""}>{combat.magazine}</span>
								<span className="orion-weapon-reserve">/ {combat.reserve}</span>
							</div>
						) : null}
						{combat.reloading ? (
							<div className="orion-weapon-reload" aria-label="Reloading">
								<span style={{ width: `${Math.round(combat.reloadProgress * 100)}%` }} />
							</div>
						) : null}
					</div>
				) : null}
				<div className="orion-health" role="status" aria-label={`Health ${health}%`}>
					<span className="orion-health-label">Health</span>
					<div className="orion-health-bar" aria-hidden="true">
						<span className={health < 30 ? "is-critical" : ""} style={{ width: `${health}%` }} />
					</div>
				</div>
			</div>
		</>
	);
}
