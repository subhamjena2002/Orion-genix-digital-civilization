import { Quat, Vec3, type AppBase, type Entity } from "playcanvas";

import { writePlayerAction } from "../player/PlayerPose";
import { playerRig } from "../player/PlayerRig";
import type { HoldRequest } from "../player/WeaponPose";
import { crashEffects } from "../traffic/CrashEffects";
import { combatAudio } from "./CombatAudio";
import { applyDamage, broadcastDisturbance, damageableMoved, damageablesNear, raycastDamageables, registerDamageable, unregisterDamageable, type Listener } from "./CombatWorld";
import { Health, makeDamageEvent, nextCombatId, type DamageEvent, type DamageSourceRef } from "./Damage";
import { HOLD_STYLES } from "./HoldStyles";
import { inMeleeArc, type Ray } from "./HitTests";
import { MeleeAttack } from "./MeleeAttack";
import { scatter } from "./Scatter";
import { Projectiles } from "./Projectiles";
import { publishCombatHud } from "./CombatHud";
import { WEAPONS, type WeaponDefinition } from "./WeaponData";
import { WeaponInventory } from "./WeaponInventory";
import { WeaponModels, type WeaponVisual } from "./WeaponModels";

/** What the controller passes in each frame. */
export interface CombatInput {
	/** Attack button held (automatic weapons keep firing). */
	attackHeld: boolean;
	/** Attack pressed this frame. */
	attackPressed: boolean;
	reloadPressed: boolean;
	/** A number key pressed this frame (1–9), or null. */
	slotPressed: number | null;
	/** Mouse wheel steps this frame (+ next, - previous). */
	wheel: number;
}

/** Where the player and camera are, each frame. */
export interface CombatContext {
	/** Feet position. */
	x: number;
	y: number;
	z: number;
	/** Facing, degrees (entity yaw: 0 faces +Z). */
	yaw: number;
	cameraX: number;
	cameraY: number;
	cameraZ: number;
	/** Unit view direction. */
	aimX: number;
	aimY: number;
	aimZ: number;
	/** On foot and in control (not driving, carjacking or dead). */
	active: boolean;
}

/** What the controller should do in response this frame. */
export interface CombatOutput {
	/** Camera kick in degrees (pitch up, yaw sideways). */
	recoilPitch: number;
	recoilYaw: number;
	/** The character should turn to face the aim (shooting or swinging). */
	faceAim: boolean;
}

const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 1.8;
const CHEST_HEIGHT = 1.35;
/** People within this distance hear a gunshot. */
const GUNSHOT_HEARING = 65;
/** People within this distance see a fight and get out of the way. */
const FIGHT_NOTICE = 12;
/** Keep facing the aim this long after the last shot. */
const AIM_HOLD_SECONDS = 1.2;
const REGEN_DELAY = 6;
const REGEN_PER_SECOND = 6;
const DEG = Math.PI / 180;

interface PhysicsRaycast {
	raycastFirst(start: Vec3, end: Vec3, options?: { filterCallback?: (entity: Entity) => boolean }): { point: Vec3; normal: Vec3; entity: Entity } | null;
}

/**
 * The player's side of combat: weapon selection, punching and sword swings, shooting and
 * rockets, and the player's own health. Input arrives from the existing controller (one input
 * system); everything else — hit shapes, damage, reactions — goes through the shared combat
 * world, so NPCs and cars need know nothing about particular weapons.
 */
export class PlayerCombat {
	public readonly inventory = new WeaponInventory(WEAPONS, "fists");
	public readonly health = new Health(100);
	public readonly source: DamageSourceRef = { id: nextCombatId(), kind: "player", x: 0, z: 0 };

