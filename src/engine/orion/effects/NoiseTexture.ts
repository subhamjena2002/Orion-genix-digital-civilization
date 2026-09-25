/**
 * A seamlessly tiling RGBA noise texture, generated once at startup. The fire and smoke shaders
 * scroll and layer it to shape flames and billows per pixel.
 *
 * This is what fixes the "pixelated" look of the old effects: those were flat, single-colour
 * squares, so every sprite edge was a hard polygon. Here the shape comes from smooth noise
 * sampled with filtering at several scales, so it stays soft at any distance or resolution.
 *
 * Each channel is fractal value noise at a different base frequency, so one texture fetch
 * gives four independent octaves to mix:
 *   r: broad billows    g: medium detail    b: fine detail    a: large, slow variation
 */

const CHANNELS: readonly { frequency: number; octaves: number }[] = [
	{ frequency: 4, octaves: 5 },
	{ frequency: 8, octaves: 4 },
	{ frequency: 16, octaves: 3 },
	{ frequency: 2, octaves: 3 },
];

/** Integer hash to [0, 1). Deterministic, so the same seed always makes the same texture. */
function hash(x: number, y: number, seed: number): number {
	let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Value noise on a lattice that wraps every `period` cells, so the result tiles. */
function periodicNoise(u: number, v: number, period: number, seed: number): number {
	const x0 = Math.floor(u);
	const y0 = Math.floor(v);
	const fx = smooth(u - x0);
	const fy = smooth(v - y0);
	const wrap = (value: number) => ((value % period) + period) % period;
	const xa = wrap(x0);
	const xb = wrap(x0 + 1);
	const ya = wrap(y0);
	const yb = wrap(y0 + 1);
	const top = hash(xa, ya, seed) + (hash(xb, ya, seed) - hash(xa, ya, seed)) * fx;
	const bottom = hash(xa, yb, seed) + (hash(xb, yb, seed) - hash(xa, yb, seed)) * fx;
	return top + (bottom - top) * fy;
}

/**
 * RGBA8 pixels, `size` x `size`, row by row. Each channel is stretched to the full 0..255 range
 * so the shaders get the same contrast whatever the seed.
 */
export function generateNoiseTexture(size: number, seed = 1337): Uint8Array {
	const pixels = new Uint8Array(size * size * 4);
	const values = new Float32Array(size * size);
	CHANNELS.forEach(({ frequency, octaves }, channel) => {
		let min = Infinity;
		let max = -Infinity;
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				let total = 0;
				let amplitude = 1;
				let norm = 0;
				let cells = frequency;
				for (let octave = 0; octave < octaves; octave++) {
					total += periodicNoise((x / size) * cells, (y / size) * cells, cells, seed + channel * 97 + octave * 13) * amplitude;
					norm += amplitude;
					amplitude *= 0.5;
					cells *= 2;
				}
				const value = total / norm;
				values[y * size + x] = value;
				if (value < min) min = value;
				if (value > max) max = value;
			}
		}
		const range = max - min || 1;
		for (let i = 0; i < values.length; i++) {
			pixels[i * 4 + channel] = Math.round(((values[i] - min) / range) * 255);
		}
	});
	return pixels;
}
