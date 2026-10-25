import { currentSession, MAX_AUTH_BODY, passesTurnstile, readEmail, startSession, tryLater, userView } from "./auth";
import { emailConfigured, issueToken, sendResetEmail, sendVerifyEmail, spendToken, tokenValid } from "./email";
import { clientAddress, inBackground, json, limited, readJsonBody, refuse, sameOrigin, TOKEN, type Waiter } from "./http";
import type { Env } from "./index";
import { hashPassword, isBreached, passwordProblem } from "./password";

/**
 * What the account emails' links lead to (docs/accounts.md), and asking for them.
 *
 *   POST /api/auth/verify        { token }: confirms the address and signs in.
 *   POST /api/auth/verify/send   sends the signed-in player a new confirmation link.
 *   POST /api/auth/forgot        { email, turnstileToken? }: always "sent" (202), whether or not
 *                                the address has an account; only one with an account gets mail.
 *   POST /api/auth/reset/check   { token }: { valid }, so the page can say a link has expired
 *                                before the player types a new password.
 *   POST /api/auth/reset         { token, password }: the new password; every other session ends,
 *                                and this browser is signed in.
 */

const linkInvalid = () => refuse(400, "link_invalid");

function readLinkToken(value: unknown): string | null {
	return typeof value === "string" && TOKEN.test(value) ? value : null;
}

async function verify(request: Request, url: URL, env: Env): Promise<Response> {
	const read = await readJsonBody(request, url, MAX_AUTH_BODY);
	if ("refused" in read) return read.refused;
	if (await limited(env.AUTH_LIMITER, `link:${clientAddress(request)}`)) return tryLater(60);
	const token = readLinkToken(read.body.token);
	const userId = token ? await spendToken(env, token, "verify") : null;
	if (!userId) return linkInvalid();
	await env.DB.prepare("UPDATE users SET email_verified = 1, updated_at = ?1 WHERE id = ?2").bind(Date.now(), userId).first();
	const cookies = await startSession(request, url, env, userId);
	return json({ user: await userView(env, userId) }, 200, {}, cookies);
}

async function sendVerification(request: Request, url: URL, env: Env, ctx?: Waiter): Promise<Response> {
	if (!sameOrigin(request, url)) return refuse(403, "cross_origin");
	const { session } = await currentSession(request, url, env);
	if (!session) return refuse(401, "signed_out");
	const user = await env.DB.prepare("SELECT email, display_name, email_verified FROM users WHERE id = ?1")
		.bind(session.userId)
		.first<{ email: string; display_name: string; email_verified: number }>();
	if (!user) return refuse(401, "signed_out");
	if (user.email_verified === 1) return json({ sent: false, verified: true });
	if (!emailConfigured(env)) return refuse(503, "email_unavailable");
	const token = await issueToken(env, session.userId, "verify");
	if (!token) return tryLater(60);
	await inBackground(ctx, sendVerifyEmail(env, url.origin, user.email, user.display_name, token));
	return json({ sent: true });
}

/**
 * A reset link, if the address has an account. The reply is the same either way, and the email
 * goes out after it, so neither the answer nor how long it takes says whether it does.
 */
async function forgot(request: Request, url: URL, env: Env, ctx?: Waiter): Promise<Response> {
	const read = await readJsonBody(request, url, MAX_AUTH_BODY);
	if ("refused" in read) return read.refused;
	const { body } = read;
	const email = readEmail(body.email);
	if (!email) return refuse(400, "email");
	if (!emailConfigured(env)) return refuse(503, "email_unavailable");
	if (await limited(env.AUTH_LIMITER, `forgot:${clientAddress(request)}`)) return tryLater(60);
	if (await limited(env.AUTH_LIMITER, `forgot:${email}`)) return tryLater(60);
	if (!(await passesTurnstile(request, url, env, body.turnstileToken))) return refuse(400, "turnstile");
	const user = await env.DB.prepare("SELECT id, display_name FROM users WHERE email = ?1").bind(email).first<{ id: string; display_name: string }>();
	if (user) {
		const token = await issueToken(env, user.id, "reset");
		if (token) await inBackground(ctx, sendResetEmail(env, url.origin, email, user.display_name, token));
	}
	return json({ sent: true }, 202);
}

async function resetCheck(request: Request, url: URL, env: Env): Promise<Response> {
	const read = await readJsonBody(request, url, MAX_AUTH_BODY);
	if ("refused" in read) return read.refused;
	if (await limited(env.AUTH_LIMITER, `link:${clientAddress(request)}`)) return tryLater(60);
	const token = readLinkToken(read.body.token);
	return json({ valid: token !== null && (await tokenValid(env, token, "reset")) });
}

/**
 * A new password from a reset link. The password is checked before the link is spent, so a
 * password that won't do doesn't use the link up. Using the link proves the player reads that
 * inbox, so the address counts as confirmed from then on.
 */
async function reset(request: Request, url: URL, env: Env): Promise<Response> {
	const read = await readJsonBody(request, url, MAX_AUTH_BODY);
	if ("refused" in read) return read.refused;
	const { body } = read;
	if (await limited(env.AUTH_LIMITER, `link:${clientAddress(request)}`)) return tryLater(60);
	const token = readLinkToken(body.token);
	if (!token) return linkInvalid();
	const problem = passwordProblem(body.password);
	if (problem) return refuse(400, problem);
	const password = body.password as string;
	if (!(await tokenValid(env, token, "reset"))) return linkInvalid();
	if ((await isBreached(password)) === true) return refuse(400, "password_breached");
	const passwordHash = await hashPassword(password);
	const userId = await spendToken(env, token, "reset");
	if (!userId) return linkInvalid();

	await env.DB.prepare("UPDATE users SET password_hash = ?1, email_verified = 1, failed_logins = 0, locked_until = NULL, updated_at = ?2 WHERE id = ?3")
		.bind(passwordHash, Date.now(), userId)
		.first();
	// Whoever knew the old password, or is signed in somewhere, is out.
	await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId).first();
	const cookies = await startSession(request, url, env, userId);
	return json({ user: await userView(env, userId) }, 200, {}, cookies);
}

const ROUTES: Record<string, (request: Request, url: URL, env: Env, ctx?: Waiter) => Promise<Response>> = {
	"/api/auth/verify": verify,
	"/api/auth/verify/send": sendVerification,
	"/api/auth/forgot": forgot,
	"/api/auth/reset/check": resetCheck,
	"/api/auth/reset": reset,
};

export const isRecoveryPath = (path: string) => path in ROUTES;

export function handleRecovery(request: Request, url: URL, env: Env, ctx?: Waiter): Promise<Response> {
	if (request.method !== "POST") return Promise.resolve(refuse(405, "method", { allow: "POST" }));
	return ROUTES[url.pathname](request, url, env, ctx);
}
