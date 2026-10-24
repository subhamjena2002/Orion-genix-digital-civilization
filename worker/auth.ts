import { mergeSaves, newGameSave } from "../src/engine/orion/missions/SaveMerge";
import { checkSave, MAX_SAVE_CHARS, SAVE_SCHEMA_VERSION, sameSave, type SaveData } from "../src/engine/orion/missions/SaveSchema";
import { clearCookie, GUEST_COOKIE, json, newId, newToken, readCookie, readToken, refuse, sameOrigin, SESSION_COOKIE, setCookie, sha256 } from "./http";
import type { Env } from "./index";

/**
 * Accounts: who is signed in, and what happens to a guest's save when they sign in
 * (docs/accounts.md). Ways of signing in (email and password, Google) build on `createUser` and
 * `startSession`; this file has the parts they share.
 *
 *   GET  /api/auth/me       the signed-in player ({ user: null } for a guest).
 *   POST /api/auth/signout  ends this browser's session and starts it over as a new guest.
 *
 * A session is a random token in an HttpOnly cookie, stored as its hash (migrations/0002). It
 * lasts 30 days from when it was last used: the expiry moves forward at most once an hour, so
 * playing doesn't cost a database write per request.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_MS = 30 * DAY_MS;
/** How often a session in use has its expiry moved forward (and its cookie renewed). */
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
const USER_AGENT_CHARS = 200;
/** Rounds of merge-and-write when the account's save changes while a guest's joins it. */
const JOIN_ATTEMPTS = 3;

export interface Session {
	userId: string;
	tokenHash: string;
}

interface SessionRow {
	user_id: string;
	last_seen_at: number;
	expires_at: number;
}

interface UserRow {
	email: string;
	email_verified: number;
	display_name: string;
	has_password: number;
	providers: string;
}

interface GuestRow {
	revision: number;
	data: string;
	last_write_id: string | null;
	created_at: number;
	updated_at: number;
}

/** A save as stored, if it still reads as one. */
export function storedSave(data: string): SaveData | null {
	try {
		const checked = checkSave(JSON.parse(data));
		return checked.ok ? checked.save : null;
	} catch {
		return null;
	}
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export interface NewUser {
	email: string;
	displayName: string;
	emailVerified: boolean;
	passwordHash?: string | null;
}

/** Adds an account and returns its id. Checking what's in it is up to the way of signing up. */
export async function createUser(env: Env, user: NewUser): Promise<string> {
	const now = Date.now();
	const row = await env.DB.prepare(
		"INSERT INTO users (id, email, email_verified, password_hash, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING id",
	).bind(newId(), normaliseEmail(user.email), user.emailVerified ? 1 : 0, user.passwordHash ?? null, user.displayName, now).first<{ id: string }>();
	if (!row) throw new Error("user not created");
	return row.id;
}

/**
 * Who the request is signed in as, if anyone, and any cookie to send back: the session's,
 * renewed, when its expiry moved; or one clearing a session cookie that's no longer any good.
 */
export async function currentSession(request: Request, url: URL, env: Env): Promise<{ session: Session | null; cookies: string[] }> {
	const token = readToken(request, url, SESSION_COOKIE);
	if (!token) return { session: null, cookies: readCookie(request, url, SESSION_COOKIE) === null ? [] : [clearCookie(url, SESSION_COOKIE)] };
	const tokenHash = await sha256(token);
	const row = await env.DB.prepare("SELECT user_id, last_seen_at, expires_at FROM sessions WHERE token_hash = ?1").bind(tokenHash).first<SessionRow>();
	const now = Date.now();
	if (!row || row.expires_at <= now) {
		if (row) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).first();
		return { session: null, cookies: [clearCookie(url, SESSION_COOKIE)] };
	}
	const cookies: string[] = [];
	if (now - row.last_seen_at >= SESSION_TOUCH_MS) {
		await env.DB.prepare("UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE token_hash = ?3").bind(now, now + SESSION_MS, tokenHash).first();
		cookies.push(setCookie(url, SESSION_COOKIE, token, SESSION_MS / 1000));
	}
	return { session: { userId: row.user_id, tokenHash }, cookies };
}

/**
 * Signs this browser in as `userId`, once whichever way of signing in has checked who they are.
 * Any guest save this browser has joins the account first, and the guest cookie goes, since its
 * save is the account's now. A session the browser already had is ended: a sign-in always gets
 * a new token. Returns the cookies to send.
 */
export async function startSession(request: Request, url: URL, env: Env, userId: string): Promise<string[]> {
	await adoptGuestSave(request, url, env, userId);
	const old = readToken(request, url, SESSION_COOKIE);
	if (old) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(old)).first();
	const token = newToken();
	const now = Date.now();
	const userAgent = request.headers.get("user-agent")?.slice(0, USER_AGENT_CHARS) ?? null;
	await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?1, ?2, ?3, ?3, ?4, ?5)")
		.bind(await sha256(token), userId, now, now + SESSION_MS, userAgent)
		.first();
	return [setCookie(url, SESSION_COOKIE, token, SESSION_MS / 1000), clearCookie(url, GUEST_COOKIE)];
}

