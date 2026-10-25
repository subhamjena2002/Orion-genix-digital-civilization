import { createUser, normaliseEmail, readDisplayName, readEmail, startSession } from "./auth";
import { clearCookie, clientAddress, json, limited, newToken, readCookie, refuse, setCookie } from "./http";
import type { Env } from "./index";

/**
 * Signing in with Google (docs/accounts.md): OAuth 2.0's authorization-code flow, with PKCE.
 *
 *   GET /api/auth/options          { google } — whether the button should be offered.
 *   GET /api/auth/google/start     ?return=/play — off to Google's account chooser.
 *   GET /api/auth/google/callback  where Google sends the player back; signs them in, then on to
 *                                  `return` (or back to /signin?error=google_… if it didn't work).
 *
 * The flow's secrets (state, nonce, PKCE verifier) wait in a short-lived HttpOnly `__Host-`
 * cookie that only this site can set. The code is exchanged for an ID token directly with Google
 * (with the client secret), and the token's signature is still checked against Google's published
 * keys, along with who issued it, who it's for, when it expires and the nonce.
 *
 * Who the player is comes from Google's `sub` (their account id), never the email. A first
 * sign-in finds the account by email, or makes one:
 *  - an account whose email is confirmed is linked to Google;
 *  - an account whose email was never confirmed loses its password and its sessions as it's
 *    linked. Anyone could have signed up with that address, so its password proves nothing,
 *    while Google has just proved who owns the address.
 */

const FLOW_COOKIE = "orion_oauth";
const FLOW_SECONDS = 10 * 60;
const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const KEYS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const REQUEST_TIMEOUT_MS = 8000;
/** Leeway for clocks a little out between here and Google. */
const CLOCK_SKEW_MS = 60_000;
/** An unknown key id is looked up again at most this often (Google rotates keys). */
const KEY_REFETCH_MS = 60_000;
const DEFAULT_KEYS_MS = 60 * 60 * 1000;
const FLOW_VALUE = /^[A-Za-z0-9_-]{1,1024}$/;

interface Flow {
	state: string;
	verifier: string;
	nonce: string;
	return: string;
}

export interface GoogleClaims {
	sub: string;
	email: string;
	emailVerified: boolean;
	name?: string;
}

interface UserMatch {
	id: string;
	email_verified: number;
}

function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
	const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const configured = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

const callbackUrl = (url: URL) => `${url.origin}/api/auth/google/callback`;

/** A path on this site to go to afterwards: nothing that leaves it (`//host`, `/\host`). */
export function safeReturn(value: string | null): string {
	if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.length > 512) return "/play";
	return value;
}

function redirect(url: URL, path: string, cookies: readonly string[]): Response {
	const headers = new Headers({ location: new URL(path, url.origin).toString(), "cache-control": "no-store" });
	for (const cookie of cookies) headers.append("set-cookie", cookie);
	return new Response(null, { status: 303, headers });
}

/** Back to the sign-in page with what went wrong, keeping where they were headed. */
function failed(url: URL, error: string, to: string, cookies: readonly string[] = []): Response {
	const query = new URLSearchParams({ error });
	if (to !== "/play") query.set("return", to);
	return redirect(url, `/signin?${query}`, [clearCookie(url, FLOW_COOKIE), ...cookies]);
}

function readFlow(request: Request, url: URL): Flow | null {
	const value = readCookie(request, url, FLOW_COOKIE);
	if (!value || !FLOW_VALUE.test(value)) return null;
	try {
		const flow = JSON.parse(new TextDecoder().decode(fromBase64url(value))) as Partial<Flow>;
		if (typeof flow.state !== "string" || typeof flow.verifier !== "string" || typeof flow.nonce !== "string" || typeof flow.return !== "string") return null;
		return { state: flow.state, verifier: flow.verifier, nonce: flow.nonce, return: safeReturn(flow.return) };
	} catch {
		return null;
	}
}

function options(env: Env): Response {
	return json({ google: configured(env) });
}

async function start(request: Request, url: URL, env: Env): Promise<Response> {
	const to = safeReturn(url.searchParams.get("return"));
	if (!configured(env)) return failed(url, "google_unavailable", to);
	if (await limited(env.AUTH_LIMITER, `google:${clientAddress(request)}`)) return failed(url, "try_later", to);
	const flow: Flow = { state: newToken(), verifier: newToken(), nonce: newToken(), return: to };
	const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(flow.verifier))));
	const google = new URL(AUTHORIZE);
	google.search = new URLSearchParams({
		client_id: env.GOOGLE_CLIENT_ID!,
		redirect_uri: callbackUrl(url),
		response_type: "code",
		scope: "openid email profile",
		state: flow.state,
		nonce: flow.nonce,
		code_challenge: challenge,
		code_challenge_method: "S256",
		prompt: "select_account",
	}).toString();
	const cookie = setCookie(url, FLOW_COOKIE, base64url(new TextEncoder().encode(JSON.stringify(flow))), FLOW_SECONDS);
	const headers = new Headers({ location: google.toString(), "cache-control": "no-store" });
	headers.append("set-cookie", cookie);
	return new Response(null, { status: 303, headers });
}

let keyCache: { keys: Map<string, CryptoKey>; expires: number; fetched: number } | null = null;

/** For tests: start with no keys known. */
export function forgetGoogleKeys(): void {
	keyCache = null;
}

