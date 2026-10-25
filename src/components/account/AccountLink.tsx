"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchMe } from "./authApi";

/**
 * "Sign in" in the landing page's header, or the player's name once they are. Asks the API once
 * the page has loaded; until it answers (or where there's no API) it shows "Sign in".
 */
export function AccountLink({ className }: Readonly<{ className?: string }>) {
	const [name, setName] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		void fetchMe().then((result) => {
			if (live && result.ok && result.user) setName(result.user.displayName);
		});
		return () => {
			live = false;
		};
	}, []);

	return (
		<Link href="/signin" className={className} aria-label={name ? `Account: signed in as ${name}` : undefined}>
			{name ?? "Sign in"}
		</Link>
	);
}
