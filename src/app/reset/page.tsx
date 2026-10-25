import type { Metadata } from "next";

import { AuthFrame } from "@/components/account/AuthPage";
import { ResetForm } from "@/components/account/RecoveryForms";

export const metadata: Metadata = {
	title: "Choose a new password",
	robots: { index: false, follow: false },
	// The link's token never leaves in a Referer.
	referrer: "no-referrer",
};

export default function Reset() {
	return (
		<AuthFrame>
			<ResetForm />
		</AuthFrame>
	);
}
