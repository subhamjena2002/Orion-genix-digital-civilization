import Link from "next/link";
import type { ReactNode } from "react";

import { AuthForm } from "./AuthForm";
import "@/app/landing.css";
import "./auth.css";

/** The frame around every account page: the landing page's look, with a way home. */
export function AuthFrame({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<div className="lp lp-auth-page">
			<header className="lp-nav">
				<Link href="/" className="lp-nav-brand" aria-label="OrionGenix home">
					<span className="lp-wordmark">
						<svg viewBox="0 0 24 24" aria-hidden="true" className="lp-wordmark-star">
							<path d="M12 0l2.4 8.6L24 12l-9.6 3.4L12 24l-2.4-8.6L0 12l9.6-3.4z" />
						</svg>
						ORION<span>GENIX</span>
					</span>
				</Link>
				<Link href="/" className="lp-button lp-button-ghost lp-button-small">Home</Link>
			</header>
			<main className="lp-auth">
				<div className="lp-auth-glow" aria-hidden="true" />
				{children}
			</main>
		</div>
	);
}

export function AuthPage({ mode }: Readonly<{ mode: "signin" | "signup" }>) {
	return (
		<AuthFrame>
			<AuthForm mode={mode} />
		</AuthFrame>
	);
}
