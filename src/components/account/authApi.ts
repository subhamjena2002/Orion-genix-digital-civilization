/**
 * The page side of accounts (worker/auth.ts, recovery.ts, google.ts): who is signed in, signing
 * up, in and out, and the email links. These only run on the account pages, never in the game's
 * loops.
 *
 * Plain `npm run dev` has no API (only `npm run cf:dev` and the live site do), so every call
 * says "unavailable" rather than failing on the HTML 404 it gets back there.
 */

export interface AccountUser {
	email: string;
	emailVerified: boolean;
	displayName: string;
	hasPassword: boolean;
	providers: string[];
}

/**
 * `checkInbox`: sign-up sent an email instead of signing in. `sent`, `valid`, `verified`: what
 * the email endpoints answer.
 */
export type AuthResult =
	| { ok: true; user: AccountUser | null; checkInbox?: boolean; sent?: boolean; valid?: boolean; verified?: boolean }
	| { ok: false; error: string; retryAfter?: number };

const TIMEOUT_MS = 15_000;

async function call(path: string, init: RequestInit = {}): Promise<AuthResult> {
	let response: Response;
	try {
		response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch {
		return { ok: false, error: "network" };
	}
	if (!(response.headers.get("content-type") ?? "").includes("application/json")) return { ok: false, error: "unavailable" };
	let body: { user?: AccountUser | null; error?: string; checkInbox?: boolean; sent?: boolean; valid?: boolean; verified?: boolean };
	try {
		body = await response.json();
	} catch {
		return { ok: false, error: "unavailable" };
	}
	if (!response.ok) return { ok: false, error: body.error ?? "internal", retryAfter: Number(response.headers.get("retry-after")) || undefined };
	return { ok: true, user: body.user ?? null, checkInbox: body.checkInbox, sent: body.sent, valid: body.valid, verified: body.verified };
}

const post = (path: string, body?: unknown) =>
	call(path, { method: "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const fetchMe = () => call("/api/auth/me");

export const signUp = (details: { email: string; password: string; displayName: string; turnstileToken?: string }) => post("/api/auth/signup", details);

export const signIn = (details: { email: string; password: string; turnstileToken?: string }) => post("/api/auth/signin", details);

export const signOut = () => post("/api/auth/signout");

/** The link in a confirmation email: confirms the address and signs in. */
export const verifyEmail = (token: string) => post("/api/auth/verify", { token });

export const resendVerification = () => post("/api/auth/verify/send");

export const forgotPassword = (details: { email: string; turnstileToken?: string }) => post("/api/auth/forgot", details);

export const checkResetLink = (token: string) => post("/api/auth/reset/check", { token });

export const resetPassword = (details: { token: string; password: string }) => post("/api/auth/reset", details);

let linkToken: string | null | undefined;

/**
 * The single-use token from an email link (`/verify#token=…`), taken out of the address bar the
 * first time it's read, before analytics or anything else on the page can see the URL.
 */
export function takeLinkToken(): string | null {
	if (linkToken !== undefined) return linkToken;
	if (typeof window === "undefined") return null;
	const found = /(?:^#|&)token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash);
	linkToken = found ? found[1] : null;
	if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
	return linkToken;
}

/** Where the "Sign in with Google" link goes: the browser itself visits Google and comes back. */
export const googleStartUrl = (returnTo: string) => `/api/auth/google/start?${new URLSearchParams({ return: returnTo })}`;

/** Which ways of signing in the server offers besides email (none where there's no API). */
export async function fetchOptions(): Promise<{ google: boolean }> {
	try {
		const response = await fetch("/api/auth/options", { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!(response.headers.get("content-type") ?? "").includes("application/json")) return { google: false };
		const body = (await response.json()) as { google?: unknown };
		return { google: body.google === true };
	} catch {
		return { google: false };
	}
}

/** What to tell the player for each refusal. */
export function authMessage(error: string, retryAfter?: number): string {
	switch (error) {
		case "email":
			return "Enter a valid email address.";
		case "password_too_short":
			return "Use at least 10 characters for your password.";
		case "password_too_long":
			return "Use at most 128 characters for your password.";
		case "password":
			return "Enter your password.";
		case "password_breached":
			return "That password has appeared in a data breach somewhere else. Choose a different one.";
		case "display_name":
			return "Choose a different player name.";
		case "email_taken":
			return "There's already an account with that email. Sign in instead.";
		case "invalid_credentials":
			return "That email and password don't match.";
		case "try_later": {
			const minutes = retryAfter ? Math.ceil(retryAfter / 60) : 1;
			return `Too many attempts. Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`;
		}
		case "turnstile":
			return "Please complete the security check, then try again.";
		case "google_cancelled":
			return "Google sign-in was cancelled. Try again, or use your email instead.";
		case "google_unverified":
			return "Your Google account's email address isn't verified, so it can't be used to sign in here.";
		case "google_unavailable":
			return "Google sign-in isn't available right now. Use your email instead.";
		case "google_failed":
			return "Google sign-in didn't work. Please try again.";
		case "link_invalid":
			return "This link has expired or has already been used. Ask for a new one.";
		case "email_unavailable":
			return "Account emails aren't set up here yet, so this can't be done right now.";
		case "signed_out":
			return "You're signed out. Sign in, then try again.";
		case "network":
			return "Can't reach the server. Check your connection and try again.";
		case "unavailable":
			return "Sign-in isn't available here right now. Please try again in a moment.";
		default:
			return "Something went wrong. Please try again.";
	}
}

/** Where to go after signing in: a path on this site only (no other site, no `//host`). */
export function returnPath(search: string, fallback = "/play"): string {
	const wanted = new URLSearchParams(search).get("return");
	if (!wanted || !wanted.startsWith("/") || wanted.startsWith("//") || wanted.startsWith("/\\")) return fallback;
	return wanted;
}
