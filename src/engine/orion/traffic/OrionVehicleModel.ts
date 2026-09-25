import { BLEND_NORMAL, BoundingBox, Color, Entity, Mat4, MeshInstance, Quat, Script, StandardMaterial, Vec3, type GraphNode, type Material, type Mesh, type RenderComponent } from "playcanvas";

import { cameraLens, distanceFromCamera, readPlayerPose } from "../player/PlayerPose";
import { LOD_PROFILES, projectedPixels, selectLod } from "../rendering/lod/LodPolicy";
import { buildMesh, compactGeometry, isMergeable, mergeGeometry, mergeMeshInstances } from "../rendering/MeshMerge";
import { DOOR_NODE, DRIVER_SIDE, GLASS_NODE, NOT_SIDE_GLASS, SEAT_LATERAL } from "./Carjack";
import type { OrionVehicle } from "./OrionVehicle";
import { createLodEntities, groupByMaterial, requestVehicleLods, type LodEntities } from "./VehicleLod";
import {
	BRAKE_LIGHT_MATERIAL,
	HEADLIGHT_MATERIAL,
	HIDDEN_BRAND_NODE,
	HIDDEN_MATERIAL,
	HIDDEN_NODE,
	PAINT_MATERIAL,
	SIREN_MATERIAL,
	WHEEL_NODE,
	type VehicleModelSpec,
} from "./VehicleModels";

/** Past this distance from the player the detailed body is hidden (the car still drives). */
// Beyond the furthest a car can be before it is recycled (600), so a body never vanishes in play.
const DETAIL_DISTANCE = 650;
const MAX_PITCH = 2.5;
const MAX_ROLL = 3.2;
const PITCH_PER_ACCEL = 0.35;
const ROLL_PER_LATERAL_ACCEL = 0.45;
const BODY_SMOOTHING = 5;
const FLASH_SECONDS = 0.28;
/** A wheel node whose pivot is further than this from its mesh centre gets re-pivoted. */
const PIVOT_TOLERANCE = 0.02;
/**
 * A "wheel" whose bottom sits this far (m) above the lowest tyre isn't on the road: it's the
 * steering wheel in the cabin, which the name pattern also matches.
 */
const OFF_GROUND = 0.3;
/**
 * Wider than this many times its height, a wheel mesh is a whole axle — both tyres modelled as
 * one part. Turned as one piece, the pair swung round the middle of the car when steering.
 */
const AXLE_WIDTH_RATIO = 1.5;

interface Wheel {
	pivot: Entity;
	radius: number;
	/** Pivot rotation relative to the model entity; the spin accumulates into it. */
	rest: Quat;
	/** Front wheels turn with the steering. */
	front: boolean;
}

const DEG = 180 / Math.PI;
// Shared rather than allocated per frame; materials copy the value they're given.
const BRAKE_ON = new Color(1, 0.08, 0.05);
const BRAKE_OFF = new Color(0.25, 0.01, 0.01);
const SIREN_BLUE = new Color(0.1, 0.3, 1);
const SIREN_RED = new Color(1, 0.1, 0.1);
const SIREN_OFF = new Color(0, 0, 0);

/** Window meshes, by material or node name; lamp lenses and the like are excluded. */
const CABIN_GLASS = /glass|window|windshield|windscreen/i;
const NOT_CABIN_GLASS = /light|lamp|lens|marker|engine|trunk|console|nav|dash|mirror|bulb|chmsl|plate|red/i;
/** A pane at least this share of the body's width, high on the car, is windscreen or rear glass. */
const FULL_WIDTH_GLASS = 0.5;
/** The driver's head sits this far behind the top edge of the windscreen. */
const HEAD_BEHIND_WINDSCREEN = 0.35;
/** Half-size (metres) of the patch of roof sampled above the driver's head. */
const ROOF_SAMPLE_HALF = 0.2;
/** A measured roof outside this range (metres above the road) is treated as a bad read. */
const ROOF_RANGE = [0.85, 2.4] as const;

/** Max size of one batch; a car is ~5 m, so this never splits a car on size. */
const BATCH_AABB_SIZE = 20;
let batchGroupCount = 0;

/**
 * Merged rigid-body geometry per model file. Every car using a model has identical parts, so
 * the merge is done once and the meshes shared; each car only adds its own mesh instances
 * (with its own paint and lamp materials).
 */
const mergedBodies = new Map<string, { signature: string; meshes: Mesh[] }>();
/** Axles split into single wheels, per model file and side; shared by every car of that model. */
const splitWheels = new Map<string, Mesh>();

interface BatchHandle {
	meshInstance: MeshInstance;
	batchGroupId: number;
}

