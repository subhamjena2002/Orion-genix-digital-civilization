import { BLEND_NORMAL, Entity, StandardMaterial, Vec3, type AnimComponent, type AppBase } from "playcanvas";

import { pavedHeightAt } from "../roads/RoadNetwork";

/**
 * What happens to a person hit by a car: they're thrown, tumble, land and play their death
 * clip, a blood pool spreads under them, and after a while the body sinks away so the pool
 * slot (pedestrian or officer) can come back as someone new.
 */

const GRAVITY = 9.8;
/** Share of the car's velocity the body picks up. */
const THROW_TRANSFER = 1.05;
const MAX_LIFT = 5.5;
const LIFT_PER_SPEED = 0.28;
const AIR_DRAG = 0.4;
const GROUND_FRICTION = 5;
const BOUNCE = 0.25;
const SPIN_PER_SPEED = 45;
/** Seconds the body stays after coming to rest. */
const LIE_SECONDS = 12;
const SINK_SECONDS = 1.8;
const SINK_DEPTH = 0.6;
const POOL_RADIUS = 0.85;
const POOL_GROW_SECONDS = 4;
/** A leg wound on someone still alive bleeds slower and less than a killing wound. */
const WOUND_POOL_RADIUS = 0.45;
const WOUND_POOL_GROW_SECONDS = 9;

export type KnockdownPhase = "none" | "airborne" | "down" | "gone";

/** How far above and below the body the ground is looked for. */
const GROUND_PROBE_UP = 1.5;
const GROUND_PROBE_DOWN = 4;

interface PhysicsRaycast {
	raycastAll(start: Vec3, end: Vec3): { entity: Entity; point: Vec3; normal: Vec3 }[];
}

const probeFrom = new Vec3();
const probeTo = new Vec3();

/**
 * Top of whatever is under (x, z): road or pavement from the road layout, otherwise the highest
 * upward-facing surface a short ray finds (grass, a lot, a plinth) — never a car or the player.
 * Falls back to `fallback` (the height the caller is at now) where there's nothing.
 *
 * A body used to land wherever it started out: thrown off a kerb, it came to rest level with the
 * pavement, floating over the lower grass with its legs hanging down to it.
 */
export function groundHeightAt(app: AppBase, x: number, z: number, fallback: number): number {
	const paved = pavedHeightAt(x, z);
	if (paved !== null) return paved;
	const physics = app.systems.rigidbody as unknown as PhysicsRaycast | undefined;
	if (!physics?.raycastAll) return fallback;
	probeFrom.set(x, fallback + GROUND_PROBE_UP, z);
	probeTo.set(x, fallback - GROUND_PROBE_DOWN, z);
	let best = -Infinity;
	for (const hit of physics.raycastAll(probeFrom, probeTo)) {
		if (hit.normal.y < 0.6 || hit.entity.name === "player" || hit.entity.script?.has("orionVehicle")) continue;
		if (hit.point.y > best) best = hit.point.y;
	}
	return best === -Infinity ? fallback : best;
}

let poolMaterial: StandardMaterial | null = null;

export function bloodMaterial(): StandardMaterial {
	if (poolMaterial) return poolMaterial;
	poolMaterial = new StandardMaterial();
	poolMaterial.diffuse.set(0.22, 0.01, 0.01);
	poolMaterial.specular.set(0.5, 0.2, 0.2);
	poolMaterial.gloss = 0.85;
	poolMaterial.opacity = 0.92;
	poolMaterial.blendType = BLEND_NORMAL;
	poolMaterial.depthWrite = false;
	poolMaterial.update();
	return poolMaterial;
}

export class Knockdown {
	public phase: KnockdownPhase = "none";

	private readonly velocity = new Vec3();
	/** Tracked here, not read back: a React re-render can re-apply an entity's spawn position. */
	private readonly position = new Vec3();
	private groundY = 0;
	private yaw = 0;
	private spin = 0;
	private restTime = 0;
	private pool: Entity | null = null;
	/** Current pool radius, so a wound's pool carries on growing (never shrinks) if they die. */
	private poolRadius = 0;
	/** Rotation used instead of the death clip when a model has none. */
	private fallPitch = 0;
	private hasDeathClip = false;

	public constructor(private readonly entity: Entity, private readonly app: AppBase) {}

	public get active(): boolean {
		return this.phase !== "none";
	}

	/** Throws the body along the car's velocity. */
	public strike(carVelocityX: number, carVelocityZ: number, anim: AnimComponent | null | undefined, yaw: number) {
		const speed = Math.hypot(carVelocityX, carVelocityZ);
		this.position.copy(this.entity.getPosition());
		this.groundY = groundHeightAt(this.app, this.position.x, this.position.z, this.position.y);
		this.yaw = yaw;
		this.velocity.set(
			carVelocityX * THROW_TRANSFER + (Math.random() - 0.5) * speed * 0.2,
			Math.min(MAX_LIFT, speed * LIFT_PER_SPEED + 0.8),
			carVelocityZ * THROW_TRANSFER + (Math.random() - 0.5) * speed * 0.2,
		);
		this.spin = (Math.random() < 0.5 ? -1 : 1) * speed * SPIN_PER_SPEED * (0.5 + Math.random() * 0.5);
		this.restTime = 0;
		this.fallPitch = 0;
		this.phase = "airborne";

		this.hasDeathClip = Boolean(anim?.baseLayer?.states.includes("Death"));
		// Crowds pause their animation off-screen and far away. Killed while paused — shot from a
		// distance, or just as they came into view — the body stood there dead, upright.
		if (anim) anim.playing = true;
		if (anim && this.hasDeathClip) {
			anim.speed = 1;
			anim.baseLayer?.transition("Death", 0.08);
		} else if (anim) {
			anim.speed = 0;
		}
	}

