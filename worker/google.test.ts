import type { DatabaseSync } from "node:sqlite";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { newGameSave } from "../src/engine/orion/missions/SaveMerge";
import { SAVE_SCHEMA_VERSION } from "../src/engine/orion/missions/SaveSchema";
import { createUser, startSession } from "./auth";
import { forgetGoogleKeys } from "./google";
import { json } from "./http";
import { handleApi, type Env } from "./index";
import { hashPassword } from "./password";
import { CookieJar, memoryDatabase } from "./testing";

const ORIGIN = "https://game.test";
const CLIENT_ID = "client-123.apps.googleusercontent.com";
const SESSION = "__Host-orion_session";
const FLOW = "__Host-orion_oauth";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64json = (value: unknown) => b64(new TextEncoder().encode(JSON.stringify(value)));

let googleKeys: CryptoKeyPair;
let strangerKeys: CryptoKeyPair;
let publicJwk: JsonWebKey;

beforeAll(async () => {
	const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;
	googleKeys = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
	strangerKeys = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
	publicJwk = await crypto.subtle.exportKey("jwk", googleKeys.publicKey);
});

async function idToken(claims: Record<string, unknown>, { key = googleKeys.privateKey, header = { alg: "RS256", kid: "key-1", typ: "JWT" } }: { key?: CryptoKey; header?: Record<string, unknown> } = {}): Promise<string> {
	const body = `${b64json(header)}.${b64json(claims)}`;
	const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body)));
	return `${body}.${b64(signature)}`;
}

let env: Env;
let db: DatabaseSync;
let jar: CookieJar;
/** What Google's token endpoint is asked, and the ID token it hands back. */
let exchanges: URLSearchParams[];
let issue: (nonce: string) => Promise<string | null>;
let keyFetches: number;

