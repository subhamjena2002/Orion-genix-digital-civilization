import { newToken, sha256 } from "./http";
import type { Env } from "./index";

/**
 * Account emails (docs/accounts.md): confirming an address, resetting a password, and telling
 * someone who signs up again that they already have an account. Sent through Resend's HTTP API
 * once RESEND_API_KEY and EMAIL_FROM are set.
 *
 * Every link carries a single-use token in its fragment (`/verify#token=…`), which browsers never
 * send to any server or in a Referer; the page reads it, then wipes it from the address bar
 * before anything else on the page loads. Only the token's hash is stored (email_tokens), the
 * newest link for a purpose replaces the ones before it, and a link is spent the moment it's used.
 *
 * For local development only, EMAIL_DEV_LOG=1 (in .dev.vars) writes emails to the wrangler
 * console instead of sending them.
 */

export type TokenPurpose = "verify" | "reset";

const TOKEN_LIFETIME_MS: Record<TokenPurpose, number> = {
	verify: 24 * 60 * 60 * 1000,
	reset: 30 * 60 * 1000,
};
/** At most one email of a kind to an account this often, however often it's asked for. */
export const EMAIL_COOLDOWN_MS = 60 * 1000;
const SEND_TIMEOUT_MS = 8000;

export const emailConfigured = (env: Env) => Boolean((env.RESEND_API_KEY && env.EMAIL_FROM) || env.EMAIL_DEV_LOG === "1");

interface Mail {
	to: string;
	subject: string;
	text: string;
	html: string;
}

async function send(env: Env, mail: Mail): Promise<boolean> {
	if (env.RESEND_API_KEY && env.EMAIL_FROM) {
		try {
			const response = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
				body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
				signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
			});
			if (!response.ok) console.error("email: provider refused", response.status);
			return response.ok;
		} catch (error) {
			console.error("email:", error instanceof Error ? error.message : "unknown error");
			return false;
		}
	}
	if (env.EMAIL_DEV_LOG === "1") {
		console.log(`email (dev log) to ${mail.to}: ${mail.subject}\n${mail.text}`);
		return true;
	}
	return false;
}

/**
 * A new link for `purpose`, replacing any unused ones before it, or null when one was sent too
 * recently (the cooldown).
 */
export async function issueToken(env: Env, userId: string, purpose: TokenPurpose): Promise<string | null> {
	const now = Date.now();
	const recent = await env.DB.prepare("SELECT 1 FROM email_tokens WHERE user_id = ?1 AND purpose = ?2 AND created_at > ?3")
		.bind(userId, purpose, now - EMAIL_COOLDOWN_MS)
		.first();
	if (recent) return null;
	await env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ?1 AND purpose = ?2").bind(userId, purpose).first();
	const token = newToken();
	await env.DB.prepare("INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
		.bind(await sha256(token), userId, purpose, now, now + TOKEN_LIFETIME_MS[purpose])
		.first();
	return token;
}

/** Whose link this is, spending it: a link works once, before it expires, for its own purpose. */
export async function spendToken(env: Env, token: string, purpose: TokenPurpose): Promise<string | null> {
	const now = Date.now();
	const row = await env.DB.prepare("UPDATE email_tokens SET used_at = ?1 WHERE token_hash = ?2 AND purpose = ?3 AND used_at IS NULL AND expires_at > ?1 RETURNING user_id")
		.bind(now, await sha256(token), purpose)
		.first<{ user_id: string }>();
	return row?.user_id ?? null;
}

/** Whether a link is still good, without spending it. */
export async function tokenValid(env: Env, token: string, purpose: TokenPurpose): Promise<boolean> {
	const row = await env.DB.prepare("SELECT 1 FROM email_tokens WHERE token_hash = ?1 AND purpose = ?2 AND used_at IS NULL AND expires_at > ?3")
		.bind(await sha256(token), purpose, Date.now())
		.first();
	return row !== null;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** One plain, readable layout for every account email: a few lines, one button, the link spelled out. */
function layout(heading: string, lines: string[], button: { label: string; href: string }, footer: string): { text: string; html: string } {
	const text = [heading, "", ...lines, "", `${button.label}: ${button.href}`, "", footer, "", "— OrionGenix"].join("\n");
	const html = `<!doctype html><html><body style="margin:0;background:#050507;padding:32px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#f4f2ff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#101018;border:1px solid #2a2a38;border-radius:16px;padding:32px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 4px;font-size:12px;letter-spacing:4px;color:#22d3ee;font-weight:700">ORIONGENIX</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#ffffff">${escape(heading)}</h1>
${lines.map((line) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#c9cadf">${escape(line)}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${escape(button.href)}" style="display:inline-block;background:#ff2d95;background-image:linear-gradient(100deg,#ff2d95,#ff7a1a 55%,#f7b733);color:#120410;font-weight:800;font-size:14px;letter-spacing:1px;text-decoration:none;padding:14px 26px;border-radius:999px">${escape(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#8b8ca3">Or paste this into your browser:<br><span style="word-break:break-all;color:#c9cadf">${escape(button.href)}</span></p>
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b6c80">${escape(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
	return { text, html };
}

export function sendVerifyEmail(env: Env, origin: string, to: string, name: string, token: string): Promise<boolean> {
	const body = layout(
		"Confirm your email",
		[`Hi ${name},`, "Confirm this address to finish setting up your OrionGenix account. The link signs you in, and works once, for 24 hours."],
		{ label: "Confirm email", href: `${origin}/verify#token=${token}` },
		"Didn't sign up? You can ignore this email: nothing happens unless the link is used.",
	);
	return send(env, { to, subject: "Confirm your OrionGenix email", ...body });
}

export function sendResetEmail(env: Env, origin: string, to: string, name: string, token: string): Promise<boolean> {
	const body = layout(
		"Reset your password",
		[`Hi ${name},`, "Someone (hopefully you) asked to reset the password for your OrionGenix account. Choose a new one with the link below. It works once, for 30 minutes, and signs you out everywhere else."],
		{ label: "Choose a new password", href: `${origin}/reset#token=${token}` },
		"Didn't ask for this? Ignore this email: your password stays as it is.",
	);
	return send(env, { to, subject: "Reset your OrionGenix password", ...body });
}

/** For a sign-up with an address that already has an account: said to the address, not the page. */
export function sendAlreadyRegisteredEmail(env: Env, origin: string, to: string, name: string, token: string, hasPassword: boolean): Promise<boolean> {
	const body = layout(
		"You already have an account",
		[
			`Hi ${name},`,
			"Someone (hopefully you) just tried to sign up for OrionGenix with this email, but it already has an account.",
			hasPassword
				? "Sign in with your password, or if you've forgotten it, choose a new one with the link below (it works once, for 30 minutes)."
				: "You signed up with Google, so use “Sign in with Google”. Or, to also sign in with a password, set one with the link below (it works once, for 30 minutes).",
		],
		{ label: hasPassword ? "Reset password" : "Set a password", href: `${origin}/reset#token=${token}` },
		"Didn't try to sign up? Ignore this email: nothing has changed.",
	);
	return send(env, { to, subject: "You already have an OrionGenix account", ...body });
}
