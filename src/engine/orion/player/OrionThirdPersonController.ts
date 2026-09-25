import { Entity, Script, Vec3 } from "playcanvas";

import { ORION_OCEAN } from "../world/Ocean";
import { combatAudio } from "../combat/CombatAudio";
import { damageablesNear } from "../combat/CombatWorld";
import { setWasted } from "../combat/CombatHud";
import { PlayerCombat, type CombatContext, type CombatInput } from "../combat/PlayerCombat";
import { playerRig } from "./PlayerRig";
import { bloodMaterial } from "../characters/Knockdown";
import { engineAudio } from "../audio/EngineAudio";
import { findCarNear, shardMaterial } from "../traffic/Carjack";
import { prewarmBurntBodies } from "../traffic/CarMeshes";
import { crashEffects } from "../traffic/CrashEffects";
import { skidMarks } from "../traffic/SkidMarks";
import { clearWrecksNear, type OrionVehicle } from "../traffic/OrionVehicle";
import { PLAYER_VISUAL_NAME, writeCameraLens, writeCameraView, writePlayerAction, writePlayerPose, writeVehicleState } from "./PlayerPose";

const UP = new Vec3(0, 1, 0);
/** Ray begins outside the player's own capsule (radius 0.45) so it can't hit the player. */
const CAMERA_RAY_START = 0.7;
const CAMERA_SURFACE_MARGIN = 0.35;
const CAMERA_MIN_DISTANCE = 1.2;
/** Pull in hard so a wall never clips; extend back gently so brief hits don't pop the view. */
const CAMERA_PULL_IN_RATE = 40;
const CAMERA_EXTEND_RATE = 6;
const CAMERA_EYE_SMOOTHING = 14;

/** The player's capsule centre sits this far above their feet. */
const CAPSULE_HALF_HEIGHT = 0.9;
/** How close to a driver's door the player must be to take the car. */
const CARJACK_REACH = 3.2;
/** Fastest a car may be going for the player to get out. */
const EXIT_SPEED = 3;
// Chase camera.
const DRIVE_CAMERA_DISTANCE = 6.2;
/** Extra distance per m/s, so the car sits further ahead of the lens at speed. */
const DRIVE_CAMERA_STRETCH = 0.05;
const DRIVE_CAMERA_MAX_STRETCH = 2.2;
const DRIVE_CAMERA_HEIGHT = 1.55;
const DRIVE_CAMERA_PITCH = 11;
/** Seconds after the mouse stops before the camera swings back behind the car. */
const CAMERA_RECENTRE_DELAY = 1.2;
const CAMERA_RECENTRE_RATE = 2.2;
/** How far the camera leans into a slide, as a share of the drift angle. */
const DRIFT_LOOK = 0.55;
const MAX_DRIFT_LOOK = 40;
/** Field of view widens with speed. */
const FOV_PER_SPEED = 0.32;
const MAX_FOV_BOOST = 20;
const FOV_SMOOTHING = 3;
const SHAKE_PER_IMPACT = 0.045;
const SHAKE_DECAY = 7;
const NEAR_CAR_CHECK_SECONDS = 0.2;
/**
 * People are animated, not simulated — they have no physics body for the player's capsule to
 * meet — so the player is kept this far (body radius) from each of them in code instead.
 */
const PLAYER_BODY_RADIUS = 0.3;
/** Fastest the player is eased out of someone they've ended up overlapping (m/s). */
const SEPARATION_SPEED = 3;
/** How long the shader warm-up props stay in front of the lens. */
const PREWARM_SECONDS = 1.5;
/** Lying dead before coming back at the spawn point. */
const WASTED_SECONDS = 4;
/** Burning cars within this far of the spawn point are cleared away as the player comes back. */
const RESPAWN_CLEAR_RADIUS = 60;
/** A click that moved the mouse less than this (px) is an attack, not a drag-to-look. */
const CLICK_SLOP = 6;
/** How quickly the character turns to face the aim while shooting or swinging. */
const AIM_TURN_RESPONSE = 20;
const HURT_SHAKE = 0.004;

/** Swings thrown at the driver on the ground, and how far into each one the fist connects. */
const BEAT = { hits: 2, interval: 0.55, lands: 0.22 } as const;
/**
 * Carjack timeline, in seconds from pressing F: walk to the door, smash the window, drag the
 * driver out, beat them while they are down, swing the door open and get in. With nobody inside
 * (a car the player left parked) everything up to the door is skipped.
 */
const CARJACK = {
	approach: 0.45,
	smashAt: 0.8,
	smashEnd: 1.2,
	pullEnd: 2.2,
	/** pullEnd + BEAT.hits * BEAT.interval. */
	beatEnd: 3.3,
	doorEnd: 3.85,
	enterEnd: 4.45,
	doorCloseSeconds: 0.4,
} as const;