beforeEach(() => {
	({ env, db } = memoryDatabase());
	env.GOOGLE_CLIENT_ID = CLIENT_ID;
	env.GOOGLE_CLIENT_SECRET = "shh";
	jar = new CookieJar();
	exchanges = [];
	keyFetches = 0;
	forgetGoogleKeys();
	issue = (nonce) => idToken(claimsFor(nonce));
	vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url === "https://www.googleapis.com/oauth2/v3/certs") {
			keyFetches++;
			return Response.json({ keys: [{ ...publicJwk, kid: "key-1", alg: "RS256", use: "sig" }] }, { headers: { "cache-control": "public, max-age=3600" } });
		}
		if (url === "https://oauth2.googleapis.com/token") {
			const body = new URLSearchParams(String(init?.body));
			exchanges.push(body);
			const token = await issue(lastNonce);
			return token === null ? Response.json({ error: "invalid_grant" }, { status: 400 }) : Response.json({ id_token: token, access_token: "unused" });
		}
		throw new Error(`unexpected fetch ${url}`);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

let lastNonce = "";

const claimsFor = (nonce: string, extra: Record<string, unknown> = {}) => ({
	iss: "https://accounts.google.com",
	aud: CLIENT_ID,
	sub: "google-sub-1",
	email: "Rosa@Gmail.com",
	email_verified: true,
	name: "Rosa Vega",
	nonce,
	iat: Math.floor(Date.now() / 1000),
	exp: Math.floor(Date.now() / 1000) + 3600,
	...extra,
});

async function get(path: string, cookies = jar): Promise<Response> {
	const response = await handleApi(new Request(`${ORIGIN}${path}`, { headers: { cookie: cookies.header() } }), env);
	cookies.take(response);
	return response;
}

/** Sends the browser to Google; returns where Google was asked to send it back with. */
async function begin(returnTo = "/play", cookies = jar) {
	const response = await get(`/api/auth/google/start?return=${encodeURIComponent(returnTo)}`, cookies);
	const google = new URL(response.headers.get("location")!);
	lastNonce = google.searchParams.get("nonce") ?? "";
	return { response, google, state: google.searchParams.get("state")! };
}

/** The whole round trip, as if the player picked their account at Google. */
async function signInWithGoogle(returnTo = "/play", cookies = jar): Promise<Response> {
	const { state } = await begin(returnTo, cookies);
	return get(`/api/auth/google/callback?state=${state}&code=auth-code-1`, cookies);
}

const errorOf = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("error");
const me = async (cookies = jar) => (await (await get("/api/auth/me", cookies)).json()).user;

describe("Google sign-in", () => {
	it("says whether it's offered", async () => {
		expect(await (await get("/api/auth/options")).json()).toEqual({ google: true });
		env.GOOGLE_CLIENT_SECRET = undefined;
		expect(await (await get("/api/auth/options")).json()).toEqual({ google: false });
	});

	it("sends the player to Google with PKCE, a state and a nonce, remembered in a short-lived HttpOnly cookie", async () => {
		const { response, google, state } = await begin("/play?from=nav");
		expect(response.status).toBe(303);
		expect(`${google.origin}${google.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(Object.fromEntries(google.searchParams)).toMatchObject({
			client_id: CLIENT_ID,
			redirect_uri: `${ORIGIN}/api/auth/google/callback`,
			response_type: "code",
			scope: "openid email profile",
			code_challenge_method: "S256",
			prompt: "select_account",
		});
		expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(lastNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const cookie = response.headers.getSetCookie()[0];
		expect(cookie).toMatch(new RegExp(`^${FLOW}=[A-Za-z0-9_-]+; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$`));
	});

	it("makes a confirmed account for a new player, signs them in and takes them where they were going", async () => {
		const response = await signInWithGoogle("/play?from=nav");
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(`${ORIGIN}/play?from=nav`);
		expect(jar.get(SESSION)).toBeDefined();
		expect(jar.get(FLOW)).toBeUndefined();
		expect(await me()).toEqual({ email: "rosa@gmail.com", emailVerified: true, displayName: "Rosa Vega", hasPassword: false, providers: ["google"] });

		// The code was swapped with the secret and the PKCE verifier whose hash went to Google.
		const [exchange] = exchanges;
		expect(Object.fromEntries(exchange)).toMatchObject({ code: "auth-code-1", client_id: CLIENT_ID, client_secret: "shh", grant_type: "authorization_code", redirect_uri: `${ORIGIN}/api/auth/google/callback` });
		const sent = new URL((await begin()).google).searchParams;
		expect(sent.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("checks the PKCE verifier against the challenge it sent", async () => {
		const { google, state } = await begin();
		await get(`/api/auth/google/callback?state=${state}&code=c`);
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exchanges[0].get("code_verifier")!)));
		expect(b64(digest)).toBe(google.searchParams.get("code_challenge"));
	});

	it("finds the same account next time by Google's id, even if the email changed", async () => {
		await signInWithGoogle();
		issue = (nonce) => idToken(claimsFor(nonce, { email: "rosa.vega@gmail.com" }));
		const other = new CookieJar();
		await signInWithGoogle("/play", other);
		expect(db.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
		expect((await me(other)).email).toBe("rosa@gmail.com");
	});

	it("links to an account whose email is confirmed, keeping its password", async () => {
		const id = await createUser(env, { email: "rosa@gmail.com", displayName: "Rosa", emailVerified: true, passwordHash: await hashPassword("neon palms at dusk") });
		await signInWithGoogle();
		expect(await me()).toMatchObject({ displayName: "Rosa", hasPassword: true, providers: ["google"] });
		expect(db.prepare("SELECT user_id FROM oauth_accounts").get()).toEqual({ user_id: id });
	});

	it("takes over an account whose email was never confirmed: its password and sessions go", async () => {
		// Someone signed up with Rosa's address and a password of their own, before she did.
		const squatter = new CookieJar();
		const id = await createUser(env, { email: "rosa@gmail.com", displayName: "Not Rosa", emailVerified: false, passwordHash: await hashPassword("squatter's password") });
		const request = new Request(`${ORIGIN}/api/auth/test`);
		squatter.take(json({}, 200, {}, await startSession(request, new URL(request.url), env, id)));
		expect(await me(squatter)).not.toBeNull();

		await signInWithGoogle();
		expect(await me()).toMatchObject({ emailVerified: true, hasPassword: false, providers: ["google"] });
		expect(await me(squatter)).toBeNull();
	});

	it("brings the guest's progress into the account", async () => {
		await get("/api/save");
		const save = { ...newGameSave(), cash: 640 };
		await handleApi(new Request(`${ORIGIN}/api/save`, {
			method: "PUT",
			headers: { cookie: jar.header(), origin: ORIGIN, "content-type": "application/json" },
			body: JSON.stringify({ baseRevision: 0, schemaVersion: SAVE_SCHEMA_VERSION, writeId: "write-1-0000", save }),
		}), env);
		await signInWithGoogle();
		expect((await (await get("/api/save")).json()).save.cash).toBe(640);
	});

	describe("goes back to /signin, signed out, when", () => {
		const refusedWith = async (response: Response, error: string) => {
			expect(response.status).toBe(303);
			expect(new URL(response.headers.get("location")!).pathname).toBe("/signin");
			expect(errorOf(response)).toBe(error);
			expect(jar.get(SESSION)).toBeUndefined();
			expect(jar.get(FLOW)).toBeUndefined();
		};

		it("the player cancels at Google", async () => {
			const { state } = await begin("/play?x=1");
			const response = await get(`/api/auth/google/callback?state=${state}&error=access_denied`);
			await refusedWith(response, "google_cancelled");
			expect(new URL(response.headers.get("location")!).searchParams.get("return")).toBe("/play?x=1");
		});

		it("the state doesn't match, or the flow cookie is missing (a forged or replayed callback)", async () => {
			await begin();
			await refusedWith(await get("/api/auth/google/callback?state=someone-elses&code=c"), "google_failed");
			await refusedWith(await get("/api/auth/google/callback?state=x&code=c", new CookieJar()), "google_failed");
			expect(exchanges).toEqual([]);
		});

		it("Google won't swap the code", async () => {
			issue = async () => null;
			await refusedWith(await signInWithGoogle(), "google_failed");
		});

		it("the ID token isn't right in any way", async () => {
			const bad: ((nonce: string) => Promise<string>)[] = [
				(nonce) => idToken(claimsFor(nonce, { aud: "someone-else.apps.googleusercontent.com" })),
				(nonce) => idToken(claimsFor(nonce, { iss: "https://evil.test" })),
				(nonce) => idToken(claimsFor(nonce, { exp: Math.floor(Date.now() / 1000) - 3600 })),
				(nonce) => idToken(claimsFor(nonce, { iat: Math.floor(Date.now() / 1000) + 3600 })),
				() => idToken(claimsFor("another-sign-in's-nonce")),
				(nonce) => idToken(claimsFor(nonce), { key: strangerKeys.privateKey }),
				(nonce) => idToken(claimsFor(nonce), { header: { alg: "none", kid: "key-1" } }),
				(nonce) => idToken(claimsFor(nonce), { header: { alg: "RS256", kid: "unknown-key" } }),
				async (nonce) => `${b64json({ alg: "none" })}.${b64json(claimsFor(nonce))}.`,
				async () => "not.a.token",
			];
			for (const make of bad) {
				issue = make;
				await refusedWith(await signInWithGoogle(), "google_failed");
			}
			expect(db.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 0 });
		});

		it("Google hasn't confirmed the email", async () => {
			issue = (nonce) => idToken(claimsFor(nonce, { email_verified: false }));
			await refusedWith(await signInWithGoogle(), "google_unverified");
		});

		it("Google sign-in isn't set up", async () => {
			env.GOOGLE_CLIENT_ID = undefined;
			await refusedWith(await get("/api/auth/google/start"), "google_unavailable");
		});

		it("there have been too many attempts", async () => {
			env.AUTH_LIMITER = { limit: async () => ({ success: false }) };
			await refusedWith(await get("/api/auth/google/start"), "try_later");
		});
	});

	it("only ever returns to a path on this site", async () => {
		for (const target of ["//evil.test/x", "/\\evil.test", "https://evil.test", "javascript:alert(1)"]) {
			jar.clear();
			const response = await signInWithGoogle(target);
			expect(response.headers.get("location"), target).toBe(`${ORIGIN}/play`);
		}
	});

	it("fetches Google's keys once and reuses them", async () => {
		await signInWithGoogle();
		await signInWithGoogle("/play", new CookieJar());
		expect(keyFetches).toBe(1);
	});
});