/**
 * Turns an arbitrary car GLB into a traffic car.
 *
 * Attached to the "car-model" entity, whose child "car-model-fit" holds the `<Container>`.
 * On load it measures the model, scales it to the spec length, sits it on the road and turns
 * its long axis to face +Z (using the headlights to tell front from back). While driving it
 * spins the wheels, lights the brakes, flashes police sirens, and pitches/rolls the body with
 * acceleration and cornering.
 */
export class OrionVehicleModel extends Script {
	public static scriptName = "orionVehicleModel";

	public spec: VehicleModelSpec | null = null;
	public paint = "#ffffff";
	public police = false;
	/** Material for the fallback light bar; OrionVehicle flashes it by entity name. */
	public flashOff: Material | null = null;

	private ready = false;
	private fit: Entity | null = null;
	private vehicle: OrionVehicle | null = null;
	private wheels: Wheel[] = [];
	private paintMaterials: StandardMaterial[] = [];
	private brakeMaterials: StandardMaterial[] = [];
	private sirenMaterials: StandardMaterial[] = [];
	private brakeLit: boolean | null = null;
	private pitch = 0;
	private roll = 0;
	private lastSpeed = 0;
	private flashTimer = 0;
	private readonly spin = new Quat();
	private readonly steering = new Quat();
	private lastSteer = 0;
	private readonly scratch = new Quat();
	private batchGroupId: number | null = null;
	private mergedBody: Entity | null = null;
	/** Measured roof height and head position, handed to the car once it's found. */
	private cabin: { roof: number; headForward: number | null } | null = null;
	private shown = true;
	/** Simplified LOD1–LOD3 entities, once built; LOD0 is the merged body plus the batch. */
	private lodEntities: LodEntities | null = null;
	private lodLevel = 0;
	/** Bounding radius in metres, for judging on-screen size. */
	private radius = 2.5;
	/** A burnt shell's paint differs from the colours baked into LOD3. */
	private burnt = false;
	private destroyed = false;

	public update(dt: number) {
		if (!this.ready) {
			this.trySetup();
			if (!this.ready) return;
		}
		const fit = this.fit;
		if (!fit) return;

		const position = this.entity.getPosition();
		const player = readPlayerPose();
		const visible = Math.hypot(position.x - player.x, position.z - player.z) < DETAIL_DISTANCE;
		if (visible !== this.shown) this.setShown(visible);
		if (!visible) return;

		// Looked up lazily: the driving script on the parent may initialise after this one.
		this.vehicle ??= ((this.entity.parent as Entity | null)?.script?.get("orionVehicle") ?? null) as OrionVehicle | null;
		if (this.cabin && this.vehicle) {
			this.vehicle.carjack.setCabin(this.cabin.roof, this.cabin.headForward);
			this.cabin = null;
		}
		const speed = this.vehicle?.currentSpeed ?? 0;
		const acceleration = dt > 0 ? (speed - this.lastSpeed) / dt : 0;
		this.lastSpeed = speed;
		const level = this.chooseLod(position.x, position.z);
		if (level !== this.lodLevel) this.applyLod(level);
		this.animateBody(dt, speed, acceleration);
		// Simplified levels carry the wheels baked in; there's nothing separate to spin.
		if (this.lodLevel === 0) this.spinWheels(dt, speed);
		this.updateLights(dt);
	}

	private trySetup() {
		const fit = this.entity.findByName("car-model-fit") as Entity | null;
		const model = fit?.children[0] as Entity | undefined;
		if (!fit || !model || !this.spec) return;
		const instances = collectMeshInstances(model);
		if (instances.length === 0) return;

		this.fit = fit;
		simplifyGlass(instances);
		const visibleInstances = hideUnwanted(model, instances, this.spec);
		this.fitToRoad(fit, visibleInstances);
		this.measureCabin(visibleInstances);
		this.prepareMaterials(visibleInstances);
		this.findWheels(model);
		if (this.police && this.sirenMaterials.length === 0) this.addLightBar(visibleInstances);
		// Grouped before merging hides the originals: the simplified levels are the whole car.
		const lodGroups = groupByMaterial(visibleInstances);
		this.radius = localBounds(this.entity, visibleInstances).halfExtents.length();
		this.mergeRigidParts(model);
		this.batchModel(model);
		this.ready = true;
		this.on("destroy", () => {
			this.destroyed = true;
		});

		const spec = this.spec;
		const cacheKey = spec.keepPaint ? spec.file : `${spec.file}|${this.paint}`;
		requestVehicleLods(this.app.graphicsDevice, cacheKey, lodGroups, model.getWorldTransform(), this.radius, fit.getLocalScale().x)
			.then((meshes) => {
				if (!meshes || this.destroyed) return;
				this.lodEntities = createLodEntities(this.app, model, meshes, lodGroups);
			});
	}

