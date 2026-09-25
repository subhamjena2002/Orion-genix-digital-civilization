import type { NextConfig } from "next";

/**
 * `next dev` resolves packages with the "development" export condition, which for PlayCanvas is
 * its debug build: every draw call and state change runs validation and assertions, which costs
 * a large share of the frame. The game is played in dev far more than it is built, so dev uses
 * the release engine too. Set ORION_ENGINE_DEBUG=1 to get the debug build back when chasing an
 * engine-level problem.
 */
const useDebugEngine = process.env.ORION_ENGINE_DEBUG === "1";

const nextConfig: NextConfig = {
  // The game is one client-side page with no server features, so it ships as plain files in
  // out/ — deployed by Cloudflare as static assets (wrangler.jsonc), not as a server Worker.
  output: "export",
  reactStrictMode: false,
  turbopack: useDebugEngine
    ? undefined
    : { resolveAlias: { playcanvas: "playcanvas/build/playcanvas/src/index.js" } },
};

export default nextConfig;
