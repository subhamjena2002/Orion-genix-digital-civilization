import type { Metadata } from "next";

import { AuthPage } from "@/components/account/AuthPage";

export const metadata: Metadata = {
	title: "Create an account",
	description: "Create a free OrionGenix account to keep your progress on every device.",
	alternates: { canonical: "/signup" },
	robots: { index: false, follow: true },
};

export default function SignUp() {
	return <AuthPage mode="signup" />;
}