/**
 * Moves this browser's guest save into the account. The guest row is taken out of the table
 * first, so however many sign-ins race, only one can claim it, and it can never be added to two
 * accounts. If joining it fails the row is put back, so the sign-in can be tried again.
 */
async function adoptGuestSave(request: Request, url: URL, env: Env, userId: string): Promise<void> {
	const token = readToken(request, url, GUEST_COOKIE);
	if (!token) return;
	const guestHash = await sha256(token);
	const claimed = await env.DB.prepare("DELETE FROM guest_saves WHERE guest_hash = ?1 RETURNING revision, data, last_write_id, created_at, updated_at")
		.bind(guestHash)
		.first<GuestRow>();
	if (!claimed) return;
	const guest = storedSave(claimed.data);
	if (!guest || sameSave(guest, newGameSave())) return;
	try {
		await joinSave(env, userId, guest);
	} catch (error) {
		await env.DB.prepare(
			"INSERT INTO guest_saves (guest_hash, revision, schema_version, data, last_write_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (guest_hash) DO NOTHING",
		).bind(guestHash, claimed.revision, SAVE_SCHEMA_VERSION, claimed.data, claimed.last_write_id, claimed.created_at, claimed.updated_at).first();
		throw error;
	}
}

/**
 * Adds a guest's progress to the account's save, or makes it the account's save if there isn't
 * one. Both started from a new game, so the merge takes a new game as what they had in common:
 * lists and bests combine, and cash, jobs and standing add up what each side earned.
 */
async function joinSave(env: Env, userId: string, guest: SaveData): Promise<void> {
	for (let attempt = 0; attempt < JOIN_ATTEMPTS; attempt++) {
		const row = await env.DB.prepare("SELECT revision, data FROM user_saves WHERE user_id = ?1").bind(userId).first<{ revision: number; data: string }>();
		let save = guest;
		if (row) {
			const account = storedSave(row.data);
			if (!account) throw new Error("stored account save unreadable");
			const merged = checkSave(mergeSaves(newGameSave(), guest, account));
			if (!merged.ok) throw new Error(`merged save: ${merged.error}`);
			save = merged.save;
		}
		const data = JSON.stringify(save);
		if (data.length > MAX_SAVE_CHARS) throw new Error("merged save too large");
		const now = Date.now();
		const written = row
			? await env.DB.prepare(
				"UPDATE user_saves SET data = ?1, schema_version = ?2, last_write_id = NULL, revision = revision + 1, updated_at = ?3 WHERE user_id = ?4 AND revision = ?5 RETURNING revision",
			).bind(data, SAVE_SCHEMA_VERSION, now, userId, row.revision).first()
			: await env.DB.prepare(
				"INSERT INTO user_saves (user_id, revision, schema_version, data, last_write_id, created_at, updated_at) VALUES (?1, 1, ?2, ?3, NULL, ?4, ?4) ON CONFLICT (user_id) DO NOTHING RETURNING revision",
			).bind(userId, SAVE_SCHEMA_VERSION, data, now).first();
		// Nothing written: the account saved meanwhile (another tab or device), so merge again.
		if (written) return;
	}
	throw new Error("account save kept changing");
}

async function me(request: Request, url: URL, env: Env): Promise<Response> {
	const { session, cookies } = await currentSession(request, url, env);
	if (!session) return json({ user: null }, 200, {}, cookies);
	const row = await env.DB.prepare(
		"SELECT email, email_verified, display_name, password_hash IS NOT NULL AS has_password, (SELECT json_group_array(provider) FROM oauth_accounts WHERE user_id = users.id) AS providers FROM users WHERE id = ?1",
	).bind(session.userId).first<UserRow>();
	if (!row) return json({ user: null }, 200, {}, [clearCookie(url, SESSION_COOKIE)]);
	return json(
		{
			user: {
				email: row.email,
				emailVerified: row.email_verified === 1,
				displayName: row.display_name,
				hasPassword: row.has_password === 1,
				providers: JSON.parse(row.providers) as string[],
			},
		},
		200,
		{},
		cookies,
	);
}

/**
 * Ends this browser's session and drops its guest cookie too, so the next save request starts a
 * new guest: the account's progress stays with the account, not with whoever uses this browser
 * next. Signing out when not signed in is fine.
 */
async function signOut(request: Request, url: URL, env: Env): Promise<Response> {
	if (!sameOrigin(request, url)) return refuse(403, "cross_origin");
	const token = readToken(request, url, SESSION_COOKIE);
	if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(token)).first();
	return json({ user: null }, 200, {}, [clearCookie(url, SESSION_COOKIE), clearCookie(url, GUEST_COOKIE)]);
}

export async function handleAuth(request: Request, url: URL, env: Env): Promise<Response> {
	if (url.pathname === "/api/auth/me") return request.method === "GET" ? me(request, url, env) : refuse(405, "method", { allow: "GET" });
	if (url.pathname === "/api/auth/signout") return request.method === "POST" ? signOut(request, url, env) : refuse(405, "method", { allow: "POST" });
	return refuse(404, "not_found");
}
