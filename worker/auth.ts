import { mergeSaves, newGameSave } from "../src/engine/orion/missions/SaveMerge";
import { checkSave, MAX_SAVE_CHARS, SAVE_SCHEMA_VERSION, sameSave, type SaveData } from "../src/engine/orion/missions/SaveSchema";
import { clearCookie, clientAddress, GUEST_COOKIE, json, limited, newId, newToken, readCookie, readJsonBody, readToken, refuse, sameOrigin, SESSION_COOKIE, setCookie, sha256 } from "./http";
import type { Env } from "./index";
import { burnPasswordCheck, hashPassword, isBreached, MAX_PASSWORD, passwordProblem, verifyPassword } from "./password";

/**
 * Accounts: who is signed in, and what happens to a guest's save when they sign in
 * (docs/accounts.md). Ways of signing in (email and password, Google) build on `createUser` and
 * `startSession`; this file has the parts they share.
 *
 *   GET  /api/auth/me       the signed-in player ({ user: null } for a guest).
 *   POST /api/auth/signup   { email, password, displayName?, turnstileToken? }: a new account,
 *                           signed in.
 *   POST /api/auth/signin   { email, password, turnstileToken? }
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
/** Sign-up and sign-in bodies: an email, a password and a Turnstile token. */
const MAX_AUTH_BODY = 4096;
const MAX_EMAIL = 254;
const MAX_DISPLAY_NAME = 32;
/** Something@something.something, with no spaces or control characters: the mailbox decides the rest. */
const EMAIL = /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
/** Wrong passwords in a row before the account stops taking any for a while. */
const LOCK_AFTER = 10;
const LOCK_MS = 15 * 60 * 1000;
const TURNSTILE_TIMEOUT_MS = 5000;

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

interface PasswordRow {
	id: string;
	password_hash: string | null;
	failed_logins: number;
	locked_until: number | null;
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

/** What the game is told about the signed-in player: nothing it doesn't show them. */
async function userView(env: Env, userId: string) {
	const row = await env.DB.prepare(
		"SELECT email, email_verified, display_name, password_hash IS NOT NULL AS has_password, (SELECT json_group_array(provider) FROM oauth_accounts WHERE user_id = users.id) AS providers FROM users WHERE id = ?1",
	).bind(userId).first<UserRow>();
	if (!row) return null;
	return {
		email: row.email,
		emailVerified: row.email_verified === 1,
		displayName: row.display_name,
		hasPassword: row.has_password === 1,
		providers: JSON.parse(row.providers) as string[],
	};
}

async function me(request: Request, url: URL, env: Env): Promise<Response> {
	const { session, cookies } = await currentSession(request, url, env);
	if (!session) return json({ user: null }, 200, {}, cookies);
	const user = await userView(env, session.userId);
	if (!user) return json({ user: null }, 200, {}, [clearCookie(url, SESSION_COOKIE)]);
	return json({ user }, 200, {}, cookies);
}

/** The email as stored, if it looks like one. */
function readEmail(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const email = normaliseEmail(value);
	return email.length <= MAX_EMAIL && EMAIL.test(email) ? email : null;
}

/** The name shown in the game: the one given, or else the email's part before the @. */
function readDisplayName(value: unknown, email: string): string | null {
	if (value !== undefined && value !== null && typeof value !== "string") return null;
	const given = (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
	const name = given === "" ? email.slice(0, email.indexOf("@")) : given;
	if (name === "" || CONTROL.test(name)) return null;
	return [...name].slice(0, MAX_DISPLAY_NAME).join("");
}

/**
 * Whether the request carries a passed Turnstile challenge for this site. Not checked where no
 * secret is set (local development); refused if Turnstile can't be reached, since otherwise a
 * bot would only need to wait for an outage.
 */
async function passesTurnstile(request: Request, url: URL, env: Env, token: unknown): Promise<boolean> {
	if (!env.TURNSTILE_SECRET) return true;
	if (typeof token !== "string" || token.length < 1 || token.length > 2048) return false;
	const form = new FormData();
	form.append("secret", env.TURNSTILE_SECRET);
	form.append("response", token);
	form.append("remoteip", clientAddress(request));
	try {
		const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS) });
		const result = (await response.json()) as { success?: boolean; hostname?: string };
		return result.success === true && (result.hostname === undefined || result.hostname === url.hostname);
	} catch {
		return false;
	}
}

