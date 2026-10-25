import type { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUser, SESSION_MS, startSession } from "./auth";
import { cleanUp } from "./cleanup";
import { issueToken, spendToken } from "./email";
import { json } from "./http";
import worker, { handleApi, type Env } from "./index";
import { CookieJar, memoryDatabase } from "./testing";

const ORIGIN = "https://game.test";
const DAY = 24 * 60 * 60 * 1000;

let env: Env;
let db: DatabaseSync;
let userId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
	({ env, db } = memoryDatabase());
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	userId = await createUser(env, { email: "rosa@example.com", displayName: "Rosa", emailVerified: false });
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function signIn(): Promise<CookieJar> {
	const jar = new CookieJar();
	const request = new Request(`${ORIGIN}/api/auth/test`);
	jar.take(json({}, 200, {}, await startSession(request, new URL(request.url), env, userId)));
	return jar;
}

const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const me = async (jar: CookieJar) => (await (await handleApi(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: jar.header() } }), env)).json()).user;

describe("daily clean-up", () => {
	it("deletes sessions past their expiry, and keeps the ones still good", async () => {
		await signIn(); // a browser whose cookie was then cleared: never seen again
		vi.setSystemTime(Date.now() + 20 * DAY);
		const active = await signIn();
		vi.setSystemTime(Date.now() + 11 * DAY); // the first is now 31 days old, the second 11

		expect(count("sessions")).toBe(2);
		expect(await cleanUp(env)).toMatchObject({ sessions: 1 });
		expect(count("sessions")).toBe(1);
		expect(await me(active)).toMatchObject({ email: "rosa@example.com" });
	});

	it("deletes email links that were used or have expired, and keeps one still waiting", async () => {
		const spent = await issueToken(env, userId, "reset");
		await spendToken(env, spent!, "reset");
		const waiting = await issueToken(env, userId, "verify");
		expect(count("email_tokens")).toBe(2);

		expect(await cleanUp(env)).toMatchObject({ emailTokens: 1 });
		expect(count("email_tokens")).toBe(1);
		expect(await spendToken(env, waiting!, "verify")).toBe(userId);

		vi.setSystemTime(Date.now() + 2 * DAY);
		await issueToken(env, userId, "reset");
		vi.setSystemTime(Date.now() + 31 * 60 * 1000); // the reset link has expired
		expect(await cleanUp(env)).toMatchObject({ emailTokens: 2 });
		expect(count("email_tokens")).toBe(0);
	});

	it("works through a big backlog in batches", async () => {
		const insert = db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, 0, 0, ?)");
		for (let i = 0; i < 4500; i++) insert.run(i.toString(16).padStart(64, "0"), userId, Date.now() - 1);
		expect(await cleanUp(env)).toEqual({ sessions: 4500, emailTokens: 0 });
		expect(count("sessions")).toBe(0);
	});

	it("touches nothing else: accounts and saves stay", async () => {
		await signIn();
		vi.setSystemTime(Date.now() + SESSION_MS + 1);
		await cleanUp(env);
		expect(count("users")).toBe(1);
	});

	it("runs from the daily trigger, after the trigger has returned", async () => {
		await signIn();
		vi.setSystemTime(Date.now() + SESSION_MS + 1);
		const waiting: Promise<unknown>[] = [];
		await worker.scheduled({}, env, { waitUntil: (promise) => void waiting.push(promise) });
		expect(waiting).toHaveLength(1);
		await Promise.all(waiting);
		expect(count("sessions")).toBe(0);
	});
});
