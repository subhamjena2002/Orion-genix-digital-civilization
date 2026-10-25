import type { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newGameSave } from "../src/engine/orion/missions/SaveMerge";
import { SAVE_SCHEMA_VERSION, type SaveData } from "../src/engine/orion/missions/SaveSchema";
import { createUser } from "./auth";
import { handleApi, type Env } from "./index";
import { CookieJar, memoryDatabase } from "./testing";

const ORIGIN = "https://game.test";
const SESSION = "__Host-orion_session";
const PASSWORD = "neon palms at dusk";

let env: Env;
let db: DatabaseSync;
let jar: CookieJar;
/** What the outside world (breach check, Turnstile) answers. */
let outside: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
	({ env, db } = memoryDatabase());
	jar = new CookieJar();
	outside = async () => new Response("0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n");
	vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => outside(String(input), init));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}, cookies = jar): Promise<Response> {
	const response = await handleApi(new Request(`${ORIGIN}${path}`, {
		method: "POST",
		headers: { cookie: cookies.header(), origin: ORIGIN, "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	}), env);
	cookies.take(response);
	return response;
}

const signUp = (body: Record<string, unknown>, cookies = jar) => post("/api/auth/signup", { email: "Rosa@Example.com", password: PASSWORD, ...body }, {}, cookies);
const signIn = (email: string, password: string, extra: Record<string, unknown> = {}, cookies = jar) => post("/api/auth/signin", { email, password, ...extra }, {}, cookies);
const me = async (cookies = jar) => {
	const response = await handleApi(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: cookies.header() } }), env);
	return (await response.json()).user;
};
const status = async (response: Promise<Response>) => (await response).status;
const error = async (response: Promise<Response>) => (await (await response).json()).error;

describe("sign-up", () => {
	it("makes an account and signs it in", async () => {
		const response = await signUp({ displayName: "  Rosa   Vega " });
		expect(response.status).toBe(201);
		expect(jar.get(SESSION)).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const user = { email: "rosa@example.com", emailVerified: false, displayName: "Rosa Vega", hasPassword: true, providers: [] };
		expect((await response.json()).user).toEqual(user);
		expect(await me()).toEqual(user);
	});

	it("names the player after their email when no name is given", async () => {
		expect((await (await signUp({})).json()).user.displayName).toBe("rosa");
	});

	it("keeps only a slow hash of the password", async () => {
		await signUp({});
		const { password_hash } = db.prepare("SELECT password_hash FROM users").get() as { password_hash: string };
		expect(password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
		expect(password_hash).not.toContain(PASSWORD);
	});

	it("brings the guest's progress into the new account", async () => {
		const save: SaveData = { ...newGameSave(), cash: 2500, passed: ["first-job"] };
		const read = await handleApi(new Request(`${ORIGIN}/api/save`), env);
		jar.take(read);
		await handleApi(new Request(`${ORIGIN}/api/save`, {
			method: "PUT",
			headers: { cookie: jar.header(), origin: ORIGIN, "content-type": "application/json" },
			body: JSON.stringify({ baseRevision: 0, schemaVersion: SAVE_SCHEMA_VERSION, writeId: "write-1-0000", save }),
		}), env);
		await signUp({});
		const loaded = await (await handleApi(new Request(`${ORIGIN}/api/save`, { headers: { cookie: jar.header() } }), env)).json();
		expect(loaded.save).toEqual(save);
	});

	it("refuses an email that's taken, whatever its case", async () => {
		await signUp({});
		const again = new CookieJar();
		expect(await status(signUp({ email: " ROSA@example.COM " }, again))).toBe(409);
		expect(again.get(SESSION)).toBeUndefined();
	});

	it("refuses what isn't a usable email, password or name", async () => {
		for (const email of ["", "rosa", "rosa@example", "ro sa@example.com", `${"a".repeat(250)}@x.io`, 42]) expect(await error(signUp({ email })), String(email)).toBe("email");
		expect(await error(signUp({ password: "short" }))).toBe("password_too_short");
		expect(await error(signUp({ password: "x".repeat(129) }))).toBe("password_too_long");
		expect(await error(signUp({ displayName: "bad\u0007name" }))).toBe("display_name");
		expect(await error(signUp({ displayName: 7 }))).toBe("display_name");
		expect(db.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 0 });
	});

	it("refuses a password known from a breach", async () => {
		// SHA-1 of PASSWORD, split into the range asked for and the suffix in the reply.
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(PASSWORD)));
		const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
		outside = async (url) => {
			expect(url).toBe(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`);
			return new Response(`${hex.slice(5)}:42\r\n`);
		};
		expect(await error(signUp({}))).toBe("password_breached");
	});

	it("goes ahead when the breach check can't be reached", async () => {
		outside = async () => { throw new TypeError("network"); };
		expect(await status(signUp({}))).toBe(201);
	});

	it("only takes requests from the game's own page, as JSON", async () => {
		expect(await status(post("/api/auth/signup", { email: "a@b.co", password: PASSWORD }, { origin: "https://evil.test" }))).toBe(403);
		expect(await status(post("/api/auth/signup", { email: "a@b.co", password: PASSWORD }, { "content-type": "text/plain" }))).toBe(415);
	});

	it("is rate limited per address", async () => {
		env.AUTH_LIMITER = { limit: async () => ({ success: false }) };
		const response = await signUp({});
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("60");
	});
});

describe("sign-in", () => {
	beforeEach(async () => {
		await signUp({}, new CookieJar());
	});

	it("signs in with the right password, whatever the email's case", async () => {
		const response = await signIn("  ROSA@example.com", PASSWORD);
		expect(response.status).toBe(200);
		expect((await response.json()).user.email).toBe("rosa@example.com");
		expect(jar.get(SESSION)).toBeDefined();
	});

	it("says the same thing for a wrong password, an unknown email and an account with no password", async () => {
		await createUser(env, { email: "google-only@example.com", displayName: "G", emailVerified: true });
		for (const [email, password] of [["rosa@example.com", "wrong password!"], ["nobody@example.com", PASSWORD], ["google-only@example.com", PASSWORD], ["not an email", PASSWORD]]) {
			const response = await signIn(email, password);
			expect(response.status, email).toBe(401);
			expect(await response.json()).toEqual({ error: "invalid_credentials" });
		}
		expect(jar.get(SESSION)).toBeUndefined();
	});

	it("stops taking passwords for 15 minutes after 10 wrong ones in a row", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
		for (let i = 0; i < 10; i++) expect(await status(signIn("rosa@example.com", `wrong guess ${i}`))).toBe(401);
		const locked = await signIn("rosa@example.com", PASSWORD);
		expect(locked.status).toBe(429);
		expect(await locked.json()).toEqual({ error: "try_later" });
		expect(Number(locked.headers.get("retry-after"))).toBe(15 * 60);

		vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1);
		expect(await status(signIn("rosa@example.com", PASSWORD))).toBe(200);
	});

	it("forgets earlier wrong passwords once the right one is used", async () => {
		for (let i = 0; i < 9; i++) await signIn("rosa@example.com", `wrong guess ${i}`);
		await signIn("rosa@example.com", PASSWORD);
		expect(db.prepare("SELECT failed_logins FROM users").get()).toEqual({ failed_logins: 0 });
		expect(await status(signIn("rosa@example.com", "wrong again!"))).toBe(401);
		expect(await status(signIn("rosa@example.com", PASSWORD))).toBe(200);
	});

	it("is rate limited per address and per email", async () => {
		const keys: string[] = [];
		env.AUTH_LIMITER = { limit: async ({ key }) => (keys.push(key), { success: !key.includes("@") }) };
		expect(await status(signIn("rosa@example.com", PASSWORD))).toBe(429);
		expect(keys).toEqual(["signin:local", "signin:rosa@example.com"]);
	});

	it("upgrades an older, weaker password hash on sign-in", async () => {
		const salt = new Uint8Array(16);
		const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(PASSWORD), "PBKDF2", false, ["deriveBits"]);
		const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 }, key, 256));
		const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
		db.prepare("UPDATE users SET password_hash = ?").run(`pbkdf2-sha256$1000$${b64(salt)}$${b64(hash)}`);
		expect(await status(signIn("rosa@example.com", PASSWORD))).toBe(200);
		expect((db.prepare("SELECT password_hash FROM users").get() as { password_hash: string }).password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
	});

	it("refuses other methods", async () => {
		const response = await handleApi(new Request(`${ORIGIN}/api/auth/signin`), env);
		expect(response.status).toBe(405);
	});
});

describe("Turnstile, once its secret is set", () => {
	beforeEach(() => {
		env.TURNSTILE_SECRET = "test-secret";
	});

	const turnstile = (result: Record<string, unknown> | Error) => {
		outside = async (url, init) => {
			if (url.startsWith("https://api.pwnedpasswords.com/")) return new Response("");
			expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
			const form = init?.body as FormData;
			expect(form.get("secret")).toBe("test-secret");
			expect(form.get("response")).toBe("token-from-widget");
			if (result instanceof Error) throw result;
			return Response.json(result);
		};
	};

	it("lets a passed challenge through", async () => {
		turnstile({ success: true, hostname: "game.test" });
		expect(await status(signUp({ turnstileToken: "token-from-widget" }))).toBe(201);
		expect(await status(signIn("rosa@example.com", PASSWORD, { turnstileToken: "token-from-widget" }))).toBe(200);
	});

	it("refuses no challenge, a failed one, one for another site, or one that can't be checked", async () => {
		expect(await error(signUp({}))).toBe("turnstile");
		for (const result of [{ success: false }, { success: true, hostname: "evil.test" }, new Error("down")]) {
			turnstile(result);
			expect(await error(signUp({ turnstileToken: "token-from-widget" }))).toBe("turnstile");
		}
		expect(await error(signIn("rosa@example.com", PASSWORD))).toBe("turnstile");
	});
});
