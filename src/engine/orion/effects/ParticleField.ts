/**
 * The simulation half of the effects system: every flame, smoke puff, spark and scorch mark in
 * the city lives in one pool of flat typed arrays. Nothing here touches the GPU (see
 * ParticleRenderer), so it can be stepped and tested on its own.
 *
 * Particles are camera-facing sprites whose look comes from a shader, not from their motion
 * alone: flames are short-lived and buoyant, smoke rises, slows and spreads, fireballs roll
 * outwards and cool into soot, sparks fly ballistically and bounce, and scorch marks sit still
 * on the road for a minute or so.
 */

export const PARTICLE_KIND = { flame: 0, smoke: 1, spark: 2, scorch: 3, fireball: 4 } as const;
export type ParticleKind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND];

export interface ParticleSpawn {
	kind: ParticleKind;
	x: number;
	y: number;
	z: number;
	vx?: number;
	vy?: number;
	vz?: number;
	/** Half-width in metres at birth. */
	size: number;
	/** Size at death as a multiple of the birth size. */
	growth?: number;
	/** Seconds. */
	life: number;
	/** Heat for flames and sparks, opacity for smoke and scorch. */
	intensity?: number;
	/** Smoke: 0 pale grey to 1 black. Flames: how much soot they leave as they cool. */
	tone?: number;
	/** Smoke lit from underneath by the fire it came from, fading as it rises. */
	glow?: number;
	/** Upward acceleration (m/s²), e.g. hot gas rising. */
	buoyancy?: number;
	/** Exponential drag rate (1/s). */
	drag?: number;
	/** Downward acceleration (m/s²), for sparks. */
	gravity?: number;
	/** Height of the ground below; falling particles bounce off it. */
	floor?: number;
	rotation?: number;
	/** Radians per second. */
	spin?: number;
	/** 0..1, varies the noise pattern so no two sprites look alike. */
	seed?: number;
}

/** Horizontal wind the smoke drifts with. */
export interface Wind {
	x: number;
	z: number;
}

const NO_WIND: Wind = { x: 0, z: 0 };
/** Share of speed kept when a spark bounces. */
const BOUNCE = 0.35;
/** How strongly smoke is pulled towards the wind velocity (1/s). */
const WIND_COUPLING = 0.6;
/** Swirling added to rising gas (m/s²). */
const TURBULENCE = 1.4;
/** Particle indices must fit below this for the sort keys to hold them. */
export const MAX_PARTICLES = 4096;
const INDEX_RANGE = MAX_PARTICLES;
/** Distances beyond this sort as equal; nothing that far is drawn anyway. */
const MAX_SORT_DISTANCE = 10_000;
const DISTANCE_STEPS = MAX_SORT_DISTANCE * 100;

export class ParticleField {
	public readonly capacity: number;
	private live = 0;
	private time = 0;

	public readonly kind: Uint8Array;
	public readonly x: Float32Array;
	public readonly y: Float32Array;
	public readonly z: Float32Array;
	public readonly vx: Float32Array;
	public readonly vy: Float32Array;
	public readonly vz: Float32Array;
	public readonly age: Float32Array;
	public readonly life: Float32Array;
	public readonly size: Float32Array;
	public readonly growth: Float32Array;
	public readonly intensity: Float32Array;
	public readonly tone: Float32Array;
	public readonly glow: Float32Array;
	public readonly buoyancy: Float32Array;
	public readonly drag: Float32Array;
	public readonly gravity: Float32Array;
	public readonly floor: Float32Array;
	public readonly rotation: Float32Array;
	public readonly spin: Float32Array;
	public readonly seed: Float32Array;

	private readonly sortKeys: Float64Array;
	private cachedArrays: Float32Array[] | null = null;

	public constructor(capacity: number) {
		if (capacity > MAX_PARTICLES) throw new RangeError(`ParticleField holds at most ${MAX_PARTICLES} particles.`);
		this.capacity = capacity;
		this.kind = new Uint8Array(capacity);
		const floats = () => new Float32Array(capacity);
		this.x = floats();
		this.y = floats();
		this.z = floats();
		this.vx = floats();
		this.vy = floats();
		this.vz = floats();
		this.age = floats();
		this.life = floats();
		this.size = floats();
		this.growth = floats();
		this.intensity = floats();
		this.tone = floats();
		this.glow = floats();
		this.buoyancy = floats();
		this.drag = floats();
		this.gravity = floats();
		this.floor = floats();
		this.rotation = floats();
		this.spin = floats();
		this.seed = floats();
		this.sortKeys = new Float64Array(capacity);
	}

	/** Particles alive right now; they occupy indices 0..count-1. */
	public get count(): number {
		return this.live;
	}

	/**
	 * Adds a particle. When the pool is full the new one replaces the particle nearest the end
	 * of its life, so a big explosion never silently fails to show — the oldest wisps give way.
	 */
	public spawn(spawn: ParticleSpawn): number {
		let index = this.live;
		if (index >= this.capacity) {
			index = this.mostSpent();
			if (index < 0) return -1;
		} else {
			this.live++;
		}
		this.kind[index] = spawn.kind;
		this.x[index] = spawn.x;
		this.y[index] = spawn.y;
		this.z[index] = spawn.z;
		this.vx[index] = spawn.vx ?? 0;
		this.vy[index] = spawn.vy ?? 0;
		this.vz[index] = spawn.vz ?? 0;
		this.age[index] = 0;
		this.life[index] = Math.max(0.01, spawn.life);
		this.size[index] = spawn.size;
		this.growth[index] = spawn.growth ?? 1;
		this.intensity[index] = spawn.intensity ?? 1;
		this.tone[index] = spawn.tone ?? 0;
		this.glow[index] = spawn.glow ?? 0;
		this.buoyancy[index] = spawn.buoyancy ?? 0;
		this.drag[index] = spawn.drag ?? 0;
		this.gravity[index] = spawn.gravity ?? 0;
		this.floor[index] = spawn.floor ?? -Infinity;
		this.rotation[index] = spawn.rotation ?? 0;
		this.spin[index] = spawn.spin ?? 0;
		this.seed[index] = spawn.seed ?? Math.random();
		return index;
	}

