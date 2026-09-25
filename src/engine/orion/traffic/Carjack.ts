import { BLEND_NORMAL, Entity, Mat4, Quat, StandardMaterial, Vec3, type MeshInstance } from "playcanvas";

import { broadcastDisturbance } from "../combat/CombatWorld";
import type { ClipState } from "../player/OrionSkinnedCharacterAnimation";
import { inCameraView, readPlayerPose } from "../player/PlayerPose";
import { carHalfHeight, carRoofHeight } from "./CarMeshes";
import type { OrionVehicle } from "./OrionVehicle";
import { VEHICLE_SHAPES, type VehicleStyle } from "./Vehicles";

/**
 * Carjacking: every car has a seated driver, and the player can smash the driver's window,
 * drag them out, open the door and drive off. This module holds the pieces that act on one
 * car (driver, glass, door) plus the registry the player uses to find the nearest car.
 */

/** Traffic keeps left, so the driver sits on the right: local -X (the car faces +Z). */
export const DRIVER_SIDE = -1;
/** Name of the seated driver entity under each car. */
export const DRIVER_NAME = "car-driver";
/**
 * The seat is placed from the roof down: the sitting clip (authored on a chair) puts the top of
 * the head this far above the character's root, and the head stays this far under the roof.
 * That sits a driver low in a sports car and upright in an SUV, visible through the windows.
 * (Measured to the top of the skull: the head bone sits at 1.29, about 0.2 below it.)
 */
const SEATED_HEAD_HEIGHT = 1.49;
const HEAD_CLEARANCE = 0.08;
/** How far out from the centreline the driver sits, as a share of half the car's width. */
export const SEAT_LATERAL = 0.42;
/** The sitting clip leans the head this far back from the character's root. */
const SEATED_HEAD_LEAN = 0.28;
/** How far outside the body the player stands to open the door. */
const DOOR_STAND_OFF = 0.55;
const DOOR_FORWARD = 0.25;
const DOOR_OPEN_DEGREES = 62;
/**
 * Drivers further than this, or out of the camera's view, aren't drawn: a head behind tinted
 * glass is a few pixels by then, and each one is a skinned character.
 */
const DRIVER_SHOW_DISTANCE = 55;
const THROWN_DISTANCE = 1.6;
const PULL_SECONDS = 0.9;
/** A landed punch shoves the driver this far away from the car and rolls them a little. */
const BEAT_SHOVE = 0.11;
const BEAT_TWIST = 13;
/**
 * The beaten driver gets up and runs. They run along the road rather than straight away from
 * the player, because straight away is usually into the side of a building.
 */
const FLEE_SPEED = 5.2;
const FLEE_ACCELERATION = 9;
const FLEE_SECONDS = 9;
const FLEE_DISTANCE = 45;
/** How far away a carjacking is noticed by people standing around. */
const SCENE_NOTICE = 26;
const SHARD_COUNT = 26;
const SHARD_SECONDS = 1.4;
const GRAVITY = 9.8;

export const GLASS_NODE = /glass|window/i;
export const NOT_SIDE_GLASS = /light|lamp|lens|marker|engine|trunk|console|nav|dash|mirror|bulb|chmsl/i;
export const DOOR_NODE = /^door(?!jamb|sill)/i;

/**
 * Where the seated driver's root goes, in car space (origin at the collision box centre).
 * Real car models pass their measured roof and head position; box cars use the style's
 * proportions (front seat a little ahead of the cabin's middle).
 */
export function driverSeatLocal(style: VehicleStyle, roof = carRoofHeight(style), headForward?: number): [number, number, number] {
	const shape = VEHICLE_SHAPES[style];
	const rootAboveRoad = roof - HEAD_CLEARANCE - SEATED_HEAD_HEIGHT;
	const forward = headForward !== undefined
		? headForward + SEATED_HEAD_LEAN
		: shape.cabinOffset + shape.cabinLength * 0.05;
	return [DRIVER_SIDE * (shape.width / 2) * SEAT_LATERAL, rootAboveRoad - carHalfHeight(style), forward];
}

const cars = new Set<OrionVehicle>();

export function registerDrivableCar(car: OrionVehicle): void {
	cars.add(car);
}

export function unregisterDrivableCar(car: OrionVehicle): void {
	cars.delete(car);
}

/** Every car in the world, for things that act on all of them (an explosion's blast). */
export function drivableCars(): ReadonlySet<OrionVehicle> {
	return cars;
}

