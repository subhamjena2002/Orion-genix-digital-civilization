import type { Metadata, Viewport } from "next";

import OrionEntry from "@/components/world/OrionEntry";

export const metadata: Metadata = {
  title: "Play Now",
  description: "OrionGenix is loading: the open world, the police and the sky are yours. Free, in your browser.",
  alternates: { canonical: "/play" },
  // The landing page is the one to find in search; this is where its Play button leads.
  robots: { index: false, follow: true },
};

/**
 * A game, not a document: no pinch or double-tap zoom stealing a thumb from the controls, and
 * drawn edge to edge under a landscape phone's notch (the HUD keeps clear via the safe-area
 * insets).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#08090a",
};

export default function Play() {
  return (
    <main className="h-dvh w-screen overflow-hidden">
      <OrionEntry />
    </main>
  );
}