async function googleKey(kid: string, now: number): Promise<CryptoKey | null> {
	const stale = !keyCache || keyCache.expires <= now || (!keyCache.keys.has(kid) && now - keyCache.fetched >= KEY_REFETCH_MS);
	if (stale) {
		const response = await fetch(KEYS, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		if (!response.ok) return keyCache?.keys.get(kid) ?? null;
		const { keys } = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
		const imported = new Map<string, CryptoKey>();
		for (const jwk of keys ?? []) {
			if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
			imported.set(jwk.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
		}
		const maxAge = /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "");
		keyCache = { keys: imported, fetched: now, expires: now + (maxAge ? Number(maxAge[1]) * 1000 : DEFAULT_KEYS_MS) };
	}
	return keyCache!.keys.get(kid) ?? null;
}

/** The ID token's claims, if Google signed it, for this site, now, and for this sign-in. */
export async function verifyIdToken(token: string, clientId: string, nonce: string): Promise<GoogleClaims | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	let header: { alg?: string; kid?: string };
	let claims: Record<string, unknown>;
	try {
		header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
		claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
	} catch {
		return null;
	}
	if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
	const now = Date.now();
	const key = await googleKey(header.kid, now);
	if (!key) return null;
	const signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
	if (!signed) return null;

	const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!ISSUERS.includes(claims.iss as string) || !audience.includes(clientId)) return null;
	if (typeof claims.exp !== "number" || claims.exp * 1000 + CLOCK_SKEW_MS <= now) return null;
	if (typeof claims.iat === "number" && claims.iat * 1000 - CLOCK_SKEW_MS > now) return null;
	if (claims.nonce !== nonce) return null;
	if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 255) return null;
	if (typeof claims.email !== "string") return null;
	return {
		sub: claims.sub,
		email: claims.email,
		emailVerified: claims.email_verified === true || claims.email_verified === "true",
		name: typeof claims.name === "string" ? claims.name : undefined,
	};
}

/** The account a Google sign-in belongs to: linked already, found by email, or new. */
async function googleUser(env: Env, claims: GoogleClaims, email: string, retried = false): Promise<string> {
	const now = Date.now();
	const linked = await env.DB.prepare("SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ?1").bind(claims.sub).first<{ user_id: string }>();
	if (linked) {
		await env.DB.prepare("UPDATE oauth_accounts SET email = ?1 WHERE provider = 'google' AND provider_user_id = ?2").bind(email, claims.sub).first();
		return linked.user_id;
	}
	const link = (userId: string) =>
		env.DB.prepare("INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email, created_at) VALUES ('google', ?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING")
			.bind(claims.sub, userId, email, now)
			.first();

	const existing = await env.DB.prepare("SELECT id, email_verified FROM users WHERE email = ?1").bind(email).first<UserMatch>();
	if (existing) {
		if (existing.email_verified !== 1) {
			await env.DB.prepare("UPDATE users SET password_hash = NULL, email_verified = 1, failed_logins = 0, locked_until = NULL, updated_at = ?1 WHERE id = ?2").bind(now, existing.id).first();
			await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(existing.id).first();
		}
		await link(existing.id);
		return existing.id;
	}
	let userId: string;
	try {
		userId = await createUser(env, { email, displayName: readDisplayName(claims.name ?? null, email) ?? readDisplayName(null, email)!, emailVerified: true });
	} catch (error) {
		// The same person's other tab got there first: find what it made.
		if (!retried && error instanceof Error && /unique/i.test(error.message)) return googleUser(env, claims, email, true);
		throw error;
	}
	await link(userId);
	return userId;
}

async function callback(request: Request, url: URL, env: Env): Promise<Response> {
	const flow = readFlow(request, url);
	const to = flow?.return ?? "/play";
	if (!flow || url.searchParams.get("state") !== flow.state) return failed(url, "google_failed", to);
	if (url.searchParams.has("error")) return failed(url, url.searchParams.get("error") === "access_denied" ? "google_cancelled" : "google_failed", to);
	const code = url.searchParams.get("code");
	if (!code || code.length > 2048) return failed(url, "google_failed", to);
	if (!configured(env)) return failed(url, "google_unavailable", to);
	if (await limited(env.AUTH_LIMITER, `google:${clientAddress(request)}`)) return failed(url, "try_later", to);

	try {
		const response = await fetch(TOKEN, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: env.GOOGLE_CLIENT_ID!,
				client_secret: env.GOOGLE_CLIENT_SECRET!,
				redirect_uri: callbackUrl(url),
				grant_type: "authorization_code",
				code_verifier: flow.verifier,
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) return failed(url, "google_failed", to);
		const { id_token: idToken } = (await response.json()) as { id_token?: unknown };
		if (typeof idToken !== "string") return failed(url, "google_failed", to);
		const claims = await verifyIdToken(idToken, env.GOOGLE_CLIENT_ID!, flow.nonce);
		if (!claims) return failed(url, "google_failed", to);
		if (!claims.emailVerified) return failed(url, "google_unverified", to);
		const email = readEmail(normaliseEmail(claims.email));
		if (!email) return failed(url, "google_failed", to);

		const userId = await googleUser(env, claims, email);
		const cookies = await startSession(request, url, env, userId);
		return redirect(url, to, [clearCookie(url, FLOW_COOKIE), ...cookies]);
	} catch (error) {
		// The message only: never the code, the token or the player.
		console.error("google sign-in:", error instanceof Error ? error.message : "unknown error");
		return failed(url, "google_failed", to);
	}
}

export async function handleGoogle(request: Request, url: URL, env: Env): Promise<Response> {
	if (request.method !== "GET") return refuse(405, "method", { allow: "GET" });
	if (url.pathname === "/api/auth/options") return options(env);
	if (url.pathname === "/api/auth/google/start") return start(request, url, env);
	if (url.pathname === "/api/auth/google/callback") return callback(request, url, env);
	return refuse(404, "not_found");
}