	/**
	 * Which level to draw, from the car's size on screen. The car being driven or taken, and
	 * anything close to the player, is always full detail: doors open and windows break there.
	 */
	private chooseLod(x: number, z: number): number {
		if (!this.lodEntities) return 0;
		const driver = this.vehicle?.driver;
		if (driver === "player" || driver === "held") return 0;
		const profile = LOD_PROFILES.vehicle;
		const player = readPlayerPose();
		if (Math.hypot(x - player.x, z - player.z) < profile.fullDetailWithin) return 0;
		const lens = cameraLens();
		const pixels = projectedPixels(this.radius, distanceFromCamera(x, z), lens.fov, lens.viewportHeight);
		const level = selectLod(pixels, this.lodLevel, profile);
		return this.burnt ? Math.min(level, 2) : level;
	}

	private applyLod(level: number) {
		this.lodLevel = level;
		if (this.shown) this.showLevel(level);
	}

	/** Switches exactly one level on, or none. */
	private showLevel(level: number | null) {
		const full = level === 0;
		if (this.mergedBody) this.mergedBody.enabled = full;
		this.setBatchVisible(full);
		const lods = this.lodEntities;
		if (!lods) return;
		lods.levels.forEach((entity, index) => {
			const on = level === index + 1;
			if (entity.enabled !== on) entity.enabled = on;
		});
		const proxy = lods.shadowProxy;
		if (proxy && proxy.enabled !== (level === 2)) proxy.enabled = level === 2;
	}

	/**
	 * Bakes every part that never moves relative to the body into one mesh per material, and
	 * switches the originals off.
	 *
	 * A detailed GLB car is hundreds of parts, each its own scene node. Driving a car moves all of
	 * them, so every frame the engine re-transformed and re-bounded each one — the five luxury cars
	 * alone were over 4,000 nodes. Only wheels (spun), doors (opened in a carjack) and side windows
	 * (smashed) need to stay separate; everything else rides along as a handful of meshes.
	 */
	private mergeRigidParts(model: Entity) {
		const spec = this.spec;
		if (!spec) return;
		const wheelPivots = new Set<GraphNode>(this.wheels.map((wheel) => wheel.pivot));
		const keepsOwnNode = (node: GraphNode) => (
			wheelPivots.has(node) || DOOR_NODE.test(node.name) || (GLASS_NODE.test(node.name) && !NOT_SIDE_GLASS.test(node.name))
		);
		const movable = (node: GraphNode | null) => {
			for (let current = node; current && current !== model; current = current.parent) {
				if (keepsOwnNode(current)) return true;
			}
			return false;
		};

		// Grouped by material and vertex layout, in hierarchy order so every car groups alike.
		const groups = new Map<string, MeshInstance[]>();
		const renders = model.findComponents("render") as RenderComponent[];
		for (const render of renders) {
			if (!render.enabled) continue;
			for (const instance of render.meshInstances) {
				if (!instance.visible || !instance.material || !isMergeable(instance) || movable(instance.node)) continue;
				const key = `${instance.material.id}|${instance.mesh.vertexBuffer.format.batchingHash}`;
				let group = groups.get(key);
				if (!group) groups.set(key, (group = []));
				group.push(instance);
			}
		}
		if (groups.size === 0) return;

		const body = new Entity("car-body-merged");
		model.addChild(body);
		const lists = [...groups.values()];
		const signature = lists.map((list) => `${list.length}:${list.reduce((sum, instance) => sum + instance.mesh.vertexBuffer.numVertices, 0)}`).join(",");
		let cached = mergedBodies.get(spec.file);
		if (!cached || cached.signature !== signature) {
			const frame = body.getWorldTransform();
			const meshes = lists.map((list) => mergeMeshInstances(this.app.graphicsDevice, list, frame));
			// The cache holds its own reference, so the meshes outlive any one car.
			for (const mesh of meshes) mesh.incRefCount();
			cached = { signature, meshes };
			mergedBodies.set(spec.file, cached);
		}
		const meshes = cached.meshes;
		body.addComponent("render", {
			meshInstances: lists.map((list, index) => new MeshInstance(meshes[index], list[0].material)),
			castShadows: true,
			receiveShadows: true,
		});

		const merged = new Set(lists.flat());
		for (const render of renders) {
			if (render.entity === body) continue;
			if (render.meshInstances.every((instance) => merged.has(instance) || !instance.visible)) render.enabled = false;
			else for (const instance of render.meshInstances) if (merged.has(instance)) instance.visible = false;
		}
		// Branches left with nothing to draw or move are switched off, so the engine stops
		// transforming their nodes every frame.
		const live = (node: GraphNode): boolean => {
			const entity = node as Entity;
			let alive = node === body || keepsOwnNode(node) || Boolean(entity.render?.enabled && entity.render.meshInstances.some((instance) => instance.visible));
			const dead: Entity[] = [];
			for (const child of node.children) {
				if (live(child)) alive = true;
				else dead.push(child as Entity);
			}
			for (const child of dead) child.enabled = false;
			return alive;
		};
		live(model);
		this.mergedBody = body;
	}

