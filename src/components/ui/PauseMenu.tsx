"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { authMessage, fetchMe, signOut, type AccountUser } from "@/components/account/authApi";
import { forgetLocalSave, settleCloudSave } from "@/engine/orion/missions/CloudSave";
import { loadGraphicsSettings } from "@/engine/orion/rendering/GraphicsSettings";
import { setAdaptiveQuality } from "@/engine/orion/rendering/RenderPipeline";

import { enterFullscreen, exitFullscreen, useFullscreen } from "./fullscreen";
import { isGameReady, isPaused, onMapClosed, onPauseChange, releasedOnPurpose, requestMap, setPaused } from "./pause";
import { SoundControls, useAudioSettings } from "./SoundSettings";

/**
 * The pause menu (Esc): Resume, Map, Settings, and signing in or out. The world stops while it's
 * open (GamePause). It opens on Escape, or when mouse-look is released by anything but the game
 * itself (the browser keeps that Escape for itself), and from the header's menu button on a
 * touch screen. Escape again resumes; the player clicks the world to take the mouse back, as
 * when the game starts (a browser only grants the mouse on a click).
 */

type View = "main" | "settings" | "map";

/** A panel of its own is open (map, missions, sound, a shop, a briefing): Escape is its to close. */
const otherDialogOpen = () => document.querySelector('#world [role="dialog"]:not(.orion-pause)') !== null;

/** Typing somewhere: Escape there isn't the game's. */
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Let lost mouse-look settle first: a panel opening releases it and appears a moment later. */
const POINTER_SETTLE_MS = 120;

function usePaused(): boolean {
	return useSyncExternalStore(onPauseChange, isPaused, () => false);
}

