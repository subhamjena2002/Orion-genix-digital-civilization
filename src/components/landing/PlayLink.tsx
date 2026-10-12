"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { enterFullscreen } from "@/components/ui/fullscreen";

/** `lock` is missing from TypeScript's DOM types; it exists on Android browsers. */
type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

/**
 * Into the game. The click is what lets the page go full screen (browsers allow it only in
 * answer to one), and the move to /play keeps the same page, so the game loads already full
 * screen — on a phone, turned to landscape where it can be. Counted in analytics with where on
 * the page it was pressed.
 */
export function PlayLink({ children, from, className = "lp-button lp-button-primary" }: Readonly<{ children: ReactNode; from: string; className?: string }>) {
	const play = () => {
		(window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.("event", "play_click", { from });
		void enterFullscreen().then(async () => {
			if (!window.matchMedia("(pointer: coarse)").matches) return;
			try {
				await (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape");
			} catch {
				// No lock here; the game asks to be turned instead.
			}
		});
	};

	return (
		<Link href="/play" className={className} onClick={play}>
			{children}
		</Link>
	);
}
