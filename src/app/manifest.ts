import type { MetadataRoute } from "next";

/** The site is a static export (Cloudflare serves files), so this is written once at build time. */
export const dynamic = "force-static";

/**
 * Installed to a phone's home screen ("Add to Home screen"), the game opens full screen and in
 * landscape, with no browser bars. Android honours the orientation; iOS ignores it and relies
 * on the in-game prompt to turn the phone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OrionGenix",
    short_name: "OrionGenix",
    description: "Explore a persistent digital world in the making.",
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#162128",
    theme_color: "#08090a",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
