import {
	CameraFrame,
	MiniStats,
	PIXELFORMAT_111110F,
	PIXELFORMAT_RGBA16F,
	PIXELFORMAT_RGBA32F,
	TONEMAP_NEUTRAL,
	type AppBase,
	type CameraComponent,
	type Entity,
	type GraphicsDevice,
	type LightComponent,
} from "playcanvas";

import { loadGraphicsSettings, saveGraphicsSettings, type GraphicsSettings } from "./GraphicsSettings";
import { QUALITY_LEVELS, QualityGovernor, setActiveQuality, startingLevel, type QualityLevel } from "./QualityGovernor";

/** Name of the directional light that casts the sun's shadows. */
const KEY_LIGHT_NAME = "key-light";
const BLOOM_INTENSITY = 0.028;
/** How often newly loaded textures are checked for filtering upgrades. */
const TEXTURE_SWEEP_SECONDS = 1;

/**
 * The camera's frame: the scene renders into an HDR target at native resolution, then is
 * tone-mapped and bloomed onto the canvas.
 *
 * HDR matters for fire: flames are many times brighter than the sunlit street around them, and
 * rendered straight to an 8-bit canvas they clip to a flat orange. In HDR they keep their hot
 * core, and bloom spreads that glow the way a real lens does.
 *
 * F3 toggles a frame-time overlay; F4 toggles adaptive quality (off by default — see
 * GraphicsSettings). Returns a function that removes it all again.
 */
export function installRenderPipeline(app: AppBase, component: CameraComponent): () => void {
	const settings = loadGraphicsSettings();
	const frame = new CameraFrame(app, component);
	frame.rendering.renderFormats = [PIXELFORMAT_111110F, PIXELFORMAT_RGBA16F, PIXELFORMAT_RGBA32F];
	// Neutral keeps the albedo the art was tuned against and only rolls off the highlights.
	frame.rendering.toneMapping = TONEMAP_NEUTRAL;
	frame.bloom.blurLevel = 12;
	frame.vignette.intensity = 0.22;
	frame.vignette.inner = 0.55;
	frame.vignette.outer = 1.25;
	frame.grading.enabled = true;
	frame.grading.contrast = 1.06;
	frame.grading.saturation = 1.05;

	const keyLight = () => (app.root.findByName(KEY_LIGHT_NAME) as Entity | null)?.light ?? null;
	configureSunShadows(keyLight(), settings);

	const governor = new QualityGovernor({
		levelCount: QUALITY_LEVELS.length,
		startLevel: startingLevel(),
	});

	const apply = (level: QualityLevel) => {
		frame.rendering.renderTargetScale = level.renderScale;
		frame.rendering.samples = level.samples;
		frame.rendering.sharpness = level.sharpness;
		frame.bloom.intensity = level.bloom ? BLOOM_INTENSITY : 0;
		frame.update();
		const light = keyLight();
		const resolution = Math.min(level.shadowResolution, settings.shadowAtlasSize);
		if (light && light.shadowResolution !== resolution) light.shadowResolution = resolution;
		setActiveQuality(level);
	};
	apply(QUALITY_LEVELS[settings.adaptiveQuality ? governor.level : 0]);

	// The governor judges the time a frame took to make, not just the interval between frames,
	// so a vsync cap isn't mistaken for load. CPU time spans the engine's update and render; GPU
	// time comes from timer queries where the browser allows them.
	const device = app.graphicsDevice as unknown as {
		extDisjointTimerQuery?: unknown;
		gpuProfiler?: { enabled: boolean; _frameTime: number };
	};
	const gpuProfiler = device.extDisjointTimerQuery ? device.gpuProfiler : undefined;
	if (gpuProfiler) gpuProfiler.enabled = true;
	let frameStart = 0;
	let sinceSweep = TEXTURE_SWEEP_SECONDS;
	const onFrameUpdate = () => {
		frameStart = performance.now();
	};
	const onFrameEnd = () => {
		const cpuTime = (performance.now() - frameStart) / 1000;
		// The raw interval: `dt` is clamped, which would hide the hitches the governor skips.
		const interval = app.stats.frame.ms / 1000;
		sinceSweep += interval;
		if (sinceSweep >= TEXTURE_SWEEP_SECONDS) {
			sinceSweep = 0;
			upgradeTextureFiltering(app.graphicsDevice, settings.anisotropy);
		}
		if (!settings.adaptiveQuality) return;
		const gpuTime = gpuProfiler ? gpuProfiler._frameTime / 1000 : 0;
		const changed = governor.sample(interval, gpuTime > 0 ? Math.max(cpuTime, gpuTime) : undefined);
		if (changed !== null) apply(QUALITY_LEVELS[changed]);
	};
	app.on("frameupdate", onFrameUpdate);
	app.on("frameend", onFrameEnd);

	let stats: MiniStats | null = null;
	const onKey = (event: KeyboardEvent) => {
		if (event.code === "F3") {
			event.preventDefault();
			if (stats) {
				stats.destroy();
				stats = null;
			} else {
				stats = new MiniStats(app);
			}
		} else if (event.code === "F4") {
			event.preventDefault();
			settings.adaptiveQuality = !settings.adaptiveQuality;
			saveGraphicsSettings(settings);
			// Switching off returns straight to full quality.
			apply(QUALITY_LEVELS[settings.adaptiveQuality ? governor.level : 0]);
			console.info(`Adaptive quality ${settings.adaptiveQuality ? "on" : "off (full quality)"}`);
		}
	};
	window.addEventListener("keydown", onKey);

	if (process.env.NODE_ENV !== "production") {
		// A handle for inspecting the running game from the browser console.
		(window as unknown as { __orion?: unknown }).__orion = { app, governor, levels: QUALITY_LEVELS, settings };
	}

	return () => {
		window.removeEventListener("keydown", onKey);
		app.off("frameupdate", onFrameUpdate);
		app.off("frameend", onFrameEnd);
		if (gpuProfiler) gpuProfiler.enabled = false;
		stats?.destroy();
		frame.destroy();
	};
}

/**
 * Cascaded shadows: the near cascade is sharp around the player, the far ones keep cars and
 * buildings grounded out to `shadowDistance`. One cascade stretched over that range gave soft,
 * blocky shadows up close; one kept tight left everything past 70 m floating.
 */
function configureSunShadows(light: LightComponent | null, settings: GraphicsSettings) {
	if (!light) return;
	// Coverage, cascade count and blending are props on the <Light> in OrionCanvas: set here they
	// were wiped the next time that component re-rendered. Only the atlas size is driven from
	// this side, because adaptive quality changes it while the game runs.
	light.shadowResolution = Math.min(light.shadowResolution, settings.shadowAtlasSize);
}

/**
 * Anisotropic filtering for every mipmapped texture, including those inside GLB files. Without
 * it, road markings, tarmac and car paint textures smear into a blur at grazing angles.
 * Setting it is cheap (a sampler parameter), so a periodic sweep catches textures as they load.
 */
export function upgradeTextureFiltering(device: GraphicsDevice, maxAnisotropy: number): number {
	const target = Math.min(maxAnisotropy, device.maxAnisotropy || 1);
	if (target <= 1) return 0;
	let upgraded = 0;
	for (const texture of (device as unknown as { textures: Set<{ mipmaps: boolean; anisotropy: number; cubemap: boolean }> }).textures) {
		if (!texture.mipmaps || texture.cubemap || texture.anisotropy >= target) continue;
		texture.anisotropy = target;
		upgraded++;
	}
	return upgraded;
}
