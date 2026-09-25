import { Color, Entity, LIGHTFALLOFF_LINEAR, StandardMaterial, Vec3, type AppBase } from "playcanvas";

import { EmissionAccumulator, PARTICLE_KIND, ParticleField, type Wind } from "../effects/ParticleField";
import { ParticleRenderer } from "../effects/ParticleRenderer";
import { activeQuality } from "../rendering/QualityGovernor";
import type { DamageStage } from "./VehicleDamage";

/**
 * Smoke, fire, explosions and wreckage for damaged cars.
 *
 * Every sprite in the city — flames, smoke, sparks, scorch marks — is simulated in one
 * ParticleField and drawn by one instanced, procedurally shaded batch (see ParticleRenderer),
 * so a street full of burning cars costs one draw call. Fires also cast real, flickering light
 * on their surroundings: the nearest few get a light each, as many as the quality level allows.
 *
 * Emission is continuous (a rate per second, carried across frames), so fire looks the same at
 * 30 fps as at 144 instead of puffing on a timer.
 */

const CAPACITY = 1600;
const DEBRIS_POOL = 18;
const MAX_FIRE_LIGHTS = 4;
const GRAVITY = 9.8;
/** Smoke leans downwind. */
const WIND: Wind = { x: 0.7, z: 0.3 };
/** Past this many fires, each one emits proportionally less so the pool isn't swamped. */
const FULL_RATE_FIRES = 6;
/** How long an explosion's flash light takes to die away. */
const FLASH_SECONDS = 0.7;
const MUZZLE_FLASH_SECONDS = 0.06;
const MUZZLE_FLASH_INTENSITY = 3.5;
const FLASH_INTENSITY = 7;
/**
 * In daylight a fire barely lights its surroundings next to the sun, so this is modest: enough
 * to warm the road and the car's flanks, not to flood them orange.
 */
const FIRE_LIGHT_INTENSITY = 1.7;
/** Explosions shake the camera within this distance. */
const SHAKE_RADIUS = 45;
const SHAKE_SECONDS = 0.9;
const FIRE_LIGHT_COLOUR = new Color(1, 0.52, 0.18);

/** One damaged car's emitter, updated in place each frame (no per-frame allocation). */
export interface DamageSource {
	x: number;
	y: number;
	z: number;
	/** Car heading as sin/cos, for spreading fire along the body. */
	sin: number;
	cos: number;
	halfWidth: number;
	halfLength: number;
	/** Road surface under the car. */
	groundY: number;
	stage: DamageStage;
	/** 0..1 within the stage: how thick the smoke is. */
	severity: number;
}

interface Emitters {
	flame: EmissionAccumulator;
	smoke: EmissionAccumulator;
	ember: EmissionAccumulator;
	/** Frame the source last emitted on, so abandoned ones can be dropped. */
	frame: number;
}

interface Debris {
	entity: Entity;
	velocity: Vec3;
	spin: Vec3;
	age: number;
	life: number;
	floor: number;
	trail: EmissionAccumulator;
}

interface Blast {
	x: number;
	y: number;
	z: number;
	age: number;
}

interface FireLight {
	entity: Entity;
	phase: number;
}

