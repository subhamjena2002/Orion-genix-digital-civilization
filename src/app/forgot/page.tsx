import type { Metadata } from "next";

import { AuthFrame } from "@/components/account/AuthPage";
import { ForgotForm } from "@/components/account/RecoveryForms";

export const metadata: Metadata = {
	title: "Reset your password",
	description: "Get a link to choose a new password for your OrionGenix account.",
	alternates: { canonical: "/forgot" },
	robots: { index: false, follow: true },
};

export default function Forgot() {
	return (
		<AuthFrame>
			<ForgotForm />
		</AuthFrame>
	);
}
