import { Entity, Quat, Script, Vec3, type CameraComponent } from "playcanvas";

import { combatAudio } from "../combat/CombatAudio";
import { applyDamage, damageableMoved, damageablesAlong, damageablesNear, raycastDamageables, registerDamageable, unregisterDamageable, type Listener } from "../combat/CombatWorld";
import { makeDamageEvent, nextCombatId, type DamageEvent, type DamageSourceRef } from "../combat/Damage";
import { detonate } from "../combat/Explosions";
import type { Ray } from "../combat/HitTests";
import { Projectiles } from "../combat/Projectiles";
import { scatter } from "../combat/Scatter";
import { EmissionAccumulator } from "../effects/ParticleField";
import { crashEffects, type DamageSource } from "../traffic/CrashEffects";
import { sceneCamera } from "../rendering/SceneCamera";
import { ORION_OCEAN } from "../world/Ocean";
import { isOnLand } from "../world/StateOutline";
import { onWorldReset } from "../world/WorldReset";
import { writeFlightHud } from "./FlightHud";
import { GunshipAudio } from "./GunshipAudio";
import { CANNON, GunshipArmament, guideMissile, MissileLock, MISSILES, REARM_SECONDS, ROCKETS, type GunshipWeapon, type MissileState } from "./GunshipWeapons";
import { GUNSHIP_CG_HEIGHT, HelicopterFlight, NO_INPUT, type PilotInput } from "./HelicopterFlight";

/**
 * The gunship in the world: flies it (HelicopterFlight) at a fixed rate, keeps it out of
 * buildings and the ground, takes and deals damage, spins its rotors, aims its chin gun, flies
 * its rockets and missiles, rearms it on the pad, and tells the HUD about it while the player
 * flies it. The player controller boards it, hands it the stick and trigger, and follows it.
 */

type Vec3Tuple = [number, number, number];

/** Pilot's (rear) seat, body frame: where the seated figure's root goes. */
const SEAT: Vec3Tuple = [0, -0.42, 1.5];
/** Where the pilot steps down to, beside the cockpit on the left. */
const DOOR: Vec3Tuple = [2.8, -GUNSHIP_CG_HEIGHT, 1.6];
/** How near the cockpit the player must be to climb in. */
const BOARD_REACH = 6.5;
/** The chin gun: its muzzle in the gun node's frame. */
const MUZZLE: Vec3Tuple = [0, -0.22, 1.9];
/** The rocket pods' fronts, body frame (left pod first). */
const PODS: readonly Vec3Tuple[] = [[2.77, -0.83, 0.95], [-2.77, -0.83, 0.95]];
/** Points on the airframe swept against buildings each frame. */
const HULL: readonly Vec3Tuple[] = [
	[0, -0.9, 4.9], [0, -1.35, 3.4], [0, 1.3, -10.9], [0, -0.5, -9.8],
	[3.0, -0.6, 0.4], [-3.0, -0.6, 0.4], [0, 2.1, 0], [1.2, 0.2, -3], [-1.2, 0.2, -3],
];
/** Airframe box for being hit (body frame): half-width, height, half-length, centre z. */
const BOX = { halfWidth: 1.6, height: 3.4, halfLength: 7.4, centreZ: -3.2 };
/** Damage (after the vehicle scaling) that takes one point off the airframe's 100. */
const DAMAGE_PER_POINT = 12;
const HARD_LANDING = 4.5;
const CRASH_LANDING = 13;
const IMPACT_HARMLESS = 3;
const REARM_RADIUS = 12;
const ROTOR_HZ = 4.8;
const TAIL_ROTOR_RATIO = 4.6;
const LOCK_SEARCH_SECONDS = 0.1;
/** Above this over the ground, the wheels and rotor can't touch it: skip the ground rays. */
const GROUND_CHECK_HEIGHT = 45;
const DEG = Math.PI / 180;

interface PhysicsHit {
	entity: Entity;
	point: Vec3;
	normal: Vec3;
}

interface Physics {
	raycastFirst(start: Vec3, end: Vec3, options?: { filterCallback?: (entity: Entity) => boolean }): PhysicsHit | null;
}

interface FlyingMissile {
	entity: Entity;
	state: MissileState;
	target: Listener | null;
	targetX: number;
	targetY: number;
	targetZ: number;
	trail: EmissionAccumulator;
}

/** Gunships in the world, for the player controller to find. */
const gunships = new Set<OrionGunship>();

/** The gunship if the player at (x, z) is close enough to its cockpit to climb in. */
export function findGunshipNear(x: number, z: number): OrionGunship | null {
	const door: Vec3Tuple = [0, 0, 0];
	for (const gunship of gunships) {
		if (gunship.destroyed || gunship.piloted) continue;
		gunship.doorPoint(door);
		if (Math.hypot(door[0] - x, door[2] - z) < BOARD_REACH) return gunship;
	}
	return null;
}

