import { BLEND_ADDITIVE, Color, Entity, Quat, Script, StandardMaterial, Vec3, type CameraComponent } from "playcanvas";

import { combatAudio } from "../combat/CombatAudio";
import { applyDamage, damageableMoved, damageablesAlong, damageablesNear, raycastDamageables, registerDamageable, unregisterDamageable, type Listener } from "../combat/CombatWorld";
import { makeDamageEvent, nextCombatId, type DamageEvent, type DamageSourceRef } from "../combat/Damage";
import { detonate } from "../combat/Explosions";
import type { Ray } from "../combat/HitTests";
import { scatter } from "../combat/Scatter";
import { EmissionAccumulator } from "../effects/ParticleField";
import { crashEffects, type DamageSource } from "../traffic/CrashEffects";
import { sceneCamera } from "../rendering/SceneCamera";
import { ORION_OCEAN } from "../world/Ocean";
import { isOnLand } from "../world/StateOutline";
import { onWorldReset } from "../world/WorldReset";
import { writeFlightHud } from "./FlightHud";
import { guideMissile, MissileLock, type MissileState } from "./GunshipWeapons";
import { JetAudio } from "./JetAudio";
import { JET_CG_HEIGHT, JetFlight, NO_JET_INPUT, type JetInput } from "./JetFlight";
import { JET_GEOMETRY } from "./JetModel";
import { JET_CANNON, JET_MISSILES, JET_REARM_SECONDS, JetArmament, type JetWeapon } from "./JetWeapons";

/**
 * A jet in the world: flies it (JetFlight) at a fixed rate, keeps it out of buildings and the
 * ground, takes and deals damage, works its gear, canopy, airbrake and afterburners, fires its
 * cannon and missiles, rearms it on the apron, and tells the HUD about it while the player flies
 * it. The player controller boards it, hands it the stick, throttle and trigger, and follows it.
 */

type Vec3Tuple = [number, number, number];

const [CG_X, CG_Y, CG_Z] = JET_GEOMETRY.centreOfMass;
/** A model-space point in the body frame (relative to the centre of mass). */
const body = (point: readonly [number, number, number]): Vec3Tuple => [point[0] - CG_X, point[1] - CG_Y, point[2] - CG_Z];

/** The pilot's (front) seat: where the seated figure's root goes. */
const SEAT: Vec3Tuple = body(JET_GEOMETRY.seat);
/** The boarding ladder: beside the cockpit, on the left, at the ground. */
const LADDER: Vec3Tuple = [3.2, -JET_CG_HEIGHT, body(JET_GEOMETRY.seat)[2]];
const BOARD_REACH = 6.5;
const MUZZLE: Vec3Tuple = body(JET_GEOMETRY.muzzle);
const NOZZLES: readonly Vec3Tuple[] = JET_GEOMETRY.nozzles.map((nozzle) => body(nozzle));
/** Points on the airframe swept against buildings and the ground each frame. */
const HULL: readonly Vec3Tuple[] = [
	body([0, 2.6, 10]), body([0, 4.5, 4.5]), body([0, 1.0, 0]), body([0, 1.1, -4.5]),
	body([0, 1.45, -10.9]), body([2.05, 5.1, -8.8]), body([-2.05, 5.1, -8.8]),
	body([5.1, 2.3, -7]), body([-5.1, 2.3, -7]), body([1.3, 1.4, -9]), body([-1.3, 1.4, -9]),
];
/** Airframe box for being hit (body frame): half-width, height, half-length, centre z. */
const BOX = { halfWidth: 2.2, height: 4.5, halfLength: 10.4, centreZ: body([0, 0, -0.5])[2] };
/** Damage (after the vehicle scaling) that takes one point off the airframe's 100. */
const DAMAGE_PER_POINT = 10;
/** Touchdown sink rates (m/s): firm, damaging, destroying. */
const HARD_LANDING = 4.5;
const CRASH_LANDING = 9;
/** Closing speeds against something solid (m/s): a scrape, and a crash. */
const IMPACT_HARMLESS = 3;
const IMPACT_FATAL = 28;
const REARM_RADIUS = 30;
const LOCK_SEARCH_SECONDS = 0.1;
/** Above this over the ground, the wheels can't touch it: skip the ground rays. */
const GROUND_CHECK_HEIGHT = 40;
/** The gear: up once clear and going, down again when slow and low. */
const GEAR_UP = { height: 25, speed: 100, climb: 2 };
const GEAR_DOWN = { height: 60, speed: 92 };
/** Seconds of flight into terrain that trigger the PULL UP warning. */
const PULL_UP_SECONDS = 5;
/** The canopy's travel a second (0 open .. 1 shut). */
const CANOPY_RATE = 0.6;
/**
 * Detail by distance from the camera. The full model is 132k triangles, a third of them the
 * cockpit: two parked jets drawn in full from across the city cost more than the rest of the
 * scene. The cockpit is drawn only close up; a jet standing parked (as the simplified versions
 * show it) switches to 10k triangles past LOD1_FROM and 2.3k past LOD2_FROM. Each switch back
 * to more detail happens a little nearer than the switch away, so it can't flicker at the line.
 */