	/**
	 * Batches the parts that move on their own (wheels, doors, side windows — everything else was
	 * merged by mergeRigidParts) into one draw call per material. The batch is dynamic: every part
	 * stays a bone, so spinning wheels and opening doors still move.
	 *
	 * Parts hidden during setup (logos, blurred rims) stay out of the batch so they stay hidden.
	 */
	private batchModel(model: Entity) {
		const batcher = this.app.batcher;
		if (!batcher) return;
		const group = batcher.addGroup(`vehicle-model-${++batchGroupCount}`, true, BATCH_AABB_SIZE);
		for (const render of model.findComponents("render") as RenderComponent[]) {
			// The batcher doesn't look at `enabled`, so parts already merged into the body must be
			// left out explicitly or they'd be drawn twice.
			if (!render.enabled || !render.entity.enabled || render.entity === this.mergedBody) continue;
			if (render.meshInstances.length > 0 && render.meshInstances.every((instance) => instance.visible)) {
				render.batchGroupId = group.id;
			}
		}
		this.batchGroupId = group.id;
		this.on("destroy", () => batcher.removeGroup(group.id));
	}

	/**
	 * Shows or hides the body. With batching, toggling the entity would rebuild the batch (a
	 * visible hitch), so the batch's own mesh instances are switched instead.
	 */
	private setShown(shown: boolean) {
		this.shown = shown;
		if (this.batchGroupId === null) {
			if (this.fit) this.fit.enabled = shown;
			return;
		}
		this.showLevel(shown ? this.lodLevel : null);
	}

	private setBatchVisible(visible: boolean) {
		if (this.batchGroupId === null) return;
		// The batch list isn't public API; read-only use, re-read because rebuilds replace it.
		const batches = (this.app.batcher as unknown as { _batchList: BatchHandle[] })._batchList;
		for (const batch of batches) {
			if (batch.batchGroupId === this.batchGroupId && batch.meshInstance.visible !== visible) batch.meshInstance.visible = visible;
		}
	}

	/**
	 * Where the cabin really is. Real models differ a lot from their style's box proportions
	 * (a mid-engined car's cockpit sits well forward and low), so the seat is placed from the
	 * model's own roof and windows rather than the style's numbers.
	 *
	 * This entity sits at road level, so heights here are heights above the road.
	 */
	private measureCabin(instances: MeshInstance[]) {
		const bounds = localBounds(this.entity, instances);
		const roof = bounds.center.y + bounds.halfExtents.y;
		if (roof < ROOF_RANGE[0] || roof > ROOF_RANGE[1]) return;
		const bodyWidth = bounds.halfExtents.x * 2;

		// The windscreen is the most forward full-width pane high on the body. Averaging all the
		// glass instead was dragged about by rear windows and high brake-light lenses.
		let windscreen: BoundingBox | null = null;
		for (const instance of instances) {
			const name = `${instance.material?.name ?? ""} ${instance.node.name}`;
			if (!CABIN_GLASS.test(name) || NOT_CABIN_GLASS.test(name)) continue;
			const pane = localBounds(this.entity, [instance]);
			if (pane.center.y < roof * 0.55 || pane.halfExtents.x * 2 < bodyWidth * FULL_WIDTH_GLASS) continue;
			if (!windscreen || pane.getMax().z > windscreen.getMax().z) windscreen = pane;
		}
		// Windscreens rake back, so their rearmost edge is the top edge, over the dashboard.
		const headForward = windscreen ? windscreen.getMin().z - HEAD_BEHIND_WINDSCREEN : null;
		// The highest point of the car is often a wing or fin, not the roof over the driver.
		const headSide = DRIVER_SIDE * (bodyWidth / 2) * SEAT_LATERAL;
		const roofOverHead = headForward === null ? null : this.surfaceHeight(instances, headSide, headForward, roof);
		this.cabin = { roof: roofOverHead ?? roof, headForward };
	}

	/**
	 * Highest vertex of the body within a small patch around (x, z): the roof over the driver's
	 * head. Only meshes whose bounds reach the patch are scanned.
	 */
	private surfaceHeight(instances: MeshInstance[], x: number, z: number, below: number): number | null {
		const toLocal = new Mat4().copy(this.entity.getWorldTransform()).invert();
		const relative = new Mat4();
		const point = new Vec3();
		const positions: number[] = [];
		let highest = -Infinity;
		for (const instance of instances) {
			const box = localBounds(this.entity, [instance]);
			if (Math.abs(box.center.z - z) > box.halfExtents.z + ROOF_SAMPLE_HALF) continue;
			if (Math.abs(box.center.x - x) > box.halfExtents.x + ROOF_SAMPLE_HALF) continue;
			if (box.center.y + box.halfExtents.y <= highest) continue;
			positions.length = 0;
			const count = instance.mesh.getPositions(positions);
			relative.mul2(toLocal, instance.node.getWorldTransform());
			for (let i = 0; i < count; i++) {
				point.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
				relative.transformPoint(point, point);
				if (Math.abs(point.z - z) < ROOF_SAMPLE_HALF && Math.abs(point.x - x) < ROOF_SAMPLE_HALF && point.y > highest) {
					highest = point.y;
				}
			}
		}
		return highest > ROOF_RANGE[0] && highest <= below + 0.01 ? highest : null;
	}