type PlayerMode = "onFoot" | "carjack" | "driving";

function smooth(t: number): number {
	const k = Math.max(0, Math.min(1, t));
	return k * k * (3 - 2 * k);
}

export class OrionThirdPersonController extends Script {
	public static scriptName = "orionThirdPersonController";
	public camera: Entity | null = null;
	public walkSpeed = 4.8;
	public runSpeed = 9.2;
	public acceleration = 16;
	public braking = 22;
	public mouseSensitivity = 0.12;
	public cameraDistance = 5.5;
	public cameraHeight = 1.35;
	public jumpForce = 450;
	/** How sharply the character swings round to face its direction of travel. */
	public turnResponse = 12;

	private readonly keys = new Set<string>();
	private combat: PlayerCombat | null = null;
	private readonly combatInput: CombatInput = { attackHeld: false, attackPressed: false, reloadPressed: false, slotPressed: null, wheel: 0 };
	private readonly combatContext: CombatContext = { x: 0, y: 0, z: 0, yaw: 0, cameraX: 0, cameraY: 0, cameraZ: 0, aimX: 0, aimY: 0, aimZ: 1, active: false };
	private dragDistance = 0;
	private wastedTimer = 0;
	private mouseX = 0;
	private mouseY = 0;
	private yaw = 0;
	private pitch = 22;
	private characterYaw = 0;
	private cameraPosition = new Vec3();
	private readonly cameraTarget = new Vec3();
	private readonly desiredCameraPosition = new Vec3();
	private readonly forward = new Vec3();
	private readonly right = new Vec3();
	private readonly desiredVelocity = new Vec3();
	private visual: Entity | null = null;
	private readonly currentVelocity = new Vec3();
	private readonly rayDirection = new Vec3();
	private readonly rayStart = new Vec3();
	private readonly rayScratch = new Vec3();
	private readonly spawnPoint = new Vec3();
	private readonly groundProbeStart = new Vec3();
	private readonly groundProbeEnd = new Vec3();
	private cameraDistanceCurrent = 0;
	private smoothedEyeY: number | null = null;
	private drownTimer = 0;
	private dragging = false;
	private mode: PlayerMode = "onFoot";
	private car: OrionVehicle | null = null;
	/** This frame's step, kept so the audio mix can be driven from the camera update. */
	private lastDelta = 1 / 60;
	private carjackTime = 0;
	private readonly carjackFrom = new Vec3();
	private skipPull = false;
	private smashed = false;
	private pulled = false;
	private released = false;
	/** Punches landed on the driver so far this carjacking. */
	private beatsLanded = 0;
	private doorCloseTimer = 0;
	private sinceMouse = 99;
	private interactPressed = false;
	private readonly carPoint = new Vec3();
	private readonly seatScratch = new Vec3();
	private baseFov = 48;
	private shake = 0;
	private nearCarTimer = 0;
	private nearCar = false;
	private prewarmProps: Entity[] = [];
	private prewarmTimer = 0;

	private isPointerLocked() {
		return document.pointerLockElement === this.app.graphicsDevice.canvas;
	}

	/**
	 * Look input accepts either pointer lock (immersive, mouse hidden) or plain click-drag.
	 * The drag path matters: pointer lock needs a user gesture and silently fails in embedded
	 * or cross-origin contexts, and without a fallback the camera can never turn at all.
	 */
	private readonly pointerMove = (event: MouseEvent) => {
		if (!this.isPointerLocked() && !this.dragging) return;
		this.mouseX += event.movementX;
		this.mouseY += event.movementY;
		if (this.dragging) this.dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
	};
	private readonly keyDown = (event: KeyboardEvent) => {
		if (event.code === "KeyF" && !event.repeat) this.interactPressed = true;
		// Number keys pick weapons (1 fists, 2 sword, 3 pistol, 4 AR, 5 shotgun, 6 rocket, 7 spare).
		const digit = /^Digit([1-9])$/.exec(event.code);
		if (digit && !event.repeat) this.combatInput.slotPressed = Number(digit[1]);
		if (event.code === "KeyR" && !event.repeat) this.combatInput.reloadPressed = true;
		this.keys.add(event.code);
	};
	private readonly wheel = (event: WheelEvent) => {
		if (this.mode !== "onFoot" || event.deltaY === 0) return;
		event.preventDefault();
		this.combatInput.wheel += Math.sign(event.deltaY);
	};
	private readonly keyUp = (event: KeyboardEvent) => this.keys.delete(event.code);
	/**
	 * Left button: with the pointer locked it's the trigger (held for automatic fire). Without a
	 * lock it doubles as drag-to-look, so only a click that didn't drag counts as an attack.
	 */
	private readonly pointerDown = (event: MouseEvent) => {
		if (event.button !== 0) return;
		if (this.isPointerLocked()) {
			this.combatInput.attackHeld = true;
			this.combatInput.attackPressed = true;
			return;
		}
		this.dragging = true;
		this.dragDistance = 0;
	};
	private readonly pointerUp = (event: MouseEvent) => {
		if (event.button !== 0) return;
		if (this.dragging && this.dragDistance < CLICK_SLOP) this.combatInput.attackPressed = true;
		this.combatInput.attackHeld = false;
		this.dragging = false;
	};
	private readonly canvasClick = () => {
		if (this.isPointerLocked()) return;
		// Best-effort: if the browser refuses, drag-to-look still works.
		Promise.resolve(this.app.graphicsDevice.canvas.requestPointerLock()).catch(() => undefined);
	};