	/** Advances every particle and removes the ones whose time is up. */
	public step(dt: number, wind: Wind = NO_WIND): void {
		if (dt <= 0) return;
		this.time += dt;
		const time = this.time;
		let i = 0;
		while (i < this.live) {
			const age = this.age[i] + dt;
			if (age >= this.life[i]) {
				this.remove(i);
				continue;
			}
			this.age[i] = age;

			const drag = Math.exp(-this.drag[i] * dt);
			let vx = this.vx[i] * drag;
			let vy = this.vy[i] * drag;
			let vz = this.vz[i] * drag;
			vy += (this.buoyancy[i] - this.gravity[i]) * dt;

			const kind = this.kind[i];
			if (kind === PARTICLE_KIND.smoke || kind === PARTICLE_KIND.flame || kind === PARTICLE_KIND.fireball) {
				// Rising gas swirls: a cheap, smooth, per-particle wobble instead of a flow field.
				const phase = this.seed[i] * 6.2832;
				vx += Math.sin(time * 1.7 + phase + this.y[i] * 0.9) * TURBULENCE * dt;
				vz += Math.cos(time * 1.3 + phase * 1.7 + this.y[i] * 0.7) * TURBULENCE * dt;
				if (kind === PARTICLE_KIND.smoke) {
					const pull = 1 - Math.exp(-WIND_COUPLING * dt);
					vx += (wind.x - vx) * pull;
					vz += (wind.z - vz) * pull;
				}
			}

			let y = this.y[i] + vy * dt;
			if (y < this.floor[i]) {
				y = this.floor[i];
				if (vy < 0) {
					vy = -vy * BOUNCE;
					vx *= BOUNCE;
					vz *= BOUNCE;
				}
			}
			this.x[i] += vx * dt;
			this.y[i] = y;
			this.z[i] += vz * dt;
			this.vx[i] = vx;
			this.vy[i] = vy;
			this.vz[i] = vz;
			this.rotation[i] += this.spin[i] * dt;
			i++;
		}
	}

	/** Half-width now, eased between the birth and death sizes. */
	public currentSize(index: number): number {
		const t = this.age[index] / this.life[index];
		// Expands quickly at first, then settles, like a puff of gas.
		const eased = 1 - (1 - t) * (1 - t);
		return this.size[index] * (1 + (this.growth[index] - 1) * eased);
	}

	/**
	 * Fills `order` with live indices from farthest to nearest the camera, which is the order
	 * blended sprites must be drawn in. Returns how many were written.
	 *
	 * Each particle becomes one integer key, distance above and index below, so the native
	 * typed-array sort does the work without a comparator callback.
	 */
	public sortBackToFront(cameraX: number, cameraY: number, cameraZ: number, order: Uint16Array | Uint32Array): number {
		const count = Math.min(this.live, order.length);
		const keys = this.sortKeys.subarray(0, count);
		for (let i = 0; i < count; i++) {
			const dx = this.x[i] - cameraX;
			const dy = this.y[i] - cameraY;
			const dz = this.z[i] - cameraZ;
			const distance = Math.min(MAX_SORT_DISTANCE, Math.sqrt(dx * dx + dy * dy + dz * dz));
			// Centimetre steps, inverted so the farthest sorts first.
			keys[i] = (DISTANCE_STEPS - Math.round(distance * 100)) * INDEX_RANGE + i;
		}
		keys.sort();
		for (let i = 0; i < count; i++) order[i] = keys[i] % INDEX_RANGE;
		return count;
	}

	public clear(): void {
		this.live = 0;
	}

	/** The particle with the least life left, or -1 if the pool is empty. */
	private mostSpent(): number {
		let best = -1;
		let bestLeft = Infinity;
		for (let i = 0; i < this.live; i++) {
			// Scorch marks are few and long-lived; replacing one would visibly pop a decal.
			if (this.kind[i] === PARTICLE_KIND.scorch) continue;
			const left = this.life[i] - this.age[i];
			if (left < bestLeft) {
				bestLeft = left;
				best = i;
			}
		}
		return best;
	}

	/** Swap-remove: the last live particle takes this slot. */
	private remove(index: number): void {
		const last = this.live - 1;
		if (index !== last) {
			this.kind[index] = this.kind[last];
			for (const array of this.floatArrays()) array[index] = array[last];
		}
		this.live = last;
	}

	private floatArrays(): Float32Array[] {
		this.cachedArrays ??= [
			this.x, this.y, this.z, this.vx, this.vy, this.vz, this.age, this.life, this.size, this.growth,
			this.intensity, this.tone, this.glow, this.buoyancy, this.drag, this.gravity, this.floor,
			this.rotation, this.spin, this.seed,
		];
		return this.cachedArrays;
	}
}

/**
 * Turns a continuous rate (per second) into whole particles per frame, carrying the fraction
 * over, so emission is smooth at any frame rate instead of bursting on a timer.
 */
export class EmissionAccumulator {
	private carry = 0;

	public take(ratePerSecond: number, dt: number): number {
		if (ratePerSecond <= 0 || dt <= 0) return 0;
		this.carry += ratePerSecond * dt;
		const whole = Math.floor(this.carry);
		this.carry -= whole;
		return whole;
	}

	public reset(): void {
		this.carry = 0;
	}
}