export function PauseMenu() {
	const paused = usePaused();
	const ids = useId();
	const [view, setView] = useState<View>("main");
	const [user, setUser] = useState<AccountUser | null>(null);
	const [accounts, setAccounts] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const resumeRef = useRef<HTMLButtonElement>(null);

	// Opening: Escape, or mouse-look lost to the browser's own Escape (or leaving the window).
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code !== "Escape" || event.repeat || !isGameReady()) return;
			if (isPaused()) return;
			if (otherDialogOpen() || typing(event.target)) return;
			event.preventDefault();
			setPaused(true);
		};
		let timer: number | null = null;
		const onPointerLockChange = () => {
			if (document.pointerLockElement || isPaused() || releasedOnPurpose()) return;
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = null;
				if (!document.pointerLockElement && !otherDialogOpen() && isGameReady()) setPaused(true);
			}, POINTER_SETTLE_MS);
		};
		window.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("pointerlockchange", onPointerLockChange);
		return () => {
			if (timer !== null) window.clearTimeout(timer);
			window.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("pointerlockchange", onPointerLockChange);
		};
	}, []);

	// While paused, the game's keys don't reach it (a key pressed now would act on resume), and
	// Escape steps back: settings to the menu, the menu to the game. The full map handles its own.
	useEffect(() => {
		if (!paused || view === "map") return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code === "Escape") {
				event.preventDefault();
				if (view === "settings") setView("main");
				else setPaused(false);
			}
			// Immediate: the game's own listeners are on window too, where this runs first (capture).
			event.stopImmediatePropagation();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [paused, view]);

	// The map closing goes back to the menu.
	useEffect(() => onMapClosed(() => setView((current) => (current === "map" ? "main" : current))), []);

	// Each time it opens: back to the first page, focus on Resume, and who's signed in.
	useEffect(() => {
		if (!paused) return;
		/* eslint-disable react-hooks/set-state-in-effect -- reset as the menu opens */
		setView("main");
		setError(null);
		/* eslint-enable react-hooks/set-state-in-effect */
		let live = true;
		void fetchMe().then((result) => {
			if (!live) return;
			// No API (plain `npm run dev`): no account section at all.
			setAccounts(result.ok);
			setUser(result.ok ? result.user : null);
		});
		return () => {
			live = false;
		};
	}, [paused]);

	useEffect(() => {
		if (paused && view === "main") resumeRef.current?.focus();
	}, [paused, view]);

	if (!paused) return null;

	const resume = () => {
		setPaused(false);
		// A click is what a browser needs to hand the mouse back for looking round.
		const canvas = document.querySelector<HTMLCanvasElement>("canvas");
		if (canvas && window.matchMedia("(pointer: fine)").matches) {
			Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
		}
	};

	const openMap = () => {
		setView("map");
		requestMap();
	};

	const leave = async () => {
		setBusy(true);
		setError(null);
		// Progress not yet sent goes now, while still signed in.
		const allSaved = await settleCloudSave();
		const result = await signOut();
		if (!result.ok) {
			setBusy(false);
			setError(authMessage(result.error));
			return;
		}
		// Only forgotten here once the account has it all; otherwise kept, put aside as another player's.
		if (allSaved) forgetLocalSave();
		// A full load on purpose: the running game and its copy of the progress go with the page.
		// eslint-disable-next-line @next/next/no-location-assign-relative-destination
		window.location.assign("/");
	};

	if (view === "map") return null;

	return (
		<div className="orion-pause-backdrop pointer-events-auto">
			<section className="orion-pause" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`}>
				{view === "main" ? (
					<>
						<p className="orion-kicker">Paused</p>
						<h2 id={`${ids}-title`} className="orion-pause-title">OrionGenix</h2>
						<nav className="orion-pause-actions" aria-label="Pause menu">
							<button ref={resumeRef} type="button" className="orion-pause-button is-primary orion-focus" onClick={resume}>
								Resume
								<kbd>Esc</kbd>
							</button>
							<button type="button" className="orion-pause-button orion-focus" onClick={openMap}>
								Map
								<kbd>M</kbd>
							</button>
							<button type="button" className="orion-pause-button orion-focus" onClick={() => setView("settings")}>
								Settings
							</button>
						</nav>
						{accounts ? (
							<div className="orion-pause-account">
								{user ? (
									<>
										<p className="orion-pause-who">
											Signed in as <strong>{user.displayName}</strong>
											<span>{user.email}</span>
										</p>
										<button type="button" className="orion-pause-button is-quiet orion-focus" onClick={() => void leave()} disabled={busy}>
											{busy ? "Signing out…" : "Sign out"}
										</button>
									</>
								) : (
									<>
										<p className="orion-pause-who">Not signed in. Sign in to keep your progress on every device.</p>
										<a className="orion-pause-button is-quiet orion-focus" href="/signin?return=%2Fplay">Sign in</a>
									</>
								)}
								{error ? <p className="orion-pause-error" role="alert">{error}</p> : null}
							</div>
						) : null}
					</>
				) : (
					<PauseSettings titleId={`${ids}-title`} back={() => setView("main")} />
				)}
			</section>
		</div>
	);
}

function PauseSettings({ titleId, back }: Readonly<{ titleId: string; back: () => void }>) {
	const [sound, updateSound] = useAudioSettings();
	const { fullscreen, supported } = useFullscreen();
	const [adaptive, setAdaptive] = useState(() => loadGraphicsSettings().adaptiveQuality);

	return (
		<>
			<p className="orion-kicker">Paused</p>
			<h2 id={titleId} className="orion-pause-title">Settings</h2>

			<div className="orion-pause-group">
				<p className="orion-kicker">Sound</p>
				<SoundControls settings={sound} update={updateSound} />
			</div>

			<div className="orion-pause-group">
				<p className="orion-kicker">Display</p>
				<label className="orion-pause-toggle">
					<input
						type="checkbox"
						checked={adaptive}
						onChange={(event) => {
							setAdaptive(event.target.checked);
							setAdaptiveQuality(event.target.checked);
						}}
					/>
					<span>
						Adaptive quality
						<small>Lowers detail for a moment when the frame rate drops. Off keeps full quality (F4).</small>
					</span>
				</label>
				{supported ? (
					<label className="orion-pause-toggle">
						<input type="checkbox" checked={fullscreen} onChange={(event) => void (event.target.checked ? enterFullscreen() : exitFullscreen())} />
						<span>Full screen</span>
					</label>
				) : null}
			</div>

			<button type="button" className="orion-pause-button orion-focus" onClick={back}>Back</button>
		</>
	);
}