function between(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

class CrashEffectLayer {
	private readonly field = new ParticleField(CAPACITY);
	private readonly renderer: ParticleRenderer;
	private readonly emitters = new Map<object, Emitters>();
	private readonly debris: Debris[] = [];
	private readonly blasts: Blast[] = [];
	private readonly fireLights: FireLight[] = [];
	private readonly flash: Entity;
	private flashAge = FLASH_SECONDS;
	/** One light, re-used by every shot: a muzzle flash lasts a frame or two. */
	private readonly muzzleLight: Entity;
	private muzzleAge = MUZZLE_FLASH_SECONDS;
	private readonly debrisMaterial: StandardMaterial;
	/** Fires alive this frame, nearest first once sorted; reused to avoid allocation. */
	private readonly fires: { x: number; y: number; z: number; strength: number; distance: number }[] = [];
	private fireCount = 0;
	private frame = 0;
	private time = 0;
	private lightingSynced = false;

	public constructor(private readonly app: AppBase) {
		this.renderer = new ParticleRenderer(app, CAPACITY);

		this.debrisMaterial = new StandardMaterial();
		this.debrisMaterial.diffuse.set(0.07, 0.07, 0.075);
		this.debrisMaterial.metalness = 0.6;
		this.debrisMaterial.useMetalness = true;
		this.debrisMaterial.gloss = 0.35;
		this.debrisMaterial.update();
		for (let i = 0; i < DEBRIS_POOL; i++) {
			const entity = new Entity("crash-debris");
			entity.addComponent("render", { type: "box", material: this.debrisMaterial, castShadows: false });
			entity.enabled = false;
			app.root.addChild(entity);
			this.debris.push({ entity, velocity: new Vec3(), spin: new Vec3(), age: 0, life: 0, floor: 0, trail: new EmissionAccumulator() });
		}

		for (let i = 0; i < MAX_FIRE_LIGHTS; i++) {
			this.fireLights.push({ entity: this.makeLight(`fire-light-${i}`, 12), phase: Math.random() * 100 });
		}
		this.flash = this.makeLight("explosion-flash", 32);
		this.muzzleLight = this.makeLight("muzzle-flash", 9);
		for (let i = 0; i < MAX_FIRE_LIGHTS * 4; i++) {
			this.fires.push({ x: 0, y: 0, z: 0, strength: 0, distance: 0 });
		}
	}

	/** Materials to draw once at load, so nothing compiles a shader mid-crash. */
	public get materials(): { type: string; material: StandardMaterial }[] {
		return [{ type: "box", material: this.debrisMaterial }];
	}

	/**
	 * Puts a few invisible sprites of every kind on screen for a moment, so the effects shader
	 * is compiled while the world loads rather than at the first crash.
	 */
	public prewarm(x: number, y: number, z: number) {
		for (const kind of Object.values(PARTICLE_KIND)) {
			this.field.spawn({ kind, x, y, z, size: 0.01, life: 1.5, intensity: 0 });
		}
	}

	/** Emits for one damaged car this frame. The `key` identifies the car across frames. */
	public vehicleDamage(key: object, source: Readonly<DamageSource>, dt: number) {
		let emitters = this.emitters.get(key);
		if (!emitters) {
			emitters = { flame: new EmissionAccumulator(), smoke: new EmissionAccumulator(), ember: new EmissionAccumulator(), frame: 0 };
			this.emitters.set(key, emitters);
		}
		emitters.frame = this.frame;
		const share = this.fireShare();

		switch (source.stage) {
			case "smoking": {
				const severity = source.severity;
				const puffs = emitters.smoke.take((3 + severity * 7) * share, dt);
				for (let i = 0; i < puffs; i++) {
					this.spawnSmoke(source, 0.55, {
						tone: 0.12 + severity * 0.5,
						size: between(0.22, 0.34),
						growth: 4,
						life: between(2.2, 3.6),
						rise: between(0.8, 1.3),
						intensity: 0.3 + severity * 0.4,
						glow: 0,
					});
				}
				break;
			}
			case "burning":
			case "wreck-fire": {
				const wreck = source.stage === "wreck-fire";
				// A car that has gone up burns along its whole length; one still running burns
				// from the engine bay.
				const spread = wreck ? 0.85 : 0.35;
				// A wreck's fire dies down as it burns out.
				const strength = wreck ? 0.35 + source.severity * 0.65 : 1;
				const flames = emitters.flame.take((wreck ? 58 : 42) * strength * share, dt);
				for (let i = 0; i < flames; i++) this.spawnFlame(source, spread, wreck ? between(0.5, 0.9) : between(0.42, 0.72));
				const puffs = emitters.smoke.take((wreck ? 13 : 10) * share, dt);
				for (let i = 0; i < puffs; i++) {
					this.spawnSmoke(source, spread, {
						tone: between(0.82, 0.95),
						size: between(0.45, 0.7),
						growth: 4.6,
						life: between(4.2, 6.5),
						rise: between(1.5, 2.3),
						intensity: 0.85,
						glow: 1,
					});
				}
				const embers = emitters.ember.take(7 * share, dt);
				for (let i = 0; i < embers; i++) this.spawnEmber(source, spread);
				this.addFire(source.x, source.y, source.z, wreck ? 1.25 * strength : 1);
				break;
			}
			case "smouldering": {
				const puffs = emitters.smoke.take((1.5 + source.severity * 3) * share, dt);
				for (let i = 0; i < puffs; i++) {
					this.spawnSmoke(source, 0.7, {
						tone: 0.5,
						size: between(0.3, 0.5),
						growth: 4.5,
						life: between(3.5, 5.5),
						rise: between(0.7, 1.2),
						intensity: 0.25 + source.severity * 0.35,
						glow: 0,
					});
				}
				const licks = emitters.flame.take(2.5 * source.severity * share, dt);
				for (let i = 0; i < licks; i++) this.spawnFlame(source, 0.7, between(0.18, 0.3));
				break;
			}
		}
	}

	/** A fireball, its smoke column, a shower of sparks and parts, a flash and a scorch mark. */
	public explosion(x: number, y: number, z: number, groundY: number) {
		const field = this.field;
		// The fireball: a bright core, then a rolling ball of burning gas that swells, rises and
		// cools into its own black cloud.
		for (let i = 0; i < 6; i++) {
			field.spawn({
				kind: PARTICLE_KIND.fireball, x: x + between(-0.5, 0.5), y: y + between(-0.2, 0.4), z: z + between(-0.5, 0.5),
				size: between(1.2, 1.6), growth: 1.9, life: between(0.5, 0.75), intensity: 1.35,
				rotation: Math.random() * 6.28, spin: between(-1, 1),
			});
		}
		for (let i = 0; i < 26; i++) {
			const angle = Math.random() * Math.PI * 2;
			const outward = between(2.5, 7);
			field.spawn({
				kind: PARTICLE_KIND.fireball,
				x: x + between(-0.8, 0.8), y: y + Math.random() * 0.8, z: z + between(-0.8, 0.8),
				vx: Math.cos(angle) * outward, vy: between(1.5, 6), vz: Math.sin(angle) * outward,
				size: between(0.9, 1.5), growth: 2.6, life: between(1.3, 2.3), intensity: between(1, 1.25),
				buoyancy: 2.5, drag: 2.8, rotation: Math.random() * 6.28, spin: between(-0.8, 0.8),
			});
		}
		// Flame tongues licking up out of the blast.
		for (let i = 0; i < 10; i++) {
			field.spawn({
				kind: PARTICLE_KIND.flame,
				x: x + between(-1.2, 1.2), y: y - 0.4, z: z + between(-1.2, 1.2),
				vy: between(0.5, 1.5), size: between(0.7, 1.1), growth: 0.8, life: between(0.6, 1), intensity: 1.2,
				buoyancy: 1.5, drag: 1.5, rotation: Math.random() * 6.28, spin: between(-2, 2),
			});
		}
		// The black column that hangs over the wreck.
		for (let i = 0; i < 26; i++) {
			const angle = Math.random() * Math.PI * 2;
			const outward = between(0.5, 3);
			field.spawn({
				kind: PARTICLE_KIND.smoke,
				x: x + between(-1.2, 1.2), y: y + Math.random() * 1.5, z: z + between(-1.2, 1.2),
				vx: Math.cos(angle) * outward, vy: between(2.5, 6), vz: Math.sin(angle) * outward,
				size: between(1.3, 2.1), growth: 3.2, life: between(5, 8.5), intensity: 0.92, tone: 0.95, glow: 1,
				buoyancy: 1.2, drag: 0.9, rotation: Math.random() * 6.28, spin: between(-0.3, 0.3),
			});
		}
		// Dust kicked out along the ground by the blast wave.
		for (let i = 0; i < 18; i++) {
			const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
			const outward = between(6, 10);
			field.spawn({
				kind: PARTICLE_KIND.smoke,
				x: x + Math.cos(angle) * 1.2, y: groundY + 0.5, z: z + Math.sin(angle) * 1.2,
				vx: Math.cos(angle) * outward, vy: between(0.3, 1), vz: Math.sin(angle) * outward,
				size: between(0.7, 1), growth: 3.5, life: between(1.8, 3), intensity: 0.5, tone: 0.35,
				drag: 2.4, rotation: Math.random() * 6.28, spin: between(-0.6, 0.6),
			});
		}
		for (let i = 0; i < 80; i++) {
			const angle = Math.random() * Math.PI * 2;
			const outward = between(3, 14);
			field.spawn({
				kind: PARTICLE_KIND.spark,
				x, y: y - 0.3, z,
				vx: Math.cos(angle) * outward, vy: between(3, 15), vz: Math.sin(angle) * outward,
				size: between(0.025, 0.05), life: between(0.8, 2), intensity: between(0.7, 1.2),
				gravity: GRAVITY, drag: 0.35, floor: groundY + 0.02,
			});
		}
		field.spawn({
			kind: PARTICLE_KIND.scorch, x, y: groundY + 0.035, z,
			size: between(3, 3.8), life: 120, intensity: 1, rotation: Math.random() * 6.28,
		});

		for (let i = 0; i < 12; i++) this.throwDebris(x, y, z, groundY);

		this.flashAge = 0;
		this.flash.setPosition(x, y + 1.5, z);
		this.flash.enabled = true;
		this.blasts.push({ x, y, z, age: 0 });
	}

	/**
	 * A gunshot at the muzzle: a white-hot flash cone along the barrel, a puff of smoke that
	 * lingers, and a burst of light on whatever's around. (dx, dy, dz) is the unit firing direction.
	 */
	public muzzleFlash(x: number, y: number, z: number, dx: number, dy: number, dz: number, style: "pistol" | "rifle" | "shotgun" | "rocket") {
		const field = this.field;
		const big = style === "shotgun" || style === "rocket" ? 1.6 : style === "rifle" ? 1.15 : 0.85;
		for (let i = 0; i < 3; i++) {
			const reach = 0.06 + i * 0.07 * big;
			field.spawn({
				kind: PARTICLE_KIND.fireball, x: x + dx * reach, y: y + dy * reach, z: z + dz * reach,
				vx: dx * 4, vy: dy * 4, vz: dz * 4,
				size: (0.07 - i * 0.012) * big, growth: 1.6, life: 0.05 + Math.random() * 0.02, intensity: 1.6,
				rotation: Math.random() * 6.28,
			});
		}
		// Sparks of burning powder shot out of the barrel.
		const sparks = style === "shotgun" ? 6 : 2;
		for (let i = 0; i < sparks; i++) {
			field.spawn({
				kind: PARTICLE_KIND.spark, x, y, z,
				vx: dx * between(12, 25) + between(-1.5, 1.5), vy: dy * between(12, 25) + between(-1, 1.5), vz: dz * between(12, 25) + between(-1.5, 1.5),
				size: 0.008, life: between(0.05, 0.12), intensity: 1.2, drag: 3,
			});
		}
		field.spawn({
			kind: PARTICLE_KIND.smoke, x: x + dx * 0.1, y: y + dy * 0.1, z: z + dz * 0.1,
			vx: dx * 1.2, vy: 0.25, vz: dz * 1.2,
			size: 0.07 * big, growth: 5, life: between(0.7, 1.1), intensity: 0.28, tone: 0.2,
			buoyancy: 0.4, drag: 2.5, rotation: Math.random() * 6.28, spin: between(-1, 1),
		});
		this.muzzleAge = 0;
		this.muzzleLight.setPosition(x + dx * 0.2, y + dy * 0.2, z + dz * 0.2);
		this.muzzleLight.enabled = true;
	}

	/**
	 * A round striking something: sparks and a dust puff off hard surfaces (brighter off metal),
	 * a dark puff off a person. (nx, ny, nz) points back out of the surface.
	 */
	public impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: "hard" | "metal" | "flesh") {
		const field = this.field;
		const sparks = surface === "metal" ? 7 : surface === "hard" ? 3 : 0;
		for (let i = 0; i < sparks; i++) {
			const speed = between(2, surface === "metal" ? 9 : 5);
			field.spawn({
				kind: PARTICLE_KIND.spark, x, y, z,
				vx: (nx + between(-0.7, 0.7)) * speed, vy: (ny + between(-0.2, 0.9)) * speed, vz: (nz + between(-0.7, 0.7)) * speed,
				size: between(0.006, 0.012), life: between(0.12, 0.35), intensity: between(0.8, 1.2),
				gravity: GRAVITY, drag: 1.5, floor: y - 3,
			});
		}
		field.spawn({
			kind: PARTICLE_KIND.smoke, x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05,
			vx: nx * 0.8, vy: 0.3 + ny * 0.8, vz: nz * 0.8,
			size: surface === "flesh" ? 0.06 : 0.09, growth: 4, life: between(0.5, 0.9),
			intensity: surface === "flesh" ? 0.5 : 0.4, tone: surface === "flesh" ? 0.85 : 0.3,
			drag: 3, rotation: Math.random() * 6.28, spin: between(-1, 1),
		});
	}

	/** A tracer: a hot streak flying from the muzzle towards where the round went. */
	public tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
		const length = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
		if (length < 2) return;
		const speed = 320;
		this.field.spawn({
			kind: PARTICLE_KIND.spark, x: x0, y: y0, z: z0,
			vx: ((x1 - x0) / length) * speed, vy: ((y1 - y0) / length) * speed, vz: ((z1 - z0) / length) * speed,
			size: 0.012, life: Math.min(0.35, length / speed), intensity: 1.1,
		});
	}

	/** Rocket exhaust for one frame of flight: flame at the nozzle and a smoke trail left behind. */
	public rocketExhaust(x: number, y: number, z: number, dx: number, dy: number, dz: number, trail: EmissionAccumulator, dt: number) {
		const puffs = trail.take(70, dt);
		for (let i = 0; i < puffs; i++) {
			const back = Math.random() * 0.3;
			this.field.spawn({
				kind: i % 3 === 0 ? PARTICLE_KIND.fireball : PARTICLE_KIND.smoke,
				x: x - dx * back, y: y - dy * back, z: z - dz * back,
				vx: -dx * 3 + between(-0.4, 0.4), vy: -dy * 3 + between(-0.2, 0.4), vz: -dz * 3 + between(-0.4, 0.4),
				size: i % 3 === 0 ? 0.1 : 0.14, growth: i % 3 === 0 ? 1.5 : 6, life: i % 3 === 0 ? 0.12 : between(1.4, 2.4),
				intensity: i % 3 === 0 ? 1.4 : 0.55, tone: 0.35, drag: 1.4, buoyancy: 0.3, rotation: Math.random() * 6.28,
			});
		}
	}

	/** Camera shake (metres of jitter) felt at a point from recent explosions. */
	public cameraShake(x: number, y: number, z: number): number {
		let shake = 0;
		for (const blast of this.blasts) {
			const distance = Math.hypot(blast.x - x, blast.y - y, blast.z - z);
			if (distance >= SHAKE_RADIUS) continue;
			const fade = 1 - blast.age / SHAKE_SECONDS;
			const falloff = 1 - distance / SHAKE_RADIUS;
			shake += 0.35 * fade * fade * falloff * falloff;
		}
		return shake;
	}

	public update(dt: number, cameraX: number, cameraY: number, cameraZ: number) {
		this.frame++;
		this.time += dt;
		this.syncLighting();
		this.field.step(dt, WIND);
		this.updateDebris(dt);
		this.updateLights(dt, cameraX, cameraY, cameraZ);
		for (let i = this.blasts.length - 1; i >= 0; i--) {
			this.blasts[i].age += dt;
			if (this.blasts[i].age >= SHAKE_SECONDS) this.blasts.splice(i, 1);
		}
		// Cars that stopped emitting (recycled or repaired) give up their emitters.
		if (this.frame % 120 === 0) {
			for (const [key, emitters] of this.emitters) {
				if (this.frame - emitters.frame > 120) this.emitters.delete(key);
			}
		}
		this.renderer.draw(this.field, dt, cameraX, cameraY, cameraZ);
	}

	private spawnFlame(source: Readonly<DamageSource>, spread: number, size: number) {
		const along = between(-spread, spread) * source.halfLength;
		const across = between(-0.8, 0.8) * source.halfWidth;
		this.field.spawn({
			kind: PARTICLE_KIND.flame,
			x: source.x + along * source.sin + across * source.cos,
			y: source.y + between(-0.1, 0.15),
			z: source.z + along * source.cos - across * source.sin,
			vx: between(-0.3, 0.3), vy: between(0.6, 1.4), vz: between(-0.3, 0.3),
			size, growth: 0.75, life: between(0.6, 1), intensity: between(0.95, 1.3),
			buoyancy: 4.5, drag: 1.6, rotation: Math.random() * 6.28, spin: between(-2, 2),
		});
	}

	private spawnSmoke(source: Readonly<DamageSource>, spread: number, puff: { tone: number; size: number; growth: number; life: number; rise: number; intensity: number; glow: number }) {
		const along = between(-spread, spread) * source.halfLength;
		const across = between(-0.6, 0.6) * source.halfWidth;
		this.field.spawn({
			kind: PARTICLE_KIND.smoke,
			x: source.x + along * source.sin + across * source.cos,
			y: source.y + 0.5 + Math.random() * 0.3,
			z: source.z + along * source.cos - across * source.sin,
			vx: between(-0.35, 0.35), vy: puff.rise, vz: between(-0.35, 0.35),
			size: puff.size, growth: puff.growth, life: puff.life, intensity: puff.intensity,
			tone: puff.tone, glow: puff.glow, buoyancy: 0.6, drag: 0.55,
			rotation: Math.random() * 6.28, spin: between(-0.5, 0.5),
		});
	}

	private spawnEmber(source: Readonly<DamageSource>, spread: number) {
		const along = between(-spread, spread) * source.halfLength;
		this.field.spawn({
			kind: PARTICLE_KIND.spark,
			x: source.x + along * source.sin, y: source.y + 0.4, z: source.z + along * source.cos,
			vx: between(-0.8, 0.8), vy: between(2, 4.5), vz: between(-0.8, 0.8),
			size: between(0.018, 0.03), life: between(1, 2.2), intensity: between(0.6, 1),
			gravity: 1.2, drag: 1.1, floor: source.groundY,
		});
	}

	private throwDebris(x: number, y: number, z: number, groundY: number) {
		const piece = this.debris.find((candidate) => !candidate.entity.enabled);
		if (!piece) return;
		const angle = Math.random() * Math.PI * 2;
		const speed = between(4, 11);
		piece.velocity.set(Math.cos(angle) * speed, between(4, 10), Math.sin(angle) * speed);
		piece.spin.set(between(-900, 900), between(-900, 900), between(-900, 900));
		piece.age = 0;
		piece.life = between(3, 5);
		piece.floor = groundY;
		piece.trail.reset();
		const size = between(0.12, 0.4);
		piece.entity.setLocalScale(size, size * between(0.2, 0.6), size * between(0.6, 1.4));
		piece.entity.setPosition(x, y, z);
		piece.entity.enabled = true;
	}

	private updateDebris(dt: number) {
		for (const piece of this.debris) {
			if (!piece.entity.enabled) continue;
			piece.age += dt;
			if (piece.age >= piece.life) {
				piece.entity.enabled = false;
				continue;
			}
			const position = piece.entity.getPosition();
			piece.velocity.y -= GRAVITY * dt;
			let x = position.x + piece.velocity.x * dt;
			let y = position.y + piece.velocity.y * dt;
			let z = position.z + piece.velocity.z * dt;
			const half = piece.entity.getLocalScale().y / 2;
			if (y < piece.floor + half) {
				y = piece.floor + half;
				piece.velocity.set(piece.velocity.x * 0.45, Math.abs(piece.velocity.y) * 0.25, piece.velocity.z * 0.45);
				piece.spin.mulScalar(0.5);
				if (Math.abs(piece.velocity.y) < 0.4) piece.velocity.y = 0;
			}
			if (piece.velocity.lengthSq() < 0.05) {
				x = position.x;
				z = position.z;
			}
			piece.entity.setPosition(x, y, z);
			piece.entity.rotateLocal(piece.spin.x * dt, piece.spin.y * dt, piece.spin.z * dt);
			// Burning parts trail fire and smoke while they fly. The fire is a small round ball, not a
			// flame tongue: a tongue stands upright on its base, which reads wrong on a tumbling part.
			if (piece.age < 1.2 && piece.velocity.lengthSq() > 1) {
				const puffs = piece.trail.take(22, dt);
				for (let i = 0; i < puffs; i++) {
					const fire = i % 2 === 0;
					this.field.spawn({
						kind: fire ? PARTICLE_KIND.fireball : PARTICLE_KIND.smoke,
						x, y, z,
						size: fire ? between(0.12, 0.2) : 0.18, growth: fire ? 2.2 : 4, life: fire ? between(0.35, 0.55) : between(1.2, 2),
						intensity: fire ? 1 : 0.55, tone: 0.9, buoyancy: 0.6, drag: 1.2,
						rotation: Math.random() * 6.28,
					});
				}
			}
		}
	}

	private addFire(x: number, y: number, z: number, strength: number) {
		if (this.fireCount >= this.fires.length) return;
		const fire = this.fires[this.fireCount++];
		fire.x = x;
		fire.y = y;
		fire.z = z;
		fire.strength = strength;
	}

	/** Each fire's share of the full emission rate, thinned when many burn at once. */
	private fireShare(): number {
		return Math.min(1, FULL_RATE_FIRES / Math.max(1, this.emitters.size));
	}

	private updateLights(dt: number, cameraX: number, cameraY: number, cameraZ: number) {
		const count = this.fireCount;
		for (let i = 0; i < count; i++) {
			const fire = this.fires[i];
			fire.distance = Math.hypot(fire.x - cameraX, fire.y - cameraY, fire.z - cameraZ);
		}
		// Only the nearest few get lights; a partial selection sort is plenty for a handful.
		const lit = Math.min(count, activeQuality().fireLights, this.fireLights.length);
		for (let i = 0; i < lit; i++) {
			let nearest = i;
			for (let j = i + 1; j < count; j++) if (this.fires[j].distance < this.fires[nearest].distance) nearest = j;
			if (nearest !== i) [this.fires[i], this.fires[nearest]] = [this.fires[nearest], this.fires[i]];
		}
		for (let i = 0; i < this.fireLights.length; i++) {
			const { entity, phase } = this.fireLights[i];
			if (i >= lit) {
				if (entity.enabled) entity.enabled = false;
				continue;
			}
			const fire = this.fires[i];
			if (!entity.enabled) entity.enabled = true;
			const t = this.time * 9 + phase;
			const flicker = 0.78 + Math.sin(t) * 0.1 + Math.sin(t * 2.3 + 1.7) * 0.08 + Math.sin(t * 5.1) * 0.04;
			entity.setPosition(fire.x, fire.y + 1.1, fire.z);
			if (entity.light) entity.light.intensity = FIRE_LIGHT_INTENSITY * fire.strength * flicker;
		}
		this.fireCount = 0;

		if (this.muzzleLight.enabled) {
			this.muzzleAge += dt;
			const t = this.muzzleAge / MUZZLE_FLASH_SECONDS;
			if (t >= 1) this.muzzleLight.enabled = false;
			else if (this.muzzleLight.light) this.muzzleLight.light.intensity = MUZZLE_FLASH_INTENSITY * (1 - t);
		}

		if (this.flash.enabled) {
			this.flashAge += dt;
			const t = this.flashAge / FLASH_SECONDS;
			if (t >= 1) {
				this.flash.enabled = false;
			} else if (this.flash.light) {
				this.flash.light.intensity = FLASH_INTENSITY * (1 - t) * (1 - t);
			}
		}
	}

	private makeLight(name: string, range: number): Entity {
		const entity = new Entity(name);
		entity.addComponent("light", {
			type: "omni",
			color: FIRE_LIGHT_COLOUR,
			intensity: 0,
			range,
			falloffMode: LIGHTFALLOFF_LINEAR,
			castShadows: false,
		});
		entity.enabled = false;
		this.app.root.addChild(entity);
		return entity;
	}

	/** Smoke is lit by the scene's sun, read from the key light once it exists. */
	private syncLighting() {
		if (this.lightingSynced) return;
		const sun = this.app.root.findByName("key-light") as Entity | null;
		if (!sun?.light) return;
		const toSun = sun.up;
		const colour = sun.light.color;
		const strength = sun.light.intensity;
		this.renderer.setLighting(
			[toSun.x, toSun.y, toSun.z],
			[colour.r * strength, colour.g * strength, colour.b * strength],
			[0.3 + strength * 0.05, 0.33 + strength * 0.05, 0.38 + strength * 0.05],
		);
		this.lightingSynced = true;
	}
}

export type { CrashEffectLayer };

const layers = new WeakMap<AppBase, CrashEffectLayer>();

export function crashEffects(app: AppBase): CrashEffectLayer {
	let layer = layers.get(app);
	if (!layer) {
		layer = new CrashEffectLayer(app);
		layers.set(app, layer);
	}
	return layer;
}
