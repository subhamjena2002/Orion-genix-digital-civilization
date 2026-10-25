"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare's Turnstile check on the sign-up and sign-in forms, when the site has a key
 * (NEXT_PUBLIC_TURNSTILE_SITE_KEY at build time). Most visitors never see a puzzle; the widget
 * hands back a single-use token that the API checks (worker/auth.ts). `resetKey` changing
 * gets a fresh token, since a failed sign-in has used the last one up.
 */

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

interface TurnstileApi {
	render(element: HTMLElement, options: Record<string, unknown>): string;
	reset(id: string): void;
	remove(id: string): void;
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
	loading ??= new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = SCRIPT;
		script.async = true;
		script.onload = () => {
			const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
			if (api) resolve(api);
			else reject(new Error("turnstile missing"));
		};
		script.onerror = () => {
			loading = null;
			reject(new Error("turnstile failed to load"));
		};
		document.head.appendChild(script);
	});
	return loading;
}

export function Turnstile({ onToken, resetKey, action }: Readonly<{ onToken: (token: string) => void; resetKey: number; action: string }>) {
	const box = useRef<HTMLDivElement>(null);
	const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
	const latest = useRef(onToken);
	useEffect(() => {
		latest.current = onToken;
	});

	useEffect(() => {
		let cancelled = false;
		void loadTurnstile().then((api) => {
			if (cancelled || !box.current) return;
			const id = api.render(box.current, {
				sitekey: TURNSTILE_SITE_KEY,
				action,
				theme: "dark",
				callback: (token: string) => latest.current(token),
				"expired-callback": () => latest.current(""),
				"error-callback": () => latest.current(""),
			});
			widget.current = { api, id };
		}).catch(() => latest.current(""));
		return () => {
			cancelled = true;
			if (widget.current) widget.current.api.remove(widget.current.id);
			widget.current = null;
		};
	}, [action]);

	useEffect(() => {
		if (resetKey === 0 || !widget.current) return;
		latest.current("");
		widget.current.api.reset(widget.current.id);
	}, [resetKey]);

	return <div ref={box} className="lp-auth-turnstile" />;
}