	/** Repaints the body: a colour for a burnt-out shell, null to put the original back. */
	public repaint(colour: string | null) {
		this.burnt = colour !== null;
		for (const material of this.paintMaterials) {
			material.diffuse = new Color().fromString(colour ?? this.paint);
			// Soot has no lacquer.
			material.clearCoat = colour ? 0 : 1;
			material.gloss = colour ? 0.12 : 0.92;
			material.update();
		}
	}

	/** Scales, centres, grounds and orients the model inside the fit entity. */
	private fitToRoad(fit: Entity, instances: MeshInstance[]) {
		const spec = this.spec!;
		fit.setLocalPosition(0, 0, 0);
		fit.setLocalEulerAngles(0, 0, 0);
		fit.setLocalScale(1, 1, 1);

		const bounds = localBounds(this.entity, instances);
		const extentX = bounds.halfExtents.x * 2;
		const extentZ = bounds.halfExtents.z * 2;
		// Long axis along X means the model was authored sideways relative to our +Z forward.
		let yaw = extentX > extentZ ? 90 : 0;

		// Tell front from back by where the headlights are, or failing that the rear lights.
		const headlights = instances.filter((instance) => HEADLIGHT_MATERIAL.test(instance.material?.name ?? ""));
		const rearLights = instances.filter((instance) => BRAKE_LIGHT_MATERIAL.test(instance.material?.name ?? ""));
		const marker = headlights.length > 0 ? headlights : rearLights;
		if (marker.length > 0) {
			const lights = localBounds(this.entity, marker).center;
			let along = yaw === 90 ? lights.x - bounds.center.x : lights.z - bounds.center.z;
			if (marker === rearLights) along = -along;
			// Rotating +90 about Y maps +X to -Z, so a nose on +X needs turning the other way.
			const noseForward = yaw === 90 ? along < 0 : along > 0;
			if (!noseForward) yaw += 180;
		}
		yaw += spec.yawOffset ?? 0;

		const scale = spec.length / Math.max(extentX, extentZ, 0.001);
		const radians = yaw / DEG;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		const cx = bounds.center.x;
		const cz = bounds.center.z;
		const minY = bounds.center.y - bounds.halfExtents.y;
		fit.setLocalEulerAngles(0, yaw, 0);
		fit.setLocalScale(scale, scale, scale);
		fit.setLocalPosition(-(cx * cos + cz * sin) * scale, -minY * scale, -(-cx * sin + cz * cos) * scale);

		for (const render of fit.findComponents("render") as unknown as { castShadows: boolean; receiveShadows: boolean }[]) {
			render.castShadows = true;
			render.receiveShadows = true;
		}
	}

	/** Clones the materials this car changes, so the rest of the traffic isn't affected. */
	private prepareMaterials(instances: MeshInstance[]) {
		const spec = this.spec!;
		const paintPattern = spec.paintMaterial ?? PAINT_MATERIAL;
		const clones = new Map<Material, StandardMaterial>();
		const cloneOf = (material: StandardMaterial) => {
			let clone = clones.get(material);
			if (!clone) {
				clone = material.clone();
				clones.set(material, clone);
			}
			return clone;
		};

		for (const instance of instances) {
			const material = instance.material as StandardMaterial | null;
			if (!material || !(material instanceof StandardMaterial)) continue;
			const name = material.name ?? "";

			if (BRAKE_LIGHT_MATERIAL.test(name)) {
				const clone = cloneOf(material);
				if (!this.brakeMaterials.includes(clone)) this.brakeMaterials.push(clone);
				instance.material = clone;
			} else if (HEADLIGHT_MATERIAL.test(name)) {
				const clone = cloneOf(material);
				clone.emissive = new Color(1, 0.96, 0.86);
				clone.emissiveIntensity = 2;
				clone.update();
				instance.material = clone;
			} else if (SIREN_MATERIAL.test(name)) {
				const clone = cloneOf(material);
				if (!this.sirenMaterials.includes(clone)) this.sirenMaterials.push(clone);
				instance.material = clone;
			} else if (paintPattern.test(name)) {
				const clone = cloneOf(material);
				if (!this.paintMaterials.includes(clone)) this.paintMaterials.push(clone);
				if (!spec.keepPaint) clone.diffuse = new Color().fromString(this.paint);
				// A lacquer layer over the base coat is what makes car paint read as car paint.
				clone.clearCoat = 1;
				clone.clearCoatGloss = 0.92;
				clone.update();
				instance.material = clone;
			}
		}
	}

