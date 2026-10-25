/**
 * Passwords: the rules for a new one, a check against known breaches, and slow salted hashing.
 *
 * Hashing is PBKDF2-SHA256 through WebCrypto, at 100,000 iterations, the most Workers allows.
 * Stored as `pbkdf2-sha256$<iterations>$<salt>$<hash>` (base64url), so the strength can be
 * raised later: `verifyPassword` says when a stored hash is weaker than today's and should be
 * replaced, which sign-in does with the password it has just checked.
 */

export const PASSWORD_ITERATIONS = 100_000;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const PREFIX = "pbkdf2-sha256";
const STORED = /^pbkdf2-sha256\$(\d{1,7})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
/** The breach check is a courtesy: if the service is slow or down, sign-up goes ahead. */
const BREACH_TIMEOUT_MS = 2500;

function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
	const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** One form for the same password however it was typed (accents composed or not, and so on). */
const normalise = (password: string) => password.normalize("NFKC");

/** Why a new password won't do, or null. Length is counted in characters, not bytes. */
export function passwordProblem(password: unknown): string | null {
	if (typeof password !== "string") return "password";
	const length = [...normalise(password)].length;
	if (length < MIN_PASSWORD) return "password_too_short";
	if (length > MAX_PASSWORD) return "password_too_long";
	if (password.trim() === "") return "password";
	return null;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalise(password)), "PBKDF2", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS));
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(password, salt, PASSWORD_ITERATIONS);
	return `${PREFIX}$${PASSWORD_ITERATIONS}$${base64url(salt)}$${base64url(hash)}`;
}

/** Compares every byte whatever the first difference, so the time taken gives nothing away. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
	return difference === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<{ ok: boolean; rehash: boolean }> {
	const parts = STORED.exec(stored);
	if (!parts) return { ok: false, rehash: false };
	const iterations = Number(parts[1]);
	const hash = await derive(password, fromBase64url(parts[2]), iterations);
	const ok = sameBytes(hash, fromBase64url(parts[3]));
	return { ok, rehash: ok && iterations < PASSWORD_ITERATIONS };
}

let dummy: Promise<string> | null = null;

/**
 * Does the work of checking a password when there's no account to check it against, so that
 * "no such email" takes as long as "wrong password" and timing doesn't tell them apart.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
	dummy ??= hashPassword("not anyone's password at all");
	await verifyPassword(password, await dummy);
}

/**
 * Whether the password is in Have I Been Pwned's list of breached passwords. Only the first five
 * characters of its SHA-1 leave the Worker (k-anonymity); the reply is padded so its size gives
 * nothing away either. Unknown (null) when the service can't be reached in time.
 */
export async function isBreached(password: string, fetcher: typeof fetch = fetch): Promise<boolean | null> {
	const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(normalise(password)));
	const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
	const prefix = hex.slice(0, 5);
	const suffix = hex.slice(5);
	try {
		const response = await fetcher(`https://api.pwnedpasswords.com/range/${prefix}`, {
			headers: { "add-padding": "true", "user-agent": "OrionGenix-sign-up" },
			signal: AbortSignal.timeout(BREACH_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		for (const line of (await response.text()).split("\n")) {
			const [candidate, count] = line.trim().split(":");
			// Padding lines have a count of 0.
			if (candidate === suffix) return Number(count) > 0;
		}
		return false;
	} catch {
		return null;
	}
}
