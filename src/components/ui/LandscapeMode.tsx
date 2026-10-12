"use client";

import { useEffect } from "react";

import { enterFullscreen, exitFullscreen, useFullscreen } from "./fullscreen";
import { usePortrait } from "./useTouchDevice";

/** `lock` is missing from TypeScript's DOM types; it exists on Android browsers. */
type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

/**
 * Full screen (no browser bars eating the height), then locked to landscape. Android allows the
 * lock only once the page is full screen; iPhones allow neither, and are asked to turn instead.
 * Must run inside a tap: browsers refuse both otherwise.
 */
async function enterLandscape(): Promise<void> {
	await enterFullscreen();
	try {
		await (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape");
	} catch {
		// No lock on this device; the rotate prompt covers portrait.
	}
}

/**
 * Landscape play on phones and tablets. The first touch takes the game full screen and turns
 * it sideways where the browser allows; held upright, the game is covered by a prompt to turn
 * the device (with a button that does it, where it can be done for them). A corner button goes
 * in and out of full screen afterwards.
 */
export function LandscapeMode() {
	const portrait = usePortrait();
	const { fullscreen, supported } = useFullscreen();

	useEffect(() => {
		// iOS Safari ignores user-scalable=no; a pinch would zoom the page instead of playing.
		const block = (event: Event) => event.preventDefault();
		document.addEventListener("gesturestart", block);
		// The first touch anywhere goes full screen, once. After that it's the player's choice.
		const first = () => {
			void enterLandscape();
			window.removeEventListener("pointerdown", first, true);
		};
		window.addEventListener("pointerdown", first, true);
		return () => {
			document.removeEventListener("gesturestart", block);
			window.removeEventListener("pointerdown", first, true);
		};
	}, []);

	return (
		<>
			{supported ? (
				<button
					type="button"
					className="orion-touch-fullscreen pointer-events-auto"
					aria-label={fullscreen ? "Leave full screen" : "Full screen"}
					onClick={() => void (fullscreen ? exitFullscreen() : enterLandscape())}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						{fullscreen
							? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
							: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
					</svg>
				</button>
			) : null}

			{portrait ? (
				<div className="orion-rotate pointer-events-auto" role="alertdialog" aria-label="Turn your device to landscape">
					<svg className="orion-rotate-phone" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<rect x="16" y="6" width="16" height="30" rx="3" />
						<path d="M22 31.5h4" />
						<path d="M38 22a14 14 0 0 1-6 14M36.5 39l-4.5-3 3-4.5" />
					</svg>
					<p className="orion-rotate-title">Turn your device sideways</p>
					<p className="orion-rotate-text">OrionGenix is played in landscape.</p>
					{supported ? (
						<button type="button" className="orion-rotate-button" onClick={() => void enterLandscape()}>
							Play in landscape
						</button>
					) : null}
				</div>
			) : null}
		</>
	);
}