	private findWheels(model: Entity) {
		const chosen: Entity[] = [];
		model.forEach((node) => {
			const entity = node as Entity;
			if (!WHEEL_NODE.test(entity.name)) return;
			// Take only the outermost match, so a wheel's own tyre/rim children spin with it.
			if (chosen.some((wheel) => isAncestor(wheel, entity))) return;
			if (collectMeshInstances(entity).length === 0) return;
			chosen.push(entity);
		});

		const inverseModel = new Quat().copy(this.entity.getRotation()).invert();
		const toModel = new Mat4().copy(this.entity.getWorldTransform()).invert();
		const onCar = chosen.map((wheel) => ({ wheel, box: localBounds(this.entity, collectMeshInstances(wheel)) }));
		const ground = Math.min(...onCar.map(({ box }) => box.center.y - box.halfExtents.y));
		const wheels: Entity[] = [];
		for (const { wheel, box } of onCar) {
			if (box.center.y - box.halfExtents.y > ground + OFF_GROUND || /steer/i.test(wheel.name)) continue;
			if (box.halfExtents.x > box.halfExtents.y * AXLE_WIDTH_RATIO) wheels.push(...this.splitAxle(wheel, box));
			else wheels.push(wheel);
		}

		for (const wheel of wheels) {
			const instances = collectMeshInstances(wheel);
			const bounds = worldBounds(instances);
			const parent = wheel.parent as Entity | null;
			if (!parent) continue;

			// Spin about the wheel's visual centre; authored pivots are often somewhere else.
			let pivot = wheel;
			if (wheel.getPosition().distance(bounds.center) > PIVOT_TOLERANCE) {
				pivot = new Entity(`${wheel.name}-pivot`);
				parent.addChild(pivot);
				pivot.setPosition(bounds.center);
				pivot.setRotation(parent.getRotation());
				// reparent() keeps the *local* transform. The pivot shares the old parent's rotation
				// and scale, so restoring the world position puts the wheel back where it was.
				const worldPosition = wheel.getPosition().clone();
				wheel.reparent(pivot);
				wheel.setPosition(worldPosition);
			}
			const rest = new Quat().mul2(inverseModel, pivot.getRotation());
			const front = toModel.transformPoint(bounds.center).z > 0;
			this.wheels.push({ pivot, radius: Math.max(bounds.halfExtents.y, 0.05), rest, front });
		}
	}

	/**
	 * Cuts an axle modelled as one mesh (both tyres in a single part) into a left and a right
	 * wheel, each a node of its own centred on its tyre, so each can steer about its own centre.
	 * The original is switched off. Returns the new wheels, or the axle itself if it can't be cut
	 * (then it still rolls correctly; it just doesn't steer as a pair).
	 */
	private splitAxle(axle: Entity, box: BoundingBox): Entity[] {
		const parent = axle.parent as Entity | null;
		const spec = this.spec;
		const instances = collectMeshInstances(axle).filter((instance) => instance.visible && instance.material);
		if (!parent || !spec || instances.length === 0 || !instances.every(isMergeable)) return [axle];

		// Triangles are sorted to a side by where they sit across the car, in the car's own frame.
		const modelFrame = this.entity.getWorldTransform();
		const groups = [...groupByMaterialAndFormat(instances).values()];
		const point = new Vec3();
		const sides = [-1, 1].map((side) => ({ side, triangles: groups.map(() => [] as number[]), min: new Vec3(Infinity, Infinity, Infinity), max: new Vec3(-Infinity, -Infinity, -Infinity) }));
		groups.forEach((group, groupIndex) => {
			const geometry = mergeGeometry(group, modelFrame);
			const positions = geometry.streams.find((stream) => stream.semantic === "POSITION");
			if (!positions) return;
			const stride = positions.components;
			for (let i = 0; i < geometry.indices.length; i += 3) {
				let x = 0;
				for (let k = 0; k < 3; k++) x += positions.data[geometry.indices[i + k] * stride];
				const target = sides[x / 3 < box.center.x ? 0 : 1];
				for (let k = 0; k < 3; k++) {
					const vertex = geometry.indices[i + k] * stride;
					point.set(positions.data[vertex], positions.data[vertex + 1], positions.data[vertex + 2]);
					target.min.min(point);
					target.max.max(point);
				}
				target.triangles[groupIndex].push(geometry.indices[i], geometry.indices[i + 1], geometry.indices[i + 2]);
			}
		});
		if (sides.some((side) => side.triangles.every((list) => list.length === 0))) return [axle];

		const wheels: Entity[] = [];
		for (const { side, triangles, min, max } of sides) {
			const wheel = new Entity(`${axle.name}-${side < 0 ? "left" : "right"}`);
			parent.addChild(wheel);
			// Centred on its own tyre, carrying the parent's orientation like a re-pivoted wheel.
			wheel.setPosition(modelFrame.transformPoint(new Vec3().add2(min, max).mulScalar(0.5)));
			wheel.setRotation(parent.getRotation());
			const frame = wheel.getWorldTransform();
			const meshInstances: MeshInstance[] = [];
			groups.forEach((group, groupIndex) => {
				if (triangles[groupIndex].length === 0) return;
				const key = `${spec.file}|${axle.name}|${side}|${groupIndex}`;
				let mesh = splitWheels.get(key);
				if (!mesh) {
					// Same instances in the same order, so the triangle numbering matches the sort above.
					const geometry = compactGeometry(mergeGeometry(group, frame), Uint32Array.from(triangles[groupIndex]));
					mesh = buildMesh(this.app.graphicsDevice, geometry);
					mesh.incRefCount();
					splitWheels.set(key, mesh);
				}
				meshInstances.push(new MeshInstance(mesh, group[0].material));
			});
			wheel.addComponent("render", { meshInstances, castShadows: true, receiveShadows: true });
			wheels.push(wheel);
		}
		for (const render of axle.findComponents("render") as RenderComponent[]) render.enabled = false;
		return wheels;
	}