	private readonly melee = new MeleeAttack(WEAPONS[0].melee!);
	private readonly models: WeaponModels;
	private readonly projectiles: Projectiles;
	private readonly event: DamageEvent = makeDamageEvent();
	private readonly output: CombatOutput = { recoilPitch: 0, recoilYaw: 0, faceAim: false };
	private readonly body: Listener;
	/** The weapon list for the HUD; the carried set doesn't change, so it's built once. */
	private readonly slotList: readonly { slot: number; name: string }[];
	private shown: WeaponVisual | null = null;
	private shownFor: WeaponDefinition | null = null;
	private aimHold = 0;
	/** 0 carried at the side .. 1 up and aimed. */
	private raise = 0;
	private sinceHurt = REGEN_DELAY;
	private triggerReleased = true;
	private swingAnimation = false;
	private readonly muzzle = new Vec3();
	private readonly from = new Vec3();
	private readonly to = new Vec3();
	private readonly handPosition = new Vec3();
	private readonly holdRotation = new Quat();
	private readonly aim = new Vec3();
	/** How much the arms are on the weapon rather than in the clip: a swing lets go of it. */
	private holdWeight = 0;
	private readonly holdRequest: HoldRequest = {
		style: HOLD_STYLES.unarmed,
		weapon: { root: null as unknown as Entity, hands: { main: null, off: null }, stock: 0 },
		aim: this.aim,
		raise: 0, weight: 0, equip: 0, reload: -1,
		attached: null,
	};
	/** Where the hand carries a blade mid-swing: the palm's turn, the body's hand's place. */
	private readonly attachedToHand = (position: Vec3, rotation: Quat) => {
		const rig = playerRig();
		const hand = rig?.hand ?? this.hand;
		if (!hand) return;
		position.copy(hand.getPosition());
		// The hilt is held in the palm, not at the wrist.
		if (rig?.palm) position.lerp(position, rig.palm.getPosition(), PALM_SHARE);
		rotation.copy((this.hand ?? hand).getRotation()).mul(SWORD_IN_HAND);
	};
	private readonly ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 };
	private hand: Entity | null = null;
	private context: CombatContext | null = null;
	/** Only the world blocks shots; people and cars are found by the combat grid. */
	private readonly worldOnly = (entity: Entity) => entity.name !== "player" && !entity.script?.has("orionVehicle") && entity.name !== "rocket";

	/** Called when the player's health runs out. */
	public onDeath: (() => void) | null = null;
	/** Called when the player is hurt, with the amount (for camera shake, flashes). */
	public onHurt: ((amount: number) => void) | null = null;

	public constructor(private readonly app: AppBase, private readonly player: Entity) {
		this.models = new WeaponModels(app, app.root);
		this.projectiles = new Projectiles(app);
		const isAlive = () => this.health.alive;
		this.body = {
			id: this.source.id,
			kind: "player",
			x: 0, y: 0, z: 0,
			radius: PLAYER_RADIUS,
			height: PLAYER_HEIGHT,
			halfLength: 0, headingX: 0, headingZ: 1,
			get alive() {
				return isAlive();
			},
			takeDamage: (event) => this.hurt(event),
		};
		registerDamageable(this.body);
		this.slotList = this.inventory.weapons.map((weapon) => ({ slot: weapon.definition.slot, name: weapon.definition.name }));
	}

	public get equipped(): WeaponDefinition {
		return this.inventory.current.definition;
	}

	public update(dt: number, input: CombatInput, context: CombatContext): CombatOutput {
		this.context = context;
		this.output.recoilPitch = 0;
		this.output.recoilYaw = 0;
		this.source.x = context.x;
		this.source.z = context.z;
		this.body.x = context.x;
		this.body.y = context.y;
		this.body.z = context.z;
		damageableMoved(this.body);
		this.regenerate(dt);

		if (!context.active) {
			// In a car or mid-carjack: put the weapon away and drop any swing.
			this.melee.cancel();
			this.endSwingAnimation();
			this.showWeapon(null);
			// The weapon is away, so there is nothing left to be aiming at. This used to be
			// skipped: the aim hold only counts down on the frames combat is active, so firing a
			// shot and then getting into a car froze it for the whole journey. The player stepped
			// out still "aiming", and while that is set the character turns to face the camera
			// rather than the way it is walking — so it crabbed sideways for a second every time
			// it left a vehicle, however long the drive had been.
			this.aimHold = 0;
			this.raise = 0;
			this.output.faceAim = false;
			this.projectiles.update(dt);
			this.publish();
			return this.output;
		}

		this.handleSelection(input);
		this.inventory.update(dt);
		if (input.reloadPressed && this.inventory.reload()) this.playWeaponSound("reload");

		const weapon = this.equipped;
		if (weapon.type === "melee" || weapon.type === "unarmed") this.updateMelee(dt, input, weapon);
		else this.updateGun(input, weapon);
		if (!input.attackHeld) this.triggerReleased = true;

		this.aimHold = Math.max(0, this.aimHold - dt);
		this.output.faceAim = this.aimHold > 0 || this.melee.swinging;
		this.showWeapon(weapon);
		this.projectiles.update(dt);
		this.publish();
		return this.output;
	}

	/**
	 * Tells the player's body what it's holding and how: it reaches both hands onto the weapon,
	 * carries it low at the ready and brings it up to the shoulder to shoot (see WeaponPose). A
	 * blade lets go for the swing, so the slash clip's arm sweeps it. Runs before the body poses
	 * itself for the frame. A body that can't hold things itself gets the weapon put at its hand.
	 */
	public placeWeapon(dt: number): void {
		const visual = this.shown;
		const context = this.context;
		const weapon = this.shownFor;
		const rig = playerRig();
		if (!visual || !context || !weapon || !visual.root.enabled) {
			rig?.setHold(null);
			return;
		}
		this.hand ??= (this.player.findByName("Palm.R") ?? this.player.findByName("Wrist.R") ?? this.player.findByName("MiddleHand.R")) as Entity | null;
		if (!rig?.holds) {
			this.placeAtHand(dt, visual, context);
			return;
		}
		this.raise += ((this.aimHold > 0 ? 1 : 0) - this.raise) * (1 - Math.exp(-RAISE_RATE * dt));
		const melee = weapon.type === "melee";
		const target = melee && this.melee.swinging ? 0 : 1;
		this.holdWeight += (target - this.holdWeight) * (1 - Math.exp(-(target > this.holdWeight ? 10 : 30) * dt));
		const request = this.holdRequest;
		request.style = HOLD_STYLES[weapon.hold];
		request.weapon.root = visual.root;
		request.weapon.hands = visual.hands;
		request.weapon.stock = visual.stock;
		this.aim.set(context.aimX, context.aimY, context.aimZ);
		request.raise = this.raise;
		request.weight = this.holdWeight;
		request.equip = this.inventory.equipProgress;
		request.reload = this.inventory.reloading ? this.inventory.reloadProgress : -1;
		request.attached = melee ? this.attachedToHand : null;
		rig.setHold(request);
	}

	/**
	 * The old way, for a body that can't hold things itself: the weapon in the hand at the side,
	 * coming up to the shoulder to shoot. Blades turn with the hand, so a slash sweeps the blade.
	 */
	private placeAtHand(dt: number, visual: WeaponVisual, context: CombatContext): void {
		// The visible body's hand when it has one; the animating rig's otherwise.
		const hand = playerRig()?.hand ?? this.hand;
		if (!hand) return;
		this.handPosition.copy(hand.getPosition());
		const weapon = this.shownFor;
		if (weapon?.type === "melee") {
			// Hilt in the palm, blade out along the fingers.
			this.holdRotation.copy((this.hand ?? hand).getRotation()).mul(SWORD_IN_HAND);
			visual.root.setPosition(this.handPosition);
			visual.root.setRotation(this.holdRotation);
			return;
		}
		const aiming = this.aimHold > 0 ? 1 : 0;
		this.raise += (aiming - this.raise) * (1 - Math.exp(-RAISE_RATE * dt));
		const hold = weapon?.id === "pistol" ? PISTOL_HOLD : weapon?.type === "projectile" ? LAUNCHER_HOLD : RIFLE_HOLD;
		const yaw = context.yaw * DEG;
		const forwardX = Math.sin(yaw);
		const forwardZ = Math.cos(yaw);
		// Character's right-hand side (facing +Z, right is -X).
		const rightX = -forwardZ;
		const rightZ = forwardX;
		const anchorX = context.x + rightX * hold.right + forwardX * hold.forward;
		const anchorY = context.y + hold.up;
		const anchorZ = context.z + rightZ * hold.right + forwardZ * hold.forward;
		const k = this.raise;
		visual.root.setPosition(
			this.handPosition.x + (anchorX - this.handPosition.x) * k,
			this.handPosition.y + (anchorY - this.handPosition.y) * k,
			this.handPosition.z + (anchorZ - this.handPosition.z) * k,
		);
		const pitch = (Math.asin(Math.max(-1, Math.min(1, context.aimY))) / DEG) * k;
		this.holdRotation.setFromEulerAngles(pitch, context.yaw + 180, 0);
		visual.root.setRotation(this.holdRotation);
	}

	/** Back to full health with fists out (respawn). */
	public reset(): void {
		this.health.reset();
		this.melee.cancel();
		this.endSwingAnimation();
		this.sinceHurt = REGEN_DELAY;
	}

	public destroy(): void {
		unregisterDamageable(this.body);
		this.models.destroy();
		this.projectiles.destroy();
	}

	private handleSelection(input: CombatInput) {
		let changed = false;
		if (input.slotPressed !== null) changed = this.inventory.selectSlot(input.slotPressed);
		else if (input.wheel !== 0) changed = this.inventory.cycle(input.wheel > 0 ? 1 : -1);
		if (!changed) return;
		this.melee.cancel();
		this.endSwingAnimation();
		const weapon = this.equipped;
		if (weapon.melee) this.melee.setTiming(weapon.melee);
		if (weapon.sounds.equip) this.playWeaponSound(weapon.sounds.equip);
	}

	private updateMelee(dt: number, input: CombatInput, weapon: WeaponDefinition) {
		if (input.attackPressed && !this.inventory.switching && this.melee.start()) {
			writePlayerAction(weapon.animations.attack || "Punch", weapon.animations.speed);
			this.swingAnimation = true;
			this.playWeaponSound(weapon.sounds.fire);
		}
		const phase = this.melee.update(dt);
		if (this.melee.active) this.resolveMeleeHits(weapon);
		if (phase === "cooldown" || phase === "ready") this.endSwingAnimation();
	}

	/** Everything in the swing's arc, within reach, at body height and not behind a wall. */
	private resolveMeleeHits(weapon: WeaponDefinition) {
		const context = this.context!;
		const melee = weapon.melee!;
		const facingX = Math.sin(context.yaw * DEG);
		const facingZ = Math.cos(context.yaw * DEG);
		const arcCos = Math.cos(melee.arcDegrees * DEG);
		const physics = this.app.systems.rigidbody as unknown as PhysicsRaycast | undefined;
		// Copied: a kill can recycle the victim, which touches the grid the query reads from.
		const nearby = [...damageablesNear(context.x, context.z, melee.reach + 3)];
		for (const target of nearby) {
			if (target.id === this.body.id || !target.alive || !this.melee.canHit(target.id)) continue;
			const radius = target.kind === "vehicle" ? Math.max(target.radius, target.halfLength) : target.radius;
			if (!inMeleeArc(context.x, context.z, facingX, facingZ, target.x, target.z, radius, melee.reach, arcCos)) continue;
			// Standing on roughly the same level: no punching someone on a balcony overhead.
			if (target.y > context.y + 1.4 || target.y + target.height < context.y + 0.4) continue;
			this.from.set(context.x, context.y + CHEST_HEIGHT, context.z);
			this.to.set(target.x, target.y + Math.min(CHEST_HEIGHT, target.height * 0.7), target.z);
			if (physics?.raycastFirst?.(this.from, this.to, { filterCallback: this.worldOnly })) continue;

			this.melee.markHit(target.id);
			const event = this.fillEvent(weapon, this.to.x, this.to.y, this.to.z, facingX, facingZ);
			applyDamage(target, event);
			const surface = target.kind === "vehicle" ? "metal" : "flesh";
			crashEffects(this.app).impact(this.to.x, this.to.y, this.to.z, -facingX, 0, -facingZ, surface);
			combatAudio().play(target.kind === "vehicle" ? "impact" : "punch", this.to.x, this.to.y, this.to.z);
			broadcastDisturbance(context.x, context.z, FIGHT_NOTICE, { id: this.source.id, x: context.x, z: context.z, attackable: true }, target.id);
		}
	}

	private updateGun(input: CombatInput, weapon: WeaponDefinition) {
		const wantsFire = weapon.automatic ? input.attackHeld : input.attackPressed || (input.attackHeld && this.triggerReleased);
		if (!wantsFire) return;
		this.triggerReleased = false;
		const result = this.inventory.fire();
		if (result === "busy") return;
		this.aimHold = AIM_HOLD_SECONDS;
		if (result === "empty") {
			if (weapon.sounds.empty) this.playWeaponSound(weapon.sounds.empty);
			return;
		}
		const context = this.context!;
		// The last round out starts a reload straight away, as a player would.
		if (this.inventory.current.magazine === 0 && this.inventory.reload() && weapon.sounds.reload) this.playWeaponSound(weapon.sounds.reload);
		this.muzzlePoint(weapon);
		const effects = crashEffects(this.app);
		if (weapon.effects.muzzle !== "none") {
			effects.muzzleFlash(this.muzzle.x, this.muzzle.y, this.muzzle.z, context.aimX, context.aimY, context.aimZ, weapon.effects.muzzle);
		}
		combatAudio().play(weapon.sounds.fire, this.muzzle.x, this.muzzle.y, this.muzzle.z, 1.2);
		this.output.recoilPitch += weapon.recoil.pitch;
		this.output.recoilYaw += (Math.random() - 0.5) * 2 * weapon.recoil.yaw;
		broadcastDisturbance(context.x, context.z, GUNSHOT_HEARING, { id: this.source.id, x: context.x, z: context.z, attackable: true });

		if (weapon.type === "projectile" && weapon.projectile) {
			const aim = this.aimPoint(context.aimX, context.aimY, context.aimZ, weapon.range);
			const dx = aim.x - this.muzzle.x;
			const dy = aim.y - this.muzzle.y;
			const dz = aim.z - this.muzzle.z;
			const length = Math.hypot(dx, dy, dz) || 1;
			this.projectiles.fire(this.muzzle.x, this.muzzle.y, this.muzzle.z, dx / length, dy / length, dz / length, weapon.projectile, this.source);
			return;
		}
		for (let pellet = 0; pellet < weapon.pellets; pellet++) this.fireRound(weapon);
	}

	/**
	 * One bullet. Aimed from the camera (what the crosshair is over), then flown from the muzzle
	 * to that point so a wall right in front of the gun still stops it.
	 */
	private fireRound(weapon: WeaponDefinition) {
		const context = this.context!;
		const [dx, dy, dz] = scatter(context.aimX, context.aimY, context.aimZ, weapon.spread * DEG);
		const aim = this.aimPoint(dx, dy, dz, weapon.range);

		const physics = this.app.systems.rigidbody as unknown as PhysicsRaycast | undefined;
		let length = Math.hypot(aim.x - this.muzzle.x, aim.y - this.muzzle.y, aim.z - this.muzzle.z) || 1;
		this.ray.ox = this.muzzle.x;
		this.ray.oy = this.muzzle.y;
		this.ray.oz = this.muzzle.z;
		this.ray.dx = (aim.x - this.muzzle.x) / length;
		this.ray.dy = (aim.y - this.muzzle.y) / length;
		this.ray.dz = (aim.z - this.muzzle.z) / length;
		// Slightly past the aim point, so the thing aimed at is actually reached.
		length = Math.min(weapon.range, length + 0.5);
		this.from.set(this.muzzle.x, this.muzzle.y, this.muzzle.z);
		this.to.set(this.muzzle.x + this.ray.dx * length, this.muzzle.y + this.ray.dy * length, this.muzzle.z + this.ray.dz * length);
		const wall = physics?.raycastFirst?.(this.from, this.to, { filterCallback: this.worldOnly });
		const wallDistance = wall ? wall.point.distance(this.from) : length;
		const hit = raycastDamageables(this.ray, wallDistance, this.body.id);
		const effects = crashEffects(this.app);

		if (hit) {
			const x = this.ray.ox + this.ray.dx * hit.distance;
			const y = this.ray.oy + this.ray.dy * hit.distance;
			const z = this.ray.oz + this.ray.dz * hit.distance;
			const flat = Math.hypot(this.ray.dx, this.ray.dz) || 1;
			applyDamage(hit.target, this.fillEvent(weapon, x, y, z, this.ray.dx / flat, this.ray.dz / flat));
			effects.impact(x, y, z, -this.ray.dx, -this.ray.dy, -this.ray.dz, hit.target.kind === "vehicle" ? "metal" : "flesh");
			if (weapon.effects.tracer) effects.tracer(this.ray.ox, this.ray.oy, this.ray.oz, x, y, z);
			return;
		}
		if (wall) {
			effects.impact(wall.point.x, wall.point.y, wall.point.z, wall.normal.x, wall.normal.y, wall.normal.z, "hard");
			combatAudio().play("impact", wall.point.x, wall.point.y, wall.point.z, 0.6);
		}
		if (weapon.effects.tracer) effects.tracer(this.ray.ox, this.ray.oy, this.ray.oz, this.to.x, this.to.y, this.to.z);
	}

	/**
	 * Where a ray from the camera along (dx, dy, dz) first meets something, within `range` of the
	 * player. The ray starts level with the player, so nothing between the camera and the player
	 * (a lamp post behind them) can be shot by mistake.
	 */
	private aimPoint(dx: number, dy: number, dz: number, range: number): Vec3 {
		const context = this.context!;
		const alongToPlayer = (context.x - context.cameraX) * dx + (context.y + CHEST_HEIGHT - context.cameraY) * dy + (context.z - context.cameraZ) * dz;
		const start = Math.max(0, alongToPlayer);
		this.ray.ox = context.cameraX + dx * start;
		this.ray.oy = context.cameraY + dy * start;
		this.ray.oz = context.cameraZ + dz * start;
		this.ray.dx = dx;
		this.ray.dy = dy;
		this.ray.dz = dz;
		this.from.set(this.ray.ox, this.ray.oy, this.ray.oz);
		this.to.set(this.ray.ox + dx * range, this.ray.oy + dy * range, this.ray.oz + dz * range);
		const physics = this.app.systems.rigidbody as unknown as PhysicsRaycast | undefined;
		const wall = physics?.raycastFirst?.(this.from, this.to, { filterCallback: this.worldOnly });
		let distance = wall ? wall.point.distance(this.from) : range;
		const target = raycastDamageables(this.ray, distance, this.body.id);
		if (target) distance = target.distance;
		return AIM_SCRATCH.set(this.ray.ox + dx * distance, this.ray.oy + dy * distance, this.ray.oz + dz * distance);
	}

	private muzzlePoint(weapon: WeaponDefinition) {
		const visual = this.models.visualFor(weapon);
		const context = this.context!;
		if (visual?.root.enabled) {
			visual.root.getWorldTransform().transformPoint(visual.muzzle, this.muzzle);
			return;
		}
		// Not placed yet: roughly at the right hand, out in front.
		const yaw = context.yaw * DEG;
		this.muzzle.set(context.x + Math.sin(yaw) * 0.6 - Math.cos(yaw) * 0.2, context.y + CHEST_HEIGHT, context.z + Math.cos(yaw) * 0.6 + Math.sin(yaw) * 0.2);
	}

	private fillEvent(weapon: WeaponDefinition, x: number, y: number, z: number, directionX: number, directionZ: number): DamageEvent {
		const event = this.event;
		event.amount = weapon.damage;
		event.type = weapon.damageType;
		event.source = this.source;
		event.x = x;
		event.y = y;
		event.z = z;
		event.directionX = directionX;
		event.directionZ = directionZ;
		event.impulse = weapon.impulse;
		return event;
	}

	private hurt(event: DamageEvent) {
		this.sinceHurt = 0;
		const killed = this.health.damage(event.amount);
		this.onHurt?.(event.amount);
		if (killed) this.onDeath?.();
	}

	private regenerate(dt: number) {
		this.sinceHurt += dt;
		if (this.sinceHurt > REGEN_DELAY) this.health.heal(REGEN_PER_SECOND * dt);
	}

	private endSwingAnimation() {
		if (!this.swingAnimation) return;
		this.swingAnimation = false;
		writePlayerAction("");
	}

	private showWeapon(weapon: WeaponDefinition | null) {
		if (weapon === this.shownFor) return;
		if (this.shown) this.shown.root.enabled = false;
		this.shownFor = weapon;
		this.shown = weapon ? this.models.visualFor(weapon) : null;
		if (this.shown) this.shown.root.enabled = true;
	}

	private playWeaponSound(id: Parameters<ReturnType<typeof combatAudio>["play"]>[0]) {
		const context = this.context;
		if (context) combatAudio().play(id, context.x, context.y + CHEST_HEIGHT, context.z, 0.8);
	}

	private publish() {
		const carried = this.inventory.current;
		publishCombatHud({
			weaponId: carried.definition.id,
			weaponName: carried.definition.name,
			slot: carried.definition.slot,
			magazine: carried.magazine,
			magazineSize: carried.definition.magazineSize,
			reserve: carried.reserve,
			reloading: this.inventory.reloading,
			reloadProgress: this.inventory.reloadProgress,
			health: this.health.current,
			maxHealth: this.health.max,
			showCrosshair: carried.definition.type === "hitscan" || carried.definition.type === "projectile",
			slots: this.slotList,
		});
	}
}

const AIM_SCRATCH = new Vec3();

/** How quickly a gun comes up to aim (1/s). */
const RAISE_RATE = 14;
/** Where the grip sits when aiming, from the feet: metres right, up and forward. */
const RIFLE_HOLD = { right: 0.2, up: 1.3, forward: 0.3 };
const LAUNCHER_HOLD = { right: 0.18, up: 1.5, forward: 0.1 };
const PISTOL_HOLD = { right: 0.12, up: 1.38, forward: 0.5 };

/**
 * The palm bone's axes, mapped to a held blade: the model's forward (-Z, the tip) out along the
 * fingers. Tuned by eye against Man_SwordSlash.
 */
const SWORD_IN_HAND = new Quat().setFromEulerAngles(90, 0, 0);
/** How far from the wrist to the middle finger's base the hilt is held. */
const PALM_SHARE = 0.7;

export { scatter };
