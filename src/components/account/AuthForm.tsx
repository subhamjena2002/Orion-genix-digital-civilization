"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";

import { authMessage, fetchMe, returnPath, signIn, signOut, signUp, type AccountUser } from "./authApi";
import { Turnstile, TURNSTILE_SITE_KEY } from "./Turnstile";

/**
 * The sign-in and sign-up forms (/signin, /signup). Email and password for now; Google joins
 * them once its client is set up. Playing never needs an account: the guest link is always
 * there.
 *
 * Built for password managers and phones: real <form>, labelled inputs with the autocomplete
 * values managers look for, the email keyboard on phones, Enter submits, a show/hide toggle, and
 * errors announced to screen readers.
 */

type Mode = "signin" | "signup";

const MIN_PASSWORD = 10;

/** The page's query (`?return=/play`): fixed for the page's life, and empty while pre-rendered. */
const useSearch = () => useSyncExternalStore(() => () => {}, () => window.location.search, () => "");

const COPY = {
	signin: {
		kicker: "Welcome back",
		title: "Sign in",
		lead: "Pick up where you left off: your cash, garage and missions, on any device.",
		submit: "Sign in",
		busy: "Signing in…",
	},
	signup: {
		kicker: "Free account",
		title: "Save your city",
		lead: "Keep your progress safe and play it on any device. What you've earned as a guest comes with you.",
		submit: "Create account",
		busy: "Creating account…",
	},
} as const;

function GoogleMark() {
	return (
		<svg viewBox="0 0 48 48" aria-hidden="true" className="lp-auth-google-mark">
			<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
			<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
			<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
			<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
		</svg>
	);
}