	public initialize() {
		if (!this.camera) {
			throw new Error("OrionThirdPersonController: Camera entity is required.");
		}

		const canvas = this.app.graphicsDevice.canvas;
		canvas.addEventListener("click", this.canvasClick);
		canvas.addEventListener("mousedown", this.pointerDown);
		window.addEventListener("mouseup", this.pointerUp);
		window.addEventListener("mousemove", this.pointerMove);
		window.addEventListener("keydown", this.keyDown);
		window.addEventListener("keyup", this.keyUp);
		canvas.addEventListener("wheel", this.wheel, { passive: false });
		this.spawnPoint.copy(this.entity.getPosition());
		this.combat = new PlayerCombat(this.app, this.entity);
		this.combat.onDeath = () => this.die();
		this.combat.onHurt = (amount) => {
			this.shake = Math.max(this.shake, Math.min(0.12, amount * HURT_SHAKE));
		};
		this.cameraDistanceCurrent = this.cameraDistance;
		this.yaw = this.camera.getEulerAngles().y;
		this.characterYaw = this.entity.getEulerAngles().y;
		this.cameraPosition.copy(this.camera.getPosition());
		this.baseFov = this.camera.camera?.fov ?? this.baseFov;
		this.prewarmEffects();
		this.on("destroy", this.destroy, this);
	}

	public update(dt: number) {
		if (!this.camera || !this.entity.rigidbody) return;
		this.lastDelta = dt;
		if (this.prewarmTimer > 0) {
			this.prewarmTimer -= dt;
			if (this.prewarmTimer <= 0) {
				for (const prop of this.prewarmProps) prop.destroy();
				this.prewarmProps = [];
			}
		}

		this.yaw -= this.mouseX * this.mouseSensitivity;
		this.pitch = Math.max(-12, Math.min(68, this.pitch - this.mouseY * this.mouseSensitivity));
		this.sinceMouse = this.mouseX !== 0 || this.mouseY !== 0 ? 0 : this.sinceMouse + dt;
		this.mouseX = 0;
		this.mouseY = 0;

		if (this.wastedTimer > 0) {
			this.updateWasted(dt);
			return;
		}

		const interact = this.interactPressed;
		this.interactPressed = false;
		if (interact && this.mode === "onFoot") this.tryCarjack();
		else if (interact && this.mode === "driving") this.tryExitCar();
		if (this.mode === "carjack") {
			this.runCombat(dt, false);
			this.updateCarjack(dt);
			return;
		}
		if (this.mode === "driving") {
			this.runCombat(dt, false);
			this.updateDriving();
			return;
		}
		this.easeFov(this.baseFov, dt);
		this.nearCarTimer -= dt;
		if (this.nearCarTimer <= 0) {
			this.nearCarTimer = NEAR_CAR_CHECK_SECONDS;
			const here = this.entity.getPosition();
			this.nearCar = findCarNear(here.x, here.z, CARJACK_REACH) !== null;
			writeVehicleState(false, 0, this.nearCar);
		}

		// Movement is camera-relative (as in most third-person games): the stick/keys pick a
		// direction on screen, and the character turns to face wherever that lands.
		const axisX = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
		const axisZ = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
		const axisLength = Math.hypot(axisX, axisZ);
		const normalizedX = axisLength > 0 ? axisX / axisLength : 0;
		const normalizedZ = axisLength > 0 ? axisZ / axisLength : 0;
		const radians = this.yaw * Math.PI / 180;
		this.forward.set(Math.sin(radians), 0, Math.cos(radians));
		// Right-handed, Y-up: facing +Z means right is -X, so this is -cross(forward, up).
		// The unnegated form sends D to screen-left.
		this.right.set(-Math.cos(radians), 0, Math.sin(radians));
		const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? this.runSpeed : this.walkSpeed;
		this.desiredVelocity.set(
			this.forward.x * normalizedZ * speed + this.right.x * normalizedX * speed,
			0,
			this.forward.z * normalizedZ * speed + this.right.z * normalizedX * speed,
		);

		const velocity = this.entity.rigidbody.linearVelocity;
		this.currentVelocity.set(velocity.x, velocity.y, velocity.z);
		const response = axisLength > 0 ? this.acceleration : this.braking;
		// Exponential in dt, like the camera and the turn: a linear `response * dt` reaches a
		// different fraction of the target per second at 30 fps than at 144, so the character
		// picked up and shed speed at a rate that changed with the frame rate.
		const blend = 1 - Math.exp(-response * dt);
		this.currentVelocity.x += (this.desiredVelocity.x - this.currentVelocity.x) * blend;
		this.currentVelocity.z += (this.desiredVelocity.z - this.currentVelocity.z) * blend;
		if (this.keys.has("Space") && this.isGrounded()) {
			this.currentVelocity.y = this.jumpForce / this.entity.rigidbody.mass;
		}

		const submerged = this.entity.getPosition().y < ORION_OCEAN.level - ORION_OCEAN.submergeDepth;
		if (submerged) {
			// Water drags: cap the sink rate and bleed off horizontal momentum. The damping is
			// exponential in dt so it behaves the same at 30fps as at 144.
			const drag = Math.exp(-ORION_OCEAN.drag * dt);
			this.currentVelocity.y = Math.max(this.currentVelocity.y, -ORION_OCEAN.sinkSpeed);
			this.currentVelocity.x *= drag;
			this.currentVelocity.z *= drag;
		}
		this.keepClearOfPeople(dt);
		this.entity.rigidbody.linearVelocity = this.currentVelocity;

		this.updateDrowning(submerged, dt);

		// Shooting or swinging turns the character to where the camera aims; otherwise they turn
		// towards the direction of travel, and hold the last facing when idle.
		const combat = this.runCombat(dt, true);
		if (combat?.faceAim) {
			const angleDelta = ((this.yaw - this.characterYaw + 540) % 360) - 180;
			this.characterYaw += angleDelta * (1 - Math.exp(-AIM_TURN_RESPONSE * dt));
		} else if (axisLength > 0) {
			const targetFacing = Math.atan2(this.desiredVelocity.x, this.desiredVelocity.z) * 180 / Math.PI;
			const angleDelta = ((targetFacing - this.characterYaw + 540) % 360) - 180;
			this.characterYaw += angleDelta * (1 - Math.exp(-this.turnResponse * dt));
		}
		this.applyFacing();

		const position = this.entity.getPosition();
		writePlayerPose(
			position.x,
			position.y,
			position.z,
			this.characterYaw,
			Math.hypot(this.currentVelocity.x, this.currentVelocity.z),
			Math.min(1, this.drownTimer / ORION_OCEAN.drownSeconds),
		);

		this.updateCamera(dt);
	}

