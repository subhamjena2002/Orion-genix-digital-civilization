import { AnimTrack, Asset, Color, Entity, Script, StandardMaterial, Vec3 } from "playcanvas";

import { onWorldReset } from "../world/WorldReset";
import { damageableMoved, registerDamageable, unregisterDamageable, type Listener } from "../combat/CombatWorld";
import { Health, makeDamageEvent, nextCombatId, type DamageEvent, type DamageSourceRef } from "../combat/Damage";
import { bodyZone, zoneDamage } from "../combat/HitZones";
import { weaponById } from "../combat/WeaponData";
import { WeaponModels, type WeaponVisual } from "../combat/WeaponModels";
import { groundHeightAt, Knockdown } from "../characters/Knockdown";
import { RestPose } from "../characters/RestPose";
import { readPlayerPose } from "../player/PlayerPose";
import { mergeCharacterMaterials } from "../rendering/CharacterMerge";
import { fixSkinnedBounds } from "../rendering/SkinnedBounds";
import { applySmoothShading } from "../rendering/SmoothShading";
import { crashEffects } from "../traffic/CrashEffects";
import { registerTrafficAgent, unregisterTrafficAgent, type TrafficAgent } from "../traffic/TrafficAgents";
import { FIRE_FROM_STARS, fireAtPlayer, nextShotDelay, policeGun, RIFLES_FROM_STARS, type PlayerCarState } from "./PoliceFire";
import { POLICE_UNIFORM } from "./Police";
import { ARREST_MAX_STARS, markArrestable, readWanted, reportCrime, spotted } from "./Wanted";

/**
 * An officer who gets out of a patrol car to fight on foot.
 *
 * A patrol car that pulls up beside the player (on foot, or stopped in a car) puts its crew out:
 * they step out of the doors, take position beside the car and open fire — pistols, or assault
 * rifles from four stars. At one star they hold the player at gunpoint instead, for an arrest.
 * If the player gets away or drives off they run back and get in, and the chase goes on.
 *
 * A fixed pool of these waits out of the world (like the patrol cars themselves) and is lent to
 * whichever car needs a crew; see `requestOfficer`.
 */

export type FootOfficerState = "stowed" | "exiting" | "fighting" | "returning" | "down";

const HEALTH = 150;
const BODY_RADIUS = 0.3;
const BODY_HEIGHT = 1.8;
const THROW_IMPULSE = 3.5;
/** Walking pace out of the car and running pace back to it. */
const STEP_OUT_SPEED = 2.2;
const RUN_BACK_SPEED = 4.2;
const TURN_RESPONSE = 10;
/** A beat after reaching position before the first shot. */
const FIRST_SHOT_DELAY = 0.6;
/** An officer is back in the car this close to the door. */
const BOARD_DISTANCE = 0.4;
/** Seen from this far by an officer on foot. */
const SIGHT_RANGE = 70;
/** Held at gunpoint this close, standing still, at low stars: an arrest. */
const ARREST_RANGE = 5.5;
const UNTINTED = ["eye"];
const DARK_PARTS = ["sock", "shoe", "black", "brown", "belt", "grey"];
const STOW_Y = -400;

const pool: OrionFootOfficer[] = [];

/** An officer free to be sent out, or null if every one is already out. */
export function requestOfficer(): OrionFootOfficer | null {
	return pool.find((officer) => officer.state === "stowed" && officer.isReady) ?? null;
}

export class OrionFootOfficer extends Script {
	public static scriptName = "orionFootOfficer";

	public asset: Asset | null = null;
	public seed = 1;
	public cap: Entity | null = null;
	/** This rig's head-end bone sits above the hair, so the cap comes down from it, not up. */
	public capLift = -0.1;

	public state: FootOfficerState = "stowed";
	/** Where to get back in (updated by the car while the officer is out). */
	public readonly door = new Vec3();
	/** Where to stand and fight. */
	private readonly post = new Vec3();
	private groundY = 0;
	private yaw = 0;
	private fireTimer = 0;
	private shooting = 0;
	private playerCar: PlayerCarState | null = null;

	private ready = false;
	private model: Entity | null = null;
	private head: Entity | null = null;
	private wrist: Entity | null = null;
	private weapons: WeaponModels | null = null;
	private pistol: WeaponVisual | null = null;
	private rifle: WeaponVisual | null = null;
	private knockdown: Knockdown | null = null;
	private agent: TrafficAgent | null = null;
	private body: Listener | null = null;
	private readonly health = new Health(HEALTH);
	private readonly source: DamageSourceRef = { id: nextCombatId(), kind: "npc", x: 0, z: 0 };
	private readonly shot: DamageEvent = makeDamageEvent();
	private readonly muzzle = new Vec3();
	private clips = new Set<string>();
	private clip = "";
	/** For starting the clips over once a downed officer is reused (see RestPose). */
	private restPose: RestPose | null = null;
	private animations: readonly Asset[] | undefined;

