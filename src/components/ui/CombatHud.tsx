"use client";

import { useEffect, useState } from "react";

import { readCombatHud, type CombatHudState } from "@/engine/orion/combat/CombatHud";
import { selectTouchSlot } from "@/engine/orion/input/TouchInput";
import { MAX_STARS, readWanted } from "@/engine/orion/police/Wanted";
import { RESERVED_SLOTS } from "@/engine/orion/combat/WeaponData";
import { usePlayerPose } from "@/components/world/usePlayerPose";
import { useFlightHud } from "./FlightHud";
import { CashCounter } from "./MissionHud";

const SLOT_KEYS = [1, 2, 3, 4, 5, 6, 7];

/** Samples the combat state on a timer, re-rendering only when something shown changed. */
export function useCombatHud(intervalMs: number): CombatHudState {
	const [state, setState] = useState<CombatHudState>(() => ({ ...readCombatHud() }));
	useEffect(() => {
		const id = window.setInterval(() => {
			const next = readCombatHud();
			setState((previous) => (
				previous.weaponId === next.weaponId && previous.magazine === next.magazine && previous.reserve === next.reserve
					&& previous.reloading === next.reloading && Math.round(previous.reloadProgress * 20) === Math.round(next.reloadProgress * 20)
					&& Math.round(previous.health) === Math.round(next.health) && previous.wasted === next.wasted && previous.busted === next.busted
					&& Math.round(previous.armour) === Math.round(next.armour) && previous.toastSerial === next.toastSerial
					&& previous.slots === next.slots
					? previous
					: { ...next }
			));
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return state;
}

/** The wanted level, sampled like the rest of the HUD: stars, and whether the police are searching. */
function useWanted(intervalMs: number): { stars: number; searching: boolean } {
	const [wanted, setWanted] = useState(() => ({ stars: 0, searching: false }));
	useEffect(() => {
		const id = window.setInterval(() => {
			const next = readWanted();
			setWanted((previous) => (
				previous.stars === next.stars && previous.searching === next.searching ? previous : { stars: next.stars, searching: next.searching }
			));
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return wanted;
}

/** A pickup's line stays up this long. */
const TOAST_MS = 2600;

/**
 * Weapon wheel strip (number keys), ammunition, health and armour, a crosshair while a gun is out,
 * what was just picked up, and the "wasted" screen. Hidden while driving, except health.
 */
export function CombatHud() {
	const combat = useCombatHud(60);
	const wanted = useWanted(100);
	const { inVehicle: inCar } = usePlayerPose(200);
	const { flying } = useFlightHud(200);
	const inVehicle = inCar || flying;
	const health = Math.max(0, Math.round((combat.health / combat.maxHealth) * 100));
	const armour = Math.max(0, Math.round(combat.armour));
	const usesAmmo = combat.magazineSize > 0;
	// The latest pickup's line, for a moment: up until it's been on screen long enough.
	const [dismissed, setDismissed] = useState(0);
	useEffect(() => {
		if (combat.toastSerial === 0) return;
		const serial = combat.toastSerial;
		const id = window.setTimeout(() => setDismissed(serial), TOAST_MS);
		return () => window.clearTimeout(id);
	}, [combat.toastSerial]);
	const toast = combat.toastSerial > dismissed && combat.toast ? combat.toast : null;

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
			{combat.busted ? (
				<div className="orion-wasted orion-busted" role="alert">
					<span>Busted</span>
				</div>
			) : null}

			<div className="orion-hud-combat absolute right-5 top-5 flex flex-col items-end gap-2 sm:right-8 sm:top-8">
				<CashCounter />
				{!inVehicle ? (
					<div className="orion-weapon-panel" role="status" aria-label={`${combat.weaponName}${usesAmmo ? `, ${combat.magazine} of ${combat.magazineSize}, ${combat.reserve} spare` : ""}`}>
						<div className="orion-weapon-slots" aria-hidden="true">
							{SLOT_KEYS.map((slot) => {
								const weapon = combat.slots.find((candidate) => candidate.slot === slot);
								const reserved = RESERVED_SLOTS.includes(slot);
								// Tappable, for touch screens (the keyboard uses the number keys).
								return (
									<button
										type="button"
										key={slot}
										tabIndex={-1}
										disabled={!weapon}
										title={weapon?.name ?? (reserved ? "Reserved" : "Empty")}
										onClick={() => selectTouchSlot(slot)}
										className={`orion-weapon-slot pointer-events-auto${slot === combat.slot ? " is-active" : ""}${weapon ? "" : " is-empty"}`}
									>
										{slot}
									</button>
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
				{toast ? <div key={combat.toastSerial} className="orion-pickup-toast" role="status">{toast}</div> : null}
				<div className="orion-health" role="status" aria-label={`Health ${health}%`}>
					<span className="orion-health-label">Health</span>
					<div className="orion-health-bar" aria-hidden="true">
						<span className={health < 30 ? "is-critical" : ""} style={{ width: `${health}%` }} />
					</div>
				</div>
				{armour > 0 ? (
					<div className="orion-health orion-armour" role="status" aria-label={`Armour ${armour}%`}>
						<span className="orion-health-label">Armour</span>
						<div className="orion-health-bar" aria-hidden="true">
							<span style={{ width: `${armour}%` }} />
						</div>
					</div>
				) : null}
				{wanted.stars > 0 ? (
					<div
						className={`orion-wanted${wanted.searching ? " is-searching" : ""}`}
						role="status"
						aria-label={`Wanted level ${wanted.stars} of ${MAX_STARS}${wanted.searching ? ", police searching" : ""}`}
					>
						{Array.from({ length: MAX_STARS }, (_, index) => (
							<svg key={index} className={index < wanted.stars ? "is-lit" : ""} viewBox="0 0 24 24" aria-hidden="true">
								<path d="M12 2.8l2.75 5.8 6.35.75-4.7 4.35 1.25 6.3L12 16.85 6.35 20l1.25-6.3L2.9 9.35l6.35-.75z" />
							</svg>
						))}
					</div>
				) : null}
			</div>
		</>
	);
}
