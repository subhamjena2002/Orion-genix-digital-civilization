"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import { authMessage, checkResetLink, forgotPassword, resetPassword, takeLinkToken, verifyEmail } from "./authApi";
import { Turnstile, TURNSTILE_SITE_KEY } from "./Turnstile";

/**
 * The pages behind the account emails: /forgot asks for a reset link, /reset uses one, /verify
 * confirms an address. The links' tokens are read with `takeLinkToken`, which wipes them from
 * the address bar first thing.
 */

const MIN_PASSWORD = 10;

function Card({ kicker, title, children }: Readonly<{ kicker: string; title: string; children: ReactNode }>) {
	const id = useId();
	return (
		<section className="lp-auth-card" aria-labelledby={id}>
			<p className="lp-kicker">{kicker}</p>
			<h1 id={id} className="lp-auth-title">{title}</h1>
			{children}
		</section>
	);
}

function PlayButton() {
	return (
		<div className="lp-auth-actions">
			<a href="/play" className="lp-button lp-button-primary">Play</a>
		</div>
	);
}

/**
 * Reads the link's token once the page is in the browser. The first render (on the server and
 * while hydrating) always shows "checking", so the two match.
 */
function useLinkToken(): { token: string | null; ready: boolean } {
	const [state, setState] = useState<{ token: string | null; ready: boolean }>({ token: null, ready: false });
	useEffect(() => {
		const token = takeLinkToken();
		// Read from the address bar, which only exists here: nothing to subscribe to.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setState({ token, ready: true });
	}, []);
	return state;
}

export function VerifyLink() {
	const { token, ready } = useLinkToken();
	const [result, setResult] = useState<{ ok: true; name: string } | { ok: false; error: string } | null>(null);

	useEffect(() => {
		if (!ready) return;
		if (!token) {
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setResult({ ok: false, error: "link_invalid" });
			return;
		}
		let live = true;
		void verifyEmail(token).then((answer) => {
			if (!live) return;
			setResult(answer.ok ? { ok: true, name: answer.user?.displayName ?? "" } : { ok: false, error: answer.error });
		});
		return () => {
			live = false;
		};
	}, [ready, token]);

	if (!result) {
		return (
			<Card kicker="Confirm email" title="Checking your link…">
				<p className="lp-auth-lead" role="status">One moment.</p>
			</Card>
		);
	}
	if (result.ok) {
		return (
			<Card kicker="Email confirmed" title={result.name ? `You're in, ${result.name}` : "You're in"}>
				<p className="lp-auth-lead" role="status">Your email is confirmed and you&apos;re signed in. Your progress saves to your account from now on.</p>
				<PlayButton />
			</Card>
		);
	}
	return (
		<Card kicker="Confirm email" title="That link didn't work">
			<p className="lp-auth-error" role="alert">{authMessage(result.error)}</p>
			<p className="lp-auth-lead lp-auth-lead-after">
				Sign in with your password, and you can send yourself a new link from there.
			</p>
			<div className="lp-auth-actions">
				<Link href="/signin" className="lp-button lp-button-primary">Sign in</Link>
			</div>
		</Card>
	);
}

export function ForgotForm() {
	const ids = useId();
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [token, setToken] = useState("");
	const [resetTurnstile, setResetTurnstile] = useState(0);
	const needsTurnstile = TURNSTILE_SITE_KEY !== "";

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		if (needsTurnstile && !token) {
			setError(authMessage("turnstile"));
			return;
		}
		setBusy(true);
		setError(null);
		const result = await forgotPassword({ email, turnstileToken: needsTurnstile ? token : undefined });
		setBusy(false);
		if (result.ok) {
			setSentTo(email.trim());
			return;
		}
		setError(authMessage(result.error, result.retryAfter));
		if (needsTurnstile) setResetTurnstile((n) => n + 1);
	};

	if (sentTo) {
		return (
			<Card kicker="Check your inbox" title="Link on its way">
				<p className="lp-auth-lead" role="status">
					If there&apos;s an account for <strong>{sentTo}</strong>, we&apos;ve sent it a link to choose a new password. It works once, for 30 minutes.
				</p>
				<p className="lp-auth-hint">Nothing after a few minutes? Check your spam folder, or make sure that&apos;s the address you signed up with.</p>
				<p className="lp-auth-switch"><Link href="/signin">Back to sign in</Link></p>
			</Card>
		);
	}

	return (
		<Card kicker="Forgot password" title="Reset your password">
			<p className="lp-auth-lead">Enter the email you signed up with, and we&apos;ll send you a link to choose a new password.</p>
			<form className="lp-auth-form" onSubmit={submit}>
				<div className="lp-auth-field">
					<label htmlFor={`${ids}-email`}>Email</label>
					<input
						id={`${ids}-email`}
						name="email"
						type="email"
						inputMode="email"
						autoComplete="email"
						autoCapitalize="none"
						spellCheck={false}
						required
						maxLength={254}
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>
				{needsTurnstile && <Turnstile onToken={setToken} resetKey={resetTurnstile} action="forgot" />}
				{error && <p className="lp-auth-error" role="alert">{error}</p>}
				<button type="submit" className="lp-button lp-button-primary lp-auth-submit" disabled={busy}>
					{busy ? "Sending…" : "Send reset link"}
				</button>
			</form>
			<p className="lp-auth-switch">Remembered it? <Link href="/signin">Sign in</Link></p>
		</Card>
	);
}

