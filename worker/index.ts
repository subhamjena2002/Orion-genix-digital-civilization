import { checkSave, MAX_SAVE_CHARS, SAVE_SCHEMA_VERSION, type SaveData } from "../src/engine/orion/missions/SaveSchema";

/**
 * The game's server side: everything under /api/ (wrangler.jsonc sends only those paths here;
 * the game itself is still served straight from the static assets).
 *
 * Saves are per guest, with no sign-up. The first visit gets a random token in an HttpOnly
 * cookie; the save is stored under the token's hash, so only that browser can read or write it.
 * Losing the cookie (clearing site data) loses the way back to the save — there's no recovery
 * across devices.
 *
 *   GET /api/save  the guest's save and its revision (and the cookie, on a first visit).
 *   PUT /api/save  { baseRevision, schemaVersion, writeId, save } — lands only if baseRevision
 *                  is still current; otherwise 409 with what's there now, to merge and retry.
 */

interface D1Statement {
	bind(...values: unknown[]): D1Statement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1 {
	prepare(query: string): D1Statement;
}

interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
	DB: D1;
	ASSETS?: { fetch(request: Request): Promise<Response> };
	/** Per guest, on writes. Optional so the API still runs where the binding isn't set up. */
	SAVE_LIMITER?: RateLimiter;
	/** Per address, on handing out new guests and on anything refused early. */
	GUEST_LIMITER?: RateLimiter;
}

/** 400 days: the longest a browser keeps a cookie. Each visit renews it. */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
const SECURE_COOKIE = "__Host-orion_guest";
/** Plain http is only for local development (wrangler dev), where a Secure cookie can't be set. */
const LOCAL_COOKIE = "orion_guest";
/** 32 random bytes, base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const WRITE_ID = /^[A-Za-z0-9-]{8,64}$/;
/** The save plus its envelope. */
const MAX_BODY_CHARS = MAX_SAVE_CHARS + 512;

interface SaveRow {
	revision: number;
	data: string;
	last_write_id: string | null;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
	});
}

const refuse = (status: number, error: string, headers?: Record<string, string>) => json({ error }, status, headers);

function isLocal(url: URL): boolean {
	return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
}

function cookieName(url: URL): string {
	return isLocal(url) ? LOCAL_COOKIE : SECURE_COOKIE;
}

function readToken(request: Request, url: URL): string | null {
	const name = cookieName(url);
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const at = part.indexOf("=");
		if (at < 0 || part.slice(0, at).trim() !== name) continue;
		const value = part.slice(at + 1).trim();
		return TOKEN.test(value) ? value : null;
	}
	return null;
}

