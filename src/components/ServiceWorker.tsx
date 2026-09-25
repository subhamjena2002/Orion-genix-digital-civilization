"use client";

import { useEffect } from "react";

/** Once the world has had time to load, the files it used are handed to the worker to keep. */
const WARM_DELAYS_MS = [5_000, 60_000];
/** The browser's default list of loaded files stops at 250; the city loads more than that. */
const RESOURCE_BUFFER = 3000;

/**
 * Registers the service worker (public/sw.js) that caches the game on the device, so the
 * installed app starts fast and copes with a weak connection. Production only: in development
 * it would cache the dev server's ever-changing files and break live reloading.
 */
export function ServiceWorker() {
	useEffect(() => {
		if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
		performance.setResourceTimingBufferSize(RESOURCE_BUFFER);
		const timers: number[] = [];
		let cancelled = false;

		const warm = async () => {
			const registration = await navigator.serviceWorker.ready;
			const urls = performance.getEntriesByType("resource").map((entry) => entry.name);
			registration.active?.postMessage({ type: "warm", urls });
		};

		const register = () => {
			if (cancelled) return;
			navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
			for (const delay of WARM_DELAYS_MS) timers.push(window.setTimeout(() => void warm(), delay));
		};

		// After the page has loaded, so registering never competes with the game's own downloads.
		if (document.readyState === "complete") register();
		else window.addEventListener("load", register, { once: true });
		return () => {
			cancelled = true;
			window.removeEventListener("load", register);
			for (const timer of timers) window.clearTimeout(timer);
		};
	}, []);
	return null;
}
