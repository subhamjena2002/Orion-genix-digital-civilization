import type { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newGameSave } from "../src/engine/orion/missions/SaveMerge";
import { SAVE_SCHEMA_VERSION, type SaveData } from "../src/engine/orion/missions/SaveSchema";
import { createUser, SESSION_MS, SESSION_TOUCH_MS, startSession } from "./auth";
import { json } from "./http";
import { handleApi, type Env } from "./index";
import { CookieJar, memoryDatabase } from "./testing";

const ORIGIN = "https://game.test";
const SESSION = "__Host-orion_session";
const GUEST = "__Host-orion_guest";

const played = (extra: Partial<SaveData> = {}): SaveData => ({ ...newGameSave(), cash: 1200, passed: ["first-job"], flags: ["dez-owes"], ...extra });

let env: Env;
let db: DatabaseSync;
let jar: CookieJar;
let writes = 0;

beforeEach(() => {
	({ env, db } = memoryDatabase());
	jar = new CookieJar();
	writes = 0;
});

afterEach(() => {
	vi.useRealTimers();
});

async function call(path: string, init: RequestInit = {}, cookies = jar): Promise<Response> {
	const response = await handleApi(new Request(`${ORIGIN}${path}`, { ...init, headers: { cookie: cookies.header(), ...(init.headers as Record<string, string>) } }), env);
	cookies.take(response);
	return response;
}

const getSave = async (cookies = jar) => (await call("/api/save", {}, cookies)).json();
const me = async (cookies = jar) => (await call("/api/auth/me", {}, cookies)).json();
const signOut = (cookies = jar, origin = ORIGIN) => call("/api/auth/signout", { method: "POST", headers: { origin } }, cookies);

function putSave(save: SaveData, baseRevision: number, cookies = jar): Promise<Response> {
	return call("/api/save", {
		method: "PUT",
		headers: { origin: ORIGIN, "content-type": "application/json" },
		body: JSON.stringify({ baseRevision, schemaVersion: SAVE_SCHEMA_VERSION, writeId: `write-${++writes}-0000`, save }),
	}, cookies);
}

/** What a way of signing in does once it knows who this is. */
async function signIn(userId: string, cookies = jar): Promise<void> {
	const request = new Request(`${ORIGIN}/api/auth/test`, { headers: { cookie: cookies.header(), "user-agent": "vitest" } });
	cookies.take(json({}, 200, {}, await startSession(request, new URL(request.url), env, userId)));
}

