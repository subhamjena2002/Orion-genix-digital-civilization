/**
 * The page side of accounts (worker/auth.ts): who is signed in, signing up, in and out. These
 * only run on the account pages, never in the game's loops.
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

export type AuthResult = { ok: true; user: AccountUser | null } | { ok: false; error: string; retryAfter?: number };

const TIMEOUT_MS = 15_000;

async function call(path: string, init: RequestInit = {}): Promise<AuthResult> {
	let response: Response;
	try {
		response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch {
		return { ok: false, error: "network" };
	}
	if (!(response.headers.get("content-type") ?? "").includes("application/json")) return { ok: false, error: "unavailable" };
	let body: { user?: AccountUser | null; error?: string };
	try {
		body = await response.json();
	} catch {
		return { ok: false, error: "unavailable" };
	}
	if (!response.ok) return { ok: false, error: body.error ?? "internal", retryAfter: Number(response.headers.get("retry-after")) || undefined };
	return { ok: true, user: body.user ?? null };
}

const post = (path: string, body?: unknown) =>
	call(path, { method: "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const fetchMe = () => call("/api/auth/me");

export const signUp = (details: { email: string; password: string; displayName: string; turnstileToken?: string }) => post("/api/auth/signup", details);

export const signIn = (details: { email: string; password: string; turnstileToken?: string }) => post("/api/auth/signin", details);

export const signOut = () => post("/api/auth/signout");

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
		case "network":
			return "Can't reach the server. Check your connection and try again.";
		case "unavailable":
			return "Sign-in isn't available here right now. You can still play as a guest.";
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
