import { BoundingBox, Entity, Quat, Script, Vec3, type MeshInstance, type RenderComponent } from "playcanvas";

import { applyDamage, damageablesNear } from "../combat/CombatWorld";
import { nextCombatId, type DamageEvent, type DamageSourceRef } from "../combat/Damage";
import { localBounds } from "../rendering/ModelBounds";
import { drivableCars } from "../traffic/Carjack";
import { distanceFromRail, RAIL_TOP_Y, railPoseAt, railWrap } from "./RailLine";
import {
	CARRIAGE_COUNT,
	CARRIAGE_GAP,
	CARRIAGE_LENGTH,
	setTrainFront,
	TRAIN_LENGTH,
	TRAIN_SPEED,
	TRAIN_STRIKE_HALF_WIDTH,
} from "./RailTraffic";

/**
 * The train: runs the loop for ever, and destroys whatever is on the line when it gets there.
 *
 * It is three carriages placed on the track one at a time rather than one rigid 68 m body, so
 * each of them stays on the rails through the corners the way real stock does — pivoting on its
 * bogies, with the ends overhanging the curve.
 *
 * The supplied model is a three-car set in one file. Each carriage entity instances the whole
 * set and hides the two thirds it isn't, which costs nothing to draw and needs no node names.
 */

/** Bogie centres, in from each end of a carriage; the body pivots on the line between them. */
const BOGIE_INSET = 7.5;
/** Lethal by a wide margin: this is a 200-tonne train hitting a parked hatchback. */
const STRIKE_DAMAGE = 400;
const STRIKE_IMPULSE = 22;
/** Samples along the train used to work out what it is hitting. */
const STRIKE_SAMPLE_STEP = 4;
/** A vehicle within this of a sample point, and on the line, is under the train. */
const STRIKE_REACH = 2.5;

export class OrionTrain extends Script {
	public static scriptName = "orionTrain";

	/** Where round the loop the front of the train is. */
	public front = 0;
	public speed = TRAIN_SPEED;

	private carriages: { root: Entity; fit: Entity; fitted: boolean }[] = [];
	private readonly source: DamageSourceRef = { id: nextCombatId(), kind: "vehicle", x: 0, z: 0 };
	private readonly strike: DamageEvent = {
		amount: STRIKE_DAMAGE,
		type: "impact",
		source: this.source,
		x: 0,
		y: 0,
		z: 0,
		directionX: 0,
		directionZ: 1,
		impulse: STRIKE_IMPULSE,
	};
	private readonly samples: { x: number; z: number }[] = [];
	private readonly turn = new Quat();
	private readonly offset = new Vec3();

	public initialize() {
		this.carriages = [];
		for (let index = 0; index < CARRIAGE_COUNT; index++) {
			const root = this.entity.findByName(carriageName(index)) as Entity | null;
			const fit = root?.findByName(carriageFitName(index)) as Entity | null;
			if (root && fit) this.carriages.push({ root, fit, fitted: false });
		}
		this.place();
		this.on("destroy", () => setTrainFront(null));
	}

	public update(dt: number) {
		this.front = railWrap(this.front + this.speed * dt);
		this.place();
		this.clearTheLine();
	}

	/** Puts each carriage on the rails, and fits the model the first time it has loaded. */
	private place() {
		setTrainFront(this.front);
		this.carriages.forEach((carriage, index) => {
			if (!carriage.fitted) carriage.fitted = this.fitCarriage(carriage.fit, index);
			const centre = this.front - CARRIAGE_LENGTH / 2 - index * (CARRIAGE_LENGTH + CARRIAGE_GAP);
			const leading = railPoseAt(centre + BOGIE_INSET);
			const trailing = railPoseAt(centre - BOGIE_INSET);
			carriage.root.setPosition((leading.x + trailing.x) / 2, RAIL_TOP_Y, (leading.z + trailing.z) / 2);
			carriage.root.setEulerAngles(0, Math.atan2(leading.x - trailing.x, leading.z - trailing.z) * (180 / Math.PI), 0);
		});
	}

