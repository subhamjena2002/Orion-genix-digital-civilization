import { checkSave, MAX_SAVE_CHARS, SAVE_SCHEMA_VERSION } from "../src/engine/orion/missions/SaveSchema";
import { currentSession, handleAuth, storedSave } from "./auth";
import { cleanUp } from "./cleanup";
import { handleGoogle } from "./google";
import { handleRecovery, isRecoveryPath } from "./recovery";
import { clientAddress, GUEST_COOKIE, json, limited, newToken, readToken, refuse, sameOrigin, setCookie, sha256, type D1, type RateLimiter, type Waiter } from "./http";

/**
 * The game's server side: everything under /api/ (wrangler.jsonc sends only those paths here;
 * the game itself is still served straight from the static assets).
 *
 * A signed-in player's save belongs to their account (worker/auth.ts). Anyone else plays as a
 * guest, with no sign-up: the first visit gets a random token in an HttpOnly cookie, and the save
 * is stored under the token's hash, so only that browser can read or write it. Losing the cookie
 * (clearing site data) loses the way back to a guest save; signing in moves it into the account.
 *
 *   GET /api/save  the player's save and its revision (and the guest cookie, on a first visit).
 *   PUT /api/save  { baseRevision, schemaVersion, writeId, save } — lands only if baseRevision
 *                  is still current; otherwise 409 with what's there now, to merge and retry.
 *   /api/auth/*    signing in and out (worker/auth.ts; Google in worker/google.ts).
 *   /play          the game: only for a signed-in player (`playPage`); anyone else is sent to
 *                  /signin and brought back after.
 *
 * Once a day (wrangler.jsonc `triggers`) it also clears out expired sessions and spent email
 * links (worker/cleanup.ts).
 */

export interface Env {
	DB: D1;
	ASSETS?: { fetch(request: Request): Promise<Response> };
	/** Per player, on writes. Optional so the API still runs where the binding isn't set up. */
	SAVE_LIMITER?: RateLimiter;
	/** Per address, on handing out new guests and on anything refused early. */
	GUEST_LIMITER?: RateLimiter;
	/** Per address and per email, on sign-up and sign-in. */
	AUTH_LIMITER?: RateLimiter;
	/** Cloudflare Turnstile's secret key. When set, sign-up and sign-in need a passed challenge. */
	TURNSTILE_SECRET?: string;
	/** Google sign-in (worker/google.ts): offered only once both are set. The id is a plain var, the secret a secret. */
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	/** Account emails (worker/email.ts), sent through Resend once both are set. */
	RESEND_API_KEY?: string;
	/** Who they're from, e.g. "OrionGenix <accounts@example.com>", on a domain set up in Resend. */
	EMAIL_FROM?: string;
	/** "1" in local .dev.vars only: write emails to the console instead of sending them. */
	EMAIL_DEV_LOG?: string;
}

/** 400 days: the longest a browser keeps a cookie. Each visit renews it. */
const GUEST_MAX_AGE = 400 * 24 * 60 * 60;
const WRITE_ID = /^[A-Za-z0-9-]{8,64}$/;
/** The save plus its envelope. */
const MAX_BODY_CHARS = MAX_SAVE_CHARS + 512;

interface SaveRow {
	revision: number;
	data: string;
	last_write_id: string | null;
}

/** Where one player's save lives: an account's row in user_saves, or a guest's in guest_saves. */
interface Slot {
	table: "user_saves" | "guest_saves";
	column: "user_id" | "guest_hash";
	key: string;
	/** Who the save belongs to, for the game to tell one player's cached save from another's: not a secret. */
	owner: string;
	limitKey: string;
}

async function guestSlot(token: string): Promise<Slot> {
	const guestHash = await sha256(token);
	return { table: "guest_saves", column: "guest_hash", key: guestHash, owner: (await sha256(`owner:${guestHash}`)).slice(0, 16), limitKey: `save:${guestHash}` };
}

async function userSlot(userId: string): Promise<Slot> {
	return { table: "user_saves", column: "user_id", key: userId, owner: (await sha256(`owner:user:${userId}`)).slice(0, 16), limitKey: `save:user:${userId}` };
}

function readRow(env: Env, slot: Slot): Promise<SaveRow | null> {
	return env.DB.prepare(`SELECT revision, data, last_write_id FROM ${slot.table} WHERE ${slot.column} = ?1`).bind(slot.key).first<SaveRow>();
}

async function readSave(request: Request, url: URL, env: Env): Promise<Response> {
	const { session, cookies } = await currentSession(request, url, env);
	let slot: Slot;
	if (session) {
		slot = await userSlot(session.userId);
	} else {
		let token = readToken(request, url, GUEST_COOKIE);
		if (!token) {
			if (await limited(env.GUEST_LIMITER, `guest:${clientAddress(request)}`)) return refuse(429, "rate_limited", { "retry-after": "60" }, cookies);
			token = newToken();
		}
		cookies.push(setCookie(url, GUEST_COOKIE, token, GUEST_MAX_AGE));
		slot = await guestSlot(token);
	}
	const row = await readRow(env, slot);
	const save = row ? storedSave(row.data) : null;
	if (row && !save) return refuse(500, "stored_save_unreadable", {}, cookies);
	return json({ owner: slot.owner, revision: row?.revision ?? 0, schemaVersion: SAVE_SCHEMA_VERSION, save }, 200, {}, cookies);
}