	/**
	 * A material's shader is compiled the first time something using it is drawn, which froze
	 * the game for ~0.3 s at the first window smash (and would at the first hit or skid). Drawing
	 * a speck of each effect in front of the lens while the world loads pays that up front.
	 */
	private prewarmEffects() {
		if (!this.camera) return;
		skidMarks(this.app);
		prewarmBurntBodies(this.app.graphicsDevice);
		const layer = crashEffects(this.app);
		const here = this.entity.getPosition();
		layer.prewarm(here.x, here.y, here.z);
		const effects = [
			{ type: "box", material: shardMaterial() },
			{ type: "cylinder", material: bloodMaterial() },
			...layer.materials,
		];
		for (const { type, material } of effects) {
			const prop = new Entity("shader-prewarm");
			prop.addComponent("render", { type, material, castShadows: false });
			this.camera.addChild(prop);
			prop.setLocalPosition(0, 0, -1);
			prop.setLocalScale(0.001, 0.001, 0.001);
			this.prewarmProps.push(prop);
		}
		this.prewarmTimer = PREWARM_SECONDS;
	}

	/** The capsule is switched off while in a car, so the body can be placed directly. */
	private setBodyActive(active: boolean) {
		if (this.entity.rigidbody) this.entity.rigidbody.enabled = active;
		if (this.entity.collision) this.entity.collision.enabled = active;
	}

	private tryCarjack() {
		const position = this.entity.getPosition();
		const car = findCarNear(position.x, position.z, CARJACK_REACH);
		if (!car) return;
		this.car = car;
		car.driver = "held";
		this.mode = "carjack";
		this.carjackTime = 0;
		this.carjackFrom.copy(position);
		this.skipPull = !car.carjack.hasDriver;
		this.smashed = this.skipPull;
		this.pulled = this.skipPull;
		this.released = this.skipPull;
		this.beatsLanded = 0;
		this.setBodyActive(false);
		writePlayerAction("");
		writeVehicleState(true, 0, false);
	}

