import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleApi, type Env } from "../../../../worker/index";
import { CookieJar, memoryDatabase } from "../../../../worker/testing";
import { CloudSave } from "./CloudSave";
import type { MissionDefinition } from "./MissionDirector";
import { addCash, collect, parseProgress, readProgress, recordPass, resetProgress, setProgressStorage } from "./Progress";
import { mergeSaves } from "./SaveMerge";
import { canonicalSave, SAVE_SCHEMA_VERSION, type SaveData } from "./SaveSchema";

const ORIGIN = "https://game.test";
const PROGRESS_KEY = "orion.progress.v1";

class MemoryStorage {
	public readonly items = new Map<string, string>();
	public getItem(key: string) {
		return this.items.get(key) ?? null;
	}
	public setItem(key: string, value: string) {
		this.items.set(key, value);
	}
	public removeItem(key: string) {
		this.items.delete(key);
	}
}

const mission = (id: string, cash: number): MissionDefinition => ({
	id, title: id, giver: { name: "", x: 0, z: 0 }, briefing: "", reward: { cash }, objectives: [],
});
const newGame = (): SaveData => canonicalSave(parseProgress(null) as SaveData);

let storage: MemoryStorage;
let env: Env;
let jar: CookieJar;
let puts: number;
let gets: number;
let online: boolean;
/** Make the network fail: before the server sees the request, or after (the reply lost). */
let failure: "none" | "before" | "after" | "down";
let clients: CloudSave[];

async function serverFetch(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
	if (failure === "before" || failure === "down") throw new TypeError("Failed to fetch");
	const method = init.method ?? "GET";
	if (method === "PUT") puts++;
	else gets++;
	const headers = new Headers(init.headers);
	headers.set("cookie", jar.header());
	if (method !== "GET") headers.set("origin", ORIGIN);
	const response = await handleApi(new Request(`${ORIGIN}${String(url)}`, { method, headers, body: init.body as string | undefined }), env);
	jar.take(response);
	if (failure === "after") throw new TypeError("Failed to fetch");
	return response;
}

function client(): CloudSave {
	const made = new CloudSave({ fetch: serverFetch as typeof fetch, online: () => online, random: () => 1 });
	clients.push(made);
	return made;
}

async function serverSave(): Promise<{ revision: number; save: SaveData | null }> {
	const response = await handleApi(new Request(`${ORIGIN}/api/save`, { headers: { cookie: jar.header() } }), env);
	return response.json();
}

/** Another tab (same guest) saving straight to the server. */
async function otherTabSaves(save: SaveData, baseRevision: number): Promise<void> {
	const response = await handleApi(new Request(`${ORIGIN}/api/save`, {
		method: "PUT",
		headers: { cookie: jar.header(), origin: ORIGIN, "content-type": "application/json" },
		body: JSON.stringify({ baseRevision, schemaVersion: SAVE_SCHEMA_VERSION, writeId: `other-tab-${baseRevision}`, save }),
	}), env);
	expect(response.status).toBe(200);
}