	public get isReady(): boolean {
		return this.ready;
	}

	/** Killed or knocked down: out of the fight for good. */
	public get down(): boolean {
		return this.state === "down";
	}

	public initialize() {
		this.agent = registerTrafficAgent("person", 0.3);
		this.agent.onStruck = (velocityX, velocityZ) => this.struck(velocityX, velocityZ);
		this.knockdown = new Knockdown(this.entity, this.app);
		const isAlive = () => this.ready && this.state !== "stowed" && this.state !== "down" && this.health.alive;
		this.body = {
			id: this.source.id,
			kind: "person",
			x: 0, y: STOW_Y, z: 0,
			radius: BODY_RADIUS,
			height: BODY_HEIGHT,
			halfLength: 0, headingX: 0, headingZ: 1,
			get alive() {
				return isAlive();
			},
			takeDamage: (event) => this.takeDamage(event),
		};
		pool.push(this);
		// A fresh start: every officer back in the cars, whatever they were doing.
		const stopListening = onWorldReset(() => {
			if (this.state === "stowed") return;
			if (this.state === "down") this.restartClips();
			this.stow();
		});
		this.on("destroy", () => {
			stopListening();
			pool.splice(pool.indexOf(this), 1);
			if (this.agent) unregisterTrafficAgent(this.agent);
			if (this.body) unregisterDamageable(this.body);
			this.knockdown?.destroy();
			this.weapons?.destroy();
		});
		this.stow();
		this.trySetup();
	}

	/** Out of the car at `door` (ground height `groundY`) to fight from `post`. */
	public deploy(doorX: number, doorZ: number, postX: number, postZ: number, groundY: number) {
		this.groundY = groundHeightAt(this.app, doorX, doorZ, groundY);
		this.door.set(doorX, this.groundY, doorZ);
		this.post.set(postX, this.groundY, postZ);
		this.health.reset();
		this.knockdown?.reset();
		this.state = "exiting";
		this.fireTimer = FIRST_SHOT_DELAY;
		this.entity.setPosition(doorX, this.groundY, doorZ);
		this.setVisible(true);
		if (this.agent) this.agent.alive = true;
		this.play("Run");
	}

	/** Back to the car. */
	public recall() {
		if (this.state === "exiting" || this.state === "fighting") this.state = "returning";
	}

	/** Back in the car (or gone): true once the car can drive off without them. */
	public get aboard(): boolean {
		return this.state === "stowed" || this.state === "down";
	}

	/** The car the player is in, if any: a round that hits it damages the car. */
	public setPlayerCar(car: PlayerCarState | null) {
		this.playerCar = car;
	}

	public update(dt: number) {
		if (!this.ready) {
			this.trySetup();
			if (!this.ready) return;
		}
		if (this.state === "stowed") return;
		if (this.state === "down") {
			this.updateDown(dt);
			return;
		}

		const player = readPlayerPose();
		const here = this.entity.getPosition();
		const wanted = readWanted();
		// Nobody wanted any more: back to the car.
		if (wanted.stars === 0) this.recall();

		if (this.state === "exiting") {
			if (this.walkTo(this.post, STEP_OUT_SPEED, dt)) this.state = "fighting";
		} else if (this.state === "returning") {
			if (this.walkTo(this.door, RUN_BACK_SPEED, dt)) {
				this.stow();
				return;
			}
		} else {
			this.fight(dt, player.x, player.z, here.x, here.z, wanted.stars);
		}
		this.publish();
	}

	/** After animation: the gun in the right hand, pointing at the player. */
	public postUpdate() {
		if (!this.ready || this.state === "stowed") return;
		const gun = this.gunFor(readWanted().stars);
		for (const visual of [this.pistol, this.rifle]) {
			if (visual) visual.root.enabled = visual === gun && this.state !== "down";
		}
		if (!gun || !this.wrist || this.state === "down") return;
		const hand = this.wrist.getPosition();
		gun.root.setPosition(hand.x, hand.y, hand.z);
		const player = readPlayerPose();
		if (this.state === "fighting") gun.root.lookAt(player.x, player.y + 1.2, player.z);
		else gun.root.setEulerAngles(-60, this.yaw, 0);
		this.followCap();
	}