async function writeSave(request: Request, url: URL, env: Env): Promise<Response> {
	if (!sameOrigin(request, url)) return refuse(403, "cross_origin");
	if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return refuse(415, "json_only");
	const { session, cookies } = await currentSession(request, url, env);
	const token = session ? null : readToken(request, url, GUEST_COOKIE);
	if (!session && !token) return refuse(401, "no_guest", {}, cookies);
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_BODY_CHARS * 4) return refuse(413, "too_large", {}, cookies);
	const text = await request.text();
	if (text.length > MAX_BODY_CHARS) return refuse(413, "too_large", {}, cookies);

	let body: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse(400, "body", {}, cookies);
		body = parsed as Record<string, unknown>;
	} catch {
		return refuse(400, "body", {}, cookies);
	}
	const { baseRevision, schemaVersion, writeId } = body;
	if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0) return refuse(400, "base_revision", {}, cookies);
	if (schemaVersion !== SAVE_SCHEMA_VERSION) return refuse(400, "schema_version", {}, cookies);
	if (typeof writeId !== "string" || !WRITE_ID.test(writeId)) return refuse(400, "write_id", {}, cookies);
	const checked = checkSave(body.save);
	if (!checked.ok) return refuse(400, `save.${checked.error}`, {}, cookies);
	const data = JSON.stringify(checked.save);
	if (data.length > MAX_SAVE_CHARS) return refuse(413, "too_large", {}, cookies);

	const slot = session ? await userSlot(session.userId) : await guestSlot(token!);
	if (await limited(env.SAVE_LIMITER, slot.limitKey)) return refuse(429, "rate_limited", { "retry-after": "10" }, cookies);

	// The table and column come from the slot, never from the request.
	const now = Date.now();
	const written = baseRevision === 0
		? await env.DB.prepare(
			`INSERT INTO ${slot.table} (${slot.column}, revision, schema_version, data, last_write_id, created_at, updated_at) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT (${slot.column}) DO NOTHING RETURNING revision`,
		).bind(slot.key, SAVE_SCHEMA_VERSION, data, writeId, now).first<{ revision: number }>()
		: await env.DB.prepare(
			`UPDATE ${slot.table} SET data = ?1, schema_version = ?2, last_write_id = ?3, revision = revision + 1, updated_at = ?4 WHERE ${slot.column} = ?5 AND revision = ?6 RETURNING revision`,
		).bind(data, SAVE_SCHEMA_VERSION, writeId, now, slot.key, baseRevision).first<{ revision: number }>();
	if (written) return json({ revision: written.revision }, 200, {}, cookies);

	// Not current: either this very write already landed (a retry after a lost reply), or
	// something else saved since — hand back what's there so the game can merge and try again.
	const row = await readRow(env, slot);
	if (row && row.last_write_id === writeId) return json({ revision: row.revision, replayed: true }, 200, {}, cookies);
	const current = row ? storedSave(row.data) : null;
	if (row && !current) return refuse(500, "stored_save_unreadable", {}, cookies);
	return json({ error: "conflict", revision: row?.revision ?? 0, save: current }, 409, {}, cookies);
}

export async function handleApi(request: Request, env: Env, ctx?: Waiter): Promise<Response> {
	const url = new URL(request.url);
	try {
		if (url.pathname === "/api/auth/options" || url.pathname.startsWith("/api/auth/google/")) return await handleGoogle(request, url, env);
		if (isRecoveryPath(url.pathname)) return await handleRecovery(request, url, env, ctx);
		if (url.pathname.startsWith("/api/auth/")) return await handleAuth(request, url, env, ctx);
		if (url.pathname !== "/api/save") return refuse(404, "not_found");
		if (request.method === "GET") return await readSave(request, url, env);
		if (request.method === "PUT") return await writeSave(request, url, env);
		return refuse(405, "method", { allow: "GET, PUT" });
	} catch (error) {
		// The message only: never the request, its cookies or the player.
		console.error("api:", error instanceof Error ? error.message : "unknown error");
		return refuse(500, "internal");
	}
}

/** The game's page and the files Next fetches for it (`/play/__next…`): wrangler.jsonc sends these here first. */
export const isPlayPath = (path: string) => path === "/play" || path === "/play.html" || path.startsWith("/play/") || path.startsWith("/play.");

/**
 * The game, for signed-in players only. Anyone else is sent to sign in, and comes back here
 * after. The page is marked private and uncacheable, so no shared cache hands it to someone else.
 */
export async function playPage(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	let checked: Awaited<ReturnType<typeof currentSession>>;
	try {
		checked = await currentSession(request, url, env);
	} catch (error) {
		console.error("play:", error instanceof Error ? error.message : "unknown error");
		return new Response("Sign-in is unavailable right now. Please try again in a moment.", { status: 503, headers: { "retry-after": "30", "cache-control": "no-store" } });
	}
	const { session, cookies } = checked;
	if (!session) {
		const headers = new Headers({ location: new URL("/signin?return=%2Fplay", url.origin).toString(), "cache-control": "no-store" });
		for (const cookie of cookies) headers.append("set-cookie", cookie);
		return new Response(null, { status: 302, headers });
	}
	const page = env.ASSETS ? await env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
	const response = new Response(page.body, page);
	response.headers.set("cache-control", "private, no-store");
	for (const cookie of cookies) response.headers.append("set-cookie", cookie);
	return response;
}

const worker = {
	async fetch(request: Request, env: Env, ctx?: Waiter): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path.startsWith("/api/")) return handleApi(request, env, ctx);
		if (isPlayPath(path)) return playPage(request, env);
		return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
	},

	async scheduled(_controller: unknown, env: Env, ctx: Waiter): Promise<void> {
		ctx.waitUntil(cleanUp(env));
	},
};

export default worker;