	private updateCarjack(dt: number) {
		const car = this.car;
		if (!car) return;
		this.carjackTime += dt;
		// An empty car skips from the approach straight to opening the door.
		let t = this.carjackTime;
		if (this.skipPull && t >= CARJACK.approach) t += CARJACK.beatEnd - CARJACK.approach;
		const rig = car.carjack;
		const door = rig.doorPoint(this.carPoint);
		door.y += CAPSULE_HALF_HEIGHT;
		const facing = rig.faceCarYaw();

		if (t < CARJACK.approach) {
			const k = smooth(t / CARJACK.approach);
			this.entity.setPosition(
				this.carjackFrom.x + (door.x - this.carjackFrom.x) * k,
				this.carjackFrom.y + (door.y - this.carjackFrom.y) * k,
				this.carjackFrom.z + (door.z - this.carjackFrom.z) * k,
			);
			this.turnTowards(facing, dt);
		} else if (t < CARJACK.smashEnd) {
			this.entity.setPosition(door);
			this.turnTowards(facing, dt);
			writePlayerAction("Punch");
			if (!this.smashed && t >= CARJACK.smashAt) {
				this.smashed = true;
				rig.smashWindow();
			}
		} else if (t < CARJACK.pullEnd) {
			this.entity.setPosition(door);
			this.turnTowards(facing, dt);
			writePlayerAction("Standing");
			if (!this.pulled) {
				this.pulled = true;
				rig.pullDriver();
			}
		} else if (t < CARJACK.beatEnd) {
			// Standing over the driver, hitting them while they are down.
			this.entity.setPosition(door);
			this.turnTowards(facing, dt);
			const into = t - CARJACK.pullEnd;
			const swing = into % BEAT.interval;
			// The punch clip plays once and holds, so it is let go between swings to restart it.
			writePlayerAction(swing < BEAT.interval - 0.12 ? "Punch" : "");
			const landed = Math.floor(into / BEAT.interval) + (swing >= BEAT.lands ? 1 : 0);
			while (this.beatsLanded < Math.min(landed, BEAT.hits)) {
				this.beatsLanded++;
				rig.beatVictim();
			}
		} else if (t < CARJACK.doorEnd) {
			this.entity.setPosition(door);
			this.turnTowards(facing, dt);
			writePlayerAction("Standing");
			// Let go as the door starts to swing: they run off while the player is getting in.
			if (!this.released) {
				this.released = true;
				rig.releaseVictim();
			}
			rig.setDoorOpen((t - CARJACK.beatEnd) / (CARJACK.doorEnd - CARJACK.beatEnd));
		} else {
			// Climb in: slide from the door to the seat, turning to face forward.
			rig.setDoorOpen(1);
			const k = smooth((t - CARJACK.doorEnd) / (CARJACK.enterEnd - CARJACK.doorEnd));
			const seat = rig.seatPoint(this.seatScratch);
			seat.y += CAPSULE_HALF_HEIGHT;
			this.entity.setPosition(door.x + (seat.x - door.x) * k, door.y + (seat.y - door.y) * k, door.z + (seat.z - door.z) * k);
			this.turnTowards(car.heading, dt);
			writePlayerAction("Sitting");
			if (t >= CARJACK.enterEnd) {
				this.mode = "driving";
				this.characterYaw = car.heading;
				car.driver = "player";
				this.doorCloseTimer = CARJACK.doorCloseSeconds;
			}
		}
		this.applyFacing();
		this.writePose(0);
		this.updateCamera(dt);
	}

	private updateDriving() {
		const car = this.car;
		if (!car) return;
		const pressed = (...codes: string[]) => codes.some((code) => this.keys.has(code));
		const throttle = Number(pressed("KeyW", "ArrowUp")) - Number(pressed("KeyS", "ArrowDown"));
		const steer = Number(pressed("KeyA", "ArrowLeft")) - Number(pressed("KeyD", "ArrowRight"));
		car.setDriveInput(throttle, steer, pressed("Space"));
	}

	/**
	 * Runs after every script's update, so the car has already moved this frame. Placing the
	 * driver and camera in update() used last frame's car position whenever the car script
	 * happened to run later: at 100 km/h that's ~0.5 m of lag, which showed as the car and
	 * everything around it juddering and the driver sitting out of the back of the car.
	 */
	public postUpdate(dt: number) {
		if (this.mode === "driving") this.followCar(dt);
		// After animation: pose the player's body from it, then put the weapon in that hand.
		this.combat?.placeWeapon(dt);
		playerRig()?.apply(dt);
		const radians = this.yaw * Math.PI / 180;
		combatAudio().setListener(this.cameraPosition.x, this.cameraPosition.y, this.cameraPosition.z, -Math.cos(radians), Math.sin(radians));
		// Traffic is mixed here rather than per car: only the nearest few engines are audible, and
		// which those are can only be decided once the listener has moved for this frame.
		engineAudio().update(this.lastDelta);
		// Smoke and flames face the camera, so they're updated once everything else has moved.
		const camera = this.cameraPosition;
		const effects = crashEffects(this.app);
		effects.update(dt, camera.x, camera.y, camera.z);
		// A nearby explosion shakes the view, on foot or at the wheel.
		const blast = effects.cameraShake(camera.x, camera.y, camera.z);
		if (blast > 0.002 && this.camera) {
			this.camera.translate((Math.random() - 0.5) * blast, (Math.random() - 0.5) * blast, (Math.random() - 0.5) * blast);
		}
	}

