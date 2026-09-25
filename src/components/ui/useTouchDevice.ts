"use client";

import { useSyncExternalStore } from "react";

/**
 * A phone or tablet: the main pointer is a finger and nothing hovers. A laptop with a touch
 * screen still has a mouse as its main pointer, so it keeps the keyboard and mouse layout.
 */
const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
const PORTRAIT_QUERY = "(orientation: portrait)";

/** `?controls=touch` or `?controls=mouse` forces a layout, for testing either on any device. */
function forcedControls(): boolean | null {
	const value = new URLSearchParams(window.location.search).get("controls");
	return value === "touch" ? true : value === "mouse" ? false : null;
}

function watch(query: string) {
	return (onChange: () => void) => {
		const media = window.matchMedia(query);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	};
}

const watchTouch = watch(TOUCH_QUERY);
const watchPortrait = watch(PORTRAIT_QUERY);

/** Whether to show the on-screen touch controls instead of keyboard hints. */
export function useTouchDevice(): boolean {
	return useSyncExternalStore(
		watchTouch,
		() => forcedControls() ?? window.matchMedia(TOUCH_QUERY).matches,
		() => false,
	);
}

export function usePortrait(): boolean {
	return useSyncExternalStore(watchPortrait, () => window.matchMedia(PORTRAIT_QUERY).matches, () => false);
}