const INTERIOR_WITHIN = 40;
const LOD1_FROM = 70;
const LOD2_FROM = 200;
const LOD_HYSTERESIS = 0.9;
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

/** Jets in the world, for the player controller to find. */
const jets = new Set<OrionJet>();

/** The jet if the player at (x, z) is close enough to its cockpit ladder to climb in. */
export function findJetNear(x: number, z: number): OrionJet | null {
	const ladder: Vec3Tuple = [0, 0, 0];
	for (const jet of jets) {
		if (jet.destroyed || jet.piloted) continue;
		jet.ladderPoint(ladder);
		if (Math.hypot(ladder[0] - x, ladder[2] - z) < BOARD_REACH) return jet;
	}
	return null;
}

export class OrionJet extends Script {
	public static scriptName = "orionJet";
	public homeX = 0;
	public homeZ = 0;
	public homeHeading = 0;
	public homeGround = 0;

	public readonly flight = new JetFlight();
	public readonly armament = new JetArmament();
	public readonly lock = new MissileLock(JET_MISSILES);
	public piloted = false;
	public destroyed = false;
	public integrity = 100;
	/** The pilot's damage source, so what the jet hits is put down to the player. */
	public pilotSource: DamageSourceRef | null = null;

	private readonly id = nextCombatId();
	private body!: Listener;
	private readonly controls: JetInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
	private trigger = false;
	private readonly missiles: FlyingMissile[] = [];
	private lockTarget: Listener | null = null;
	private sinceLockSearch = 0;
	private readonly audio = new JetAudio();
	private rearmTimer = 0;
	private canopy = 0;
	/** Wrecked in the air: blows up when it hits. */
	private pendingBlast = false;
	private readonly damage: DamageSource = { x: 0, y: 0, z: 0, sin: 0, cos: 1, halfWidth: 2, halfLength: 9, groundY: 0, stage: "smoking", severity: 0 };
	private readonly event: DamageEvent = makeDamageEvent();
	private readonly ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 };
	private altitude = 0;
	private groundUnder = 0;
	private readonly groundCache = new Map<number, number | null>();
	private unsubscribeReset: (() => void) | null = null;
	// Model parts, found once the model has loaded.
	private partsFound = false;
	private canopyNode: Entity | null = null;
	private airbrakeNode: Entity | null = null;
	private gearNodes: Entity[] = [];
	private pylonNodes: (Entity | null)[] = [];
	private flames: { core: Entity; glow: Entity }[] = [];
	/** The full model's static pieces, the cockpit, and the two simplified versions. */
	private fullNodes: Entity[] = [];
	private interiorNode: Entity | null = null;
	private lodNodes: (Entity | null)[] = [];
	private detail = 0;
	private chuteNode: Entity | null = null;
	private flameMaterials: StandardMaterial[] = [];
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
		jets.add(this);
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
			jets.delete(this);
			unregisterDamageable(this.body);
			this.unsubscribeReset?.();
			for (const missile of this.missiles) missile.entity.destroy();
			this.missiles.length = 0;
			for (const material of this.flameMaterials) material.destroy();
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
		Object.assign(this.controls, NO_JET_INPUT);
		this.lock.clear();
		this.lockTarget = null;
		writeFlightHud({ flying: false });
	}

	public setControls(input: Readonly<JetInput>, trigger: boolean): void {
		Object.assign(this.controls, input);
		this.trigger = trigger;
	}

	public selectWeapon(weapon: JetWeapon): void {
		this.armament.select(weapon);
		combatAudio().play("equip", this.flight.x, this.flight.y, this.flight.z, 0.6);
	}

	public cycleWeapon(step: number): void {
		this.armament.cycle(step);
		combatAudio().play("equip", this.flight.x, this.flight.y, this.flight.z, 0.6);
	}

	/** Nobody aboard, engines off, stopped on its wheels and nothing of its own in the air. */
	private get resting(): boolean {
		const flight = this.flight;
		return !this.piloted && !this.pendingBlast && this.missiles.length === 0 && flight.spool === 0 && flight.landed
			&& flight.speed < 0.05 && Math.abs(flight.wx) + Math.abs(flight.wy) + Math.abs(flight.wz) < 0.01;
	}

	/** Stopped on its wheels: the pilot can climb out. */
	public get landed(): boolean {
		return this.flight.landed;
	}

	public seatPoint(out: Vec3Tuple): Vec3Tuple {
		return this.flight.toWorld(SEAT[0], SEAT[1], SEAT[2], out);
	}

	public ladderPoint(out: Vec3Tuple): Vec3Tuple {
		this.flight.toWorld(LADDER[0], LADDER[1], LADDER[2], out);
		out[1] = this.groundAt(out[0], out[2]) ?? out[1];
		return out;
	}

	public get heading(): number {
		return this.flight.heading;
	}

	/** World rotation of the airframe, for seating the pilot and the chase camera. */
	public get attitude(): Quat {
		return this.rotation.set(this.flight.qx, this.flight.qy, this.flight.qz, this.flight.qw);
	}

	// ---- Each frame --------------------------------------------------------------------------

	public update(dt: number) {
		if (!(dt > 0)) return;
		const flight = this.flight;
		// Parked, still and empty: nothing to fly. Stepping it anyway cost a dozen raycasts a
		// frame per jet to keep it exactly where it was.
		if (this.resting) {
			// React can re-apply the stand's position between frames: put it back where it rests.
			const at = this.entity.getPosition();
			if (Math.abs(at.x - flight.x) > 1e-3 || Math.abs(at.y - flight.y) > 1e-3 || Math.abs(at.z - flight.z) > 1e-3) this.pose();
			this.findParts();
			this.animateParts(dt);
			this.chooseDetail();
			this.rearm(dt);
			this.burn(dt);
			return;
		}
		this.groundCache.clear();
		this.measureAltitude();
		for (let i = 0; i < HULL.length; i++) flight.toWorld(HULL[i][0], HULL[i][1], HULL[i][2], this.previous[i]);

		this.autoGear();
		flight.advance(dt, this.piloted && !this.destroyed ? this.controls : NO_JET_INPUT, this.groundAt);
		this.handleContacts();
		this.pose();

		this.findParts();
		this.animateParts(dt);
		this.chooseDetail();
		if (this.piloted && !this.destroyed) {
			this.updateLock(dt);
			this.fireWeapons(dt);
		}
		this.updateMissiles(dt);
		this.rearm(dt);
		this.burn(dt);
		this.audio.update(flight.x, flight.y, flight.z, this.destroyed ? 0 : flight.spool, flight.afterburner, this.piloted);
		if (this.piloted) this.publish();
	}

	/** Height over whatever's below, with one long ray (also decides whether to look closer). */
	private measureAltitude() {
		const flight = this.flight;
		this.from.set(flight.x, flight.y, flight.z);
		this.to.set(flight.x, flight.y - 900, flight.z);
		const hit = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
		this.groundUnder = hit ? hit.point.y : isOnLand(flight.x, flight.z) ? flight.y - 900 : ORION_OCEAN.level;
		this.altitude = flight.y - JET_CG_HEIGHT - this.groundUnder;
	}

	/** The gear looks after itself: up once airborne and going, down when slow and low. */
	private autoGear() {
		const flight = this.flight;
		if (flight.wheelsDown > 0 || !this.piloted) {
			flight.gearDown = true;
			return;
		}
		if (flight.gearDown && this.altitude > GEAR_UP.height && (flight.vy > GEAR_UP.climb || flight.speed > GEAR_UP.speed)) flight.gearDown = false;
		else if (!flight.gearDown && this.altitude < GEAR_DOWN.height && flight.speed < GEAR_DOWN.speed) flight.gearDown = true;
	}

	/** Touchdowns, buildings and the ground, the sea. */
	private handleContacts() {
		const flight = this.flight;
		const sink = flight.takeTouchdown();
		if (this.pendingBlast && sink > 1) this.blowUp();
		else if (sink > CRASH_LANDING) this.destroy();
		else if (sink > HARD_LANDING) this.harm((sink - HARD_LANDING) * 8);

		if (!this.destroyed && flight.y - JET_CG_HEIGHT < ORION_OCEAN.level + 0.2 && !isOnLand(flight.x, flight.z)) this.destroy();

		// The airframe against buildings and the ground: each hull point swept along its move.
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
			else if (closing > IMPACT_FATAL) {
				this.destroy();
				this.blowUp();
			} else if (closing > IMPACT_HARMLESS) {
				this.harm((closing - IMPACT_HARMLESS) * 4);
				combatAudio().play("crash", hit.point.x, hit.point.y, hit.point.z, Math.min(1.5, closing / 10));
			}
		}
	}

	private pose() {
		const flight = this.flight;
		this.entity.setPosition(flight.x, flight.y, flight.z);
		this.entity.setRotation(flight.qx, flight.qy, flight.qz, flight.qw);
		const centre = flight.toWorld(0, -JET_CG_HEIGHT, BOX.centreZ, this.a);
		const forward = flight.directionToWorld(0, 0, 1, this.b);
		const flat = Math.hypot(forward[0], forward[2]) || 1;
		this.body.x = centre[0];
		this.body.y = centre[1];
		this.body.z = centre[2];
		this.body.headingX = forward[0] / flat;
		this.body.headingZ = forward[2] / flat;
		damageableMoved(this.body);
	}

	// ---- The model's moving parts ------------------------------------------------------------

	private findParts() {
		if (this.partsFound) return;
		const canopy = this.entity.findByName("canopy") as Entity | null;
		if (!canopy) return;
		this.partsFound = true;
		this.canopyNode = canopy;
		this.airbrakeNode = this.entity.findByName("airbrake") as Entity | null;
		this.gearNodes = ["gear-nose", "gear-left", "gear-right"].map((name) => this.entity.findByName(name) as Entity | null).filter((node): node is Entity => node !== null);
		this.pylonNodes = Array.from({ length: JET_MISSILES.count }, (_, index) => this.entity.findByName(`missile-${index + 1}`) as Entity | null);
		this.fullNodes = ["body", "engine-core", "canopy", "airbrake"].map((name) => this.entity.findByName(name) as Entity | null).filter((node): node is Entity => node !== null);
		this.interiorNode = this.entity.findByName("interior") as Entity | null;
		this.lodNodes = ["lod1", "lod2"].map((name) => this.entity.findByName(name) as Entity | null);
		this.showPylons();
		this.buildFlames();
		this.buildChute();
	}

	/** The braking parachute: a cloth canopy that streams out behind the tail on the landing roll. */
	private buildChute() {
		const material = new StandardMaterial();
		material.diffuse = new Color(0.86, 0.42, 0.16);
		material.gloss = 0.15;
		material.cull = 0;
		material.update();
		this.flameMaterials.push(material);
		const chute = new Entity("brake-chute");
		chute.addComponent("render", { type: "sphere", material, castShadows: true });
		chute.enabled = false;
		this.entity.addChild(chute);
		this.chuteNode = chute;
	}

	/** Afterburner flames: a hot core and a wider glow at each nozzle, additive, unlit. */
	private buildFlames() {
		const make = (colour: Color, opacity: number) => {
			const material = new StandardMaterial();
			material.useLighting = false;
			material.diffuse = new Color(0, 0, 0);
			material.emissive = colour;
			material.blendType = BLEND_ADDITIVE;
			material.depthWrite = false;
			material.opacity = opacity;
			material.cull = 0;
			material.update();
			this.flameMaterials.push(material);
			return material;
		};
		const coreMaterial = make(new Color(1, 0.72, 0.38), 0.9);
		const glowMaterial = make(new Color(1, 0.38, 0.12), 0.45);
		for (const nozzle of NOZZLES) {
			const cone = (material: StandardMaterial) => {
				const entity = new Entity("afterburner");
				entity.addComponent("render", { type: "cone", material, castShadows: false, receiveShadows: false });
				entity.enabled = false;
				this.entity.addChild(entity);
				entity.setLocalPosition(nozzle[0], nozzle[1], nozzle[2]);
				// The cone points along its +Y: turned to point back out of the nozzle.
				entity.setLocalEulerAngles(-90, 0, 0);
				return entity;
			};
			this.flames.push({ core: cone(coreMaterial), glow: cone(glowMaterial) });
		}
	}

	private animateParts(dt: number) {
		const flight = this.flight;
		// Canopy: shut with a pilot aboard, open when parked empty.
		const canopyWanted = this.piloted || !flight.landed ? 1 : 0;
		this.canopy += Math.max(-CANOPY_RATE * dt, Math.min(CANOPY_RATE * dt, canopyWanted - this.canopy));
		this.canopyNode?.setLocalEulerAngles(JET_GEOMETRY.canopyClosed * this.canopy, 0, 0);
		this.airbrakeNode?.setLocalEulerAngles(JET_GEOMETRY.airbrakeClosed + JET_GEOMETRY.airbrakeOpen * flight.airbrake, 0, 0);
		// Gear: each leg folds forward about its top into the bay, and is gone once it's in.
		const gear = flight.gear;
		for (const node of this.gearNodes) {
			node.enabled = gear > 0.04;
			if (node.enabled) node.setLocalEulerAngles(-95 * (1 - gear), 0, 0);
		}
		// Parachute: blooms out behind the tail, swaying a little.
		const chute = this.chuteNode;
		if (chute) {
			chute.enabled = flight.chute > 0.02;
			if (chute.enabled) {
				const open = flight.chute;
				const sway = Math.sin(performance.now() * 0.004) * 0.25;
				chute.setLocalPosition(sway, 0.6, body([0, 0, -11])[2] - 4 - 6 * open);
				chute.setLocalScale(3.6 * open + 0.3, 3.6 * open + 0.3, 1.8 * open + 0.3);
			}
		}
		// Flames: a faint shimmer at dry power, long and bright with the afterburner lit.
		const lit = !this.destroyed && flight.engineOn && flight.spool > 0.02;
		const burner = flight.afterburner ? (flight.spool - 0.85) / 0.15 : 0;
		const flicker = 0.9 + 0.1 * Math.sin(performance.now() * 0.05);
		const length = (0.6 + 1.2 * flight.spool + 4.5 * burner) * flicker;
		const radius = JET_GEOMETRY.nozzleRadius * (0.55 + 0.35 * burner);
		for (const flame of this.flames) {
			flame.core.enabled = lit && (flight.spool > 0.6 || burner > 0);
			flame.glow.enabled = lit && burner > 0;
			for (const [entity, scale] of [[flame.core, 0.7], [flame.glow, 1]] as const) {
				if (!entity.enabled) continue;
				const along = length * scale;
				entity.setLocalScale(radius * 2 * scale, along, radius * 2 * scale);
				// Base at the nozzle: the cone is centred on its origin.
				const nozzle = entity.getLocalPosition();
				entity.setLocalPosition(nozzle.x, nozzle.y, NOZZLES[0][2] - along / 2);
			}
		}
	}

	/** Which version of the model to draw, for the camera's distance (see LOD1_FROM). */
	private chooseDetail() {
		if (!this.partsFound) return;
		const camera = sceneCamera(this.app);
		const flight = this.flight;
		let distance = 0;
		if (camera) {
			const eye = camera.entity.getPosition();
			distance = Math.hypot(eye.x - flight.x, eye.y - flight.y, eye.z - flight.z);
		}
		// The simplified versions are the jet as it stands parked: only then can they stand in.
		const parked = !this.piloted && !this.destroyed && flight.landed && this.canopy === 0 && flight.airbrake === 0 && flight.gear >= 1 && this.armament.full;
		const far = (level: number, from: number) => distance > (this.detail >= level ? from * LOD_HYSTERESIS : from);
		const detail = !parked || this.lodNodes[0] === null ? 0 : far(2, LOD2_FROM) && this.lodNodes[1] ? 2 : far(1, LOD1_FROM) ? 1 : 0;
		this.detail = detail;
		const full = detail === 0;
		for (const node of this.fullNodes) node.enabled = full;
		if (this.interiorNode) this.interiorNode.enabled = full && distance < INTERIOR_WITHIN;
		if (!full) {
			for (const node of this.gearNodes) node.enabled = false;
			for (const node of this.pylonNodes) if (node) node.enabled = false;
		} else {
			this.showPylons();
		}
		this.lodNodes.forEach((node, index) => {
			if (node) node.enabled = detail === index + 1;
		});
	}

	private showPylons() {
		this.pylonNodes.forEach((node, index) => {
			if (node) node.enabled = this.armament.pylons[index];
		});
	}

	// ---- Weapons -------------------------------------------------------------------------------

	/** The missile seeker looks along the nose: whatever's nearest its centre, held, locks. */
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
		const flight = this.flight;
		const nose = flight.directionToWorld(0, 0, 1, this.b);
		const dx = target.x - flight.x;
		const dy = target.y + target.height / 2 - flight.y;
		const dz = target.z - flight.z;
		const distance = Math.hypot(dx, dy, dz) || 1;
		const along = (dx * nose[0] + dy * nose[1] + dz * nose[2]) / distance;
		return Math.acos(Math.max(-1, Math.min(1, along))) / DEG;
	}

	private bestTarget(): { target: Listener; angle: number } | null {
		const flight = this.flight;
		const nose = flight.directionToWorld(0, 0, 1, this.b);
		const flat = Math.hypot(nose[0], nose[2]);
		const reach = JET_MISSILES.range * Math.max(flat, 0.1);
		const nearby = flat > 0.1
			? damageablesAlong(flight.x, flight.z, flight.x + (nose[0] / flat) * reach, flight.z + (nose[2] / flat) * reach, 60)
			: damageablesNear(flight.x, flight.z, 150);
		let best: { target: Listener; angle: number } | null = null;
		for (const target of nearby) {
			// Heat-seekers go for engines: vehicles and aircraft, not people.
			if (!target.alive || target.id === this.id || target.kind !== "vehicle") continue;
			const distance = Math.hypot(target.x - flight.x, target.y - flight.y, target.z - flight.z);
			if (distance < 60 || distance > JET_MISSILES.range) continue;
			const angle = this.angleTo(target);
			if (angle > JET_MISSILES.keepCone) continue;
			if (!best || angle < best.angle) best = { target, angle };
		}
		if (!best) return null;
		this.from.set(flight.x, flight.y, flight.z);
		this.to.set(best.target.x, best.target.y + best.target.height / 2, best.target.z);
		const wall = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
		if (wall && wall.point.distance(this.to) > 5) return null;
		return best;
	}

	private fireWeapons(dt: number) {
		const fire = this.armament.update(dt, this.trigger);
		const flight = this.flight;
		if (fire.empty) combatAudio().play("empty", flight.x, flight.y, flight.z, 0.7);
		for (let round = 0; round < fire.rounds; round++) this.fireRound(round);
		if (fire.missile >= 0) this.launchMissile(fire.missile);
	}

	/** One 30 mm round, along the nose from the wing-root gun. */
	private fireRound(index: number) {
		const flight = this.flight;
		const muzzle = flight.toWorld(MUZZLE[0], MUZZLE[1], MUZZLE[2], this.a);
		const nose = flight.directionToWorld(0, 0, 1, this.b);
		const [dx, dy, dz] = scatter(nose[0], nose[1], nose[2], JET_CANNON.spread * DEG);
		const effects = crashEffects(this.app);
		if (index === 0) {
			effects.muzzleFlash(muzzle[0], muzzle[1], muzzle[2], dx, dy, dz, "rifle");
			combatAudio().play("rifle", muzzle[0], muzzle[1], muzzle[2], 1.4);
		}
		this.from.set(muzzle[0], muzzle[1], muzzle[2]);
		this.to.set(muzzle[0] + dx * JET_CANNON.range, muzzle[1] + dy * JET_CANNON.range, muzzle[2] + dz * JET_CANNON.range);
		const wall = this.physics?.raycastFirst(this.from, this.to, { filterCallback: this.notSelf });
		const wallDistance = wall ? wall.point.distance(this.from) : JET_CANNON.range;
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
		const flat = Math.hypot(dx, dz) || 1;
		if (hit) applyDamage(hit.target, this.fillEvent(JET_CANNON.damage, "explosive", x, y, z, dx / flat, dz / flat, 6));
		for (const near of [...damageablesNear(x, z, JET_CANNON.splashRadius + 2)]) {
			if (near === hit?.target || near.id === this.id) continue;
			const d = Math.hypot(near.x - x, near.y + near.height / 2 - y, near.z - z) - near.radius;
			if (d > JET_CANNON.splashRadius) continue;
			applyDamage(near, this.fillEvent(JET_CANNON.splashDamage, "explosive", x, y, z, (near.x - x) / (d + 1), (near.z - z) / (d + 1), 4));
		}
		const normal = wall && !hit ? wall.normal : null;
		effects.impact(x, y, z, normal?.x ?? -dx, normal?.y ?? -dy, normal?.z ?? -dz, hit?.target.kind === "person" ? "flesh" : hit ? "metal" : "hard");
		effects.muzzleFlash(x, y, z, normal?.x ?? -dx, normal?.y ?? -dy, normal?.z ?? -dz, "shotgun");
		combatAudio().play("impact", x, y, z, 0.9);
	}

	/** Drops the missile off its pylon with the jet's speed; the motor lights a moment later. */
	private launchMissile(pylon: number) {
		const node = this.pylonNodes[pylon];
		const flight = this.flight;
		const start = node ? node.getPosition().clone() : new Vec3(flight.x, flight.y - 1.5, flight.z);
		const down = flight.directionToWorld(0, -1, 0, this.b);
		const entity = node ? (node.clone() as Entity) : new Entity();
		entity.name = "missile-in-flight";
		this.app.root.addChild(entity);
		entity.setPosition(start);
		if (node) node.enabled = false;
		const target = this.lock.state === "locked" ? this.lockTarget : null;
		this.missiles.push({
			entity,
			state: {
				x: start.x, y: start.y, z: start.z,
				vx: flight.vx + down[0] * 4,
				vy: flight.vy + down[1] * 4,
				vz: flight.vz + down[2] * 4,
				age: 0,
			},
			target,
			targetX: target?.x ?? 0,
			targetY: target?.y ?? 0,
			targetZ: target?.z ?? 0,
			trail: new EmissionAccumulator(),
		});
		combatAudio().play("rocket", start.x, start.y, start.z, 1.5);
	}

	private updateMissiles(dt: number) {
		if (!(dt > 1e-4)) return;
		const effects = crashEffects(this.app);
		for (let i = this.missiles.length - 1; i >= 0; i--) {
			const missile = this.missiles[i];
			const state = missile.state;
			const target = missile.target && missile.target.alive ? missile.target : null;
			let aim: { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null = null;
			if (target) {
				aim = {
					x: target.x, y: target.y + target.height / 2, z: target.z,
					vx: (target.x - missile.targetX) / dt, vy: (target.y - missile.targetY) / dt, vz: (target.z - missile.targetZ) / dt,
				};
				missile.targetX = target.x;
				missile.targetY = target.y;
				missile.targetZ = target.z;
			}
			const fromX = state.x;
			const fromY = state.y;
			const fromZ = state.z;
			guideMissile(state, aim, dt, JET_MISSILES);
			const step = Math.hypot(state.x - fromX, state.y - fromY, state.z - fromZ);
			let blastAt: Vec3Tuple | null = null;
			if (state.age > 0.3 && step > 0) {
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
				const struck = raycastDamageables(ray, wallDistance, this.id);
				if (struck || wall) {
					const along = struck ? struck.distance : wallDistance;
					blastAt = [fromX + ray.dx * along, fromY + ray.dy * along, fromZ + ray.dz * along];
				}
			}
			if (!blastAt && aim && Math.hypot(aim.x - state.x, aim.y - state.y, aim.z - state.z) < JET_MISSILES.proximity) blastAt = [state.x, state.y, state.z];
			if (!blastAt && (state.age > JET_MISSILES.lifetime || state.y < ORION_OCEAN.level)) blastAt = [state.x, state.y, state.z];
			if (!Number.isFinite(state.x + state.y + state.z)) {
				missile.entity.destroy();
				this.missiles.splice(i, 1);
				continue;
			}
			if (blastAt) {
				detonate(this.app, blastAt[0], blastAt[1], blastAt[2], JET_MISSILES.explosionRadius, JET_MISSILES.explosionDamage, this.pilotSource);
				missile.entity.destroy();
				this.missiles.splice(i, 1);
				continue;
			}
			missile.entity.setPosition(state.x, state.y, state.z);
			const speed = Math.hypot(state.vx, state.vy, state.vz) || 1;
			// The model's nose is its +Z; lookAt points an entity's -Z, so look back along the path.
			this.to.set(state.x - state.vx, state.y - state.vy, state.z - state.vz);
			missile.entity.lookAt(this.to);
			if (state.age > 0.3) effects.rocketExhaust(state.x, state.y, state.z, state.vx / speed, state.vy / speed, state.vz / speed, missile.trail, dt);
		}
	}

	/** Stopped on its stand (or near it): rearmed and patched up. */
	private rearm(dt: number) {
		const flight = this.flight;
		const onStand = flight.landed && Math.hypot(flight.x - this.homeX, flight.z - this.homeZ) < REARM_RADIUS && !this.destroyed;
		if (!onStand || (this.armament.full && this.integrity >= 100)) {
			this.rearmTimer = 0;
			return;
		}
		this.rearmTimer += dt;
		if (this.rearmTimer < JET_REARM_SECONDS) return;
		this.rearmTimer = 0;
		this.armament.rearm();
		this.integrity = 100;
		this.showPylons();
		combatAudio().play("reload", flight.x, flight.y, flight.z, 1);
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
		this.lock.clear();
		if (this.altitude < 3) this.blowUp();
		else this.pendingBlast = true;
	}

	private blowUp() {
		this.pendingBlast = false;
		const flight = this.flight;
		detonate(this.app, flight.x, flight.y, flight.z, 12, 500, null);
		combatAudio().play("explosion", flight.x, flight.y, flight.z, 1.8);
	}

	/** Smoke when it's hurt, fire when it's badly hurt, a burning wreck when it's gone. */
	private burn(dt: number) {
		const stage = this.destroyed ? "wreck-fire" : this.integrity < 15 ? "burning" : this.integrity < 45 ? "smoking" : null;
		if (!stage) return;
		const flight = this.flight;
		const at = flight.toWorld(0, 0.2, -4, this.a);
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

	/** Back on its stand, as new, canopy open. */
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
		this.canopy = 0;
		this.showPylons();
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
		// The gun pipper: where rounds along the nose are 700 m out.
		const nose = flight.directionToWorld(0, 0, 1, this.c);
		const [boresightX, boresightY] = place(flight.x + nose[0] * 700, flight.y + nose[1] * 700, flight.z + nose[2] * 700);
		// Where the aircraft is actually going.
		const speed = flight.speed || 1;
		const [pathX, pathY] = flight.speed > 20 ? place(flight.x + (flight.vx / speed) * 400, flight.y + (flight.vy / speed) * 400, flight.z + (flight.vz / speed) * 400) : [-1, -1];
		let lockX = -1;
		let lockY = -1;
		if (this.lockTarget && this.lock.state !== "none") {
			[lockX, lockY] = place(this.lockTarget.x, this.lockTarget.y + this.lockTarget.height / 2, this.lockTarget.z);
		}
		let warning = "";
		const timeToGround = flight.vy < -1 ? this.altitude / -flight.vy : Infinity;
		if (this.destroyed) warning = "AIRFRAME LOST";
		else if (this.integrity < 25) warning = "DAMAGE CRITICAL";
		else if (!flight.onGround && flight.gear < 0.5 && timeToGround < PULL_UP_SECONDS && this.altitude < 250) warning = "PULL UP";
		else if (flight.stalling) warning = "STALL";
		else if (flight.y > flight.spec.ceiling) warning = "CEILING";
		writeFlightHud({
			flying: true,
			aircraft: "jet",
			altitude: Math.max(0, this.altitude),
			speed: flight.speed,
			verticalSpeed: flight.vy,
			heading: (((180 - flight.heading) % 360) + 360) % 360,
			rotor: 1,
			throttle: flight.throttle,
			afterburner: flight.afterburner,
			gear: flight.gear,
			load: flight.load,
			integrity: this.integrity,
			weapon: this.armament.selected,
			cannon: this.armament.rounds,
			rockets: 0,
			missiles: this.armament.missiles,
			lock: this.lock.state,
			lockProgress: this.lock.progress,
			landed: flight.landed,
			rearm: this.rearmTimer > 0 ? this.rearmTimer / JET_REARM_SECONDS : -1,
			warning,
			gunX: -1,
			gunY: -1,
			boresightX,
			boresightY,
			pathX,
			pathY,
			lockX,
			lockY,
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
}