	private followCar(dt: number) {
		const car = this.car;
		if (!car) return;
		if (car.burnedOut) {
			// The car went up with the player still in it.
			this.leaveCar(car);
			this.respawn();
			return;
		}
		if (this.doorCloseTimer > 0) {
			this.doorCloseTimer = Math.max(0, this.doorCloseTimer - dt);
			car.carjack.setDoorOpen(this.doorCloseTimer / CARJACK.doorCloseSeconds);
		}

		const seat = car.carjack.seatPoint(this.carPoint);
		this.entity.setPosition(seat.x, seat.y + CAPSULE_HALF_HEIGHT, seat.z);
		this.characterYaw = car.heading;
		this.applyFacing();
		writePlayerAction("Sitting");
		this.writePose(Math.abs(car.currentSpeed));

		const speed = Math.hypot(car.velocityX, car.velocityZ);
		writeVehicleState(true, speed, false, car.integrity, car.condition === "burning");

		if (this.sinceMouse > CAMERA_RECENTRE_DELAY) {
			// Sit behind the car, leaning towards where it's actually travelling in a slide.
			let follow = car.heading;
			if (speed > 3 && car.currentSpeed > 0) {
				const travel = (Math.atan2(car.velocityX, car.velocityZ) * 180) / Math.PI;
				const drift = ((travel - car.heading + 540) % 360) - 180;
				follow += Math.max(-MAX_DRIFT_LOOK, Math.min(MAX_DRIFT_LOOK, drift * DRIFT_LOOK));
			}
			const rate = CAMERA_RECENTRE_RATE + speed * 0.06;
			const delta = ((follow - this.yaw + 540) % 360) - 180;
			this.yaw += delta * (1 - Math.exp(-rate * dt));
			this.pitch += (DRIVE_CAMERA_PITCH - this.pitch) * (1 - Math.exp(-2 * dt));
		}
		const stretch = Math.min(DRIVE_CAMERA_MAX_STRETCH, speed * DRIVE_CAMERA_STRETCH);
		this.updateCamera(dt, car.entity.getPosition(), DRIVE_CAMERA_DISTANCE + stretch, DRIVE_CAMERA_HEIGHT);
		this.easeFov(this.baseFov + Math.min(MAX_FOV_BOOST, speed * FOV_PER_SPEED), dt);

		this.shake = Math.max(this.shake * Math.exp(-SHAKE_DECAY * dt), car.impact * SHAKE_PER_IMPACT);
		if (this.shake > 0.002 && this.camera) {
			this.camera.translate(
				(Math.random() - 0.5) * this.shake,
				(Math.random() - 0.5) * this.shake,
				(Math.random() - 0.5) * this.shake,
			);
		}
	}

	private easeFov(target: number, dt: number) {
		const camera = this.camera?.camera;
		if (!camera || Math.abs(camera.fov - target) < 0.01) return;
		camera.fov += (target - camera.fov) * (1 - Math.exp(-FOV_SMOOTHING * dt));
	}

	private tryExitCar() {
		const car = this.car;
		if (!car || Math.hypot(car.velocityX, car.velocityZ) > EXIT_SPEED) return;
		car.setDriveInput(0, 0, true);
		car.driver = "parked";
		this.leaveCar(car);
	}

	/** Puts the player back on their feet beside the car. */
	private leaveCar(car: OrionVehicle) {
		// A burnt-out shell is nobody's car any more, so it can be cleared away like any wreck.
		if (car.burnedOut) car.driver = "wrecked";
		const door = car.carjack.doorPoint(this.carPoint);
		door.y += CAPSULE_HALF_HEIGHT;
		this.entity.setPosition(door);
		this.setBodyActive(true);
		this.entity.rigidbody?.teleport(door);
		this.currentVelocity.set(0, 0, 0);
		if (this.entity.rigidbody) this.entity.rigidbody.linearVelocity = this.currentVelocity;
		this.characterYaw = car.carjack.faceCarYaw() + 180;
		this.car = null;
		this.mode = "onFoot";
		writePlayerAction("");
		writeVehicleState(false, 0, false);
	}

	private turnTowards(yaw: number, dt: number) {
		const delta = ((yaw - this.characterYaw + 540) % 360) - 180;
		this.characterYaw += delta * (1 - Math.exp(-this.turnResponse * dt));
	}

