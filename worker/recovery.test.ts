import type { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUser } from "./auth";
import { handleApi, type Env } from "./index";
import { CookieJar, memoryDatabase } from "./testing";

const ORIGIN = "https://game.test";
const SESSION = "__Host-orion_session";
const PASSWORD = "neon palms at dusk";
const NEW_PASSWORD = "sunset strip at noon";

interface Sent {
	from: string;
	to: string[];
	subject: string;
	text: string;
	html: string;
	key: string | null;
}

let env: Env;
let db: DatabaseSync;
let jar: CookieJar;
let outbox: Sent[];

beforeEach(() => {
	({ env, db } = memoryDatabase());
	env.RESEND_API_KEY = "re_test";
	env.EMAIL_FROM = "OrionGenix <accounts@game.test>";
	jar = new CookieJar();
	outbox = [];
	vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.startsWith("https://api.pwnedpasswords.com/")) return new Response("");
		if (url === "https://api.resend.com/emails") {
			outbox.push({ ...JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("authorization") });
			return Response.json({ id: "email-1" });
		}
		throw new Error(`unexpected fetch ${url}`);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function post(path: string, body: unknown = {}, cookies = jar): Promise<Response> {
	const response = await handleApi(new Request(`${ORIGIN}${path}`, {
		method: "POST",
		headers: { cookie: cookies.header(), origin: ORIGIN, "content-type": "application/json" },
		body: JSON.stringify(body),
	}), env);
	cookies.take(response);
	return response;
}

const signUp = (email = "rosa@example.com", cookies = jar) => post("/api/auth/signup", { email, password: PASSWORD, displayName: "Rosa" }, cookies);
const signIn = (password: string, cookies = jar) => post("/api/auth/signin", { email: "rosa@example.com", password }, cookies);
const me = async (cookies = jar) => (await (await handleApi(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: cookies.header() } }), env)).json()).user;
const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** The link in an email: which page, and its token. */
function linkIn(mail: Sent): { page: string; token: string } {
	const found = /https:\/\/game\.test\/(verify|reset)#token=([A-Za-z0-9_-]{43})/.exec(mail.text);
	expect(found, mail.text).not.toBeNull();
	expect(mail.html).toContain(`${ORIGIN}/${found![1]}#token=${found![2]}`);
	return { page: found![1], token: found![2] };
}

const lastLink = () => linkIn(outbox.at(-1)!);

describe("sign-up, with email set up", () => {
	it("doesn't sign in: it sends a link that confirms the address", async () => {
		const response = await signUp();
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ checkInbox: true });
		expect(jar.get(SESSION)).toBeUndefined();
		expect(outbox).toHaveLength(1);
		expect(outbox[0]).toMatchObject({ from: "OrionGenix <accounts@game.test>", to: ["rosa@example.com"], subject: "Confirm your OrionGenix email", key: "Bearer re_test" });
		expect(lastLink().page).toBe("verify");
		expect(db.prepare("SELECT email_verified FROM users").get()).toEqual({ email_verified: 0 });
	});

	it("answers a taken address exactly as a new one, and tells the address instead", async () => {
		await signUp();
		const first = outbox.length;
		const again = await signUp(" ROSA@example.com ", new CookieJar());
		expect(again.status).toBe(202);
		expect(await again.json()).toEqual({ checkInbox: true });
		expect(count("users")).toBe(1);
		const mail = outbox.at(-1)!;
		expect(outbox).toHaveLength(first + 1);
		expect(mail.subject).toBe("You already have an OrionGenix account");
		expect(lastLink().page).toBe("reset");
		// The password on the account is untouched.
		expect((await signIn(PASSWORD)).status).toBe(200);
	});

	it("lets the new account sign in with its password before the address is confirmed", async () => {
		await signUp();
		expect((await signIn(PASSWORD)).status).toBe(200);
		expect((await me()).emailVerified).toBe(false);
	});

	it("sends the email after the response, where the Worker allows", async () => {
		const waiting: Promise<unknown>[] = [];
		const ctx = { waitUntil: (promise: Promise<unknown>) => void waiting.push(promise) };
		const response = await handleApi(new Request(`${ORIGIN}/api/auth/signup`, {
			method: "POST",
			headers: { origin: ORIGIN, "content-type": "application/json" },
			body: JSON.stringify({ email: "rosa@example.com", password: PASSWORD }),
		}), env, ctx);
		expect(response.status).toBe(202);
		expect(waiting).toHaveLength(1);
		await Promise.all(waiting);
		expect(outbox).toHaveLength(1);
	});
});

