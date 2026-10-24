import { beforeEach, describe, expect, it } from "vitest";

import { parseProgress } from "../src/engine/orion/missions/Progress";
import { canonicalSave, MAX_SAVE_CHARS, SAVE_SCHEMA_VERSION, type SaveData } from "../src/engine/orion/missions/SaveSchema";
import worker, { handleApi, type Env } from "./index";
import { CookieJar, memoryDatabase } from "./testing";

const ORIGIN = "https://game.test";

const newGame = (): SaveData => canonicalSave(parseProgress(null) as SaveData);
const played = (extra: Partial<SaveData> = {}): SaveData => ({ ...newGame(), cash: 1200, passed: ["first-job"], flags: ["dez-owes"], ...extra });

let env: Env;
let jar: CookieJar;
let writes = 0;

beforeEach(() => {
	env = memoryDatabase().env;
	jar = new CookieJar();
	writes = 0;
});

async function get(cookies = jar): Promise<Response> {
	const response = await handleApi(new Request(`${ORIGIN}/api/save`, { headers: { cookie: cookies.header() } }), env);
	cookies.take(response);
	return response;
}

function putRequest(body: unknown, headers: Record<string, string> = {}, cookies = jar): Request {
	return new Request(`${ORIGIN}/api/save`, {
		method: "PUT",
		headers: { cookie: cookies.header(), origin: ORIGIN, "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

async function put(save: SaveData, baseRevision: number, cookies = jar, writeId = `write-${++writes}-0000`): Promise<Response> {
	return handleApi(putRequest({ baseRevision, schemaVersion: SAVE_SCHEMA_VERSION, writeId, save }, {}, cookies), env);
}

describe("save api", () => {
	it("hands a new guest an empty save and a secure HttpOnly cookie, without writing anything", async () => {
		const response = await get();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ revision: 0, save: null, schemaVersion: SAVE_SCHEMA_VERSION });
		const cookie = response.headers.get("set-cookie")!;
		expect(cookie).toMatch(/^__Host-orion_guest=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("uses a non-Secure cookie only on plain-http localhost", async () => {
		const response = await handleApi(new Request("http://localhost:8787/api/save"), env);
		expect(response.headers.get("set-cookie")).toMatch(/^orion_guest=.*SameSite=Lax$/);
	});

	it("saves and loads a guest's progress, a revision at a time", async () => {
		await get();
		expect((await put(played(), 0)).status).toBe(200);
		const loaded = await (await get()).json();
		expect(loaded.revision).toBe(1);
		expect(loaded.save).toEqual(played());
		const second = await put(played({ cash: 5000 }), 1);
		expect(await second.json()).toEqual({ revision: 2 });
		expect((await (await get()).json()).save.cash).toBe(5000);
	});

	it("keeps the same guest across visits", async () => {
		const first = await (await get()).json();
		const again = await (await get()).json();
		expect(again.owner).toBe(first.owner);
		expect(first.owner).toMatch(/^[0-9a-f]{16}$/);
	});

	it("refuses a stale write and hands back what's there now", async () => {
		await get();
		await put(played(), 0);
		await put(played({ cash: 3000 }), 1);
		const stale = await put(played({ cash: 9999 }), 1);
		expect(stale.status).toBe(409);
		expect(await stale.json()).toMatchObject({ error: "conflict", revision: 2, save: { cash: 3000 } });
		// A second first-save can't replace the existing one either.
		expect((await put(played({ cash: 1 }), 0)).status).toBe(409);
		expect((await (await get()).json()).save.cash).toBe(3000);
	});

	it("treats a retried write that already landed as done, not a conflict, and doesn't apply it twice", async () => {
		await get();
		expect((await put(played(), 0, jar, "retry-me")).status).toBe(200);
		const retry = await put(played(), 0, jar, "retry-me");
		expect(retry.status).toBe(200);
		expect(await retry.json()).toEqual({ revision: 1, replayed: true });
		expect((await (await get()).json()).revision).toBe(1);
	});

	it("keeps guests apart: one can't read or overwrite another's save", async () => {
		const other = new CookieJar();
		await get();
		await get(other);
		await put(played({ cash: 777 }), 0);
		const theirs = await (await get(other)).json();
		expect(theirs.save).toBeNull();
		// Whatever the body says, a write goes to the cookie's own save.
		const response = await handleApi(putRequest({ baseRevision: 0, schemaVersion: SAVE_SCHEMA_VERSION, writeId: "x-12345678", save: played({ cash: 1 }), guest: "someone-else" }, {}, other), env);
		expect(response.status).toBe(200);
		expect((await (await get()).json()).save.cash).toBe(777);
	});

	it("treats a forged or malformed cookie as nobody", async () => {
		const forged = new Request(`${ORIGIN}/api/save`, {
			method: "PUT",
			headers: { cookie: "__Host-orion_guest=not-a-token", origin: ORIGIN, "content-type": "application/json" },
			body: JSON.stringify({ baseRevision: 0, schemaVersion: SAVE_SCHEMA_VERSION, writeId: "w-12345678", save: played() }),
		});
		expect((await handleApi(forged, env)).status).toBe(401);
	});

	describe("refuses", () => {
		beforeEach(async () => {
			await get();
		});

		const body = (save: unknown, extra: Record<string, unknown> = {}) => ({ baseRevision: 0, schemaVersion: SAVE_SCHEMA_VERSION, writeId: "w-12345678", save, ...extra });
		const status = async (request: Request) => (await handleApi(request, env)).status;

		it("writes from another origin, or with no origin at all", async () => {
			expect(await status(putRequest(body(played()), { origin: "https://evil.test" }))).toBe(403);
			const bare = new Request(`${ORIGIN}/api/save`, { method: "PUT", headers: { cookie: jar.header(), "content-type": "application/json" }, body: JSON.stringify(body(played())) });
			expect(await status(bare)).toBe(403);
		});

		it("anything but JSON", async () => {
			expect(await status(putRequest(body(played()), { "content-type": "text/plain" }))).toBe(415);
			expect(await status(putRequest("{not json"))).toBe(400);
			expect(await status(putRequest("[]"))).toBe(400);
		});

		it("a write with no guest", async () => {
			expect(await status(putRequest(body(played()), { cookie: "" }))).toBe(401);
		});

		it("malformed saves", async () => {
			const bad: unknown[] = [
				null,
				{ ...played(), cash: -1 },
				{ ...played(), cash: 1.5 },
				{ ...played(), cash: "100" },
				{ ...played(), weapons: ["fists", "railgun"] },
				{ ...played(), passed: ["a", "a"] },
				{ ...played(), passed: ["bad\u0000id"] },
				{ ...played(), rep: { ...newGame().rep, street: 11 } },
				{ ...played(), ratings: { "first-job": 4 } },
				{ ...played(), bestTimes: { "first-job": -3 } },
				{ ...played(), garage: [{ id: "car", style: "sedan" }] },
				{ ...played(), admin: true },
				Object.fromEntries(Object.entries(played()).filter(([key]) => key !== "jobs")),
			];
			for (const save of bad) expect(await status(putRequest(body(save))), JSON.stringify(save)).toBe(400);
			expect(await status(putRequest(body(played(), { baseRevision: -1 })))).toBe(400);
			expect(await status(putRequest(body(played(), { schemaVersion: 99 })))).toBe(400);
			expect(await status(putRequest(body(played(), { writeId: "x" })))).toBe(400);
		});

		it("oversized requests", async () => {
			const huge = { ...played(), flags: Array.from({ length: 400 }, (_, i) => `flag-${i}-${"x".repeat(50)}`) };
			expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_SAVE_CHARS);
			expect(await status(putRequest(body(huge)))).toBe(413);
		});

		it("other paths and methods", async () => {
			expect(await status(new Request(`${ORIGIN}/api/other`))).toBe(404);
			expect(await status(new Request(`${ORIGIN}/api/save`, { method: "DELETE", headers: { origin: ORIGIN } }))).toBe(405);
		});

		it("too many writes, when the limiter says so", async () => {
			env.SAVE_LIMITER = { limit: async () => ({ success: false }) };
			const response = await handleApi(putRequest(body(played())), env);
			expect(response.status).toBe(429);
			expect(response.headers.get("retry-after")).toBe("10");
		});
	});

	it("serves everything outside /api/ from the static assets", async () => {
		env.ASSETS = { fetch: async () => new Response("asset") };
		const response = await worker.fetch(new Request(`${ORIGIN}/play`), env);
		expect(await response.text()).toBe("asset");
	});
});