/** The car whose driver's door is closest to (x, z), within reach. */
export function findCarNear(x: number, z: number, reach: number): OrionVehicle | null {
	let best: OrionVehicle | null = null;
	let bestDistance = reach;
	const door = new Vec3();
	for (const car of cars) {
		// A burnt-out shell has no engine left to steal.
		if (car.driver === "player" || car.burnedOut || !car.entity.enabled) continue;
		car.carjack.doorPoint(door);
		const distance = Math.hypot(door.x - x, door.z - z);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = car;
		}
	}
	return best;
}

interface DoorPart {
	entity: Entity;
	localPosition: Vec3;
	localRotation: Quat;
	worldPosition: Vec3;
	worldRotation: Quat;
}

interface Shard {
	entity: Entity;
	velocity: Vec3;
	spin: Vec3;
	age: number;
}

function meshesUnder(node: Entity): MeshInstance[] {
	return (node.find((candidate) => Boolean((candidate as Entity).render)) as Entity[])
		.flatMap((entity) => entity.render?.meshInstances ?? []);
}

function isAncestor(ancestor: Entity, node: Entity): boolean {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (parent === ancestor) return true;
	}
	return false;
}

let glassMaterial: StandardMaterial | null = null;

export function shardMaterial(): StandardMaterial {
	if (glassMaterial) return glassMaterial;
	glassMaterial = new StandardMaterial();
	glassMaterial.diffuse.set(0.75, 0.85, 0.9);
	glassMaterial.specular.set(1, 1, 1);
	glassMaterial.gloss = 0.95;
	glassMaterial.opacity = 0.55;
	glassMaterial.blendType = BLEND_NORMAL;
	glassMaterial.depthWrite = false;
	glassMaterial.update();
	return glassMaterial;
}

/**
 * What has become of the driver: dragged out ("pull"), on the ground being beaten ("down"),
 * or running for it ("flee"). "none" covers both still seated and long gone.
 */
type VictimPhase = "none" | "pull" | "down" | "flee";

export class CarjackRig {
	/** False once the driver has been dragged out, until the car is recycled. */
	public hasDriver = true;

	private driver: Entity | null = null;
	private driverSeat: { position: Vec3; rotation: Quat; scale: Vec3 } | null = null;
	/** Seat measured from a real car model; replaces the style default. */
	private seat: [number, number, number] | null = null;
	private pull: { from: Vec3; to: Vec3; yaw: number; time: number } | null = null;
	private victim: VictimPhase = "none";
	/** Where the dragged-out driver is, re-applied each frame (see updateVictim). */
	private readonly bodyPosition = new Vec3();
	private bodyYaw = 0;
	private readonly flee = { x: 0, z: 0, speed: 0, time: 0, travelled: 0 };
	/** Hidden by zero scale as well as visibility, because batched parts ignore `visible`. */
	private brokenGlass: { instance: MeshInstance; scale: Vec3 }[] = [];
	private doorParts: DoorPart[] | null = null;
	private doorHinge = new Vec3();
	private doorAngle = 0;
	private shards: Shard[] = [];
	private readonly inverse = new Mat4();
	private readonly scratch = new Vec3();
	private readonly spin = new Quat();

	public constructor(private readonly car: OrionVehicle) {}

	private get entity(): Entity {
		return this.car.entity;
	}

	/** World point beside the driver's door where the player stands. */
	public doorPoint(out: Vec3): Vec3 {
		return this.toWorld(DRIVER_SIDE * (this.car.halfWidth + DOOR_STAND_OFF), -this.car.halfHeight, DOOR_FORWARD, out);
	}

	/** World position of the seated character's root (feet). */
	public seatPoint(out: Vec3): Vec3 {
		const [x, y, z] = this.seatLocal();
		return this.toWorld(x, y, z, out);
	}

	/** Yaw (degrees) that faces the car from beside the driver's door. */
	public faceCarYaw(): number {
		const right = this.entity.right;
		return (Math.atan2(-DRIVER_SIDE * right.x, -DRIVER_SIDE * right.z) * 180) / Math.PI;
	}

	public update(dt: number, playerDistance: number) {
		const driver = this.findDriver();
		if (driver && this.hasDriver && !this.pull) {
			const position = this.entity.getPosition();
			const show = playerDistance < DRIVER_SHOW_DISTANCE && inCameraView(position.x, position.z, DRIVER_SHOW_DISTANCE);
			if (driver.enabled !== show) driver.enabled = show;
			// Re-applied each frame: the entity's React props carry the style's default seat.
			if (show && this.seat) driver.setLocalPosition(...this.seat);
		}
		this.updateVictim(dt);
		this.updateShards(dt);
	}

