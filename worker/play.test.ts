import { beforeEach, describe, expect, it } from "vitest";

import { createUser, startSession } from "./auth";
import { json } from "./http";
import worker, { isPlayPath, type Env } from "./index";
import { CookieJar, memoryDatabase } from "./testing";

const ORIGIN = "https://game.test";

let env: Env;
let jar: CookieJar;
let served: string[];

beforeEach(() => {
	env = memoryDatabase().env;
	jar = new CookieJar();
	served = [];
	env.ASSETS = {
		fetch: async (request: Request) => {
			served.push(new URL(request.url).pathname);
			return new Response("<html>the game</html>", { headers: { "content-type": "text/html", "cache-control": "public, max-age=0, must-revalidate" } });
		},
	};
});

const visit = (path: string, cookies = jar) => worker.fetch(new Request(`${ORIGIN}${path}`, { headers: { cookie: cookies.header() } }), env);

async function signIn(): Promise<void> {
	const id = await createUser(env, { email: "rosa@example.com", displayName: "Rosa", emailVerified: true });
	const request = new Request(`${ORIGIN}/api/auth/test`);
	jar.take(json({}, 200, {}, await startSession(request, new URL(request.url), env, id)));
}

describe("the game page", () => {
	it("sends a signed-out visitor to sign in, and back to the game after", async () => {
		const response = await visit("/play");
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(`${ORIGIN}/signin?return=%2Fplay`);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(served).toEqual([]);
	});

	it("serves the game to a signed-in player, marked private and uncacheable", async () => {
		await signIn();
		const response = await visit("/play");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>the game</html>");
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(served).toEqual(["/play"]);
	});

	it("treats a forged or expired session as signed out, and clears it", async () => {
		const forged = new CookieJar();
		forged.take(json({}, 200, {}, ["__Host-orion_session=" + "A".repeat(43) + "; Path=/"]));
		const response = await visit("/play", forged);
		expect(response.status).toBe(302);
		expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-orion_session=; .*Max-Age=0/);
	});

	it("covers the files Next fetches for the page, and nothing else", async () => {
		for (const path of ["/play", "/play.html", "/play.txt", "/play/__next.play.__PAGE__.txt"]) expect(isPlayPath(path), path).toBe(true);
		for (const path of ["/", "/playground", "/signin", "/api/save", "/models/car.glb"]) expect(isPlayPath(path), path).toBe(false);
		expect((await visit("/play/__next.play.__PAGE__.txt")).status).toBe(302);
		expect((await visit("/")).status).toBe(200);
	});
});