	private fight(dt: number, playerX: number, playerZ: number, x: number, z: number, stars: number) {
		const distance = Math.hypot(playerX - x, playerZ - z);
		this.turnTowards((Math.atan2(playerX - x, playerZ - z) * 180) / Math.PI, dt);
		if (distance < SIGHT_RANGE) spotted(playerX, playerZ);
		const player = readPlayerPose();
		// Held at gunpoint: standing still close by, while they still mean to take the player alive.
		if (stars <= ARREST_MAX_STARS && !player.inVehicle && distance < ARREST_RANGE && player.speed < 1.2) markArrestable();

		this.shooting = Math.max(0, this.shooting - dt);
		if (this.shooting === 0) this.play("Aim");
		if (stars < FIRE_FROM_STARS) return;
		this.fireTimer -= dt;
		if (this.fireTimer > 0) return;
		const gun = policeGun(stars);
		this.fireTimer = nextShotDelay(gun);
		const visual = this.gunFor(stars);
		if (visual) visual.root.getWorldTransform().transformPoint(visual.muzzle as Vec3, this.muzzle);
		else this.muzzle.set(x, this.groundY + 1.4, z);
		this.source.x = x;
		this.source.z = z;
		fireAtPlayer(this.app, this.muzzle.x, this.muzzle.y, this.muzzle.z, gun, this.playerCar, this.source, this.shot);
		this.play("Shoot", true);
		this.shooting = 0.35;
	}

	/** Walks towards `target`; true on arrival. */
	private walkTo(target: Vec3, speed: number, dt: number): boolean {
		const here = this.entity.getPosition();
		const dx = target.x - here.x;
		const dz = target.z - here.z;
		const distance = Math.hypot(dx, dz);
		if (distance < BOARD_DISTANCE) return true;
		const step = Math.min(distance, speed * dt);
		const x = here.x + (dx / distance) * step;
		const z = here.z + (dz / distance) * step;
		// Feet on whatever is underfoot (road, kerb, grass), not the height of the car's wheels.
		this.groundY = groundHeightAt(this.app, x, z, this.groundY);
		this.entity.setPosition(x, this.groundY, z);
		this.turnTowards((Math.atan2(dx, dz) * 180) / Math.PI, dt);
		this.play("Run");
		return false;
	}

	private turnTowards(target: number, dt: number) {
		const turn = ((target - this.yaw + 540) % 360) - 180;
		this.yaw += turn * (1 - Math.exp(-TURN_RESPONSE * dt));
		this.entity.setEulerAngles(0, this.yaw, 0);
	}

	private publish() {
		const here = this.entity.getPosition();
		if (this.agent) {
			this.agent.x = here.x;
			this.agent.z = here.z;
		}
		if (this.body) {
			this.body.x = here.x;
			this.body.y = this.groundY;
			this.body.z = here.z;
			damageableMoved(this.body);
		}
	}

	private takeDamage(event: DamageEvent) {
		if (this.state === "stowed" || this.state === "down" || !this.knockdown) return;
		const zone = bodyZone(event.y, this.groundY, BODY_HEIGHT);
		const killed = this.health.damage(zoneDamage(event.amount, event.type, zone));
		if (event.source?.kind === "player") reportCrime(killed ? "copKilled" : "assault", event.x, event.z);
		if (!killed) {
			this.play("Hit", true);
			this.shooting = 0.45;
			return;
		}
		const impulse = zone === "head" ? 0 : event.impulse >= THROW_IMPULSE ? event.impulse : event.impulse * 0.4;
		this.goDown(event.directionX * impulse, event.directionZ * impulse);
		crashEffects(this.app).impact(event.x, event.y, event.z, -event.directionX, 0.3, -event.directionZ, "flesh");
	}

	private struck(velocityX: number, velocityZ: number) {
		if (this.state === "stowed" || this.state === "down") return;
		this.health.damage(this.health.current);
		reportCrime("copKilled", this.entity.getPosition().x, this.entity.getPosition().z);
		this.goDown(velocityX, velocityZ);
	}

	private goDown(velocityX: number, velocityZ: number) {
		this.state = "down";
		if (this.agent) this.agent.alive = false;
		this.knockdown?.strike(velocityX, velocityZ, this.model?.anim, this.yaw);
	}

	private updateDown(dt: number) {
		const phase = this.knockdown?.update(dt);
		this.followCap();
		if (phase !== "gone") return;
		// The next crew member out of a car is this body: fresh clips, or the dead pose stays on the torso.
		this.restartClips();
		this.stow();
	}

	/** New clips on a skeleton back at rest (see RestPose). */
	private restartClips() {
		if (!this.model || !this.restPose) return;
		this.restPose.restartAnimation(this.model, (target) => this.assignClips(target, this.animations));
		this.clip = "";
	}

	/** Out of the world until the next car needs a crew. */
	private stow() {
		this.state = "stowed";
		this.knockdown?.reset();
		this.setVisible(false);
		this.entity.setPosition(0, STOW_Y, 0);
		if (this.agent) {
			this.agent.alive = false;
			this.agent.x = 1e6;
			this.agent.z = 1e6;
		}
		if (this.body) {
			this.body.x = 1e6;
			this.body.z = 1e6;
			damageableMoved(this.body);
		}
	}