export function ResetForm() {
	const ids = useId();
	const { token, ready } = useLinkToken();
	const [valid, setValid] = useState<boolean | null>(null);
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [doneFor, setDoneFor] = useState<string | null>(null);

	useEffect(() => {
		if (!ready) return;
		if (!token) {
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setValid(false);
			return;
		}
		let live = true;
		void checkResetLink(token).then((answer) => {
			if (live) setValid(answer.ok ? answer.valid === true : false);
		});
		return () => {
			live = false;
		};
	}, [ready, token]);

	const tooShort = password.length > 0 && [...password].length < MIN_PASSWORD;

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy || !token) return;
		setBusy(true);
		setError(null);
		const result = await resetPassword({ token, password });
		setBusy(false);
		if (result.ok) {
			setDoneFor(result.user?.displayName ?? "");
			return;
		}
		if (result.error === "link_invalid") setValid(false);
		else setError(authMessage(result.error, result.retryAfter));
	};

	if (doneFor !== null) {
		return (
			<Card kicker="Password changed" title="All set">
				<p className="lp-auth-lead" role="status">
					Your new password is saved and you&apos;re signed in{doneFor ? ` as ${doneFor}` : ""}. Any other device that was signed in has been signed out.
				</p>
				<PlayButton />
			</Card>
		);
	}
	if (valid === null) {
		return (
			<Card kicker="Reset password" title="Checking your link…">
				<p className="lp-auth-lead" role="status">One moment.</p>
			</Card>
		);
	}
	if (!valid) {
		return (
			<Card kicker="Reset password" title="That link didn't work">
				<p className="lp-auth-error" role="alert">{authMessage("link_invalid")}</p>
				<div className="lp-auth-actions lp-auth-actions-after">
					<Link href="/forgot" className="lp-button lp-button-primary">Send a new link</Link>
				</div>
			</Card>
		);
	}
	return (
		<Card kicker="Reset password" title="Choose a new password">
			<p className="lp-auth-lead">Once it&apos;s saved, you&apos;re signed in here and signed out everywhere else.</p>
			<form className="lp-auth-form" onSubmit={submit}>
				<div className="lp-auth-field">
					<label htmlFor={`${ids}-password`}>New password</label>
					<div className="lp-auth-password">
						<input
							id={`${ids}-password`}
							name="password"
							type={showPassword ? "text" : "password"}
							autoComplete="new-password"
							required
							minLength={MIN_PASSWORD}
							maxLength={128}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							aria-describedby={`${ids}-rule`}
							aria-invalid={tooShort || Boolean(error) || undefined}
						/>
						<button type="button" className="lp-auth-reveal" onClick={() => setShowPassword((shown) => !shown)} aria-pressed={showPassword} aria-controls={`${ids}-password`}>
							{showPassword ? "Hide" : "Show"}
						</button>
					</div>
					<p id={`${ids}-rule`} className={`lp-auth-hint${tooShort ? " lp-auth-hint-warn" : ""}`}>
						At least {MIN_PASSWORD} characters. A short phrase is easy to remember and hard to guess.
					</p>
				</div>
				{error && <p className="lp-auth-error" role="alert">{error}</p>}
				<button type="submit" className="lp-button lp-button-primary lp-auth-submit" disabled={busy}>
					{busy ? "Saving…" : "Save new password"}
				</button>
			</form>
		</Card>
	);
}
