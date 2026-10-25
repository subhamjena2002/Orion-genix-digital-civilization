import type { Metadata } from "next";

import { AuthFrame } from "@/components/account/AuthPage";
import { VerifyLink } from "@/components/account/RecoveryForms";

export const metadata: Metadata = {
	title: "Confirm your email",
	robots: { index: false, follow: false },
	// The link's token never leaves in a Referer.
	referrer: "no-referrer",
};

export default function Verify() {
	return (
		<AuthFrame>
			<VerifyLink />
		</AuthFrame>
	);
}