	private writePose(speed: number) {
		const position = this.entity.getPosition();
		writePlayerPose(position.x, position.y, position.z, this.characterYaw, speed, 0);
	}

	private get physics() {
		return this.entity.rigidbody?.system as unknown as {
			raycastFirst: (from: Vec3, to: Vec3) => { point: Vec3 } | null;
		} | undefined;
	}

	/**
	 * Applies facing to the visual child. Setting it on `this.entity` does nothing: that entity
	 * is a dynamic rigidbody whose rotation is locked (angularFactor 0), so the physics sync
	 * overwrites the transform every frame and the character would never visibly turn.
	 */
	/** Tracks time underwater and returns the player to the spawn point once they drown. */
	/**
	 * Feeds this frame's input to combat and applies what comes back (recoil). `active` is false
	 * in a car or mid-carjack, which puts the weapon away. Input edges are consumed either way.
	 */
	private runCombat(dt: number, active: boolean) {
		const combat = this.combat;
		const input = this.combatInput;
		if (!combat) return null;
		const position = this.entity.getPosition();
		const context = this.combatContext;
		context.x = position.x;
		context.y = position.y - CAPSULE_HALF_HEIGHT;
		context.z = position.z;
		context.yaw = this.characterYaw;
		context.cameraX = this.cameraPosition.x;
		context.cameraY = this.cameraPosition.y;
		context.cameraZ = this.cameraPosition.z;
		context.aimX = -this.rayDirection.x;
		context.aimY = -this.rayDirection.y;
		context.aimZ = -this.rayDirection.z;
		// Before the camera has placed itself there's no aim yet.
		if (context.aimX === 0 && context.aimY === 0 && context.aimZ === 0) context.aimZ = 1;
		context.active = active;
		const output = combat.update(dt, input, context);
		input.attackPressed = false;
		input.reloadPressed = false;
		input.slotPressed = null;
		input.wheel = 0;
		// Recoil kicks the view up (pitch counts down from level) and a little sideways.
		this.pitch = Math.max(-12, Math.min(68, this.pitch - output.recoilPitch));
		this.yaw += output.recoilYaw;
		return output;
	}

	private die() {
		this.wastedTimer = WASTED_SECONDS;
		setWasted(true);
		writePlayerAction("Death");
		this.currentVelocity.set(0, 0, 0);
		if (this.entity.rigidbody) this.entity.rigidbody.linearVelocity = this.currentVelocity;
	}

	private updateWasted(dt: number) {
		this.wastedTimer -= dt;
		this.runCombat(dt, false);
		this.updateCamera(dt);
		if (this.wastedTimer > 0) return;
		this.wastedTimer = 0;
		this.respawn();
		this.combat?.reset();
		setWasted(false);
		writePlayerAction("");
	}

	private updateDrowning(submerged: boolean, dt: number) {
		this.drownTimer = submerged ? this.drownTimer + dt : 0;
		if (this.drownTimer >= ORION_OCEAN.drownSeconds) {
			this.respawn();
		}
	}

	private respawn() {
		this.drownTimer = 0;
		// The death clip holds its last frame, and the idle clip that follows doesn't animate every
		// bone it moved: without this the player stood up still folded over.
		playerRig()?.resetPose();
		// Whatever was alight where the player is coming back to is cleared away first; a wreck
		// burns far longer than the few seconds they're down, so they respawned inside the fire.
		clearWrecksNear(this.spawnPoint.x, this.spawnPoint.z, RESPAWN_CLEAR_RADIUS);
		this.currentVelocity.set(0, 0, 0);
		this.entity.rigidbody?.teleport(this.spawnPoint);
		if (this.entity.rigidbody) {
			this.entity.rigidbody.linearVelocity = this.currentVelocity;
			this.entity.rigidbody.angularVelocity = this.currentVelocity;
		}
	}

	private applyFacing() {
		this.visual ??= this.entity.findByName(PLAYER_VISUAL_NAME) as Entity | null;
		this.visual?.setLocalEulerAngles(0, this.characterYaw, 0);
	}

	private isGrounded() {
		const position = this.entity.getPosition();
		const start = this.groundProbeStart.set(position.x, position.y, position.z);
		const end = this.groundProbeEnd.set(position.x, position.y - 1.15, position.z);
		return Boolean(this.physics?.raycastFirst(start, end));
	}

