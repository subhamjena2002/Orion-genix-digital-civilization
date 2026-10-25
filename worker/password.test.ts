import { describe, expect, it } from "vitest";

import { hashPassword, isBreached, MAX_PASSWORD, MIN_PASSWORD, PASSWORD_ITERATIONS, passwordProblem, verifyPassword } from "./password";

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A hash made the way an older, weaker setting would have. */
async function weakHash(password: string, iterations: number): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
	const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
	return `pbkdf2-sha256$${iterations}$${base64url(salt)}$${base64url(hash)}`;
}

describe("passwords", () => {
	it("hashes with a fresh salt at full strength, and checks the right password only", async () => {
		const stored = await hashPassword("correct horse battery");
		expect(stored).toMatch(new RegExp(`^pbkdf2-sha256\\$${PASSWORD_ITERATIONS}\\$[A-Za-z0-9_-]{22}\\$[A-Za-z0-9_-]{43}$`));
		expect(stored).not.toContain("correct");
		expect(await hashPassword("correct horse battery")).not.toBe(stored);
		expect(await verifyPassword("correct horse battery", stored)).toEqual({ ok: true, rehash: false });
		expect(await verifyPassword("correct horse batterY", stored)).toEqual({ ok: false, rehash: false });
	});

	it("treats a password typed with composed or decomposed accents as the same", async () => {
		const stored = await hashPassword("café au lait!!");
		expect((await verifyPassword("café au lait!!", stored)).ok).toBe(true);
	});

	it("asks for a weaker stored hash to be replaced once the password is known to be right", async () => {
		const stored = await weakHash("old and weak pass", 1000);
		expect(await verifyPassword("old and weak pass", stored)).toEqual({ ok: true, rehash: true });
		expect(await verifyPassword("wrong", stored)).toEqual({ ok: false, rehash: false });
	});

	it("never matches a malformed stored hash", async () => {
		for (const stored of ["", "plain text", "pbkdf2-sha256$100000$short$short"]) expect((await verifyPassword("anything", stored)).ok).toBe(false);
	});

	it("asks for at least 10 characters, counted as characters", () => {
		expect(passwordProblem("a".repeat(MIN_PASSWORD - 1))).toBe("password_too_short");
		expect(passwordProblem("a".repeat(MIN_PASSWORD))).toBeNull();
		expect(passwordProblem("\u{1F697}".repeat(MIN_PASSWORD))).toBeNull();
		expect(passwordProblem("a".repeat(MAX_PASSWORD + 1))).toBe("password_too_long");
		expect(passwordProblem(" ".repeat(12))).toBe("password");
		expect(passwordProblem(12345678901)).toBe("password");
	});

	describe("breach check", () => {
		// SHA-1 of "password": 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8
		const reply = (body: string, status = 200) => async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe("https://api.pwnedpasswords.com/range/5BAA6");
			expect(new Headers(init?.headers).get("add-padding")).toBe("true");
			return new Response(body, { status });
		};

		it("sends only the first five characters of the hash, and spots a breached password", async () => {
			expect(await isBreached("password", reply("0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n"))).toBe(true);
		});

		it("doesn't count padding lines as breaches", async () => {
			expect(await isBreached("password", reply("1E4C9B93F3F0682250B6CF8331B7EE68FD8:0\r\n"))).toBe(false);
			expect(await isBreached("password", reply("0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n"))).toBe(false);
		});

		it("says it doesn't know when the service fails", async () => {
			expect(await isBreached("password", reply("", 503))).toBeNull();
			expect(await isBreached("password", async () => { throw new TypeError("network"); })).toBeNull();
		});
	});
});
