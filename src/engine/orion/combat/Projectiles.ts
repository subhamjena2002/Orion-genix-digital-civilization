import { Entity, StandardMaterial, Vec3, type AppBase } from "playcanvas";

import { playAt } from "../audio/SoundBank";
import { EmissionAccumulator } from "../effects/ParticleField";
import { crashEffects } from "../traffic/CrashEffects";
import { raycastDamageables } from "./CombatWorld";
import type { DamageSourceRef } from "./Damage";
import { detonate } from "./Explosions";
import type { Ray } from "./HitTests";
import { bounce, THROW_GRAVITY } from "./Throw";
import { WEAPON_MODEL_BASE } from "./WeaponData";
import { loadContainer } from "./WeaponModels";

/**
 * Rockets and grenades in flight. Small fixed pools: firing takes a free slot and landing returns
 * it, so nothing is created or destroyed during play. Each frame a rocket sweeps the segment it
 * travels against the world (one physics ray) and against people and cars (the spatial grid), and
 * detonates at the nearest hit. A grenade sweeps the same way but bounces off what it meets, rolls
 * to a stop and goes off when its fuse runs out.
 */

const POOL_SIZE = 8;
const GRENADE_POOL_SIZE = 8;
/** How much of a grenade's speed into a surface comes back out, and how much along it is kept. */
const GRENADE_RESTITUTION = 0.32;
const GRENADE_GRIP = 0.62;
/** Slower than this against the ground, it stops bouncing and lies there. */
const GRENADE_REST_SPEED = 0.7;
/** Held this far off what it lies on (its body's radius). */
const GRENADE_RADIUS = 0.032;
/** The rocket model's middle, from its tail (it's turned so its nose leads). */
const ROCKET_MODEL_CENTRE = 0.52;

export interface GrenadeSpec {
	fuse: number;
	explosionRadius: number;
	explosionDamage: number;
}

interface Grenade {
	entity: Entity;
	active: boolean;
	resting: boolean;
	position: Vec3;
	velocity: number[];
	age: number;
	spec: GrenadeSpec | null;
	source: DamageSourceRef | null;
	/** Tumble, degrees about its own x and z. */
	spinX: number;
	spinZ: number;
}

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
	/** A damageable the rocket passes through (the aircraft that fired it). */
	ignoreId: number;
	trail: EmissionAccumulator;
}

interface PhysicsRaycast {
	raycastFirst(start: Vec3, end: Vec3, options?: { filterCallback?: (entity: Entity) => boolean }): { point: Vec3; normal?: Vec3; entity: Entity } | null;
}

