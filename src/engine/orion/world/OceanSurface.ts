import {
	ADDRESS_REPEAT,
	Color,
	FILTER_LINEAR,
	FILTER_LINEAR_MIPMAP_LINEAR,
	PIXELFORMAT_RGBA8,
	Script,
	StandardMaterial,
	Texture,
	Vec2,
	type GraphicsDevice,
} from "playcanvas";

import { sceneCamera } from "../rendering/SceneCamera";
import { ORION_OCEAN } from "./Ocean";

/**
 * The sea's surface: a deep blue-green that only mirrors the sky at a glancing angle, broken up by
 * moving waves, and a plane that travels with the camera so there's water to the horizon
 * wherever the player flies.
 *
 * It used to be a glossy, half-metallic 3 km square: from the air it mirrored the sky so exactly
 * that sea and sky couldn't be told apart, and its edges and corners were in plain view.
 */

/** Width of the plane: past the flying camera's far clip in every direction. */
export const OCEAN_SPAN = 44000;
/** Metres per repeat of the large swell and of the small ripples laid over it. */
const SWELL_TILE = 64;
const RIPPLE_TILE = 16;
/** Drift of each wave layer, in repeats a second (they move differently, so no pattern holds). */
const SWELL_DRIFT = new Vec2(0.012, 0.007);
const RIPPLE_DRIFT = new Vec2(-0.028, 0.019);
/** Pixels across the generated wave texture. */
const WAVE_TEXTURE_SIZE = 256;

/**
 * A wave normal map that tiles seamlessly: the height field is a sum of waves whose frequencies
 * are whole numbers of cycles across the tile, in many directions, with longer waves taller.
 */
export function createWaveNormalMap(device: GraphicsDevice): Texture {
	const size = WAVE_TEXTURE_SIZE;
	const height = new Float32Array(size * size);
	// A fixed seed, so the sea looks the same every time.
	let seed = 1234567;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const waves: { kx: number; ky: number; amplitude: number; phase: number }[] = [];
	for (let i = 0; i < 40; i++) {
		const kx = Math.round((random() * 2 - 1) * 9);
		const ky = Math.round((random() * 2 - 1) * 9);
		if (kx === 0 && ky === 0) continue;
		waves.push({ kx, ky, amplitude: 1 / Math.pow(Math.hypot(kx, ky), 1.4), phase: random() * Math.PI * 2 });
	}
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let h = 0;
			for (const wave of waves) h += wave.amplitude * Math.sin(((wave.kx * x + wave.ky * y) / size) * Math.PI * 2 + wave.phase);
			height[y * size + x] = h;
		}
	}
	const texture = new Texture(device, {
		name: "ocean-waves",
		width: size,
		height: size,
		format: PIXELFORMAT_RGBA8,
		mipmaps: true,
		minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
		magFilter: FILTER_LINEAR,
		addressU: ADDRESS_REPEAT,
		addressV: ADDRESS_REPEAT,
		anisotropy: 8,
	});
	const pixels = texture.lock() as Uint8Array;
	const strength = 2.2;
	const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
			const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
			const length = Math.hypot(dx, dy, 1);
			const i = (y * size + x) * 4;
			pixels[i] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
			pixels[i + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
			pixels[i + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
			pixels[i + 3] = 255;
		}
	}
	texture.unlock();
	return texture;
}

/** The water: dark and blue looking down into it, the sky's reflection only near the horizon. */
export function createOceanMaterial(waves: Texture): StandardMaterial {
	const material = new StandardMaterial();
	material.name = "ocean";
	material.diffuse = new Color(0.035, 0.12, 0.16);
	material.useMetalness = true;
	material.metalness = 0;
	material.gloss = 0.86;
	material.normalMap = waves;
	material.bumpiness = 0.55;
	material.normalMapTiling = new Vec2(OCEAN_SPAN / SWELL_TILE, OCEAN_SPAN / SWELL_TILE);
	material.normalDetailMap = waves;
	material.normalDetailMapBumpiness = 0.7;
	material.normalDetailMapTiling = new Vec2(OCEAN_SPAN / RIPPLE_TILE, OCEAN_SPAN / RIPPLE_TILE);
	material.update();
	return material;
}

/**
 * Keeps the sea under the camera and its waves moving. The plane steps in whole swell tiles, so
 * the wave pattern stays fixed to the world as it moves (only the drift moves it).
 */
export class OrionOcean extends Script {
	public static scriptName = "orionOcean";
	public material: StandardMaterial | null = null;

	private readonly swell = new Vec2();
	private readonly ripple = new Vec2();

	public postUpdate(dt: number) {
		const camera = sceneCamera(this.app);
		if (camera) {
			const position = camera.entity.getPosition();
			const x = Math.round(position.x / SWELL_TILE) * SWELL_TILE;
			const z = Math.round(position.z / SWELL_TILE) * SWELL_TILE;
			this.entity.setPosition(x, ORION_OCEAN.level, z);
		}
		const material = this.material;
		if (!material || !(dt > 0)) return;
		this.swell.x = (this.swell.x + SWELL_DRIFT.x * dt) % 1;
		this.swell.y = (this.swell.y + SWELL_DRIFT.y * dt) % 1;
		this.ripple.x = (this.ripple.x + RIPPLE_DRIFT.x * dt) % 1;
		this.ripple.y = (this.ripple.y + RIPPLE_DRIFT.y * dt) % 1;
		material.normalMapOffset = this.swell;
		material.normalDetailMapOffset = this.ripple;
		material.update();
	}
}