/** Lets real async work (hashing in the API) finish; fake timers alone don't wait for it. */
async function flushReal(): Promise<void> {
	// Real time (node:timers/promises isn't faked), for hashing that runs off the main thread.
	await sleep(2);
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Moves the clock on in steps, letting each step's requests finish. */
async function advance(ms: number, step = 250): Promise<void> {
	for (let passed = 0; passed < ms; passed += step) {
		await flushReal();
		await vi.advanceTimersByTimeAsync(Math.min(step, ms - passed));
	}
	await flushReal();
}

const settle = () => advance(15_000);

// Each test waits on real time in small steps (see flushReal); a busy machine running the whole
// suite in parallel needs more than the default five seconds for that.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
	storage = new MemoryStorage();
	setProgressStorage(storage);
	env = memoryDatabase().env;
	jar = new CookieJar();
	puts = 0;
	gets = 0;
	online = true;
	failure = "none";
	clients = [];
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	for (const made of clients) made.stop();
	setProgressStorage(undefined);
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("cloud save", () => {
	it("a new player with nothing to save makes one request and writes nothing", async () => {
		const cloud = client();
		cloud.start();
		await settle();
		expect(gets).toBe(1);
		expect(puts).toBe(0);
		expect(cloud.state()).toBe("synced");
		expect((await serverSave()).save).toBeNull();
	});

	it("uploads an existing local save the first time, and leaves the local one in place", async () => {
		const local = { ...newGame(), cash: 4200, passed: ["first-job"], flags: ["dez-owes"] };
		storage.setItem(PROGRESS_KEY, JSON.stringify(local));
		const before = storage.getItem(PROGRESS_KEY);
		client().start();
		await settle();
		expect(puts).toBe(1);
		const server = await serverSave();
		expect(server.revision).toBe(1);
		expect(server.save).toMatchObject({ cash: 4200, passed: ["first-job"], flags: ["dez-owes"] });
		expect(storage.getItem(PROGRESS_KEY)).toBe(before);
	});

	it("loads cloud progress into a browser whose local storage was cleared", async () => {
		addCash(500);
		const first = client();
		first.start();
		await settle();
		first.stop();
		// Site storage cleared, the cookie kept (what Safari does to script storage after a week).
		storage.items.clear();
		setProgressStorage(storage);
		expect(readProgress().cash).toBe(0);
		client().start();
		await settle();
		expect(readProgress().cash).toBe(500);
	});

	it("keeps local progress, and keeps playing, while the server can't be reached", async () => {
		addCash(300);
		failure = "down";
		const cloud = client();
		cloud.start();
		await advance(10 * 60_000, 30_000);
		expect(cloud.state()).not.toBe("synced");
		recordPass(mission("m1", 100), 30);
		expect(readProgress().cash).toBe(400);
		expect(JSON.parse(storage.getItem(PROGRESS_KEY)!).cash).toBe(400);
		// Back: it catches up.
		failure = "none";
		cloud.online();
		await settle();
		expect((await serverSave()).save?.cash).toBe(400);
	});

	it("gives up retrying after a few tries rather than hammering a dead server", async () => {
		failure = "down";
		let attempts = 0;
		const counting = new CloudSave({ fetch: (async (...args: Parameters<typeof fetch>) => { attempts++; return serverFetch(...args); }) as typeof fetch, online: () => true, random: () => 1 });
		clients.push(counting);
		counting.start();
		await advance(60 * 60_000, 30_000);
		expect(attempts).toBe(7);
		expect(counting.state()).toBe("offline");
	});

	it("doesn't try while offline, and syncs what was earned once back online", async () => {
		const cloud = client();
		cloud.start();
		await settle();
		online = false;
		addCash(50);
		collect("manifest-1", 25);
		await settle();
		expect(puts).toBe(0);
		online = true;
		cloud.online();
		await settle();
		expect(puts).toBe(1);
		expect((await serverSave()).save).toMatchObject({ cash: 75, collected: ["manifest-1"] });
	});

	it("sends a burst of changes as one request", async () => {
		const cloud = client();
		cloud.start();
		await settle();
		for (let i = 0; i < 5; i++) {
			addCash(10);
			await advance(300);
		}
		await settle();
		expect(puts).toBe(1);
		expect((await serverSave()).save?.cash).toBe(50);
	});

	it("doesn't wait forever on a steady trickle of changes", async () => {
		const cloud = client();
		cloud.start();
		await settle();
		for (let i = 0; i < 12; i++) {
			addCash(1);
			await advance(1000);
		}
		expect(puts).toBeGreaterThanOrEqual(1);
	});

	it("merges with a save made in another tab instead of overwriting it, without paying anything twice", async () => {
		addCash(100);
		const cloud = client();
		cloud.start();
		await settle();
		// The other tab passes a mission (+1000) on top of revision 1.
		await otherTabSaves({ ...newGame(), cash: 1100, passed: ["other-tab"] }, 1);
		// This tab earns 250 meanwhile, from the same 100.
		recordPass(mission("this-tab", 250), 40);
		await settle();
		const server = await serverSave();
		expect(server.save?.cash).toBe(1350);
		expect(server.save?.passed.sort()).toEqual(["other-tab", "this-tab"]);
		expect(readProgress().cash).toBe(1350);
		expect(readProgress().passed).toContain("other-tab");
	});

	it("a retried save whose reply was lost lands once, not twice", async () => {
		const cloud = client();
		cloud.start();
		await settle();
		recordPass(mission("big-job", 5000), 60);
		failure = "after";
		await advance(3000);
		failure = "none";
		await settle();
		const server = await serverSave();
		expect(server.revision).toBe(1);
		expect(server.save?.cash).toBe(5000);
		expect(readProgress().cash).toBe(5000);
	});

	it("a mission passed twice only pays once, locally and in the cloud", async () => {
		const cloud = client();
		cloud.start();
		await settle();
		recordPass(mission("once", 800), 20);
		recordPass(mission("once", 800), 18);
		await settle();
		expect((await serverSave()).save?.cash).toBe(800);
	});

	it("a new game resets the cloud copy too", async () => {
		addCash(900);
		const cloud = client();
		cloud.start();
		await settle();
		resetProgress();
		await settle();
		expect((await serverSave()).save).toEqual(newGame());
		expect(readProgress().cash).toBe(0);
	});

	it("puts a different guest's cached save aside instead of uploading it", async () => {
		addCash(100);
		const cloud = client();
		cloud.start();
		await settle();
		cloud.stop();
		// A different guest, who already has a save of their own.
		jar.clear();
		await serverFetch("/api/save");
		await otherTabSaves({ ...newGame(), cash: 9 }, 0);
		client().start();
		await settle();
		expect(readProgress().cash).toBe(9);
		expect((await serverSave()).save?.cash).toBe(9);
		expect(JSON.parse(storage.getItem("orion.progress.v1.backup")!).cash).toBe(100);
	});

	it("stays out of the way where there's no save API (next dev): the game saves locally as always", async () => {
		const cloud = new CloudSave({ fetch: (async () => new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } })) as typeof fetch, online: () => true });
		clients.push(cloud);
		cloud.start();
		await settle();
		expect(cloud.state()).toBe("disabled");
		addCash(10);
		await settle();
		expect(readProgress().cash).toBe(10);
		expect(JSON.parse(storage.getItem(PROGRESS_KEY)!).cash).toBe(10);
	});

	it("never applies a malformed reply from the server", async () => {
		addCash(70);
		const cloud = new CloudSave({ fetch: (async () => Response.json({ owner: "0123456789abcdef", revision: 3, save: { cash: -5 } })) as typeof fetch, online: () => true });
		clients.push(cloud);
		cloud.start();
		await settle();
		expect(cloud.state()).toBe("disabled");
		expect(readProgress().cash).toBe(70);
	});
});