export class OrionGunship extends Script {
	public static scriptName = "orionGunship";
	public homeX = 0;
	public homeZ = 0;
	public homeHeading = 0;
	public homeGround = 0;

	public readonly flight = new HelicopterFlight();
	public readonly armament = new GunshipArmament();
	public readonly lock = new MissileLock();
	public piloted = false;
	public destroyed = false;
	public integrity = 100;
	/** The pilot's damage source, so what the gunship hits is put down to the player. */
	public pilotSource: DamageSourceRef | null = null;

	private readonly id = nextCombatId();
	private body!: Listener;
	private readonly controls: PilotInput = { forward: 0, turn: 0, strafe: 0, climb: 0 };
	private trigger = false;
	private readonly aimOrigin = new Vec3();
	private readonly aimDirection = new Vec3(0, 0, 1);
	private readonly aimPoint = new Vec3();
	private projectiles: Projectiles | null = null;
	private readonly missiles: FlyingMissile[] = [];
	private lockTarget: Listener | null = null;
	private sinceLockSearch = 0;
	private readonly audio = new GunshipAudio();
	private rotorAngle = 0;
	private gunYaw = 0;
	private gunPitch = 0;
	private rearmTimer = 0;
	/** Wrecked in the air: blows up when it hits. */
	private pendingBlast = false;
	private readonly damage: DamageSource = { x: 0, y: 0, z: 0, sin: 0, cos: 1, halfWidth: 1.4, halfLength: 6, groundY: 0, stage: "smoking", severity: 0 };
	private readonly event: DamageEvent = makeDamageEvent();
	private readonly ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 };
	private altitude = 0;
	private groundUnder = 0;
	private readonly groundCache = new Map<number, number | null>();
	private unsubscribeReset: (() => void) | null = null;
	// Model parts (found once the model has loaded).
	private mainRotor: Entity | null = null;
	private tailRotor: Entity | null = null;
	private gun: Entity | null = null;
	private rails: (Entity | null)[] = [];
	// Scratch.
	private readonly a: Vec3Tuple = [0, 0, 0];
	private readonly b: Vec3Tuple = [0, 0, 0];
	private readonly c: Vec3Tuple = [0, 0, 0];
	private readonly from = new Vec3();
	private readonly to = new Vec3();
	private readonly screen = new Vec3();
	private readonly rotation = new Quat();
	private readonly previous: Vec3Tuple[] = HULL.map(() => [0, 0, 0]);

	private readonly notSelf = (entity: Entity) => entity !== this.entity && entity.name !== "player" && entity.name !== "rocket" && entity.name !== "missile-in-flight";

	private readonly groundAt = (x: number, z: number): number | null => {
		if (this.altitude > GROUND_CHECK_HEIGHT) return null;
		const key = Math.round(x * 2) * 100003 + Math.round(z * 2);
		const cached = this.groundCache.get(key);
		if (cached !== undefined) return cached;
		this.from.set(x, this.flight.y + 6, z);
		this.to.set(x, this.flight.y - GROUND_CHECK_HEIGHT - 10, z);
		const hit = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
		const ground = hit ? hit.point.y : isOnLand(x, z) ? null : ORION_OCEAN.level;
		this.groundCache.set(key, ground);
		return ground;
	};

	public initialize() {
		gunships.add(this);
		this.projectiles = new Projectiles(this.app, 24);
		const isAlive = () => !this.destroyed;
		this.body = {
			id: this.id,
			kind: "vehicle",
			x: 0, y: 0, z: 0,
			radius: BOX.halfWidth,
			height: BOX.height,
			halfLength: BOX.halfLength,
			headingX: 0, headingZ: 1,
			get alive() {
				return isAlive();
			},
			takeDamage: (event) => this.takeDamage(event),
		};
		registerDamageable(this.body);
		this.park();
		this.unsubscribeReset = onWorldReset(() => {
			if (!this.piloted) this.park();
		});
		this.on("destroy", () => {
			gunships.delete(this);
			unregisterDamageable(this.body);
			this.unsubscribeReset?.();
			this.projectiles?.destroy();
			for (const missile of this.missiles) missile.entity.destroy();
			this.missiles.length = 0;
			this.audio.destroy();
		});
	}

	// ---- The controller's side ---------------------------------------------------------------

	public board(source: DamageSourceRef): void {
		this.piloted = true;
		this.pilotSource = source;
		this.flight.engineOn = true;
		this.lock.clear();
		this.lockTarget = null;
	}

	public leave(): void {
		this.piloted = false;
		this.flight.engineOn = false;
		this.trigger = false;
		Object.assign(this.controls, NO_INPUT);
		this.lock.clear();
		this.lockTarget = null;
		writeFlightHud({ flying: false });
	}

	public setControls(input: Readonly<PilotInput>, trigger: boolean): void {
		Object.assign(this.controls, input);
		this.trigger = trigger;
	}

	/** Where the gunner is looking: a ray from the camera. */
	public setAim(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
		this.aimOrigin.set(ox, oy, oz);
		this.aimDirection.set(dx, dy, dz).normalize();
	}

	public selectWeapon(weapon: GunshipWeapon): void {
		this.armament.select(weapon);
		combatAudio().play("equip", this.flight.x, this.flight.y, this.flight.z, 0.6);
	}

	public cycleWeapon(step: number): void {
		this.armament.cycle(step);
		combatAudio().play("equip", this.flight.x, this.flight.y, this.flight.z, 0.6);
	}

	public get landed(): boolean {
		return this.flight.landed;
	}

	/** Nobody aboard, rotor stopped, settled on its wheels and nothing of its own in the air. */
	private get resting(): boolean {
		const flight = this.flight;
		return !this.piloted && !this.pendingBlast && this.missiles.length === 0 && flight.rotor === 0 && flight.landed
			&& flight.speed < 0.05 && Math.abs(flight.wx) + Math.abs(flight.wy) + Math.abs(flight.wz) < 0.01;
	}

	public seatPoint(out: Vec3Tuple): Vec3Tuple {
		return this.flight.toWorld(SEAT[0], SEAT[1], SEAT[2], out);
	}

	public doorPoint(out: Vec3Tuple): Vec3Tuple {
		this.flight.toWorld(DOOR[0], DOOR[1], DOOR[2], out);
		out[1] = (this.groundAt(out[0], out[2]) ?? out[1]);
		return out;
	}

	public get heading(): number {
		return this.flight.heading;
	}

	// ---- Each frame --------------------------------------------------------------------------

	public update(dt: number) {
		if (!(dt > 0)) return;
		const flight = this.flight;
		// Parked, still and empty: nothing to fly (stepping it cost raycasts every frame).
		if (this.resting) {
			// React can re-apply the pad's position between frames: put it back where it rests.
			const at = this.entity.getPosition();
			if (Math.abs(at.x - flight.x) > 1e-3 || Math.abs(at.y - flight.y) > 1e-3 || Math.abs(at.z - flight.z) > 1e-3) this.pose();
			this.findParts();
			// Rockets already fired fly on.
			this.projectiles?.update(dt);
			this.rearm(dt);
			this.burn(dt);
			return;
		}
		this.groundCache.clear();
		this.measureAltitude();
		for (let i = 0; i < HULL.length; i++) flight.toWorld(HULL[i][0], HULL[i][1], HULL[i][2], this.previous[i]);

		flight.advance(dt, this.piloted && !this.destroyed ? this.controls : NO_INPUT, this.groundAt);
		this.handleContacts();
		this.pose();

		this.findParts();
		this.spinRotors(dt);
		if (this.piloted && !this.destroyed) {
			this.aimGun(dt);
			this.updateLock(dt);
			this.fireWeapons(dt);
		}
		this.projectiles?.update(dt);
		this.updateMissiles(dt);
		this.rearm(dt);
		this.burn(dt);
		this.audio.update(flight.x, flight.y, flight.z, this.destroyed ? 0 : flight.rotor, flight.collective, this.piloted);
		if (this.piloted) this.publish();
	}

	/** Height over whatever's below, with one long ray (also decides whether to look closer). */
	private measureAltitude() {
		const flight = this.flight;
		this.from.set(flight.x, flight.y, flight.z);
		this.to.set(flight.x, flight.y - 600, flight.z);
		const hit = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
		this.groundUnder = hit ? hit.point.y : isOnLand(flight.x, flight.z) ? flight.y - 600 : ORION_OCEAN.level;
		this.altitude = flight.y - GUNSHIP_CG_HEIGHT - this.groundUnder;
	}

	/** Landings, buildings, the rotor disc, the sea. */
	private handleContacts() {
		const flight = this.flight;
		// Touchdowns: gentle is fine, heavy bends it, a fall wrecks it.
		const sink = flight.takeTouchdown();
		if (this.pendingBlast && sink > 1) this.blowUp();
		else if (sink > CRASH_LANDING) this.destroy();
		else if (sink > HARD_LANDING) this.harm((sink - HARD_LANDING) * 7);
		if (flight.rotorStrike && !this.destroyed) this.destroy();

		// Into the sea.
		if (!this.destroyed && flight.y - GUNSHIP_CG_HEIGHT < ORION_OCEAN.level + 0.2 && !isOnLand(flight.x, flight.z)) this.destroy();

		// The rotor disc against walls: spokes from the hub to the tips.
		if (flight.rotor > 0.3 && !this.destroyed) {
			const hub = flight.toWorld(0, flight.spec.rotorHeight, 0, this.a);
			this.from.set(hub[0], hub[1], hub[2]);
			for (let k = 0; k < 8; k++) {
				const angle = (k / 8) * Math.PI * 2;
				const tip = flight.toWorld(Math.cos(angle) * flight.spec.rotorRadius, flight.spec.rotorHeight, Math.sin(angle) * flight.spec.rotorRadius, this.b);
				this.to.set(tip[0], tip[1], tip[2]);
				if (this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf })) {
					this.destroy();
					break;
				}
			}
		}

		// The airframe against buildings: each hull point swept along its move this frame.
		for (let i = 0; i < HULL.length; i++) {
			const now = flight.toWorld(HULL[i][0], HULL[i][1], HULL[i][2], this.c);
			const before = this.previous[i];
			if (Math.hypot(now[0] - before[0], now[1] - before[1], now[2] - before[2]) < 1e-4) continue;
			this.from.set(before[0], before[1], before[2]);
			this.to.set(now[0], now[1], now[2]);
			const hit = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
			if (!hit) continue;
			const n = hit.normal;
			flight.nudge(hit.point.x - now[0] + n.x * 0.05, hit.point.y - now[1] + n.y * 0.05, hit.point.z - now[2] + n.z * 0.05);
			const closing = flight.collide(HULL[i][0], HULL[i][1], HULL[i][2], n.x, n.y, n.z);
			if (this.pendingBlast) this.blowUp();
			else if (closing > IMPACT_HARMLESS) {
				this.harm((closing - IMPACT_HARMLESS) * 6);
				combatAudio().play("crash", hit.point.x, hit.point.y, hit.point.z, Math.min(1.5, closing / 8));
			}
		}
	}

	private pose() {
		const flight = this.flight;
		this.entity.setPosition(flight.x, flight.y, flight.z);
		this.entity.setRotation(flight.qx, flight.qy, flight.qz, flight.qw);
		// The hit box: along the heading, centred on the fuselage.
		const centre = flight.toWorld(0, -GUNSHIP_CG_HEIGHT, BOX.centreZ, this.a);
		const forward = flight.directionToWorld(0, 0, 1, this.b);
		const flat = Math.hypot(forward[0], forward[2]) || 1;
		this.body.x = centre[0];
		this.body.y = centre[1];
		this.body.z = centre[2];
		this.body.headingX = forward[0] / flat;
		this.body.headingZ = forward[2] / flat;
		damageableMoved(this.body);
	}

	private findParts() {
		if (this.mainRotor) return;
		this.mainRotor = this.entity.findByName("main-rotor") as Entity | null;
		if (!this.mainRotor) return;
		this.tailRotor = this.entity.findByName("tail-rotor") as Entity | null;
		this.gun = this.entity.findByName("gun") as Entity | null;
		this.rails = Array.from({ length: MISSILES.count }, (_, index) => this.entity.findByName(`missile-${index + 1}`) as Entity | null);
		this.showRails();
	}

	private spinRotors(dt: number) {
		this.rotorAngle = (this.rotorAngle + this.flight.rotor * ROTOR_HZ * 360 * dt) % 360;
		this.mainRotor?.setLocalEulerAngles(0, -this.rotorAngle, 0);
		this.tailRotor?.setLocalEulerAngles((this.rotorAngle * TAIL_ROTOR_RATIO) % 360, 0, 0);
	}

	/** Slews the chin gun towards where the gunner looks, within its limits and slew rate. */
	private aimGun(dt: number) {
		const physics = this.physics;
		const origin = this.aimOrigin;
		const direction = this.aimDirection;
		this.from.copy(origin);
		this.to.copy(direction).mulScalar(CANNON.range).add(origin);
		const hit = physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
		this.aimPoint.copy(hit ? hit.point : this.to);
		if (!this.gun) return;
		const pivot = this.gun.getPosition();
		const toAim = this.flight.directionToBody(this.aimPoint.x - pivot.x, this.aimPoint.y - pivot.y, this.aimPoint.z - pivot.z, this.a);
		const yaw = Math.max(-CANNON.traverse, Math.min(CANNON.traverse, Math.atan2(toAim[0], toAim[2]) / DEG));
		const pitch = Math.max(-CANNON.depression, Math.min(CANNON.elevation, Math.atan2(toAim[1], Math.hypot(toAim[0], toAim[2])) / DEG));
		const step = CANNON.slewRate * dt;
		this.gunYaw += Math.max(-step, Math.min(step, yaw - this.gunYaw));
		this.gunPitch += Math.max(-step, Math.min(step, pitch - this.gunPitch));
		this.gun.setLocalEulerAngles(-this.gunPitch, this.gunYaw, 0);
	}

	/** The missile seeker: whatever's nearest the sight's centre, held long enough, locks. */
	private updateLock(dt: number) {
		if (this.armament.selected !== "missiles") {
			if (this.lock.state !== "none") this.lock.clear();
			this.lockTarget = null;
			return;
		}
		if (this.lockTarget && !this.lockTarget.alive) this.lockTarget = null;
		const lockedAngle = this.lockTarget && this.lock.state === "locked" ? this.angleTo(this.lockTarget) : null;
		this.sinceLockSearch += dt;
		let candidate: { id: number; angle: number } | null = null;
		if (this.sinceLockSearch >= LOCK_SEARCH_SECONDS || this.lock.state === "locking") {
			this.sinceLockSearch = 0;
			const best = this.bestTarget();
			if (best) {
				candidate = { id: best.target.id, angle: best.angle };
				if (this.lock.state !== "locked") this.lockTarget = best.target;
			}
		}
		this.lock.update(dt, candidate, lockedAngle);
		if (this.lock.state === "none") this.lockTarget = null;
	}

	private angleTo(target: Listener): number {
		const o = this.aimOrigin;
		const dx = target.x - o.x;
		const dy = target.y + target.height / 2 - o.y;
		const dz = target.z - o.z;
		const distance = Math.hypot(dx, dy, dz) || 1;
		const along = (dx * this.aimDirection.x + dy * this.aimDirection.y + dz * this.aimDirection.z) / distance;
		return Math.acos(Math.max(-1, Math.min(1, along))) / DEG;
	}

	private bestTarget(): { target: Listener; angle: number } | null {
		const o = this.aimOrigin;
		const d = this.aimDirection;
		const flat = Math.hypot(d.x, d.z);
		const reach = MISSILES.range * (flat > 0.1 ? flat : 0.1);
		const nearby = flat > 0.1
			? damageablesAlong(o.x, o.z, o.x + (d.x / flat) * reach, o.z + (d.z / flat) * reach, 40)
			: damageablesNear(o.x, o.z, 80);
		let best: { target: Listener; angle: number } | null = null;
		for (const target of nearby) {
			if (!target.alive || target.id === this.id || target.kind === "player") continue;
			const distance = Math.hypot(target.x - o.x, target.y - o.y, target.z - o.z);
			if (distance < 25 || distance > MISSILES.range) continue;
			const angle = this.angleTo(target);
			if (angle > MISSILES.keepCone) continue;
			if (!best || angle < best.angle) best = { target, angle };
		}
		if (!best) return null;
		// Something in the way?
		this.from.copy(o);
		this.to.set(best.target.x, best.target.y + best.target.height / 2, best.target.z);
		const wall = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
		if (wall && wall.point.distance(this.to) > 4) return null;
		return best;
	}

	private fireWeapons(dt: number) {
		const fire = this.armament.update(dt, this.trigger);
		const flight = this.flight;
		if (fire.empty) combatAudio().play("empty", flight.x, flight.y, flight.z, 0.7);
		for (let round = 0; round < fire.rounds; round++) this.fireRound(round);
		for (const pod of fire.rockets) this.fireRocket(pod);
		if (fire.missile >= 0) this.launchMissile(fire.missile);
	}

	private muzzle(out: Vec3Tuple): Vec3Tuple {
		if (!this.gun) return this.flight.toWorld(0, -1.4, 4.2, out);
		const point = this.gun.getWorldTransform().transformPoint(new Vec3(MUZZLE[0], MUZZLE[1], MUZZLE[2]), this.to);
		out[0] = point.x;
		out[1] = point.y;
		out[2] = point.z;
		return out;
	}

	private gunDirection(out: Vec3Tuple): Vec3Tuple {
		if (!this.gun) return this.flight.directionToWorld(0, 0, 1, out);
		const forward = this.gun.forward;
		// The model's barrel points along its +Z; an entity's `forward` is -Z.
		out[0] = -forward.x;
		out[1] = -forward.y;
		out[2] = -forward.z;
		return out;
	}

	/** One 30 mm round: flown along the barrel, exploding on whatever it meets. */
	private fireRound(index: number) {
		const muzzle = this.muzzle(this.a);
		const barrel = this.gunDirection(this.b);
		const [dx, dy, dz] = scatter(barrel[0], barrel[1], barrel[2], CANNON.spread * DEG);
		const effects = crashEffects(this.app);
		if (index === 0) {
			effects.muzzleFlash(muzzle[0], muzzle[1], muzzle[2], dx, dy, dz, "rifle");
			combatAudio().play("rifle", muzzle[0], muzzle[1], muzzle[2], 1.5);
		}
		this.from.set(muzzle[0], muzzle[1], muzzle[2]);
		this.to.set(muzzle[0] + dx * CANNON.range, muzzle[1] + dy * CANNON.range, muzzle[2] + dz * CANNON.range);
		const wall = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
		const wallDistance = wall ? wall.point.distance(this.from) : CANNON.range;
		const ray = this.ray;
		ray.ox = muzzle[0];
		ray.oy = muzzle[1];
		ray.oz = muzzle[2];
		ray.dx = dx;
		ray.dy = dy;
		ray.dz = dz;
		const hit = raycastDamageables(ray, wallDistance, this.id);
		const distance = hit ? hit.distance : wallDistance;
		const x = muzzle[0] + dx * distance;
		const y = muzzle[1] + dy * distance;
		const z = muzzle[2] + dz * distance;
		if (this.armament.rounds % 2 === 0) effects.tracer(muzzle[0], muzzle[1], muzzle[2], x, y, z);
		if (!hit && !wall) return;
		// High-explosive: a hit on what it struck, and a little blast round it.
		const flat = Math.hypot(dx, dz) || 1;
		if (hit) applyDamage(hit.target, this.fillEvent(CANNON.damage, "explosive", x, y, z, dx / flat, dz / flat, 6));
		for (const near of [...damageablesNear(x, z, CANNON.splashRadius + 2)]) {
			if (near === hit?.target || near.id === this.id) continue;
			const d = Math.hypot(near.x - x, near.y + near.height / 2 - y, near.z - z) - near.radius;
			if (d > CANNON.splashRadius) continue;
			applyDamage(near, this.fillEvent(CANNON.splashDamage, "explosive", x, y, z, (near.x - x) / (d + 1), (near.z - z) / (d + 1), 4));
		}
		const normal = wall && !hit ? wall.normal : null;
		effects.impact(x, y, z, normal?.x ?? -dx, normal?.y ?? -dy, normal?.z ?? -dz, hit?.target.kind === "person" ? "flesh" : hit ? "metal" : "hard");
		effects.muzzleFlash(x, y, z, normal?.x ?? -dx, normal?.y ?? -dy, normal?.z ?? -dz, "shotgun");
		combatAudio().play("impact", x, y, z, 0.9);
	}

	private fireRocket(pod: number) {
		const flight = this.flight;
		const start = flight.toWorld(PODS[pod][0], PODS[pod][1], PODS[pod][2], this.a);
		const nose = flight.directionToWorld(0, 0, 1, this.b);
		const [dx, dy, dz] = scatter(nose[0], nose[1], nose[2], ROCKETS.spread * DEG);
		this.projectiles?.fire(start[0], start[1], start[2], dx, dy, dz, ROCKETS_SPEC, this.pilotSource, this.id);
		crashEffects(this.app).muzzleFlash(start[0], start[1], start[2], dx, dy, dz, "rocket");
		combatAudio().play("rocket", start[0], start[1], start[2], 1.1);
	}

	private launchMissile(rail: number) {
		const node = this.rails[rail];
		const flight = this.flight;
		const start = node ? node.getPosition() : this.to.set(flight.x, flight.y - 1, flight.z);
		const forward = flight.directionToWorld(0, 0, 1, this.b);
		const entity = node ? node.clone() as Entity : new Entity();
		entity.name = "missile-in-flight";
		this.app.root.addChild(entity);
		entity.setPosition(start);
		if (node) node.enabled = false;
		const target = this.lock.state === "locked" ? this.lockTarget : null;
		this.missiles.push({
			entity,
			state: {
				x: start.x, y: start.y, z: start.z,
				vx: flight.vx + forward[0] * MISSILES.launchSpeed,
				vy: flight.vy + forward[1] * MISSILES.launchSpeed,
				vz: flight.vz + forward[2] * MISSILES.launchSpeed,
				age: 0,
			},
			target,
			targetX: target?.x ?? 0,
			targetY: target?.y ?? 0,
			targetZ: target?.z ?? 0,
			trail: new EmissionAccumulator(),
		});
		combatAudio().play("rocket", start.x, start.y, start.z, 1.4);
	}

	private updateMissiles(dt: number) {
		// A frame with no time in it (the browser can deliver one) would divide by zero below.
		if (!(dt > 1e-4)) return;
		const effects = crashEffects(this.app);
		for (let i = this.missiles.length - 1; i >= 0; i--) {
			const missile = this.missiles[i];
			const state = missile.state;
			const target = missile.target && missile.target.alive ? missile.target : null;
			let aim: { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null = null;
			if (target) {
				const ty = target.y + target.height / 2;
				aim = {
					x: target.x, y: ty, z: target.z,
					vx: (target.x - missile.targetX) / dt, vy: (target.y - missile.targetY) / dt, vz: (target.z - missile.targetZ) / dt,
				};
				missile.targetX = target.x;
				missile.targetY = target.y;
				missile.targetZ = target.z;
			}
			const fromX = state.x;
			const fromY = state.y;
			const fromZ = state.z;
			guideMissile(state, aim, dt);
			const step = Math.hypot(state.x - fromX, state.y - fromY, state.z - fromZ);
			let blastAt: Vec3Tuple | null = null;
			if (state.age > 0.2 && step > 0) {
				this.from.set(fromX, fromY, fromZ);
				this.to.set(state.x, state.y, state.z);
				const wall = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
				const wallDistance = wall ? wall.point.distance(this.from) : step;
				const ray = this.ray;
				ray.ox = fromX;
				ray.oy = fromY;
				ray.oz = fromZ;
				ray.dx = (state.x - fromX) / step;
				ray.dy = (state.y - fromY) / step;
				ray.dz = (state.z - fromZ) / step;
				const body = raycastDamageables(ray, wallDistance, this.id);
				if (body || wall) {
					const along = body ? body.distance : wallDistance;
					blastAt = [fromX + ray.dx * along, fromY + ray.dy * along, fromZ + ray.dz * along];
				}
			}
			if (!blastAt && aim && Math.hypot(aim.x - state.x, aim.y - state.y, aim.z - state.z) < MISSILES.proximity) blastAt = [state.x, state.y, state.z];
			if (!blastAt && (state.age > MISSILES.lifetime || state.y < ORION_OCEAN.level)) blastAt = [state.x, state.y, state.z];
			if (!Number.isFinite(state.x + state.y + state.z)) {
				missile.entity.destroy();
				this.missiles.splice(i, 1);
				continue;
			}
			if (blastAt) {
				detonate(this.app, blastAt[0], blastAt[1], blastAt[2], MISSILES.explosionRadius, MISSILES.explosionDamage, this.pilotSource);
				missile.entity.destroy();
				this.missiles.splice(i, 1);
				continue;
			}
			missile.entity.setPosition(state.x, state.y, state.z);
			const speed = Math.hypot(state.vx, state.vy, state.vz) || 1;
			// The model's nose is its +Z; lookAt points an entity's -Z, so look back along the path.
			this.to.set(state.x - state.vx, state.y - state.vy, state.z - state.vz);
			missile.entity.lookAt(this.to);
			if (state.age > 0.25) effects.rocketExhaust(state.x, state.y, state.z, state.vx / speed, state.vy / speed, state.vz / speed, missile.trail, dt);
		}
	}

	/** Landed on the pad: rearmed and patched up. */
	private rearm(dt: number) {
		const flight = this.flight;
		const onPad = flight.landed && Math.hypot(flight.x - this.homeX, flight.z - this.homeZ) < REARM_RADIUS && !this.destroyed;
		if (!onPad || (this.armament.full && this.integrity >= 100)) {
			this.rearmTimer = 0;
			return;
		}
		this.rearmTimer += dt;
		if (this.rearmTimer < REARM_SECONDS) return;
		this.rearmTimer = 0;
		this.armament.rearm();
		this.integrity = 100;
		this.showRails();
		combatAudio().play("reload", flight.x, flight.y, flight.z, 1);
	}

	private showRails() {
		this.rails.forEach((node, index) => {
			if (node) node.enabled = this.armament.rails[index];
		});
	}

	// ---- Damage ------------------------------------------------------------------------------

	private takeDamage(event: DamageEvent) {
		if (this.destroyed) return;
		this.harm(event.amount / DAMAGE_PER_POINT);
	}

	private harm(points: number) {
		if (this.destroyed || !(points > 0)) return;
		this.integrity = Math.max(0, this.integrity - points);
		if (this.integrity === 0) this.destroy();
	}

	/** Out of the fight: it falls, and goes up when it hits (or at once, if it's down already). */
	private destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.integrity = 0;
		this.flight.wrecked = true;
		this.flight.engineOn = false;
		// The rotor is wrecked with it: it stops, and so does its noise.
		this.flight.rotor = 0;
		this.lock.clear();
		if (this.altitude < 2) this.blowUp();
		else this.pendingBlast = true;
	}

	private blowUp() {
		this.pendingBlast = false;
		const flight = this.flight;
		detonate(this.app, flight.x, flight.y, flight.z, 10, 400, null);
		combatAudio().play("explosion", flight.x, flight.y, flight.z, 1.6);
	}

	/** Smoke when it's hurt, fire when it's badly hurt, a burning wreck when it's gone. */
	private burn(dt: number) {
		const stage = this.destroyed ? "wreck-fire" : this.integrity < 15 ? "burning" : this.integrity < 45 ? "smoking" : null;
		if (!stage) return;
		const flight = this.flight;
		const at = flight.toWorld(0, 0.8, -1.5, this.a);
		const damage = this.damage;
		damage.x = at[0];
		damage.y = at[1];
		damage.z = at[2];
		const heading = flight.heading * DEG;
		damage.sin = Math.sin(heading);
		damage.cos = Math.cos(heading);
		damage.groundY = this.groundUnder;
		damage.stage = stage;
		damage.severity = stage === "smoking" ? 1 - (this.integrity - 15) / 30 : 1;
		crashEffects(this.app).vehicleDamage(this, damage, dt);
	}

	// ---- Reset, HUD --------------------------------------------------------------------------

	/** Back on the pad, as new. */
	private park() {
		this.flight.park(this.homeX, this.homeGround, this.homeZ, this.homeHeading);
		this.destroyed = false;
		this.pendingBlast = false;
		this.integrity = 100;
		this.armament.rearm();
		this.armament.select("cannon");
		this.lock.clear();
		this.lockTarget = null;
		for (const missile of this.missiles) missile.entity.destroy();
		this.missiles.length = 0;
		this.showRails();
		this.gunYaw = this.gunPitch = 0;
		this.gun?.setLocalEulerAngles(0, 0, 0);
		this.pose();
	}

	private publish() {
		const flight = this.flight;
		const camera = this.camera;
		const place = (x: number, y: number, z: number): [number, number] => {
			if (!camera) return [-1, -1];
			const rect = this.app.graphicsDevice.clientRect;
			const point = camera.worldToScreen(this.from.set(x, y, z), this.screen);
			if (point.z <= 0 || rect.width <= 0) return [-1, -1];
			return [point.x / rect.width, point.y / rect.height];
		};
		// Where the gun is pointing now (it lags the sight while it slews).
		const muzzle = this.muzzle(this.a);
		const barrel = this.gunDirection(this.b);
		const [gunX, gunY] = place(muzzle[0] + barrel[0] * 600, muzzle[1] + barrel[1] * 600, muzzle[2] + barrel[2] * 600);
		// Rockets go along the nose, dropping a little.
		const nose = flight.directionToWorld(0, 0, 1, this.c);
		const [boresightX, boresightY] = place(flight.x + nose[0] * 400, flight.y + nose[1] * 400 - 3, flight.z + nose[2] * 400);
		let lockX = -1;
		let lockY = -1;
		if (this.lockTarget && this.lock.state !== "none") {
			[lockX, lockY] = place(this.lockTarget.x, this.lockTarget.y + this.lockTarget.height / 2, this.lockTarget.z);
		}
		const heading = flight.heading;
		let warning = "";
		if (this.destroyed) warning = "AIRFRAME LOST";
		else if (this.integrity < 25) warning = "DAMAGE CRITICAL";
		else if (flight.rotor < 0.95 && flight.engineOn) warning = "ROTOR SPOOLING UP";
		else if (flight.vy < -8 && this.altitude < 40) warning = "SINK RATE";
		writeFlightHud({
			flying: true,
			aircraft: "gunship",
			altitude: Math.max(0, this.altitude),
			speed: flight.speed,
			verticalSpeed: flight.vy,
			// North is -Z; the game's heading rises towards +X (west), so the compass runs the other way.
			heading: (((180 - heading) % 360) + 360) % 360,
			rotor: flight.rotor,
			integrity: this.integrity,
			weapon: this.armament.selected,
			cannon: this.armament.rounds,
			rockets: this.armament.rockets,
			missiles: this.armament.missiles,
			lock: this.lock.state,
			lockProgress: this.lock.progress,
			landed: flight.landed,
			rearm: this.rearmTimer > 0 ? this.rearmTimer / REARM_SECONDS : -1,
			warning,
			gunX, gunY, boresightX, boresightY, lockX, lockY,
		});
	}

	private fillEvent(amount: number, type: DamageEvent["type"], x: number, y: number, z: number, directionX: number, directionZ: number, impulse: number): DamageEvent {
		const event = this.event;
		event.amount = amount;
		event.type = type;
		event.source = this.pilotSource;
		event.x = x;
		event.y = y;
		event.z = z;
		event.directionX = directionX;
		event.directionZ = directionZ;
		event.impulse = impulse;
		return event;
	}

	private get camera(): CameraComponent | null {
		return sceneCamera(this.app);
	}

	private get physics(): Physics | undefined {
		return this.app.systems.rigidbody as unknown as Physics | undefined;
	}

	/** World rotation of the airframe, for seating the pilot. */
	public get attitude(): Quat {
		return this.rotation.set(this.flight.qx, this.flight.qy, this.flight.qz, this.flight.qw);
	}
}

const ROCKETS_SPEC = {
	speed: ROCKETS.speed,
	gravity: ROCKETS.gravity,
	lifetime: ROCKETS.lifetime,
	explosionRadius: ROCKETS.explosionRadius,
	explosionDamage: ROCKETS.explosionDamage,
};
