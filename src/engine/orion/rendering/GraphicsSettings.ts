/**
 * Player-facing graphics settings.
 *
 * Native resolution, 4x MSAA, cascaded sun shadows and 8x anisotropic filtering. Frame rate is
 * protected first by doing less work for the same image (LOD, culling, batching, update
 * throttling) rather than by drawing a worse one.
 *
 * `adaptiveQuality` is the trade-off, and it is ON by default: the quality governor lowers MSAA
 * and shadow resolution, and as a last resort the render resolution, when the machine can't
 * hold 60 fps — and puts them back as soon as it can. F4 turns it off and pins full quality,
 * which looks better on a fast GPU and stutters on a slow one.
 *
 * The shadow numbers below are chosen to cost no more than what the game has actually been
 * running. Until recently they never reached the light at all (see OrionCanvas), so it was on
 * the engine's defaults: 40 m, one cascade, a 1024 atlas. Keeping one cascade keeps the shadow
 * pass a single draw of the casters — two cascades draw them twice, and with the atlas split
 * between them the near shadows come out blurrier than one cascade of the same size. So: one
 * cascade, the same reach, and four times the texel density for it.
 *
 * Raising `shadowCascades` is what buys distance — each one costs another pass over everything
 * that casts, which on a street full of cars and people is the most expensive thing here.
 */
export interface GraphicsSettings {
	adaptiveQuality: boolean;
	/** Upper bound on anisotropic filtering; the GPU's own limit also applies. */
	anisotropy: number;
	/** Sun shadow coverage, in metres from the camera. */
	shadowDistance: number;
	/** Cascades share one shadow atlas: 1 uses all of it, 2–4 a quarter each. */
	shadowCascades: 1 | 2 | 3 | 4;
	/** Size of the sun's shadow atlas, in texels per side. */
	shadowAtlasSize: number;
}

export const DEFAULT_GRAPHICS_SETTINGS: Readonly<GraphicsSettings> = {
	adaptiveQuality: true,
	anisotropy: 8,
	shadowDistance: 45,
	shadowCascades: 1,
	shadowAtlasSize: 2048,
};

const STORAGE_KEY = "orion.graphics";

/** The saved settings merged over the defaults; storage may be unavailable (private mode). */
export function loadGraphicsSettings(): GraphicsSettings {
	const settings: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };
	try {
		const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<GraphicsSettings>;
		if (typeof saved.adaptiveQuality === "boolean") settings.adaptiveQuality = saved.adaptiveQuality;
		if (typeof saved.shadowDistance === "number") settings.shadowDistance = saved.shadowDistance;
	} catch {
		// Defaults it is.
	}
	return settings;
}

export function saveGraphicsSettings(settings: GraphicsSettings): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
			adaptiveQuality: settings.adaptiveQuality,
			shadowDistance: settings.shadowDistance,
		}));
	} catch {
		// Not persisted; still applies for this session.
	}
}
