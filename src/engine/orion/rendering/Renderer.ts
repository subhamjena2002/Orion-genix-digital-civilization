import type { AppBase } from "playcanvas";

export const ORION_RENDERING = {
	clearColor: "#9aa8a6",
	cameraFov: 48,
	// The chase camera never gets closer than ~0.35 m to a surface, so a 0.2 m near plane loses
	// nothing and doubles depth precision over 0.1 (less z-fighting on markings and decals).
	cameraNearClip: 0.2,
	cameraFarClip: 800,
	// Kept moderate: the HDRI environment atlas adds the sky's own ambient and reflections, so
	// full-strength directionals on top blow the albedo out.
	keyLightIntensity: 1.15,
	// About half the sun, from the opposite side (see OrionCanvas): the faces turned away from the
	// sun stay in daylight instead of falling to the sky's dim blue ambient.
	fillLightIntensity: 0.55,
	// A low afternoon sun: warm on the plaster. White sunlight under a blue sky left the pastel
	// walls a cold grey.
	keyLightColor: "#ffe6c2",
	// Sunlight bounced back off the city: a softer, slightly warm white, not the sky's blue.
	fillLightColor: "#fff1e0",
} as const;

/** Beyond 2x the extra fill cost outweighs any visible sharpness gain. */
const MAX_PIXEL_RATIO = 2;

/**
 * PlayCanvas renders at 1x pixel density by default, so on high-DPI screens the frame is
 * upscaled and looks soft and blocky. This renders at the display's real density instead, and
 * keeps doing so when the density changes (browser zoom, or moving to another monitor).
 * Returns a cleanup function.
 */
export function applyDisplayPixelRatio(app: AppBase): () => void {
	let media: MediaQueryList | null = null;

	const apply = () => {
		const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
		if (app.graphicsDevice.maxPixelRatio !== ratio) app.graphicsDevice.maxPixelRatio = ratio;
		// Always re-fit: a page that loaded in a hidden or minimised tab sized its canvas to 0x0,
		// and nothing else resizes it when the tab is shown.
		app.resizeCanvas();
		// A resolution media query only fires once, when the density moves away from the value
		// it was created with, so re-arm it for the new density each time.
		media?.removeEventListener("change", apply);
		media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
		media.addEventListener("change", apply);
	};

	apply();
	window.addEventListener("resize", apply);
	return () => {
		window.removeEventListener("resize", apply);
		media?.removeEventListener("change", apply);
	};
}