export class Projectiles {
	private readonly rockets: Rocket[] = [];
	private readonly grenades: Grenade[] = [];
	private readonly grenadeNext = new Vec3();
	private destroyed = false;
	private readonly next = new Vec3();
	private readonly ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 };
	private readonly ignore = (entity: Entity) => entity.name !== "player" && entity.name !== "gunship" && entity.name !== "grenade";

	public constructor(private readonly app: AppBase, poolSize = POOL_SIZE) {
		const material = new StandardMaterial();
		material.diffuse.set(0.16, 0.18, 0.14);
		material.useMetalness = true;
		material.metalness = 0.4;
		material.gloss = 0.5;
		material.update();
		for (let i = 0; i < poolSize; i++) {
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
			this.rockets.push({ entity, active: false, position: new Vec3(), velocity: new Vec3(), age: 0, spec: null, source: null, ignoreId: -1, trail: new EmissionAccumulator() });
		}
		const olive = new StandardMaterial();
		olive.diffuse.set(0.15, 0.18, 0.1);
		olive.gloss = 0.4;
		olive.update();
		for (let i = 0; i < GRENADE_POOL_SIZE; i++) {
			const entity = new Entity("grenade");
			const body = new Entity("grenade-body");
			body.addComponent("render", { type: "sphere", material: olive, castShadows: true });
			body.setLocalScale(0.064, 0.064, 0.064);
			entity.addChild(body);
			entity.enabled = false;
			app.root.addChild(entity);
			this.grenades.push({ entity, active: false, resting: false, position: new Vec3(), velocity: [0, 0, 0], age: 0, spec: null, source: null, spinX: 0, spinZ: 0 });
		}
		// The modelled rocket and grenade replace the stand-in shapes once they've loaded.
		this.dressWith("rocket.glb", this.rockets.map((rocket) => rocket.entity), ROCKET_MODEL_CENTRE);
		this.dressWith("grenade.glb", this.grenades.map((grenade) => grenade.entity), 0);
	}

	/** Swaps each entity's stand-in shape for a copy of the model in `file`, shifted `shift` m along +Z. */
	private dressWith(file: string, entities: readonly Entity[], shift: number): void {
		loadContainer(this.app, `${WEAPON_MODEL_BASE}/${file}`).then((asset) => {
			if (!asset || this.destroyed) return;
			const resource = asset.resource as { instantiateRenderEntity: () => Entity };
			for (const entity of entities) {
				const model = resource.instantiateRenderEntity();
				for (const render of model.findComponents("render") as unknown as { castShadows: boolean }[]) render.castShadows = true;
				model.setLocalPosition(0, 0, shift);
				for (const child of [...entity.children]) (child as Entity).destroy();
				entity.addChild(model);
			}
		}).catch(() => {
			// The stand-ins stay.
		});
	}

	/** Lobs a grenade from (x, y, z) at (vx, vy, vz). Returns false if every grenade is already out. */
	public throwGrenade(x: number, y: number, z: number, vx: number, vy: number, vz: number, spec: GrenadeSpec, source: DamageSourceRef | null): boolean {
		const grenade = this.grenades.find((candidate) => !candidate.active);
		if (!grenade) return false;
		grenade.active = true;
		grenade.resting = false;
		grenade.age = 0;
		grenade.spec = spec;
		grenade.source = source;
		grenade.position.set(x, y, z);
		grenade.velocity[0] = vx;
		grenade.velocity[1] = vy;
		grenade.velocity[2] = vz;
		grenade.spinX = Math.random() * 360;
		grenade.spinZ = Math.random() * 360;
		grenade.entity.enabled = true;
		grenade.entity.setPosition(grenade.position);
		return true;
	}

	/** Grenades fly, bounce, roll to a stop and go off when their fuse is out. */
	private updateGrenades(dt: number, physics: PhysicsRaycast | undefined) {
		for (const grenade of this.grenades) {
			if (!grenade.active || !grenade.spec) continue;
			grenade.age += dt;
			if (grenade.age >= grenade.spec.fuse || grenade.position.y < -5) {
				grenade.active = false;
				grenade.entity.enabled = false;
				const { x, y, z } = grenade.position;
				detonate(this.app, x, y + 0.1, z, grenade.spec.explosionRadius, grenade.spec.explosionDamage, grenade.source);
				continue;
			}
			if (grenade.resting) continue;
			const v = grenade.velocity;
			v[1] -= THROW_GRAVITY * dt;
			const next = this.grenadeNext.set(grenade.position.x + v[0] * dt, grenade.position.y + v[1] * dt, grenade.position.z + v[2] * dt);
			const step = Math.hypot(v[0], v[1], v[2]) * dt;
			const wall = step > 1e-5 ? physics?.raycastFirst?.(grenade.position, next, { filterCallback: this.ignore }) : null;
			if (wall?.normal) {
				const n = wall.normal;
				const speed = Math.hypot(v[0], v[1], v[2]);
				bounce(v, n.x, n.y, n.z, GRENADE_RESTITUTION, GRENADE_GRIP);
				grenade.position.set(wall.point.x + n.x * GRENADE_RADIUS, wall.point.y + n.y * GRENADE_RADIUS, wall.point.z + n.z * GRENADE_RADIUS);
				// A knock of metal on the street with each real bounce.
				if (speed > 3) playAt("casing", wall.point.x, wall.point.y, wall.point.z, { level: Math.min(0.6, speed * 0.06), variation: 0.2, channel: "impacts" });
				if (n.y > 0.6 && Math.hypot(v[0], v[1], v[2]) < GRENADE_REST_SPEED) {
					grenade.resting = true;
					v[0] = v[1] = v[2] = 0;
				}
			} else {
				// People and cars stop it dead and drop it at their feet.
				const length = Math.max(step, 1e-6);
				this.ray.ox = grenade.position.x;
				this.ray.oy = grenade.position.y;
				this.ray.oz = grenade.position.z;
				this.ray.dx = (v[0] * dt) / length;
				this.ray.dy = (v[1] * dt) / length;
				this.ray.dz = (v[2] * dt) / length;
				const body = step > 1e-5 ? raycastDamageables(this.ray, step, grenade.source?.id ?? -1) : null;
				if (body) {
					v[0] *= -0.2;
					v[2] *= -0.2;
					v[1] = Math.min(v[1], 0);
				} else {
					grenade.position.copy(next);
				}
			}
			const tumble = Math.hypot(v[0], v[2]) * dt * 900;
			grenade.spinX = (grenade.spinX + tumble) % 360;
			grenade.spinZ = (grenade.spinZ + tumble * 0.4) % 360;
			grenade.entity.setPosition(grenade.position);
			grenade.entity.setEulerAngles(grenade.spinX, 0, grenade.spinZ);
		}
	}

	/** Launches from (x, y, z) along the unit direction. Returns false if every rocket is in flight. */
	public fire(x: number, y: number, z: number, dx: number, dy: number, dz: number, spec: RocketSpec, source: DamageSourceRef | null, ignoreId = -1): boolean {
		const rocket = this.rockets.find((candidate) => !candidate.active);
		if (!rocket) return false;
		rocket.active = true;
		rocket.age = 0;
		rocket.spec = spec;
		rocket.source = source;
		rocket.ignoreId = ignoreId;
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
		this.updateGrenades(dt, physics);
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
			const body = raycastDamageables(this.ray, Math.min(step, hitDistance), rocket.ignoreId >= 0 ? rocket.ignoreId : rocket.source?.id ?? -1);
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
		this.destroyed = true;
		for (const rocket of this.rockets) rocket.entity.destroy();
		this.rockets.length = 0;
		for (const grenade of this.grenades) grenade.entity.destroy();
		this.grenades.length = 0;
	}
}