export function AuthForm({ mode }: Readonly<{ mode: Mode }>) {
	const copy = COPY[mode];
	const ids = useId();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errorCode, setErrorCode] = useState<string | null>(null);
	const [token, setToken] = useState("");
	const [resetTurnstile, setResetTurnstile] = useState(0);
	const [user, setUser] = useState<AccountUser | null>(null);
	const search = useSearch();

	useEffect(() => {
		let live = true;
		void fetchMe().then((result) => {
			if (live && result.ok) setUser(result.user);
		});
		return () => {
			live = false;
		};
	}, []);

	const needsTurnstile = TURNSTILE_SITE_KEY !== "";
	const tooShort = mode === "signup" && password.length > 0 && [...password].length < MIN_PASSWORD;

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		if (needsTurnstile && !token) {
			setError(authMessage("turnstile"));
			setErrorCode("turnstile");
			return;
		}
		setBusy(true);
		setError(null);
		setErrorCode(null);
		const turnstileToken = needsTurnstile ? token : undefined;
		const result = mode === "signup" ? await signUp({ email, password, displayName, turnstileToken }) : await signIn({ email, password, turnstileToken });
		if (result.ok) {
			// A full load, so the game starts afresh under the account's save.
			window.location.assign(returnPath(window.location.search));
			return;
		}
		setBusy(false);
		setError(authMessage(result.error, result.retryAfter));
		setErrorCode(result.error);
		// Each Turnstile token works once.
		if (needsTurnstile) setResetTurnstile((n) => n + 1);
	};

	const leave = async () => {
		setBusy(true);
		const result = await signOut();
		setBusy(false);
		if (result.ok) setUser(null);
		else setError(authMessage(result.error));
	};

	const other = mode === "signin" ? "/signup" : "/signin";
	const keepReturn = search.includes("return=") ? search : "";

	if (user) {
		return (
			<section className="lp-auth-card" aria-labelledby={`${ids}-title`}>
				<p className="lp-kicker">Signed in</p>
				<h1 id={`${ids}-title`} className="lp-auth-title">Hey, {user.displayName}</h1>
				<p className="lp-auth-lead">
					You&apos;re signed in as <strong>{user.email}</strong>. Your progress saves to your account.
				</p>
				<div className="lp-auth-actions">
					<Link href={returnPath(search)} className="lp-button lp-button-primary">Play</Link>
					<button type="button" className="lp-button lp-button-ghost" onClick={leave} disabled={busy}>
						{busy ? "Signing out…" : "Sign out"}
					</button>
				</div>
				{error && <p className="lp-auth-error" role="alert">{error}</p>}
			</section>
		);
	}

	return (
		<section className="lp-auth-card" aria-labelledby={`${ids}-title`}>
			<p className="lp-kicker">{copy.kicker}</p>
			<h1 id={`${ids}-title`} className="lp-auth-title">{copy.title}</h1>
			<p className="lp-auth-lead">{copy.lead}</p>

			<button type="button" className="lp-auth-google" disabled aria-describedby={`${ids}-google-soon`}>
				<GoogleMark />
				Continue with Google
				<span id={`${ids}-google-soon`} className="lp-auth-soon">Soon</span>
			</button>

			<div className="lp-auth-or" role="separator"><span>or with email</span></div>

			<form className="lp-auth-form" onSubmit={submit}>
				{mode === "signup" && (
					<div className="lp-auth-field">
						<label htmlFor={`${ids}-name`}>Player name <span className="lp-auth-optional">optional</span></label>
						<input
							id={`${ids}-name`}
							name="nickname"
							type="text"
							autoComplete="nickname"
							maxLength={32}
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							placeholder="Shown in the game"
						/>
					</div>
				)}
				<div className="lp-auth-field">
					<label htmlFor={`${ids}-email`}>Email</label>
					<input
						id={`${ids}-email`}
						name="email"
						type="email"
						inputMode="email"
						autoComplete={mode === "signin" ? "username" : "email"}
						autoCapitalize="none"
						spellCheck={false}
						required
						maxLength={254}
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						aria-invalid={errorCode === "email" || errorCode === "email_taken" || undefined}
					/>
				</div>
				<div className="lp-auth-field">
					<div className="lp-auth-label-row">
						<label htmlFor={`${ids}-password`}>Password</label>
						{mode === "signin" && <span className="lp-auth-hint">Forgot it? Reset is coming soon.</span>}
					</div>
					<div className="lp-auth-password">
						<input
							id={`${ids}-password`}
							name="password"
							type={showPassword ? "text" : "password"}
							autoComplete={mode === "signin" ? "current-password" : "new-password"}
							required
							minLength={mode === "signup" ? MIN_PASSWORD : undefined}
							maxLength={128}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							aria-describedby={mode === "signup" ? `${ids}-password-rule` : undefined}
							aria-invalid={errorCode?.startsWith("password") || errorCode === "invalid_credentials" || tooShort || undefined}
						/>
						<button
							type="button"
							className="lp-auth-reveal"
							onClick={() => setShowPassword((shown) => !shown)}
							aria-pressed={showPassword}
							aria-controls={`${ids}-password`}
						>
							{showPassword ? "Hide" : "Show"}
						</button>
					</div>
					{mode === "signup" && (
						<p id={`${ids}-password-rule`} className={`lp-auth-hint${tooShort ? " lp-auth-hint-warn" : ""}`}>
							At least {MIN_PASSWORD} characters. A short phrase is easy to remember and hard to guess.
						</p>
					)}
				</div>

				{needsTurnstile && <Turnstile onToken={setToken} resetKey={resetTurnstile} action={mode} />}

				{error && (
					<p className="lp-auth-error" role="alert">
						{error}
						{errorCode === "email_taken" && <> <Link href={`/signin${keepReturn}`}>Sign in</Link></>}
					</p>
				)}

				<button type="submit" className="lp-button lp-button-primary lp-auth-submit" disabled={busy}>
					{busy ? copy.busy : copy.submit}
				</button>
			</form>

			<p className="lp-auth-switch">
				{mode === "signin" ? "New to OrionGenix? " : "Already have an account? "}
				<Link href={`${other}${keepReturn}`}>{mode === "signin" ? "Create an account" : "Sign in"}</Link>
			</p>
			<p className="lp-auth-switch">
				<Link href="/play" className="lp-auth-guest">Or play as a guest →</Link>
			</p>
			{mode === "signup" && (
				<p className="lp-auth-fine">Your email is only used to sign you in and to help you get back into your account.</p>
			)}
		</section>
	);
}
