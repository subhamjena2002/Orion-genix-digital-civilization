"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import {
	addTouchLook,
	cycleTouchWeapon,
	pressTouch,
	releaseAllTouch,
	setTouchButton,
	setTouchStick,
	type TouchHoldButton,
} from "@/engine/orion/input/TouchInput";
import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { useCombatHud } from "./CombatHud";
import { useFlightHud } from "./FlightHud";

/** Inner share of the stick's travel that reads as centred, so a resting thumb doesn't creep. */
const STICK_DEADZONE = 0.12;
/** Past this the stick is at the rim: running on foot (matches the controller's STICK_RUN). */
const STICK_RIM = 0.9;

/**
 * Keeps a finger's moves and lift coming to the control it landed on, even after sliding off
 * it. Throws if the finger has already gone; the control still sees it while it's over it.
 */
function capture(element: Element, pointerId: number) {
	try {
		element.setPointerCapture(pointerId);
	} catch {
		// Lifted already.
	}
}

/** Only what the controls change with, so walking about doesn't re-render them. */
function usePlayerStatus(intervalMs: number) {
	const [status, setStatus] = useState({ inVehicle: false, nearCar: false, burning: false });
	useEffect(() => {
		const id = window.setInterval(() => {
			const pose = readPlayerPose();
			setStatus((previous) => (
				previous.inVehicle === pose.inVehicle && previous.nearCar === pose.nearCar && previous.burning === pose.vehicleBurning
					? previous
					: { inVehicle: pose.inVehicle, nearCar: pose.nearCar, burning: pose.vehicleBurning }
			));
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return status;
}

/**
 * On-screen controls for phones and tablets, laid out for landscape: a movement stick on the
 * left (steering in a car), actions on the right under the thumb, and the camera turned by
 * dragging anywhere else on the game. On foot: attack, jump, reload, weapon and get in a car.
 * Driving: accelerate, brake / reverse, handbrake and get out.
 */
export function TouchControls() {
	const { inVehicle, nearCar, burning } = usePlayerStatus(100);
	const combat = useCombatHud(120);
	const flight = useFlightHud(120);

	useEffect(() => {
		// A finger lifted while the page wasn't listening never sends its "up".
		const release = () => releaseAllTouch();
		const onVisibility = () => {
			if (document.hidden) release();
		};
		window.addEventListener("blur", release);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("blur", release);
			document.removeEventListener("visibilitychange", onVisibility);
			release();
		};
	}, []);

	const weapon = combat.weaponId;
	const usesAmmo = combat.magazineSize > 0;
	const attack = weapon === "fists"
		? { label: "Punch", icon: <FistIcon /> }
		: usesAmmo
			? { label: "Fire", icon: <CrosshairIcon /> }
			: { label: "Swing", icon: <BladeIcon /> };

	if (flight.flying) return <FlyingControls landed={flight.landed} weaponName={flight.weapon} jet={flight.aircraft === "jet"} />;

	return (
		<div className="orion-touch" data-mode={inVehicle ? "drive" : "foot"} onContextMenu={(event) => event.preventDefault()}>
			{inVehicle ? (
				<div className="orion-touch-steer">
					<HoldButton button="steerLeft" label="Steer left" className="orion-touch-arrow is-left">
						<ArrowIcon />
					</HoldButton>
					<HoldButton button="steerRight" label="Steer right" className="orion-touch-arrow is-right">
						<ArrowIcon />
					</HoldButton>
				</div>
			) : (
				<Stick />
			)}

			{inVehicle ? (
				<div className="orion-touch-cluster">
					<HoldButton button="gas" label="Accelerate" className="orion-touch-gas">
						<PedalIcon />
						<span className="orion-touch-caption">Gas</span>
					</HoldButton>
					<HoldButton button="brake" label="Brake and reverse" className="orion-touch-brake">
						<PedalIcon />
						<span className="orion-touch-caption">Brake</span>
					</HoldButton>
					<HoldButton button="handbrake" label="Handbrake" className="orion-touch-handbrake">
						<HandbrakeIcon />
					</HoldButton>
					<TapButton label="Get out" className={`orion-touch-exit${burning ? " is-urgent" : ""}`} onTap={() => pressTouch("interact")}>
						<ExitIcon />
						<span className="orion-touch-caption">Exit</span>
					</TapButton>
				</div>
			) : (
				<div className="orion-touch-cluster">
					{/* Dragging off the attack button aims, so a gun can be fired and steered at once. */}
					<HoldButton button="fire" label={attack.label} className="orion-touch-fire" lookDrag>
						{attack.icon}
						<span className="orion-touch-caption">{attack.label}</span>
					</HoldButton>
					<HoldButton button="jump" label="Jump" className="orion-touch-jump">
						<JumpIcon />
					</HoldButton>
					{usesAmmo ? (
						<TapButton label="Reload" className={`orion-touch-reload${combat.magazine === 0 ? " is-urgent" : ""}`} onTap={() => pressTouch("reload")}>
							<ReloadIcon />
							<span className="orion-touch-caption">{combat.reloading ? "…" : combat.magazine}</span>
						</TapButton>
					) : null}
					<TapButton label={`Weapon: ${combat.weaponName}. Tap for the next one`} className="orion-touch-weapon" onTap={() => cycleTouchWeapon(1)}>
						<SwapIcon />
						<span className="orion-touch-caption">{combat.weaponName}</span>
					</TapButton>
					{flight.nearGunship ? (
						<TapButton label="Fly the gunship" className="orion-touch-enter is-urgent" onTap={() => pressTouch("interact")}>
							<RotorIcon />
							<span className="orion-touch-caption">Fly</span>
						</TapButton>
					) : null}
					{flight.nearJet ? (
						<TapButton label="Fly the jet" className="orion-touch-enter is-urgent" onTap={() => pressTouch("interact")}>
							<JetIcon />
							<span className="orion-touch-caption">Fly</span>
						</TapButton>
					) : null}
					{nearCar ? (
						<TapButton label="Take car" className="orion-touch-enter is-urgent" onTap={() => pressTouch("interact")}>
							<CarIcon />
							<span className="orion-touch-caption">Take car</span>
						</TapButton>
					) : null}
				</div>
			)}
		</div>
	);
}

/**
 * Flying. Gunship: the stick flies (forward/back, and turns — banking into them at speed), climb
 * and descend are held. Jet: the stick is the control column (up dives, down pulls up, sideways
 * banks) and the two held buttons are thrust up and down (held down at idle, it brakes). Fire
 * aims by dragging off it; the weapon button steps through the weapons. Getting out only once
 * stopped on the ground.
 */
function FlyingControls({ landed, weaponName, jet }: Readonly<{ landed: boolean; weaponName: string; jet: boolean }>) {
	return (
		<div className="orion-touch" data-mode="fly" onContextMenu={(event) => event.preventDefault()}>
			<Stick />
			<div className="orion-touch-cluster">
				<HoldButton button="fire" label="Fire" className="orion-touch-fire" lookDrag>
					<CrosshairIcon />
					<span className="orion-touch-caption">Fire</span>
				</HoldButton>
				<HoldButton button="climb" label={jet ? "More thrust" : "Climb"} className="orion-touch-climb">
					<ArrowIcon />
					<span className="orion-touch-caption">{jet ? "Faster" : "Up"}</span>
				</HoldButton>
				<HoldButton button="descend" label={jet ? "Less thrust; held at idle, brakes" : "Descend"} className="orion-touch-descend">
					<ArrowIcon />
					<span className="orion-touch-caption">{jet ? "Slower" : "Down"}</span>
				</HoldButton>
				<TapButton label={`Weapon: ${weaponName}. Tap for the next one`} className="orion-touch-weapon" onTap={() => cycleTouchWeapon(1)}>
					<SwapIcon />
					<span className="orion-touch-caption">{weaponName}</span>
				</TapButton>
				{landed ? (
					<TapButton label="Get out" className="orion-touch-exit" onTap={() => pressTouch("interact")}>
						<ExitIcon />
						<span className="orion-touch-caption">Exit</span>
					</TapButton>
				) : null}
			</div>
		</div>
	);
}

function RotorIcon() {
	return (
		<Icon>
			<path d="M3 5h18M12 5v3" />
			<path d="M5 13a3 3 0 0 1 3-3h7a4 4 0 0 1 4 4v1H8a3 3 0 0 1-3-2Z" />
			<path d="M19 13h2.5M9 18h9M11 15v3M16 15v3" />
		</Icon>
	);
}

function JetIcon() {
	return (
		<Icon>
			<path d="M12 2.5 13.4 8l6.6 5v1.8l-6.4-2.2-.6 4.9 2.4 1.9V21l-3.4-1-3.4 1v-1.6l2.4-1.9-.6-4.9L4 14.8V13l6.6-5Z" />
		</Icon>
	);
}

/**
 * Floating stick: it appears wherever the thumb lands in the left-hand area, so there's no
 * reaching for a fixed spot, and returns to its resting place when let go.
 */
function Stick() {
	const zone = useRef<HTMLDivElement>(null);
	const base = useRef<HTMLDivElement>(null);
	const knob = useRef<HTMLDivElement>(null);
	const pointer = useRef<number | null>(null);
	const origin = useRef({ x: 0, y: 0, radius: 1 });

	const reset = () => {
		pointer.current = null;
		setTouchStick(0, 0);
		base.current?.removeAttribute("style");
		base.current?.classList.remove("is-active", "is-rim");
		if (knob.current) knob.current.style.transform = "";
	};

	// Getting into a car (or leaving the screen) must not leave it pushed.
	useEffect(() => reset, []);

	const move = (event: ReactPointerEvent) => {
		const { x, y, radius } = origin.current;
		let dx = event.clientX - x;
		let dy = event.clientY - y;
		const length = Math.hypot(dx, dy);
		if (length > radius) {
			dx *= radius / length;
			dy *= radius / length;
		}
		if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
		const push = Math.min(1, length / radius);
		const scaled = push < STICK_DEADZONE ? 0 : (push - STICK_DEADZONE) / (1 - STICK_DEADZONE);
		const direction = length > 0 ? 1 / Math.hypot(dx, dy) : 0;
		// Screen y runs down; forward is up.
		setTouchStick(dx * direction * scaled, -dy * direction * scaled);
		base.current?.classList.toggle("is-rim", scaled >= STICK_RIM);
	};

	const down = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (pointer.current !== null || !zone.current || !base.current) return;
		event.preventDefault();
		pointer.current = event.pointerId;
		capture(zone.current, event.pointerId);
		const area = zone.current.getBoundingClientRect();
		const width = base.current.offsetWidth;
		const height = base.current.offsetHeight;
		// Kept whole inside the area, so a thumb landing at the very edge still gets full travel.
		const cx = Math.min(Math.max(event.clientX, area.left + width / 2), area.right - width / 2);
		const cy = Math.min(Math.max(event.clientY, area.top + height / 2), area.bottom - height / 2);
		origin.current = { x: cx, y: cy, radius: width * 0.32 };
		base.current.style.left = `${cx - area.left - width / 2}px`;
		base.current.style.top = `${cy - area.top - height / 2}px`;
		base.current.style.bottom = "auto";
		base.current.classList.add("is-active");
		move(event);
	};

	const up = (event: ReactPointerEvent) => {
		if (event.pointerId === pointer.current) reset();
	};

	return (
		<div
			ref={zone}
			className="orion-touch-stick-zone"
			onPointerDown={down}
			onPointerMove={(event) => {
				if (event.pointerId === pointer.current) move(event);
			}}
			onPointerUp={up}
			onPointerCancel={up}
		>
			<div ref={base} className="orion-touch-stick" aria-hidden="true">
				<div ref={knob} className="orion-touch-stick-knob" />
			</div>
		</div>
	);
}

interface ButtonProps {
	label: string;
	className: string;
	children: ReactNode;
}

/** Held for as long as the finger stays down, wherever it slides to. */
function HoldButton({ button, label, className, lookDrag = false, children }: Readonly<ButtonProps & { button: TouchHoldButton; lookDrag?: boolean }>) {
	const pointer = useRef<number | null>(null);
	const last = useRef({ x: 0, y: 0 });
	const [down, setDown] = useState(false);

	// Unmounted while held (the car blew up under the thumb): let go.
	useEffect(() => () => setTouchButton(button, false), [button]);

	const release = (event: ReactPointerEvent) => {
		if (event.pointerId !== pointer.current) return;
		pointer.current = null;
		setTouchButton(button, false);
		setDown(false);
	};

	return (
		<button
			type="button"
			aria-label={label}
			className={`orion-touch-button ${className}${down ? " is-down" : ""}`}
			onPointerDown={(event) => {
				event.preventDefault();
				if (pointer.current !== null) return;
				pointer.current = event.pointerId;
				last.current = { x: event.clientX, y: event.clientY };
				capture(event.currentTarget, event.pointerId);
				setTouchButton(button, true);
				setDown(true);
			}}
			onPointerMove={(event) => {
				if (!lookDrag || event.pointerId !== pointer.current) return;
				addTouchLook(event.clientX - last.current.x, event.clientY - last.current.y);
				last.current = { x: event.clientX, y: event.clientY };
			}}
			onPointerUp={release}
			onPointerCancel={release}
		>
			{children}
		</button>
	);
}

/** Acts the moment the finger lands (a click would wait for it to lift). */
function TapButton({ label, className, onTap, children }: Readonly<ButtonProps & { onTap: () => void }>) {
	const [down, setDown] = useState(false);
	return (
		<button
			type="button"
			aria-label={label}
			className={`orion-touch-button ${className}${down ? " is-down" : ""}`}
			onPointerDown={(event) => {
				event.preventDefault();
				setDown(true);
				onTap();
			}}
			onPointerUp={() => setDown(false)}
			onPointerCancel={() => setDown(false)}
			onPointerLeave={() => setDown(false)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") onTap();
			}}
		>
			{children}
		</button>
	);
}

function Icon({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<svg className="orion-touch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{children}
		</svg>
	);
}

function FistIcon() {
	return (
		<Icon>
			<path d="M7 11V8.5a1.5 1.5 0 0 1 3 0V11" />
			<path d="M10 10V7.5a1.5 1.5 0 0 1 3 0V10" />
			<path d="M13 10V8a1.5 1.5 0 0 1 3 0v2.5" />
			<path d="M16 10.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1.5A5.5 5.5 0 0 1 6 14.5V12a1.5 1.5 0 0 1 3 0v1" />
		</Icon>
	);
}

function CrosshairIcon() {
	return (
		<Icon>
			<circle cx="12" cy="12" r="6.5" />
			<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
			<circle cx="12" cy="12" r="1" fill="currentColor" />
		</Icon>
	);
}

function BladeIcon() {
	return (
		<Icon>
			<path d="M19.5 4.5 9 15l-2-2L17.5 2.5h2z" />
			<path d="m6 12 6 6M8 16l-4 4M4.5 18.5l1 1" />
		</Icon>
	);
}

function JumpIcon() {
	return (
		<Icon>
			<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" />
			<path d="M6 21h12" />
		</Icon>
	);
}

function ReloadIcon() {
	return (
		<Icon>
			<path d="M20 12a8 8 0 1 1-2.35-5.65" />
			<path d="M20 4v5h-5" />
		</Icon>
	);
}

function SwapIcon() {
	return (
		<Icon>
			<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
		</Icon>
	);
}

function CarIcon() {
	return (
		<Icon>
			<path d="M4 15.5V12l2-4.5A2 2 0 0 1 7.8 6.5h8.4A2 2 0 0 1 18 7.5l2 4.5v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
			<path d="M4.5 12h15" />
			<circle cx="7.5" cy="16.5" r="1.5" />
			<circle cx="16.5" cy="16.5" r="1.5" />
		</Icon>
	);
}

function PedalIcon() {
	return (
		<Icon>
			<rect x="7" y="3.5" width="10" height="17" rx="2.5" />
			<path d="M9.5 8h5M9.5 12h5M9.5 16h5" />
		</Icon>
	);
}

/** The dashboard parking-brake symbol: a P in a circle between two brackets. */
function HandbrakeIcon() {
	return (
		<svg className="orion-touch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="6.2" />
			<path d="M10.4 15V9h2.1a1.8 1.8 0 0 1 0 3.6h-2.1" />
			<path d="M4.6 6.8a8.8 8.8 0 0 0 0 10.4M19.4 6.8a8.8 8.8 0 0 1 0 10.4" />
		</svg>
	);
}

/** Points right; the left arrow is the same icon mirrored in CSS. */
function ArrowIcon() {
	return (
		<svg className="orion-touch-icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M8 4.5 18.5 12 8 19.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
		</svg>
	);
}

function ExitIcon() {
	return (
		<Icon>
			<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
			<path d="M14 8l4 4-4 4M18 12H9" />
		</Icon>
	);
}
