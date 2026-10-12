"use client";

import { useSyncExternalStore } from "react";

/**
 * The browser's full screen (no tabs, address bar or OS bars), for the whole page: shared by the
 * phone landscape mode and the laptop view. Requests only succeed inside a click or tap.
 */

type FullscreenRoot = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

export function fullscreenElement(): Element | null {
	const doc = document as FullscreenDocument;
	return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function canFullscreen(): boolean {
	const root = document.documentElement as FullscreenRoot;
	return typeof root.requestFullscreen === "function" || typeof root.webkitRequestFullscreen === "function";
}

/** Into full screen, if not already; refused or unsupported, the game plays in the window. */
export async function enterFullscreen(): Promise<void> {
	if (fullscreenElement()) return;
	const root = document.documentElement as FullscreenRoot;
	try {
		if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
		else await root.webkitRequestFullscreen?.();
	} catch {
		// Refused: play in the browser window.
	}
}

export async function exitFullscreen(): Promise<void> {
	const doc = document as FullscreenDocument;
	try {
		if (doc.exitFullscreen) await doc.exitFullscreen();
		else await doc.webkitExitFullscreen?.();
	} catch {
		// Already out.
	}
}

function watchFullscreen(onChange: () => void) {
	document.addEventListener("fullscreenchange", onChange);
	document.addEventListener("webkitfullscreenchange", onChange);
	return () => {
		document.removeEventListener("fullscreenchange", onChange);
		document.removeEventListener("webkitfullscreenchange", onChange);
	};
}

/** Whether the page is full screen now, and whether this browser can do it at all. */
export function useFullscreen(): { fullscreen: boolean; supported: boolean } {
	const fullscreen = useSyncExternalStore(watchFullscreen, () => fullscreenElement() !== null, () => false);
	const supported = useSyncExternalStore(watchFullscreen, canFullscreen, () => false);
	return { fullscreen, supported };
}