const tryLater = (seconds: number) => refuse(429, "try_later", { "retry-after": String(seconds) });

/**
 * A new account with a password, signed in straight away (the address is confirmed later, by
 * email). Saying an email is taken does tell whoever asks that it has an account here; once
 * sign-up emails exist, that answer moves into an email to the address instead.
 */
async function signUp(request: Request, url: URL, env: Env): Promise<Response> {
	const read = await readJsonBody(request, url, MAX_AUTH_BODY);
	if ("refused" in read) return read.refused;
	const { body } = read;
	if (await limited(env.AUTH_LIMITER, `signup:${clientAddress(request)}`)) return tryLater(60);
	const email = readEmail(body.email);
	if (!email) return refuse(400, "email");
	const problem = passwordProblem(body.password);
	if (problem) return refuse(400, problem);
	const password = body.password as string;
	const displayName = readDisplayName(body.displayName, email);
	if (!displayName) return refuse(400, "display_name");
	if (!(await passesTurnstile(request, url, env, body.turnstileToken))) return refuse(400, "turnstile");
	if (await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first()) return refuse(409, "email_taken");
	if ((await isBreached(password)) === true) return refuse(400, "password_breached");

	let userId: string;
	try {
		userId = await createUser(env, { email, displayName, emailVerified: false, passwordHash: await hashPassword(password) });
	} catch (error) {
		// Someone else signed up with it a moment ago.
		if (error instanceof Error && /unique/i.test(error.message)) return refuse(409, "email_taken");
		throw error;
	}
	const cookies = await startSession(request, url, env, userId);
	return json({ user: await userView(env, userId) }, 201, {}, cookies);
}

/**
 * Signing in with a password. Every way it can fail says the same thing (no such email, no
 * password on the account, wrong password) and takes as long, so it can't be used to find out
 * who has an account. Guessing is slowed per address and per email by the rate limiter, and an
 * account that takes 10 wrong passwords in a row takes none for 15 minutes.
 */
async function signIn(request: Request, url: URL, env: Env): Promise<Response> {
	const read = await readJsonBody(request, url, MAX_AUTH_BODY);
	if ("refused" in read) return read.refused;
	const { body } = read;
	const { password } = body;
	if (typeof password !== "string" || password.length > MAX_PASSWORD * 4) return refuse(400, "password");
	const email = readEmail(body.email);
	if (await limited(env.AUTH_LIMITER, `signin:${clientAddress(request)}`)) return tryLater(60);
	if (email && (await limited(env.AUTH_LIMITER, `signin:${email}`))) return tryLater(60);
	if (!(await passesTurnstile(request, url, env, body.turnstileToken))) return refuse(400, "turnstile");

	const row = email
		? await env.DB.prepare("SELECT id, password_hash, failed_logins, locked_until FROM users WHERE email = ?1").bind(email).first<PasswordRow>()
		: null;
	if (!row || row.password_hash === null) {
		await burnPasswordCheck(password);
		return refuse(401, "invalid_credentials");
	}
	const now = Date.now();
	if (row.locked_until !== null && row.locked_until > now) return tryLater(Math.ceil((row.locked_until - now) / 1000));

	const checked = await verifyPassword(password, row.password_hash);
	if (!checked.ok) {
		const failures = row.failed_logins + 1;
		const lock = failures >= LOCK_AFTER;
		await env.DB.prepare("UPDATE users SET failed_logins = ?1, locked_until = ?2 WHERE id = ?3").bind(lock ? 0 : failures, lock ? now + LOCK_MS : null, row.id).first();
		return refuse(401, "invalid_credentials");
	}
	const rehashed = checked.rehash ? await hashPassword(password) : null;
	await env.DB.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, password_hash = COALESCE(?1, password_hash), updated_at = ?2 WHERE id = ?3").bind(rehashed, now, row.id).first();
	const cookies = await startSession(request, url, env, row.id);
	return json({ user: await userView(env, row.id) }, 200, {}, cookies);
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
	if (url.pathname === "/api/auth/signup") return request.method === "POST" ? signUp(request, url, env) : refuse(405, "method", { allow: "POST" });
	if (url.pathname === "/api/auth/signin") return request.method === "POST" ? signIn(request, url, env) : refuse(405, "method", { allow: "POST" });
	if (url.pathname === "/api/auth/signout") return request.method === "POST" ? signOut(request, url, env) : refuse(405, "method", { allow: "POST" });
	return refuse(404, "not_found");
}