	/**
	 * How far the camera may sit behind the player before solid geometry gets in the way, so
	 * backing against a wall doesn't put the camera inside the building.
	 */
	private allowedCameraDistance(distance: number): number {
		// Start outside the player's own capsule so the ray can't hit the player.
		const start = this.rayStart.copy(this.cameraTarget).add(this.rayScratch.copy(this.rayDirection).mulScalar(CAMERA_RAY_START));
		const end = this.desiredCameraPosition.copy(this.cameraTarget).add(this.rayScratch.copy(this.rayDirection).mulScalar(distance));
		const hit = this.physics?.raycastFirst(start, end);
		if (!hit) return distance;

		const blocked = Math.hypot(
			hit.point.x - this.cameraTarget.x,
			hit.point.y - this.cameraTarget.y,
			hit.point.z - this.cameraTarget.z,
		);
		return Math.max(CAMERA_MIN_DISTANCE, blocked - CAMERA_SURFACE_MARGIN);
	}

	private updateCamera(dt: number, focus?: Vec3, distance = this.cameraDistance, height = this.cameraHeight) {
		if (!this.camera) return;
		const position = focus ?? this.entity.getPosition();

		// A capsule resting on box colliders micro-bounces at the seams. Reading that raw
		// put the noise straight into the camera, which is what made the view shimmer while
		// walking, so the eye height is smoothed while x/z track the player exactly.
		const targetY = position.y + height;
		this.smoothedEyeY = this.smoothedEyeY === null
			? targetY
			: this.smoothedEyeY + (targetY - this.smoothedEyeY) * (1 - Math.exp(-CAMERA_EYE_SMOOTHING * dt));
		this.cameraTarget.set(position.x, this.smoothedEyeY, position.z);

		// Camera sits BEHIND the player, so pressing W walks away from it into the scene.
		const yawRadians = this.yaw * Math.PI / 180;
		const pitchRadians = this.pitch * Math.PI / 180;
		const cosPitch = Math.cos(pitchRadians);
		this.rayDirection.set(-Math.sin(yawRadians) * cosPitch, Math.sin(pitchRadians), -Math.cos(yawRadians) * cosPitch);

		// Ease the *distance* rather than snapping the position. The clamp is binary — the ray
		// either hits or it doesn't — so applying it directly made the camera jump in and out
		// every frame as it grazed kerbs and corners. Pull in fast enough never to clip a wall,
		// but extend back slowly so a momentary hit can't pop the view.
		const allowed = this.allowedCameraDistance(distance);
		const rate = allowed < this.cameraDistanceCurrent ? CAMERA_PULL_IN_RATE : CAMERA_EXTEND_RATE;
		this.cameraDistanceCurrent += (allowed - this.cameraDistanceCurrent) * (1 - Math.exp(-rate * dt));

		this.cameraPosition.copy(this.cameraTarget).add(this.rayScratch.copy(this.rayDirection).mulScalar(this.cameraDistanceCurrent));
		this.camera.setPosition(this.cameraPosition);
		this.camera.lookAt(this.cameraTarget, UP);
		writeCameraView(this.cameraPosition.x, this.cameraPosition.z, -this.rayDirection.x, -this.rayDirection.z);
		writeCameraLens(this.camera.camera?.fov ?? this.baseFov, this.app.graphicsDevice.height);
	}

	/**
	 * Stops the player walking through people: movement into anyone in contact is cancelled
	 * (sliding past them still works), and any overlap is eased apart.
	 */
	private keepClearOfPeople(dt: number) {
		const here = this.entity.getPosition();
		const velocity = this.currentVelocity;
		for (const person of damageablesNear(here.x, here.z, PLAYER_BODY_RADIUS + 1)) {
			if (person.kind !== "person" || !person.alive || Math.abs(person.y - (here.y - CAPSULE_HALF_HEIGHT)) > 1.5) continue;
			const dx = here.x - person.x;
			const dz = here.z - person.z;
			const distance = Math.hypot(dx, dz);
			const contact = PLAYER_BODY_RADIUS + person.radius;
			if (distance >= contact) continue;
			const nx = distance > 1e-4 ? dx / distance : 1;
			const nz = distance > 1e-4 ? dz / distance : 0;
			const into = velocity.x * nx + velocity.z * nz;
			if (into < 0) {
				velocity.x -= into * nx;
				velocity.z -= into * nz;
			}
			const push = Math.min(SEPARATION_SPEED, (contact - distance) / Math.max(dt, 1 / 60));
			velocity.x += nx * push;
			velocity.z += nz * push;
		}
	}

	public destroy() {
		for (const prop of this.prewarmProps) prop.destroy();
		this.prewarmProps = [];
		const canvas = this.app.graphicsDevice.canvas;
		canvas.removeEventListener("click", this.canvasClick);
		canvas.removeEventListener("mousedown", this.pointerDown);
		window.removeEventListener("mouseup", this.pointerUp);
		window.removeEventListener("mousemove", this.pointerMove);
		window.removeEventListener("keydown", this.keyDown);
		window.removeEventListener("keyup", this.keyUp);
		canvas.removeEventListener("wheel", this.wheel);
		this.keys.clear();
		this.combat?.destroy();
		this.combat = null;
	}
}