	/** Shatters the driver's side window. */
	public smashWindow() {
		for (const instance of this.sideGlass()) {
			this.brokenGlass.push({ instance, scale: instance.node.getLocalScale().clone() });
			instance.visible = false;
			instance.node.setLocalScale(0, 0, 0);
		}

		const origin = this.toWorld(DRIVER_SIDE * this.car.halfWidth, -this.car.halfHeight + 0.95, this.seatForward() + 0.2, new Vec3());
		const right = this.entity.right;
		const material = shardMaterial();
		for (let i = 0; i < SHARD_COUNT; i++) {
			const shard = new Entity("glass-shard");
			shard.addComponent("render", { type: "box", material, castShadows: false });
			const size = 0.03 + Math.random() * 0.06;
			shard.setLocalScale(size, size * 0.2, size * (0.6 + Math.random()));
			shard.setPosition(
				origin.x + (Math.random() - 0.5) * 0.5,
				origin.y + (Math.random() - 0.5) * 0.3,
				origin.z + (Math.random() - 0.5) * 0.5,
			);
			// Mostly inwards, away from the punch, with a little spray back out.
			const inwards = (Math.random() < 0.75 ? -1 : 0.6) * DRIVER_SIDE;
			const push = 1 + Math.random() * 2.5;
			const velocity = new Vec3(
				right.x * inwards * push + (Math.random() - 0.5),
				Math.random() * 2,
				right.z * inwards * push + (Math.random() - 0.5),
			);
			const spin = new Vec3(Math.random() * 720, Math.random() * 720, Math.random() * 720);
			this.car.app.root.addChild(shard);
			this.shards.push({ entity: shard, velocity, spin, age: 0 });
		}
	}

	/** The driver doesn't survive the car going up. */
	public burnDriver() {
		const driver = this.findDriver();
		this.hasDriver = false;
		this.pull = null;
		this.victim = "none";
		if (driver) driver.enabled = false;
	}

	/** Starts dragging the driver out onto the road. */
	public pullDriver() {
		const driver = this.findDriver();
		if (!driver || !this.hasDriver) return;
		this.hasDriver = false;
		const from = driver.getPosition().clone();
		const to = this.toWorld(DRIVER_SIDE * (this.car.halfWidth + THROWN_DISTANCE), -this.car.halfHeight, this.seatForward() - 0.4, new Vec3());
		const yaw = this.faceCarYaw() + 180;
		// Out of the car's hierarchy so it stays behind when the car drives away.
		const scale = driver.getLocalScale().clone();
		driver.reparent(this.car.app.root);
		driver.setLocalScale(scale);
		driver.setPosition(from);
		driver.setEulerAngles(0, yaw, 0);
		driver.enabled = true;
		this.pull = { from, to, yaw, time: 0 };
		this.victim = "pull";
		this.setDriverClip("Standing");
		// Everyone close enough to see it happen scatters, as they do for a gunshot. It's reported
		// as something that happened rather than someone to fight: there is no attacker id to
		// give them, and a brave one would otherwise square up to a threat that doesn't exist.
		broadcastDisturbance(from.x, from.z, SCENE_NOTICE, { id: -1, x: from.x, z: from.z, attackable: false });
	}

	/** True while the driver is on the ground and can still be hit. */
	public get victimDown(): boolean {
		return this.victim === "down";
	}

	/** One punch lands on the driver lying in the road: shoves them clear of the car and rolls them. */
	public beatVictim() {
		if (this.victim !== "down") return;
		const right = this.entity.right;
		this.bodyPosition.x += right.x * DRIVER_SIDE * BEAT_SHOVE;
		this.bodyPosition.z += right.z * DRIVER_SIDE * BEAT_SHOVE;
		this.bodyYaw += (Math.random() < 0.5 ? -1 : 1) * BEAT_TWIST;
	}

	/**
	 * The player is done with them: the driver scrambles up and runs off down the road, away
	 * from whoever just beat them, and is gone once they are clear.
	 */
	public releaseVictim() {
		if (this.victim !== "down") return;
		this.victim = "flee";
		this.flee.speed = 0;
		this.flee.time = 0;
		this.flee.travelled = 0;
		// The car is on a road, so its own axis is the road: running along it keeps them on the
		// carriageway instead of straight into the building behind them.
		const along = this.entity.forward;
		const player = readPlayerPose();
		const away = (this.bodyPosition.x - player.x) * along.x + (this.bodyPosition.z - player.z) * along.z;
		const sign = away >= 0 ? 1 : -1;
		this.flee.x = along.x * sign;
		this.flee.z = along.z * sign;
		this.bodyYaw = (Math.atan2(this.flee.x, this.flee.z) * 180) / Math.PI;
		this.setDriverClip("Run");
	}

