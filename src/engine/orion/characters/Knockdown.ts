import { BLEND_NORMAL, Entity, StandardMaterial, Vec3, type AnimComponent, type AppBase } from "playcanvas";

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

export type KnockdownPhase = "none" | "airborne" | "down" | "gone";

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
		this.groundY = this.position.y;
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
		const radius = POOL_RADIUS * Math.sqrt(grow) * 2;
		this.pool.setLocalScale(radius, 0.004, radius * 0.8);
	}

	private clearPool() {
		this.pool?.destroy();
		this.pool = null;
	}
}
