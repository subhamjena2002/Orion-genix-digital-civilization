"use client";

import { useState } from "react";

/**
 * Sends the site to a friend: the phone's own share sheet where there is one, otherwise the
 * link and the message copied to the clipboard.
 */
export function ShareButton({ label, text, className = "lp-button lp-button-ghost" }: Readonly<{ label: string; text: string; className?: string }>) {
	const [copied, setCopied] = useState(false);

	const share = async () => {
		const url = window.location.origin;
		(window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.("event", "share", { method: "share_button" });
		try {
			if (navigator.share) {
				await navigator.share({ title: "OrionGenix", text, url });
				return;
			}
			await navigator.clipboard.writeText(`${text} ${url}`);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2200);
		} catch {
			// Dismissed, or no clipboard: nothing to do.
		}
	};

	return (
		<button type="button" className={className} onClick={() => void share()}>
			{copied ? "Link copied ✓" : label}
		</button>
	);
}