	/** 0 = shut, 1 = fully open. */
	public setDoorOpen(amount: number) {
		const angle = Math.max(0, Math.min(1, amount)) * DOOR_OPEN_DEGREES;
		if (angle === this.doorAngle) return;
		const parts = this.doorParts ?? this.captureDoor();
		this.doorAngle = angle;
		if (angle === 0) {
			for (const part of parts) {
				part.entity.setLocalPosition(part.localPosition);
				part.entity.setLocalRotation(part.localRotation);
			}
			this.doorParts = null;
			return;
		}
		this.spin.setFromAxisAngle(Vec3.UP, -DRIVER_SIDE * angle);
		for (const part of parts) {
			this.scratch.sub2(part.worldPosition, this.doorHinge);
			this.spin.transformVector(this.scratch, this.scratch);
			part.entity.setPosition(this.scratch.add(this.doorHinge));
			part.entity.setRotation(new Quat().mul2(this.spin, part.worldRotation));
		}
	}

	/** Puts the car back as it was: driver seated, glass whole, door shut. */
	public reset() {
		this.setDoorOpen(0);
		for (const { instance, scale } of this.brokenGlass) {
			instance.visible = true;
			instance.node.setLocalScale(scale);
		}
		this.brokenGlass = [];
		this.pull = null;
		this.victim = "none";
		const driver = this.driver;
		if (driver && this.driverSeat) {
			if (driver.parent !== this.entity) driver.reparent(this.entity);
			driver.setLocalPosition(this.driverSeat.position);
			driver.setLocalRotation(this.driverSeat.rotation);
			driver.setLocalScale(this.driverSeat.scale);
			driver.enabled = true;
			this.setDriverClip("Sitting");
		}
		this.hasDriver = Boolean(driver);
	}

	public destroy() {
		for (const shard of this.shards) shard.entity.destroy();
		this.shards = [];
	}

	private seatForward(): number {
		return this.seatLocal()[2];
	}

	private seatLocal(): [number, number, number] {
		return this.seat ?? driverSeatLocal(this.car.style);
	}

	/** Called by a real car model once it has measured its cabin (see OrionVehicleModel). */
	public setCabin(roof: number, headForward: number | null) {
		this.seat = driverSeatLocal(this.car.style, roof, headForward ?? undefined);
		if (this.driverSeat) this.driverSeat.position.set(...this.seat);
	}

	private findDriver(): Entity | null {
		if (!this.driver) {
			this.driver = this.entity.findByName(DRIVER_NAME) as Entity | null;
			if (this.driver) {
				this.driverSeat = {
					position: this.driver.getLocalPosition().clone(),
					rotation: this.driver.getLocalRotation().clone(),
					scale: this.driver.getLocalScale().clone(),
				};
			}
		}
		return this.driver;
	}

	private setDriverClip(state: ClipState) {
		const holder = this.driver?.find((node) => Boolean((node as Entity).script?.has("orionSkinnedCharacterAnimation")))[0] as Entity | undefined;
		const script = holder?.script?.get("orionSkinnedCharacterAnimation") as { forcedState: string } | undefined;
		if (script) script.forcedState = state;
	}

	private updateVictim(dt: number) {
		const driver = this.driver;
		if (!driver) return;
		if (this.pull) {
			const pull = this.pull;
			pull.time += dt;
			const t = Math.min(1, pull.time / PULL_SECONDS);
			const eased = t * t * (3 - 2 * t);
			driver.setPosition(
				pull.from.x + (pull.to.x - pull.from.x) * eased,
				pull.from.y + (pull.to.y - pull.from.y) * eased + Math.sin(t * Math.PI) * 0.35,
				pull.from.z + (pull.to.z - pull.from.z) * eased,
			);
			if (t >= 1) {
				this.pull = null;
				this.victim = "down";
				this.bodyPosition.copy(pull.to);
				this.bodyYaw = pull.yaw;
				this.setDriverClip("Death");
			}
			return;
		}
		if (this.victim === "flee") {
			// No standing start from flat on their back: they get up to speed over a stride or two.
			this.flee.time += dt;
			this.flee.speed = Math.min(FLEE_SPEED, this.flee.speed + FLEE_ACCELERATION * dt);
			const step = this.flee.speed * dt;
			this.bodyPosition.x += this.flee.x * step;
			this.bodyPosition.z += this.flee.z * step;
			this.flee.travelled += step;
			if (this.flee.time > FLEE_SECONDS || this.flee.travelled > FLEE_DISTANCE) {
				this.victim = "none";
				driver.enabled = false;
				return;
			}
		} else if (this.victim !== "down") {
			return;
		}
		// The driver entity still carries its seat position as a React prop, and a re-render
		// would re-apply it relative to the scene root, so its place is set here every frame.
		driver.setPosition(this.bodyPosition);
		driver.setEulerAngles(0, this.bodyYaw, 0);
	}