describe("merging saves", () => {
	const base = { ...newGame(), cash: 100, jobs: 1, passed: ["a"], bestTimes: { a: 50 }, ratings: { a: 1 } };

	it("adds up what each side earned since they last agreed", () => {
		const local = { ...base, cash: 150, jobs: 2, passed: ["a", "b"], bestTimes: { a: 40 } };
		const server = { ...base, cash: 400, passed: ["a", "c"], ratings: { a: 3 }, rep: { ...base.rep, law: 2 } };
		const merged = mergeSaves(base, local, server);
		expect(merged.cash).toBe(450);
		expect(merged.jobs).toBe(2);
		expect(merged.passed.sort()).toEqual(["a", "b", "c"]);
		expect(merged.bestTimes).toEqual({ a: 40 });
		expect(merged.ratings).toEqual({ a: 3 });
		expect(merged.rep.law).toBe(2);
	});

	it("never adds up when there's nothing known in common", () => {
		const merged = mergeSaves(null, { ...base, cash: 150 }, { ...base, cash: 120 });
		expect(merged.cash).toBe(150);
	});

	it("keeps standing within its limits", () => {
		const merged = mergeSaves(base, { ...base, rep: { ...base.rep, street: 8 } }, { ...base, rep: { ...base.rep, street: 7 } });
		expect(merged.rep.street).toBe(10);
	});
});

describe("where requests come from", () => {
	it("only the cloud save and the account pages talk to the API: nothing in the frame, physics, traffic or AI code does", () => {
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const name of readdirSync(dir)) {
				const path = join(dir, name);
				if (statSync(path).isDirectory()) walk(path);
				else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) files.push(path);
			}
		};
		walk(join(__dirname, "..", "..", ".."));
		const talking = files.filter((path) => readFileSync(path, "utf8").includes("/api/")).map((path) => path.replace(/\\/g, "/").replace(/^.*\/src\//, "src/"));
		// authApi runs only on the sign-in pages and the landing header, never in the game.
		expect(talking.sort()).toEqual(["src/components/account/authApi.ts", "src/engine/orion/missions/CloudSave.ts"]);
		const progress = readFileSync(join(__dirname, "Progress.ts"), "utf8");
		expect(progress).not.toMatch(/fetch\(/);
	}, 30_000);
});