describe("confirming an address", () => {
	beforeEach(async () => {
		await signUp();
	});

	it("confirms it and signs that browser in, once", async () => {
		const { token } = lastLink();
		const response = await post("/api/auth/verify", { token });
		expect(response.status).toBe(200);
		expect((await response.json()).user).toMatchObject({ email: "rosa@example.com", emailVerified: true });
		expect(jar.get(SESSION)).toBeDefined();
		const reused = await post("/api/auth/verify", { token }, new CookieJar());
		expect(reused.status).toBe(400);
		expect(await reused.json()).toEqual({ error: "link_invalid" });
	});

	it("refuses a link after 24 hours, a reset link, or a made-up one", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const { token } = lastLink();
		vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
		expect((await post("/api/auth/verify", { token })).status).toBe(400);
		for (const bad of ["A".repeat(43), "short", 42]) expect((await post("/api/auth/verify", { token: bad })).status).toBe(400);
		await post("/api/auth/forgot", { email: "rosa@example.com" });
		expect((await post("/api/auth/verify", { token: lastLink().token })).status).toBe(400);
		expect(jar.get(SESSION)).toBeUndefined();
	});

	it("sends a signed-in player a new link, at most once a minute, and the old one stops working", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const old = lastLink().token;
		await signIn(PASSWORD);
		vi.setSystemTime(Date.now() + 61_000);
		const resend = await post("/api/auth/verify/send");
		expect(await resend.json()).toEqual({ sent: true });
		const fresh = lastLink().token;
		expect(fresh).not.toBe(old);
		expect((await post("/api/auth/verify/send")).status).toBe(429);
		expect((await post("/api/auth/verify", { token: old })).status).toBe(400);
		expect((await post("/api/auth/verify", { token: fresh })).status).toBe(200);
		expect(await (await post("/api/auth/verify/send")).json()).toEqual({ sent: false, verified: true });
	});

	it("won't resend for someone signed out", async () => {
		expect((await post("/api/auth/verify/send")).status).toBe(401);
	});
});

describe("forgotten password", () => {
	beforeEach(async () => {
		await signUp();
		outbox = [];
	});

	it("says the same thing whether or not there's an account, and only mails an account", async () => {
		const known = await post("/api/auth/forgot", { email: "Rosa@Example.com" });
		const unknown = await post("/api/auth/forgot", { email: "nobody@example.com" });
		expect([known.status, unknown.status]).toEqual([202, 202]);
		expect(await known.json()).toEqual(await unknown.json());
		expect(outbox).toHaveLength(1);
		expect(outbox[0]).toMatchObject({ to: ["rosa@example.com"], subject: "Reset your OrionGenix password" });
	});

	it("sends at most one reset email a minute, without saying so", async () => {
		await post("/api/auth/forgot", { email: "rosa@example.com" });
		const second = await post("/api/auth/forgot", { email: "rosa@example.com" });
		expect(second.status).toBe(202);
		expect(outbox).toHaveLength(1);
	});

	it("is rate limited, and unavailable without email set up", async () => {
		env.AUTH_LIMITER = { limit: async () => ({ success: false }) };
		expect((await post("/api/auth/forgot", { email: "rosa@example.com" })).status).toBe(429);
		env.AUTH_LIMITER = undefined;
		env.RESEND_API_KEY = undefined;
		const response = await post("/api/auth/forgot", { email: "rosa@example.com" });
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: "email_unavailable" });
	});
});

describe("resetting a password", () => {
	let token: string;
	let other: CookieJar;

	beforeEach(async () => {
		await signUp();
		other = new CookieJar();
		await signIn(PASSWORD, other);
		await post("/api/auth/forgot", { email: "rosa@example.com" });
		token = lastLink().token;
	});

	it("sets the new password, confirms the address, signs this browser in and every other one out", async () => {
		expect(await (await post("/api/auth/reset/check", { token })).json()).toEqual({ valid: true });
		const response = await post("/api/auth/reset", { token, password: NEW_PASSWORD });
		expect(response.status).toBe(200);
		expect((await response.json()).user).toMatchObject({ emailVerified: true, hasPassword: true });
		expect(await me()).not.toBeNull();
		expect(await me(other)).toBeNull();
		expect((await signIn(PASSWORD, new CookieJar())).status).toBe(401);
		expect((await signIn(NEW_PASSWORD, new CookieJar())).status).toBe(200);
		expect(await (await post("/api/auth/reset/check", { token })).json()).toEqual({ valid: false });
		expect((await post("/api/auth/reset", { token, password: "another new one!" })).status).toBe(400);
	});

	it("doesn't use the link up on a password that won't do", async () => {
		expect(await (await post("/api/auth/reset", { token, password: "short" })).json()).toEqual({ error: "password_too_short" });
		expect((await post("/api/auth/reset", { token, password: NEW_PASSWORD })).status).toBe(200);
	});

	it("lifts a lock from wrong passwords", async () => {
		db.prepare("UPDATE users SET failed_logins = 3, locked_until = ?").run(Date.now() + 600_000);
		await post("/api/auth/reset", { token, password: NEW_PASSWORD });
		expect(db.prepare("SELECT failed_logins, locked_until FROM users").get()).toEqual({ failed_logins: 0, locked_until: null });
	});

	it("refuses a link after 30 minutes", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 1);
		expect(await (await post("/api/auth/reset", { token, password: NEW_PASSWORD })).json()).toEqual({ error: "link_invalid" });
	});

	it("lets an account made with Google add a password", async () => {
		await createUser(env, { email: "g@example.com", displayName: "G", emailVerified: true });
		await post("/api/auth/forgot", { email: "g@example.com" });
		await post("/api/auth/reset", { token: lastLink().token, password: NEW_PASSWORD });
		expect(await me()).toMatchObject({ email: "g@example.com", hasPassword: true });
	});
});

describe("only from the game's own page", () => {
	it("refuses the email endpoints from another site", async () => {
		for (const path of ["/api/auth/verify", "/api/auth/verify/send", "/api/auth/forgot", "/api/auth/reset/check", "/api/auth/reset"]) {
			const response = await handleApi(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: "{}" }), env);
			expect(response.status, path).toBe(403);
			expect((await handleApi(new Request(`${ORIGIN}${path}`), env)).status, path).toBe(405);
		}
	});
});