	/** Advances the body; returns the phase after this frame. */
	public update(dt: number): KnockdownPhase {
		if (this.phase === "none" || this.phase === "gone") return this.phase;
		let { x, y, z } = this.position;

		if (this.phase === "airborne") {
			this.velocity.y -= GRAVITY * dt;
			const drag = Math.exp(-AIR_DRAG * dt);
			this.velocity.x *= drag;
			this.velocity.z *= drag;
			x += this.velocity.x * dt;
			y += this.velocity.y * dt;
			z += this.velocity.z * dt;
			this.yaw += this.spin * dt;
			this.spin *= Math.exp(-2 * dt);
			if (!this.hasDeathClip) this.fallPitch = Math.min(90, this.fallPitch + 300 * dt);

			// The ground under the body where it is now, not where it was standing.
			this.groundY = groundHeightAt(this.app, x, z, this.groundY);
			if (y <= this.groundY) {
				y = this.groundY;
				if (this.velocity.y < -1.5) {
					this.velocity.y = -this.velocity.y * BOUNCE;
				} else {
					this.velocity.y = 0;
					// Slide to a stop along the road.
					const friction = Math.exp(-GROUND_FRICTION * dt);
					this.velocity.x *= friction;
					this.velocity.z *= friction;
					this.spin *= friction;
					if (Math.hypot(this.velocity.x, this.velocity.z) < 0.15) {
						this.phase = "down";
						this.spawnPool(x, z);
					}
				}
			}
		} else {
			this.restTime += dt;
			this.growPool();
			const sinkStart = LIE_SECONDS;
			if (this.restTime > sinkStart) {
				const sink = Math.min(1, (this.restTime - sinkStart) / SINK_SECONDS);
				y = this.groundY - sink * SINK_DEPTH;
				if (sink >= 1) {
					this.phase = "gone";
					this.clearPool();
				}
			}
		}

		this.position.set(x, y, z);
		this.entity.setPosition(x, y, z);
		this.entity.setEulerAngles(-this.fallPitch, this.yaw, 0);
		return this.phase;
	}

	/**
	 * Killed where they already lie (finished off while down with a wound): no throw and no second
	 * fall — the death clip is already holding them on the ground.
	 */
	public dieWhereLying(yaw: number) {
		this.position.copy(this.entity.getPosition());
		this.groundY = this.position.y;
		this.yaw = yaw;
		this.velocity.set(0, 0, 0);
		this.spin = 0;
		this.fallPitch = 0;
		this.hasDeathClip = true;
		this.restTime = 0;
		this.phase = "down";
		this.spawnPool(this.position.x, this.position.z);
	}

	/** A wound bleeding while its owner is still alive: a small pool, spreading slowly. */
	public bleed(x: number, y: number, z: number, seconds: number) {
		if (!this.pool) {
			this.groundY = y;
			this.spawnPool(x, z);
		}
		const grow = Math.min(1, seconds / WOUND_POOL_GROW_SECONDS);
		this.setPoolRadius(WOUND_POOL_RADIUS * Math.sqrt(grow) * 2);
	}

	/**
	 * Leaves the current pool where it is, for the caller to clear later: someone who gets up and
	 * limps off leaves their blood behind rather than taking it with them.
	 */
	public releasePool(): Entity | null {
		const pool = this.pool;
		this.pool = null;
		this.poolRadius = 0;
		return pool;
	}

	/** Back on their feet (the caller moves them somewhere new). */
	public reset() {
		this.phase = "none";
		this.fallPitch = 0;
		this.clearPool();
	}

	public destroy() {
		this.clearPool();
	}

	private spawnPool(x: number, z: number) {
		if (this.pool) return;
		const pool = new Entity("blood-pool");
		pool.addComponent("render", { type: "cylinder", material: bloodMaterial(), castShadows: false });
		pool.setPosition(x, this.groundY + 0.015, z);
		pool.setLocalScale(0.01, 0.004, 0.01);
		this.app.root.addChild(pool);
		this.pool = pool;
	}

	private growPool() {
		if (!this.pool) return;
		const grow = Math.min(1, this.restTime / POOL_GROW_SECONDS);
		this.setPoolRadius(POOL_RADIUS * Math.sqrt(grow) * 2);
	}

	private setPoolRadius(radius: number) {
		if (!this.pool) return;
		this.poolRadius = Math.max(this.poolRadius, radius);
		this.pool.setLocalScale(this.poolRadius, 0.004, this.poolRadius * 0.8);
	}

	private clearPool() {
		this.pool?.destroy();
		this.pool = null;
		this.poolRadius = 0;
	}
}
