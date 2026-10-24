import { checkSave, MAX_SAVE_CHARS, SAVE_SCHEMA_VERSION } from "../src/engine/orion/missions/SaveSchema";
import { currentSession, handleAuth, storedSave } from "./auth";
import { clientAddress, GUEST_COOKIE, json, limited, newToken, readToken, refuse, sameOrigin, setCookie, sha256, type D1, type RateLimiter } from "./http";

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
 *   /api/auth/*    signing in and out (worker/auth.ts).
 */

export interface Env {
	DB: D1;
	ASSETS?: { fetch(request: Request): Promise<Response> };
	/** Per player, on writes. Optional so the API still runs where the binding isn't set up. */
	SAVE_LIMITER?: RateLimiter;
	/** Per address, on handing out new guests and on anything refused early. */
	GUEST_LIMITER?: RateLimiter;
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

export async function handleApi(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	try {
		if (url.pathname.startsWith("/api/auth/")) return await handleAuth(request, url, env);
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

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env);
		return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
	},
};

export default worker;
