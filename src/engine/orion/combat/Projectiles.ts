import { Entity, StandardMaterial, Vec3, type AppBase } from "playcanvas";

import { EmissionAccumulator } from "../effects/ParticleField";
import { crashEffects } from "../traffic/CrashEffects";
import { raycastDamageables } from "./CombatWorld";
import type { DamageSourceRef } from "./Damage";
import { detonate } from "./Explosions";
import type { Ray } from "./HitTests";

/**
 * Rockets in flight. A small fixed pool: firing takes a free slot and landing returns it, so
 * nothing is created or destroyed during play. Each frame a rocket sweeps the segment it travels
 * against the world (one physics ray) and against people and cars (the spatial grid), and
 * detonates at the nearest hit.
 */

const POOL_SIZE = 8;

export interface RocketSpec {
	speed: number;
	gravity: number;
	lifetime: number;
	explosionRadius: number;
	explosionDamage: number;
}

interface Rocket {
	entity: Entity;
	active: boolean;
	position: Vec3;
	velocity: Vec3;
	age: number;
	spec: RocketSpec | null;
	source: DamageSourceRef | null;
	trail: EmissionAccumulator;
}

interface PhysicsRaycast {
	raycastFirst(start: Vec3, end: Vec3, options?: { filterCallback?: (entity: Entity) => boolean }): { point: Vec3; entity: Entity } | null;
}

export class Projectiles {
	private readonly rockets: Rocket[] = [];
	private readonly next = new Vec3();
	private readonly ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 };
	private readonly ignore = (entity: Entity) => entity.name !== "player";

	public constructor(private readonly app: AppBase) {
		const material = new StandardMaterial();
		material.diffuse.set(0.16, 0.18, 0.14);
		material.useMetalness = true;
		material.metalness = 0.4;
		material.gloss = 0.5;
		material.update();
		for (let i = 0; i < POOL_SIZE; i++) {
			const entity = new Entity("rocket");
			const body = new Entity("rocket-body");
			body.addComponent("render", { type: "cylinder", material, castShadows: true });
			body.setLocalScale(0.09, 0.62, 0.09);
			body.setLocalEulerAngles(90, 0, 0);
			entity.addChild(body);
			const nose = new Entity("rocket-nose");
			nose.addComponent("render", { type: "cone", material, castShadows: true });
			nose.setLocalScale(0.09, 0.16, 0.09);
			nose.setLocalEulerAngles(-90, 0, 0);
			nose.setLocalPosition(0, 0, -0.39);
			entity.addChild(nose);
			entity.enabled = false;
			app.root.addChild(entity);
			this.rockets.push({ entity, active: false, position: new Vec3(), velocity: new Vec3(), age: 0, spec: null, source: null, trail: new EmissionAccumulator() });
		}
	}

	/** Launches from (x, y, z) along the unit direction. Returns false if every rocket is in flight. */
	public fire(x: number, y: number, z: number, dx: number, dy: number, dz: number, spec: RocketSpec, source: DamageSourceRef | null): boolean {
		const rocket = this.rockets.find((candidate) => !candidate.active);
		if (!rocket) return false;
		rocket.active = true;
		rocket.age = 0;
		rocket.spec = spec;
		rocket.source = source;
		rocket.position.set(x, y, z);
		rocket.velocity.set(dx * spec.speed, dy * spec.speed, dz * spec.speed);
		rocket.trail.reset();
		rocket.entity.enabled = true;
		this.pose(rocket);
		return true;
	}

	public update(dt: number): void {
		const physics = this.app.systems.rigidbody as unknown as PhysicsRaycast | undefined;
		const effects = crashEffects(this.app);
		for (const rocket of this.rockets) {
			if (!rocket.active || !rocket.spec) continue;
			rocket.age += dt;
			rocket.velocity.y -= rocket.spec.gravity * dt;
			this.next.copy(rocket.velocity).mulScalar(dt).add(rocket.position);

			const step = rocket.velocity.length() * dt;
			const speed = Math.max(rocket.velocity.length(), 1e-6);
			this.ray.ox = rocket.position.x;
			this.ray.oy = rocket.position.y;
			this.ray.oz = rocket.position.z;
			this.ray.dx = rocket.velocity.x / speed;
			this.ray.dy = rocket.velocity.y / speed;
			this.ray.dz = rocket.velocity.z / speed;

			let hitDistance = Infinity;
			const wall = physics?.raycastFirst?.(rocket.position, this.next, { filterCallback: this.ignore });
			if (wall) hitDistance = wall.point.distance(rocket.position);
			const body = raycastDamageables(this.ray, Math.min(step, hitDistance), rocket.source?.id ?? -1);
			if (body) hitDistance = body.distance;

			if (hitDistance !== Infinity || rocket.age >= rocket.spec.lifetime || this.next.y < -5) {
				const along = hitDistance === Infinity ? step : hitDistance;
				this.explode(rocket, rocket.position.x + this.ray.dx * along, rocket.position.y + this.ray.dy * along, rocket.position.z + this.ray.dz * along);
				continue;
			}
			rocket.position.copy(this.next);
			this.pose(rocket);
			effects.rocketExhaust(rocket.position.x, rocket.position.y, rocket.position.z, this.ray.dx, this.ray.dy, this.ray.dz, rocket.trail, dt);
		}
	}

	private explode(rocket: Rocket, x: number, y: number, z: number) {
		rocket.active = false;
		rocket.entity.enabled = false;
		const spec = rocket.spec!;
		detonate(this.app, x, y, z, spec.explosionRadius, spec.explosionDamage, rocket.source);
	}

	private pose(rocket: Rocket) {
		rocket.entity.setPosition(rocket.position);
		const v = rocket.velocity;
		const yaw = Math.atan2(-v.x, -v.z) * (180 / Math.PI);
		const pitch = Math.atan2(v.y, Math.hypot(v.x, v.z)) * (180 / Math.PI);
		rocket.entity.setEulerAngles(pitch, yaw, 0);
	}

	public destroy(): void {
		for (const rocket of this.rockets) rocket.entity.destroy();
		this.rockets.length = 0;
	}
}