function setCookie(url: URL, token: string): string {
	const secure = isLocal(url) ? "" : "; Secure";
	return `${cookieName(url)}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
}

function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Who the save belongs to, for the game to tell one guest's cached save from another's: not a secret. */
async function ownerTag(guestHash: string): Promise<string> {
	return (await sha256(`owner:${guestHash}`)).slice(0, 16);
}

/** Writes come from the game's own page: same origin, as JSON (which a cross-site form can't send). */
function sameOrigin(request: Request, url: URL): boolean {
	const origin = request.headers.get("origin");
	if (origin !== null) return origin === url.origin;
	return request.headers.get("sec-fetch-site") === "same-origin";
}

async function limited(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
	if (!limiter) return false;
	try {
		return !(await limiter.limit({ key })).success;
	} catch {
		// The limiter failing shouldn't take saving down with it.
		return false;
	}
}

function clientAddress(request: Request): string {
	return request.headers.get("cf-connecting-ip") ?? "local";
}

function parseStored(row: SaveRow): SaveData | null {
	try {
		const checked = checkSave(JSON.parse(row.data));
		return checked.ok ? checked.save : null;
	} catch {
		return null;
	}
}

async function readSave(request: Request, url: URL, env: Env): Promise<Response> {
	let token = readToken(request, url);
	if (!token) {
		if (await limited(env.GUEST_LIMITER, `guest:${clientAddress(request)}`)) return refuse(429, "rate_limited", { "retry-after": "60" });
		token = newToken();
	}
	const guestHash = await sha256(token);
	const row = await env.DB.prepare("SELECT revision, data, last_write_id FROM guest_saves WHERE guest_hash = ?1").bind(guestHash).first<SaveRow>();
	const save = row ? parseStored(row) : null;
	if (row && !save) return refuse(500, "stored_save_unreadable");
	return json(
		{ owner: await ownerTag(guestHash), revision: row?.revision ?? 0, schemaVersion: SAVE_SCHEMA_VERSION, save },
		200,
		{ "set-cookie": setCookie(url, token) },
	);
}

async function writeSave(request: Request, url: URL, env: Env): Promise<Response> {
	if (!sameOrigin(request, url)) return refuse(403, "cross_origin");
	if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return refuse(415, "json_only");
	const token = readToken(request, url);
	if (!token) return refuse(401, "no_guest");
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_BODY_CHARS * 4) return refuse(413, "too_large");
	const text = await request.text();
	if (text.length > MAX_BODY_CHARS) return refuse(413, "too_large");

	let body: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse(400, "body");
		body = parsed as Record<string, unknown>;
	} catch {
		return refuse(400, "body");
	}
	const { baseRevision, schemaVersion, writeId } = body;
	if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0) return refuse(400, "base_revision");
	if (schemaVersion !== SAVE_SCHEMA_VERSION) return refuse(400, "schema_version");
	if (typeof writeId !== "string" || !WRITE_ID.test(writeId)) return refuse(400, "write_id");
	const checked = checkSave(body.save);
	if (!checked.ok) return refuse(400, `save.${checked.error}`);
	const data = JSON.stringify(checked.save);
	if (data.length > MAX_SAVE_CHARS) return refuse(413, "too_large");

	const guestHash = await sha256(token);
	if (await limited(env.SAVE_LIMITER, `save:${guestHash}`)) return refuse(429, "rate_limited", { "retry-after": "10" });

	const now = Date.now();
	const written = baseRevision === 0
		? await env.DB.prepare(
			"INSERT INTO guest_saves (guest_hash, revision, schema_version, data, last_write_id, created_at, updated_at) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT (guest_hash) DO NOTHING RETURNING revision",
		).bind(guestHash, SAVE_SCHEMA_VERSION, data, writeId, now).first<{ revision: number }>()
		: await env.DB.prepare(
			"UPDATE guest_saves SET data = ?1, schema_version = ?2, last_write_id = ?3, revision = revision + 1, updated_at = ?4 WHERE guest_hash = ?5 AND revision = ?6 RETURNING revision",
		).bind(data, SAVE_SCHEMA_VERSION, writeId, now, guestHash, baseRevision).first<{ revision: number }>();
	if (written) return json({ revision: written.revision });

	// Not current: either this very write already landed (a retry after a lost reply), or
	// something else saved since — hand back what's there so the game can merge and try again.
	const row = await env.DB.prepare("SELECT revision, data, last_write_id FROM guest_saves WHERE guest_hash = ?1").bind(guestHash).first<SaveRow>();
	if (row && row.last_write_id === writeId) return json({ revision: row.revision, replayed: true });
	if (row && !parseStored(row)) return refuse(500, "stored_save_unreadable");
	return json({ error: "conflict", revision: row?.revision ?? 0, save: row ? parseStored(row) : null }, 409);
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname !== "/api/save") return refuse(404, "not_found");
	try {
		if (request.method === "GET") return await readSave(request, url, env);
		if (request.method === "PUT") return await writeSave(request, url, env);
		return refuse(405, "method", { allow: "GET, PUT" });
	} catch (error) {
		// The message only: never the request, its cookie or the guest.
		console.error("save api:", error instanceof Error ? error.message : "unknown error");
		return refuse(500, "internal");
	}
}

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env);
		return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
	},
};

export default worker;
