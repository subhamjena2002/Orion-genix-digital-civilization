/**
 * What every API route shares: the few D1 calls it makes, JSON replies, cookies, tokens and
 * hashes, the same-origin check and rate limits.
 */

export interface D1Statement {
	bind(...values: unknown[]): D1Statement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1 {
	prepare(query: string): D1Statement;
}

export interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** 32 random bytes, base64url: guest and session tokens. */
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The guest's save token (worker/index.ts). */
export const GUEST_COOKIE = "orion_guest";
/** The signed-in player's session token (worker/auth.ts). */
export const SESSION_COOKIE = "orion_session";

/** `cookies` are sent as separate Set-Cookie headers. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}, cookies: readonly string[] = []): Response {
	const out = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
	for (const cookie of cookies) out.append("set-cookie", cookie);
	return new Response(JSON.stringify(body), { status, headers: out });
}

export const refuse = (status: number, error: string, headers?: Record<string, string>, cookies?: readonly string[]) => json({ error }, status, headers, cookies);

export function isLocal(url: URL): boolean {
	return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
}

/**
 * `__Host-<name>` (Secure, this host only, whole site), except over plain-http localhost
 * (wrangler dev), where a Secure cookie can't be set and the plain name is used.
 */
export function cookieName(url: URL, name: string): string {
	return isLocal(url) ? name : `__Host-${name}`;
}

/** The cookie's raw value, if the request has one. */
export function readCookie(request: Request, url: URL, name: string): string | null {
	const wanted = cookieName(url, name);
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const at = part.indexOf("=");
		if (at < 0 || part.slice(0, at).trim() !== wanted) continue;
		return part.slice(at + 1).trim();
	}
	return null;
}

/** The cookie's token, if it has a well-formed one: anything else is treated as no cookie. */
export function readToken(request: Request, url: URL, name: string): string | null {
	const value = readCookie(request, url, name);
	return value !== null && TOKEN.test(value) ? value : null;
}

export function setCookie(url: URL, name: string, value: string, maxAgeSeconds: number): string {
	const secure = isLocal(url) ? "" : "; Secure";
	return `${cookieName(url, name)}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearCookie(url: URL, name: string): string {
	return setCookie(url, name, "", 0);
}

function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url (43 characters). */
export function newToken(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** 16 random bytes, base64url (22 characters): not a secret, just unique. */
export function newId(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Writes come from the game's own page: same origin, as JSON (which a cross-site form can't send). */
export function sameOrigin(request: Request, url: URL): boolean {
	const origin = request.headers.get("origin");
	if (origin !== null) return origin === url.origin;
	return request.headers.get("sec-fetch-site") === "same-origin";
}

export async function limited(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
	if (!limiter) return false;
	try {
		return !(await limiter.limit({ key })).success;
	} catch {
		// The limiter failing shouldn't take the API down with it.
		return false;
	}
}

export function clientAddress(request: Request): string {
	return request.headers.get("cf-connecting-ip") ?? "local";
}