	private addLightBar(instances: MeshInstance[]) {
		if (!this.flashOff) return;
		const bounds = localBounds(this.entity, instances);
		const roof = bounds.center.y + bounds.halfExtents.y;
		const width = bounds.halfExtents.x * 2 * 0.28;
		for (const [name, side] of [["beacon-red", -1], ["beacon-blue", 1]] as const) {
			const beacon = new Entity(name);
			beacon.addComponent("render", { type: "box", material: this.flashOff });
			this.entity.addChild(beacon);
			beacon.setLocalPosition(side * width * 0.55, roof + 0.07, 0);
			beacon.setLocalScale(width, 0.12, 0.26);
		}
	}

	private animateBody(dt: number, speed: number, acceleration: number) {
		const lateral = this.vehicle?.lateralAcceleration ?? 0;
		const targetPitch = clamp(-acceleration * PITCH_PER_ACCEL, -MAX_PITCH, MAX_PITCH);
		const targetRoll = clamp(lateral * ROLL_PER_LATERAL_ACCEL, -MAX_ROLL, MAX_ROLL);
		const blend = 1 - Math.exp(-BODY_SMOOTHING * dt);
		this.pitch += (targetPitch - this.pitch) * blend;
		this.roll += (targetRoll - this.roll) * blend;
		this.entity.setLocalEulerAngles(this.pitch, 0, this.roll);
	}

	private spinWheels(dt: number, speed: number) {
		if (this.wheels.length === 0) return;
		const steer = (this.vehicle?.steerAngle ?? 0) * DEG;
		if (Math.abs(speed) <= 0.01 && steer === this.lastSteer) return;
		this.lastSteer = steer;
		const modelRotation = this.entity.getRotation();
		this.steering.setFromAxisAngle(Vec3.UP, steer);
		for (const wheel of this.wheels) {
			const angle = (speed * dt) / wheel.radius;
			// Accumulate the spin into the stored rest rotation (about the car's lateral X axis).
			this.spin.setFromAxisAngle(Vec3.RIGHT, angle * DEG);
			wheel.rest.mul2(this.spin, wheel.rest).normalize();
			// Steering turns the spinning wheel about the car's vertical axis.
			if (wheel.front) this.scratch.mul2(this.steering, wheel.rest);
			else this.scratch.copy(wheel.rest);
			this.scratch.mul2(modelRotation, this.scratch);
			wheel.pivot.setRotation(this.scratch);
		}
	}

	private updateLights(dt: number) {
		const braking = this.vehicle?.isBraking ?? false;
		if (braking !== this.brakeLit) {
			this.brakeLit = braking;
			for (const material of this.brakeMaterials) {
				material.emissive = braking ? BRAKE_ON : BRAKE_OFF;
				material.emissiveIntensity = braking ? 4 : 1;
				material.update();
			}
		}

		if (!this.police || this.sirenMaterials.length === 0) return;
		this.flashTimer += dt;
		const redPhase = Math.floor(this.flashTimer / FLASH_SECONDS) % 2 === 0;
		this.sirenMaterials.forEach((material, index) => {
			const name = (material.name ?? "").toLowerCase();
			const isBlue = name.includes("blue") || (!name.includes("red") && index % 2 === 1);
			const on = isBlue ? !redPhase : redPhase;
			const emissive = on ? (isBlue ? SIREN_BLUE : SIREN_RED) : SIREN_OFF;
			if (material.emissive.equals(emissive)) return;
			material.emissive = emissive;
			material.emissiveIntensity = on ? 5 : 0;
			material.update();
		});
	}
}