	/**
	 * Measures the loaded model, hides every carriage but this one, and stands what's left on
	 * the railhead facing along the track. Says whether the model was there to measure yet.
	 */
	private fitCarriage(fit: Entity, index: number): boolean {
		const bounds = localBounds(fit);
		if (!bounds) return false;
		const size = bounds.halfExtents;
		// The set lies along whichever horizontal axis is longer; its carriages divide that up.
		const alongX = size.x >= size.z;
		const total = (alongX ? size.x : size.z) * 2;
		const min = (alongX ? bounds.center.x : bounds.center.z) - total / 2;
		const band = total / CARRIAGE_COUNT;
		// Carriage 0 leads, and the model's +X end is the one turned into the direction of
		// travel below — so the leading carriage takes the LAST band, not the first. Taking
		// them in order ran the set backwards, tail car first.
		const from = min + (CARRIAGE_COUNT - 1 - index) * band;
		const to = from + band;

		for (const instance of meshInstancesIn(fit)) {
			const centre = instanceCentre(fit, instance);
			const position = alongX ? centre.x : centre.z;
			if (position < from || position >= to) instance.visible = false;
		}

		// Turn the long axis onto +Z (the heading the track is described in), then slide the
		// carriage so its own centre is over the entity and its wheels are on the railhead.
		this.turn.setFromEulerAngles(0, alongX ? -90 : 0, 0);
		this.offset.set(
			alongX ? -(from + to) / 2 : -bounds.center.x,
			-(bounds.center.y - size.y),
			alongX ? -bounds.center.z : -(from + to) / 2,
		);
		this.turn.transformVector(this.offset, this.offset);
		fit.setLocalRotation(this.turn);
		fit.setLocalPosition(this.offset);
		return true;
	}

	/**
	 * Anything standing on the line where the train is goes: cars are blown apart and thrown
	 * clear, people and the player are run down. The train does not slow for any of it.
	 */
	private clearTheLine() {
		this.samples.length = 0;
		for (let back = 0; back <= TRAIN_LENGTH; back += STRIKE_SAMPLE_STEP) {
			const pose = railPoseAt(this.front - back);
			this.samples.push({ x: pose.x, z: pose.z });
		}
		const nose = railPoseAt(this.front);
		const heading = (nose.heading * Math.PI) / 180;
		this.strike.directionX = Math.sin(heading);
		this.strike.directionZ = Math.cos(heading);
		this.source.x = nose.x;
		this.source.z = nose.z;

		for (const car of drivableCars()) {
			const position = car.entity.getPosition();
			if (distanceFromRail(position.x, position.z) > TRAIN_STRIKE_HALF_WIDTH + car.halfWidth) continue;
			if (!this.underTheTrain(position.x, position.z, car.halfLength)) continue;
			car.struckByTrain(this.strike.directionX * STRIKE_IMPULSE, this.strike.directionZ * STRIKE_IMPULSE);
		}

		const centre = railPoseAt(this.front - TRAIN_LENGTH / 2);
		for (const target of damageablesNear(centre.x, centre.z, TRAIN_LENGTH / 2 + STRIKE_REACH)) {
			// Vehicles are handled above, where they can be detonated rather than just damaged.
			if (target.kind === "vehicle" || !target.alive) continue;
			if (!this.underTheTrain(target.x, target.z, target.radius)) continue;
			this.strike.x = target.x;
			this.strike.y = target.y;
			this.strike.z = target.z;
			applyDamage(target, this.strike);
		}
	}

	private underTheTrain(x: number, z: number, halfLength: number): boolean {
		const reach = STRIKE_REACH + halfLength;
		for (const sample of this.samples) {
			if (Math.hypot(sample.x - x, sample.z - z) <= reach) return true;
		}
		return false;
	}
}

export function carriageName(index: number): string {
	return `carriage-${index}`;
}

export function carriageFitName(index: number): string {
	return `carriage-fit-${index}`;
}

function meshInstancesIn(root: Entity): MeshInstance[] {
	const instances: MeshInstance[] = [];
	for (const render of root.findComponents("render") as RenderComponent[]) {
		instances.push(...render.meshInstances);
	}
	return instances;
}

const instanceBox = new BoundingBox();

/** Centre of one mesh instance in `root`'s own space. */
function instanceCentre(root: Entity, instance: MeshInstance): Vec3 {
	instanceBox.setFromTransformedAabb(instance.mesh.aabb, instance.node.getWorldTransform());
	const centre = instanceBox.center.clone();
	root.getWorldTransform().clone().invert().transformPoint(centre, centre);
	return centre;
}
