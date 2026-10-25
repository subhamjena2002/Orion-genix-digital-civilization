import type { Metadata } from "next";

import { AuthPage } from "@/components/account/AuthPage";

export const metadata: Metadata = {
	title: "Sign in",
	description: "Sign in to OrionGenix to keep your progress on every device.",
	alternates: { canonical: "/signin" },
	robots: { index: false, follow: true },
};

export default function SignIn() {
	return <AuthPage mode="signin" />;
}