	private updateShards(dt: number) {
		if (this.shards.length === 0) return;
		const floor = this.entity.getPosition().y - this.car.halfHeight + 0.02;
		this.shards = this.shards.filter((shard) => {
			shard.age += dt;
			if (shard.age > SHARD_SECONDS) {
				shard.entity.destroy();
				return false;
			}
			const position = shard.entity.getPosition();
			shard.velocity.y -= GRAVITY * dt;
			let y = position.y + shard.velocity.y * dt;
			if (y < floor) {
				y = floor;
				shard.velocity.set(shard.velocity.x * 0.4, -shard.velocity.y * 0.25, shard.velocity.z * 0.4);
			}
			shard.entity.setPosition(position.x + shard.velocity.x * dt, y, position.z + shard.velocity.z * dt);
			shard.entity.rotateLocal(shard.spin.x * dt, shard.spin.y * dt, shard.spin.z * dt);
			return true;
		});
	}

	/** Side-window meshes near the driver's seat. */
	private sideGlass(): MeshInstance[] {
		const found: MeshInstance[] = [];
		this.inverse.copy(this.entity.getWorldTransform()).invert();
		for (const node of this.entity.find((candidate) => GLASS_NODE.test(candidate.name) && !NOT_SIDE_GLASS.test(candidate.name))) {
			for (const instance of meshesUnder(node as Entity)) {
				const center = this.inverse.transformPoint(instance.aabb.center, this.scratch);
				const lateral = center.x * DRIVER_SIDE;
				if (lateral > this.car.halfWidth * 0.3 && Math.abs(center.z - this.seatForward()) < 1.3) found.push(instance);
			}
		}
		return [...new Set(found)];
	}

	/** Records the driver-side door meshes and their hinge before swinging them. */
	private captureDoor(): DoorPart[] {
		this.inverse.copy(this.entity.getWorldTransform()).invert();
		const parts: DoorPart[] = [];
		let front = -Infinity;
		const doors = this.entity.find((candidate) => DOOR_NODE.test(candidate.name)) as Entity[];
		for (const entity of doors) {
			// Swing only the outermost matches; children move with their parent.
			if (doors.some((other) => other !== entity && isAncestor(other, entity))) continue;
			const instances = meshesUnder(entity);
			if (instances.length === 0) continue;
			const center = this.inverse.transformPoint(instances[0].aabb.center, this.scratch);
			if (center.x * DRIVER_SIDE <= 0) continue;
			front = Math.max(front, this.frontEdge(instances));
			parts.push({
				entity,
				localPosition: entity.getLocalPosition().clone(),
				localRotation: entity.getLocalRotation().clone(),
				worldPosition: entity.getPosition().clone(),
				worldRotation: entity.getRotation().clone(),
			});
		}
		if (parts.length > 0) {
			this.toWorld(DRIVER_SIDE * this.car.halfWidth, 0, front, this.doorHinge);
		}
		this.doorParts = parts;
		return parts;
	}

	/** Furthest-forward point of these meshes, in car space (the hinge side of a front door). */
	private frontEdge(instances: readonly MeshInstance[]): number {
		const toCar = new Mat4();
		let front = -Infinity;
		for (const instance of instances) {
			toCar.mul2(this.inverse, instance.node.getWorldTransform());
			const { center, halfExtents } = instance.mesh.aabb;
			for (let corner = 0; corner < 8; corner++) {
				this.scratch.set(
					center.x + (corner & 1 ? halfExtents.x : -halfExtents.x),
					center.y + (corner & 2 ? halfExtents.y : -halfExtents.y),
					center.z + (corner & 4 ? halfExtents.z : -halfExtents.z),
				);
				front = Math.max(front, toCar.transformPoint(this.scratch, this.scratch).z);
			}
		}
		return front;
	}

	private toWorld(x: number, y: number, z: number, out: Vec3): Vec3 {
		return this.entity.getWorldTransform().transformPoint(out.set(x, y, z), out);
	}
}