const newUser = (email = "Player@Example.com") => createUser(env, { email, displayName: "Player", emailVerified: true });
const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("accounts", () => {
	it("says nobody is signed in for a guest", async () => {
		const response = await call("/api/auth/me");
		expect(await response.json()).toEqual({ user: null });
		expect(response.headers.getSetCookie()).toEqual([]);
	});

	it("signs in with a secure HttpOnly session cookie and says who it is", async () => {
		const id = await newUser();
		const request = new Request(`${ORIGIN}/api/auth/test`);
		const cookies = await startSession(request, new URL(request.url), env, id);
		expect(cookies[0]).toMatch(new RegExp(`^${SESSION}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Lax; Secure$`));
		jar.take(json({}, 200, {}, cookies));
		expect(await me()).toEqual({ user: { email: "player@example.com", emailVerified: true, displayName: "Player", hasPassword: false, providers: [] } });
	});

	it("stores only the hash of the session token", async () => {
		await signIn(await newUser());
		const stored = db.prepare("SELECT token_hash, user_agent FROM sessions").get() as { token_hash: string; user_agent: string };
		expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(stored.token_hash).not.toBe(jar.get(SESSION));
		expect(stored.user_agent).toBe("vitest");
	});

	it("keeps emails unique whatever their case", async () => {
		await newUser("Player@Example.com");
		await expect(newUser("  player@EXAMPLE.com ")).rejects.toThrow();
	});

	it("gives a new session token on every sign-in and ends the old one", async () => {
		const id = await newUser();
		await signIn(id);
		const first = jar.get(SESSION);
		await signIn(id);
		expect(jar.get(SESSION)).not.toBe(first);
		expect(count("sessions")).toBe(1);
	});

	describe("saves", () => {
		it("keeps a signed-in player's save with the account, on every device", async () => {
			const id = await newUser();
			await signIn(id);
			expect((await putSave(played({ cash: 4000 }), 0)).status).toBe(200);
			const phone = new CookieJar();
			await signIn(id, phone);
			const there = await getSave(phone);
			expect(there).toMatchObject({ revision: 1, save: { cash: 4000 } });
			expect(there.owner).toBe((await getSave()).owner);
			expect(count("guest_saves")).toBe(0);
		});

		it("tags an account's save differently from any guest's", async () => {
			const guest = (await getSave()).owner;
			await signIn(await newUser());
			const account = (await getSave()).owner;
			expect(account).toMatch(/^[0-9a-f]{16}$/);
			expect(account).not.toBe(guest);
		});

		it("doesn't need or hand out a guest cookie while signed in", async () => {
			await signIn(await newUser());
			const response = await call("/api/save");
			expect(response.headers.getSetCookie()).toEqual([]);
			expect((await putSave(played(), 0)).status).toBe(200);
		});
	});

	describe("a guest's save joining the account", () => {
		it("becomes the account's save when the account has none", async () => {
			await getSave();
			await putSave(played(), 0);
			await signIn(await newUser());
			expect(jar.get(GUEST)).toBeUndefined();
			expect(await getSave()).toMatchObject({ revision: 1, save: played() });
			expect(count("guest_saves")).toBe(0);
		});

		it("adds up with the account's save: lists combine, and each side's earnings count once", async () => {
			const id = await newUser();
			const laptop = new CookieJar();
			await signIn(id, laptop);
			await putSave(played({ cash: 5000, passed: ["first-job"], weapons: ["fists", "sword", "pistol", "ar"], jobs: 2, rep: { street: 3, sunset: 0, law: 0, meridian: 0 } }), 0, laptop);

			await getSave();
			await putSave(played({ cash: 1200, passed: ["night-run"], flags: ["met-kasper"], jobs: 1, rep: { street: 2, sunset: 1, law: 0, meridian: 0 } }), 0);
			await signIn(id);

			const { revision, save } = await getSave();
			expect(revision).toBe(2);
			expect(save.cash).toBe(6200);
			expect(save.jobs).toBe(3);
			expect(save.passed.sort()).toEqual(["first-job", "night-run"]);
			expect(save.flags.sort()).toEqual(["dez-owes", "met-kasper"]);
			expect(save.weapons).toContain("ar");
			expect(save.rep).toMatchObject({ street: 5, sunset: 1 });
			// The other device's next write is based on revision 1: it gets the merged save back.
			const stale = await putSave(played({ cash: 5000 }), 1, laptop);
			expect(stale.status).toBe(409);
		});

		it("can only ever join one account, however the guest cookie is replayed", async () => {
			await getSave();
			await putSave(played({ cash: 900 }), 0);
			const copied = new CookieJar();
			copied.take(json({}, 200, {}, [`${GUEST}=${jar.get(GUEST)}; Path=/`]));

			await signIn(await newUser("a@example.com"));
			await signIn(await newUser("b@example.com"), copied);
			expect((await getSave()).save.cash).toBe(900);
			expect((await getSave(copied)).save).toBeNull();
		});

		it("leaves nothing behind for a guest who hadn't played", async () => {
			await getSave();
			await putSave(newGameSave(), 0);
			await signIn(await newUser());
			expect(await getSave()).toMatchObject({ revision: 0, save: null });
			expect(count("guest_saves")).toBe(0);
		});

		it("puts the guest's save back if it can't join, so signing in can be tried again", async () => {
			const id = await newUser();
			await getSave();
			await putSave(played(), 0);
			db.prepare("INSERT INTO user_saves (user_id, revision, schema_version, data, created_at, updated_at) VALUES (?, 1, 1, '{\"broken\":true}', 0, 0)").run(id);
			await expect(signIn(id)).rejects.toThrow();
			expect(count("guest_saves")).toBe(1);
			expect(count("sessions")).toBe(0);
			expect((await getSave()).save).toEqual(played());
		});
	});

	describe("sessions over time", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
		});

		const expiry = () => (db.prepare("SELECT expires_at FROM sessions").get() as { expires_at: number }).expires_at;

		it("renews the session at most once an hour while it's used", async () => {
			await signIn(await newUser());
			const first = expiry();
			vi.setSystemTime(Date.now() + SESSION_TOUCH_MS / 2);
			expect((await call("/api/auth/me")).headers.getSetCookie()).toEqual([]);
			expect(expiry()).toBe(first);

			vi.setSystemTime(Date.now() + SESSION_TOUCH_MS);
			const renewed = await call("/api/auth/me");
			expect(renewed.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION}=`));
			expect(expiry()).toBe(Date.now() + SESSION_MS);
		});

		it("ends a session left unused for 30 days", async () => {
			await signIn(await newUser());
			vi.setSystemTime(Date.now() + SESSION_MS + 1);
			const response = await call("/api/auth/me");
			expect(await response.json()).toEqual({ user: null });
			expect(response.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION}=; .*Max-Age=0`));
			expect(count("sessions")).toBe(0);
			// And the save API treats the browser as a guest again.
			expect((await getSave()).save).toBeNull();
		});
	});

	it("treats a forged, malformed or unknown session cookie as nobody, and clears it", async () => {
		for (const value of ["not-a-token", "A".repeat(43)]) {
			const forged = new CookieJar();
			forged.take(json({}, 200, {}, [`${SESSION}=${value}; Path=/`]));
			const response = await call("/api/auth/me", {}, forged);
			expect(await response.json()).toEqual({ user: null });
			expect(forged.get(SESSION)).toBeUndefined();
		}
	});

	it("signs out: ends the session and starts the browser over as a new guest", async () => {
		const id = await newUser();
		await signIn(id);
		await putSave(played({ cash: 3000 }), 0);
		const account = (await getSave()).owner;

		expect((await signOut(jar, "https://evil.test")).status).toBe(403);
		expect(count("sessions")).toBe(1);

		const response = await signOut();
		expect(response.status).toBe(200);
		expect(jar.get(SESSION)).toBeUndefined();
		expect(count("sessions")).toBe(0);
		expect(await me()).toEqual({ user: null });
		const guest = await getSave();
		expect(guest.owner).not.toBe(account);
		expect(guest.save).toBeNull();

		// The progress is still the account's.
		await signIn(id);
		expect((await getSave()).save.cash).toBe(3000);
	});

	it("signing out when not signed in is fine", async () => {
		expect((await signOut()).status).toBe(200);
	});

	it("deleting an account takes its sessions and save with it", async () => {
		const id = await newUser();
		await signIn(id);
		await putSave(played(), 0);
		db.prepare("DELETE FROM users WHERE id = ?").run(id);
		expect(count("sessions")).toBe(0);
		expect(count("user_saves")).toBe(0);
		expect(await me()).toEqual({ user: null });
	});

	it("refuses other methods and paths", async () => {
		expect((await call("/api/auth/me", { method: "POST", headers: { origin: ORIGIN } })).status).toBe(405);
		expect((await call("/api/auth/signout")).status).toBe(405);
		expect((await call("/api/auth/nothing")).status).toBe(404);
	});
});
