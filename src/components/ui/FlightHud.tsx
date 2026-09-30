"use client";

import { useEffect, useRef, useState } from "react";

import { readFlightHud, type FlightHudState } from "@/engine/orion/aircraft/FlightHud";
import { GUNSHIP_NAME } from "@/engine/orion/aircraft/GunshipModel";
import { GUNSHIP_WEAPONS, WEAPON_NAMES } from "@/engine/orion/aircraft/GunshipWeapons";
import { JET_NAME } from "@/engine/orion/aircraft/JetModel";
import { JET_WEAPON_NAMES, JET_WEAPONS } from "@/engine/orion/aircraft/JetWeapons";
import { selectTouchSlot } from "@/engine/orion/input/TouchInput";

const KMH_PER_MS = 3.6;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Samples the flight state on a timer, re-rendering only when something shown changed. */
export function useFlightHud(intervalMs: number): FlightHudState {
	const [state, setState] = useState<FlightHudState>(() => ({ ...readFlightHud() }));
	useEffect(() => {
		const id = window.setInterval(() => {
			const next = readFlightHud();
			setState((previous) => (
				previous.flying === next.flying && previous.nearGunship === next.nearGunship && previous.nearJet === next.nearJet && previous.aircraft === next.aircraft
						&& Math.round(previous.throttle * 50) === Math.round(next.throttle * 50) && previous.afterburner === next.afterburner
						&& Math.round(previous.gear * 4) === Math.round(next.gear * 4) && Math.round(previous.load * 10) === Math.round(next.load * 10)
					&& Math.round(previous.altitude) === Math.round(next.altitude) && Math.round(previous.speed * KMH_PER_MS) === Math.round(next.speed * KMH_PER_MS)
					&& Math.round(previous.verticalSpeed * 2) === Math.round(next.verticalSpeed * 2) && Math.round(previous.heading) === Math.round(next.heading)
					&& Math.round(previous.rotor * 100) === Math.round(next.rotor * 100) && Math.round(previous.integrity) === Math.round(next.integrity)
					&& previous.weapon === next.weapon && previous.cannon === next.cannon && previous.rockets === next.rockets && previous.missiles === next.missiles
					&& previous.lock === next.lock && previous.landed === next.landed && Math.round(previous.rearm * 20) === Math.round(next.rearm * 20)
					&& previous.warning === next.warning
					? previous
					: { ...next }
			));
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return state;
}

/**
 * The gunship's head-up display: the gun reticle (where the chin gun actually points), the
 * rocket aiming mark (along the nose), the missile seeker's box, flight instruments, the
 * weapons and their rounds, and warnings.
 */
export function FlightHud({ touch }: Readonly<{ touch: boolean }>) {
	const hud = useFlightHud(80);
	if (!hud.flying) return null;
	if (hud.aircraft === "jet") return <JetHud hud={hud} touch={touch} />;
	const kmh = Math.round(hud.speed * KMH_PER_MS);
	const integrity = Math.max(0, Math.round(hud.integrity));
	const climbing = hud.verticalSpeed;
	const heading = Math.round(hud.heading);
	const point = COMPASS[Math.round(hud.heading / 45) % 8];

	return (
		<>
			<Sights weapon={hud.weapon} jet={false} />

			<div className="orion-flight-panel" role="status" aria-label={`${GUNSHIP_NAME}: ${kmh} km/h, ${Math.round(hud.altitude)} metres, heading ${heading}`}>
				<Reading label="Speed" value={kmh} unit="km/h" />
				<Reading label="Alt" value={Math.round(hud.altitude)} unit="m" />
				<Reading label="V/S" value={`${climbing >= 0 ? "+" : "−"}${Math.abs(climbing).toFixed(1)}`} unit="m/s" />
				<Reading label="Hdg" value={`${String(heading).padStart(3, "0")}°`} unit={point} />
				<div className="orion-flight-bars" aria-hidden="true">
					<Bar label="Rotor" value={hud.rotor * 100} warn={hud.rotor < 0.9} />
					<Bar label={`Health ${integrity}%`} value={integrity} warn={integrity < 45} critical={integrity < 20} />
				</div>
			</div>

			<div className="orion-flight-weapons" role="status" aria-label={`${WEAPON_NAMES[hud.weapon]} selected`}>
				<div className="orion-flight-callsign">{GUNSHIP_NAME}</div>
				{GUNSHIP_WEAPONS.map((weapon, index) => {
					const count = weapon === "cannon" ? hud.cannon : weapon === "rockets" ? hud.rockets : hud.missiles;
					return (
						<button
							type="button"
							key={weapon}
							tabIndex={-1}
							onClick={() => selectTouchSlot(index + 1)}
							className={`orion-flight-weapon pointer-events-auto${weapon === hud.weapon ? " is-active" : ""}${count === 0 ? " is-empty" : ""}`}
						>
							{touch ? null : <span className="orion-key">{index + 1}</span>}
							<span className="orion-flight-weapon-name">{WEAPON_NAMES[weapon]}</span>
							<span className="orion-flight-weapon-count">{count}</span>
						</button>
					);
				})}
				{hud.weapon === "missiles" ? (
					<div className={`orion-flight-lock is-${hud.lock}`}>
						{hud.lock === "locked" ? "LOCKED — fire" : hud.lock === "locking" ? "Locking…" : "Hold the sight on a target"}
					</div>
				) : null}
			</div>

			<div className="orion-flight-status">
				{hud.warning ? <div className="orion-control-hint orion-alert" role="alert">{hud.warning}</div> : null}
				{hud.rearm >= 0 ? (
					<div className="orion-control-hint" role="status">
						Rearming <span className="orion-flight-rearm"><span style={{ width: `${Math.round(hud.rearm * 100)}%` }} /></span>
					</div>
				) : null}
				{!touch ? (
					<div className="orion-control-hint hidden sm:flex">
						<Hint keys={["W", "S"]} label="Fwd/back" />
						<Hint keys={["A", "D"]} label="Turn" />
						<Hint keys={["Q", "E"]} label="Slide" />
						<Hint keys={["Space", "Shift"]} label="Up/down" />
						<Hint keys={["Click"]} label="Fire" />
						<Hint keys={["1–3"]} label="Weapon" />
						{hud.landed ? <Hint keys={["F"]} label="Get out" /> : null}
					</div>
				) : null}
			</div>
		</>
	);
}

/**
 * The jet's head-up display: the gun pipper along the nose, the flight path marker, the missile
 * seeker's box, flight instruments (speed, height, climb, heading, g), thrust and afterburner, the
 * gear, the weapons and warnings.
 */
function JetHud({ hud, touch }: Readonly<{ hud: FlightHudState; touch: boolean }>) {
	const kmh = Math.round(hud.speed * KMH_PER_MS);
	const integrity = Math.max(0, Math.round(hud.integrity));
	const climbing = hud.verticalSpeed;
	const heading = Math.round(hud.heading);
	const point = COMPASS[Math.round(hud.heading / 45) % 8];
	const thrust = Math.round(hud.throttle * 100);
	const gear = hud.gear > 0.95 ? "Down" : hud.gear < 0.05 ? "Up" : "Moving";
	return (
		<>
			<Sights weapon={hud.weapon} jet />

			<div className="orion-flight-panel" role="status" aria-label={`${JET_NAME}: ${kmh} km/h, ${Math.round(hud.altitude)} metres, heading ${heading}`}>
				<Reading label="Speed" value={kmh} unit="km/h" />
				<Reading label="Alt" value={Math.round(hud.altitude)} unit="m" />
				<Reading label="V/S" value={`${climbing >= 0 ? "+" : "−"}${Math.abs(climbing).toFixed(0)}`} unit="m/s" />
				<Reading label="Hdg" value={`${String(heading).padStart(3, "0")}°`} unit={point} />
				<Reading label="G" value={hud.load.toFixed(1)} unit={`Gear ${gear}`} />
				<div className="orion-flight-bars" aria-hidden="true">
					<Bar label={hud.afterburner ? `Thrust ${thrust}% · Afterburner` : `Thrust ${thrust}%`} value={thrust} warn={hud.afterburner} />
					<Bar label={`Health ${integrity}%`} value={integrity} warn={integrity < 45} critical={integrity < 20} />
				</div>
			</div>

			<div className="orion-flight-weapons" role="status" aria-label={`${JET_WEAPON_NAMES[hud.weapon === "missiles" ? "missiles" : "cannon"]} selected`}>
				<div className="orion-flight-callsign">{JET_NAME}</div>
				{JET_WEAPONS.map((weapon, index) => {
					const count = weapon === "cannon" ? hud.cannon : hud.missiles;
					return (
						<button
							type="button"
							key={weapon}
							tabIndex={-1}
							onClick={() => selectTouchSlot(index + 1)}
							className={`orion-flight-weapon pointer-events-auto${weapon === hud.weapon ? " is-active" : ""}${count === 0 ? " is-empty" : ""}`}
						>
							{touch ? null : <span className="orion-key">{index + 1}</span>}
							<span className="orion-flight-weapon-name">{JET_WEAPON_NAMES[weapon]}</span>
							<span className="orion-flight-weapon-count">{count}</span>
						</button>
					);
				})}
				{hud.weapon === "missiles" ? (
					<div className={`orion-flight-lock is-${hud.lock}`}>
						{hud.lock === "locked" ? "LOCKED — fire" : hud.lock === "locking" ? "Locking…" : "Point the nose at a vehicle"}
					</div>
				) : null}
			</div>

			<div className="orion-flight-status">
				{hud.warning ? <div className="orion-control-hint orion-alert" role="alert">{hud.warning}</div> : null}
				{hud.rearm >= 0 ? (
					<div className="orion-control-hint" role="status">
						Rearming <span className="orion-flight-rearm"><span style={{ width: `${Math.round(hud.rearm * 100)}%` }} /></span>
					</div>
				) : null}
				{hud.landed && hud.throttle < 0.05 ? (
					<div className="orion-control-hint" role="status">{touch ? "Hold Faster to taxi and take off" : "Hold Space for thrust, S to pull up at 230 km/h"}</div>
				) : null}
				{!touch ? (
					<div className="orion-control-hint hidden sm:flex">
						<Hint keys={["W", "S"]} label="Dive/climb" />
						<Hint keys={["A", "D"]} label="Bank" />
						<Hint keys={["Q", "E"]} label="Rudder" />
						<Hint keys={["Space", "Shift"]} label="Thrust/brake" />
						<Hint keys={["Click"]} label="Fire" />
						<Hint keys={["1–2"]} label="Weapon" />
						{hud.landed ? <Hint keys={["F"]} label="Get out" /> : null}
					</div>
				) : null}
			</div>
		</>
	);
}

/**
 * Sight marks, moved every frame straight from the game's state (no React renders). Gunship:
 * the gun reticle, the rocket mark and the missile box. Jet: the gun pipper along the nose, the
 * flight path marker and the missile box.
 */
function Sights({ weapon, jet }: Readonly<{ weapon: string; jet: boolean }>) {
	const gun = useRef<HTMLDivElement>(null);
	const boresight = useRef<HTMLDivElement>(null);
	const path = useRef<HTMLDivElement>(null);
	const lock = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let frame = 0;
		const place = (element: HTMLDivElement | null, x: number, y: number, show: boolean) => {
			if (!element) return;
			const visible = show && x >= 0 && y >= 0 && x <= 1 && y <= 1;
			element.style.opacity = visible ? "1" : "0";
			if (visible) element.style.transform = `translate(${(x * window.innerWidth).toFixed(1)}px, ${(y * window.innerHeight).toFixed(1)}px) translate(-50%, -50%)`;
		};
		const tick = () => {
			const hud = readFlightHud();
			if (jet) {
				place(gun.current, hud.boresightX, hud.boresightY, true);
				place(boresight.current, -1, -1, false);
				place(path.current, hud.pathX, hud.pathY, true);
			} else {
				place(gun.current, hud.gunX, hud.gunY, hud.weapon === "cannon");
				place(boresight.current, hud.boresightX, hud.boresightY, hud.weapon === "rockets");
				place(path.current, -1, -1, false);
			}
			place(lock.current, hud.lockX, hud.lockY, hud.weapon === "missiles" && hud.lock !== "none");
			if (lock.current) {
				lock.current.dataset.state = hud.lock;
				lock.current.style.setProperty("--closing", String(1 - hud.lockProgress));
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [jet]);
	return (
		<div className="orion-flight-sights" aria-hidden="true">
			{/* Where the pilot is looking, for the gunship's missiles (and to lead the gun onto). */}
			{weapon === "missiles" && !jet ? <div className="orion-flight-seeker" /> : null}
			<div ref={gun} className="orion-flight-reticle" />
			<div ref={boresight} className="orion-flight-boresight" />
			<div ref={path} className="orion-flight-path" />
			<div ref={lock} className="orion-flight-lockbox" />
		</div>
	);
}

function Reading({ label, value, unit }: Readonly<{ label: string; value: number | string; unit: string }>) {
	return (
		<div className="orion-flight-reading">
			<span className="orion-flight-label">{label}</span>
			<span className="orion-flight-value">{value}</span>
			<span className="orion-flight-unit">{unit}</span>
		</div>
	);
}

function Bar({ label, value, warn = false, critical = false }: Readonly<{ label: string; value: number; warn?: boolean; critical?: boolean }>) {
	return (
		<div className="orion-flight-bar">
			<span className="orion-flight-label">{label}</span>
			<div className="orion-condition-bar">
				<span className={critical ? "is-critical" : warn ? "is-warning" : ""} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
			</div>
		</div>
	);
}

function Hint({ keys, label }: Readonly<{ keys: readonly string[]; label: string }>) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span className="inline-flex items-center gap-0.5">
				{keys.map((key) => <span key={key} className="orion-key">{key}</span>)}
			</span>
			<span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--oi-text-tertiary)]">{label}</span>
		</span>
	);
}