	private setVisible(visible: boolean) {
		for (const child of this.entity.children) (child as Entity).enabled = visible;
		if (this.cap) this.cap.enabled = visible;
	}

	private gunFor(stars: number): WeaponVisual | null {
		return stars >= RIFLES_FROM_STARS ? this.rifle : this.pistol;
	}

	private followCap() {
		if (!this.head || !this.cap) return;
		const headPosition = this.head.getPosition();
		this.cap.setPosition(headPosition.x, headPosition.y + this.capLift, headPosition.z);
		this.cap.setEulerAngles(0, this.yaw, 0);
	}

	private play(clip: "Run" | "Aim" | "Shoot" | "Hit", restart = false) {
		const anim = this.model?.anim;
		if (!anim) return;
		let state: string = clip;
		if (!this.clips.has(state)) state = clip === "Shoot" || clip === "Hit" ? "Aim" : "Idle";
		if (!this.clips.has(state)) return;
		if (state === this.clip && !restart) return;
		this.clip = state;
		anim.playing = true;
		anim.baseLayer?.transition(state, state === "Shoot" || state === "Hit" ? 0.05 : 0.2);
	}

	private trySetup() {
		const resource = this.asset?.resource as { animations?: readonly Asset[] } | undefined;
		const scaled = this.entity.findByName("officer-model") as Entity | null;
		const model = scaled?.children[0]?.children[0] as Entity | undefined;
		if (!resource || !model) return;

		applySmoothShading(model);
		fixSkinnedBounds(model);
		this.applyUniform(model);
		mergeCharacterMaterials(model, this.app.graphicsDevice);
		this.restPose = new RestPose(model);
		this.animations = resource.animations;
		this.assignClips(model, resource.animations);
		this.model = model;
		this.head = (model.findByName("Head_end") ?? model.findByName("Head")) as Entity | null;
		this.wrist = model.findByName("Wrist.R") as Entity | null;
		this.weapons = new WeaponModels(this.app, this.entity);
		this.pistol = this.weapons.visualFor(weaponById("pistol"));
		this.rifle = this.weapons.visualFor(weaponById("ar"));
		this.ready = true;
		if (this.body) registerDamageable(this.body);
		if (this.state === "stowed") this.setVisible(false);
	}

	private applyUniform(model: Entity) {
		const skin = POLICE_UNIFORM.skin[this.seed % POLICE_UNIFORM.skin.length];
		const renders = model.findComponents("render") as unknown as { meshInstances: { material: StandardMaterial }[] }[];
		for (const render of renders) {
			for (const meshInstance of render.meshInstances) {
				const name = (meshInstance.material.name ?? "").toLowerCase();
				if (UNTINTED.some((skip) => name.includes(skip))) continue;
				let colour: string = POLICE_UNIFORM.khaki;
				if (name.includes("skin")) colour = skin;
				else if (name.includes("hair")) colour = POLICE_UNIFORM.hair;
				else if (DARK_PARTS.some((part) => name.includes(part))) colour = POLICE_UNIFORM.belt;
				const tinted = meshInstance.material.clone();
				tinted.diffuse = new Color().fromString(colour);
				// Cloth and skin: the pack ships these 40% metallic, which turned khaki into gold.
				tinted.metalness = 0;
				tinted.update();
				meshInstance.material = tinted;
			}
		}
	}

	/** The gun clips this rig carries: aiming, firing, running, plus flinch and death. */
	private assignClips(model: Entity, animations: readonly Asset[] | undefined) {
		if (!animations?.length) return;
		model.addComponent("anim", { activate: true });
		const anim = model.anim;
		if (!anim) return;
		const find = (pattern: RegExp) => animations.find((clip) => pattern.test((clip.resource as AnimTrack | undefined)?.name ?? ""));
		const roles: [string, RegExp, boolean, number][] = [
			["Idle", /(^|[|_])idle$/i, true, 1],
			["Aim", /idle_gun_pointing$/i, true, 1],
			["Shoot", /(^|[|_])gun_shoot$/i, false, 1.4],
			["Run", /(^|[|_])run$/i, true, 1],
			["Hit", /hitrecieve$|hitreact$|hit_?receive$/i, false, 1.3],
			["Death", /death$/i, false, 1],
		];
		for (const [state, pattern, loop, rate] of roles) {
			const clip = find(pattern);
			if (!clip) continue;
			anim.assignAnimation(state, clip.resource as AnimTrack, undefined, rate, loop);
			this.clips.add(state);
		}
		anim.baseLayer?.transition(this.clips.has("Aim") ? "Aim" : "Idle", 0);
	}
}