/** How see-through converted glass is. */
const GLASS_OPACITY = 0.35;

/**
 * glTF transmission (KHR_materials_transmission) turns on PlayCanvas dynamic refraction, which
 * needs a scene-colour grab pass on the camera — an extra full-screen copy every frame. For
 * car windows plain alpha-blended glass looks nearly the same, so convert it. The materials
 * are shared by every car using this model, and converting twice is harmless.
 */
function simplifyGlass(instances: MeshInstance[]) {
	for (const instance of instances) {
		if (!(instance.material instanceof StandardMaterial)) continue;
		// Set by the glTF parser but missing from the published typings.
		const material = instance.material as StandardMaterial & { useDynamicRefraction: boolean; refractionMap: unknown };
		if (!material.useDynamicRefraction) continue;
		material.useDynamicRefraction = false;
		material.refraction = 0;
		material.refractionMap = null;
		material.opacity = Math.min(material.opacity, GLASS_OPACITY);
		material.blendType = BLEND_NORMAL;
		material.depthWrite = false;
		material.update();
	}
}

/** Hides brand marks and pre-blurred rims; returns the instances that stay visible. */
function hideUnwanted(model: Entity, instances: MeshInstance[], spec: VehicleModelSpec | null): MeshInstance[] {
	const hidden = new Set<MeshInstance>();
	model.forEach((node) => {
		if (HIDDEN_NODE.test(node.name) || HIDDEN_BRAND_NODE.test(node.name)) {
			for (const instance of collectMeshInstances(node as Entity)) hidden.add(instance);
		}
	});
	const extra = spec?.hideMaterial;
	for (const instance of instances) {
		const name = instance.material?.name ?? "";
		if (HIDDEN_MATERIAL.test(name) || extra?.test(name)) hidden.add(instance);
	}
	for (const instance of hidden) instance.visible = false;
	return instances.filter((instance) => !hidden.has(instance));
}

/** Instances that can be merged together: the same material and the same vertex layout. */
function groupByMaterialAndFormat(instances: readonly MeshInstance[]): Map<string, MeshInstance[]> {
	const groups = new Map<string, MeshInstance[]>();
	for (const instance of instances) {
		const key = `${instance.material.id}|${instance.mesh.vertexBuffer.format.batchingHash}`;
		const group = groups.get(key);
		if (group) group.push(instance);
		else groups.set(key, [instance]);
	}
	return groups;
}

function collectMeshInstances(root: Entity): MeshInstance[] {
	const renders = root.findComponents("render") as unknown as { meshInstances: MeshInstance[] }[];
	return renders.flatMap((render) => render.meshInstances);
}

/**
 * World-space bounds from each mesh's own box and its node's current transform. The cached
 * `MeshInstance.aabb` can still reflect the pose from before the model was fitted.
 */
function worldBounds(instances: MeshInstance[]): BoundingBox {
	const min = new Vec3(Infinity, Infinity, Infinity);
	const max = new Vec3(-Infinity, -Infinity, -Infinity);
	const corner = new Vec3();
	for (const instance of instances) {
		const lo = instance.mesh.aabb.getMin();
		const hi = instance.mesh.aabb.getMax();
		const transform = instance.node.getWorldTransform();
		for (let i = 0; i < 8; i++) {
			corner.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
			transform.transformPoint(corner, corner);
			min.min(corner);
			max.max(corner);
		}
	}
	const box = new BoundingBox();
	box.setMinMax(min, max);
	return box;
}

/**
 * Bounds of the mesh instances in `frame`'s local space. Built from each mesh's own box
 * rather than the world-space one, which would balloon whenever the car isn't axis-aligned.
 */
function localBounds(frame: Entity, instances: MeshInstance[]): BoundingBox {
	const inverse = new Mat4().copy(frame.getWorldTransform()).invert();
	const relative = new Mat4();
	const min = new Vec3(Infinity, Infinity, Infinity);
	const max = new Vec3(-Infinity, -Infinity, -Infinity);
	const corner = new Vec3();
	for (const instance of instances) {
		const aabb = instance.mesh.aabb;
		const lo = aabb.getMin();
		const hi = aabb.getMax();
		relative.mul2(inverse, instance.node.getWorldTransform());
		for (let i = 0; i < 8; i++) {
			corner.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
			relative.transformPoint(corner, corner);
			min.min(corner);
			max.max(corner);
		}
	}
	const box = new BoundingBox();
	box.setMinMax(min, max);
	return box;
}

function isAncestor(ancestor: Entity, node: Entity): boolean {
	let current = node.parent;
	while (current) {
		if (current === ancestor) return true;
		current = current.parent;
	}
	return false;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
