import { Asset, BoundingBox, Entity, Mat4, Quat, StandardMaterial, Vec3, type AppBase, type MeshInstance } from "playcanvas";

import { WEAPON_MODEL_BASE, type WeaponDefinition, type WeaponModelSpec } from "./WeaponData";

/**
 * Turns a weapon's model spec into a held object.
 *
 * Any GLB works as long as it's roughly a weapon shape: on load the model is measured, its long
 * axis found, turned so the muzzle (or blade tip) points along the holder's forward (-Z) with
 * its top up, scaled to the spec's real length, and shifted so the grip sits at the holder's
 * origin. The holder is what the combat code places in the player's hand.
 *
 * Until a model loads — or if its file isn't there yet — a simple placeholder of the right size
 * and silhouette is shown, so every weapon works before its art arrives.
 */
export interface WeaponVisual {
	/** Place and orient this; the grip is at its origin, the muzzle along its -Z. */
	readonly root: Entity;
	/** The muzzle (or blade tip), in the holder's local space. */
	readonly muzzle: Vec3;
	/** Where the hands take hold, in the holder's local space; null leaves it to the hold style. */
	readonly hands: { readonly main: Vec3 | null; readonly off: Vec3 | null };
	/**
	 * How far the model reaches behind the grip: a long gun's stock, 0 for anything that ends at
	 * the hand. The hold rests that end against the shoulder, so a long stock tips the muzzle down
	 * instead of pushing itself through the chest. Measured once there are meshes to measure.
	 */
	stock: number;
}

type Axis = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

const MUZZLE_NODE = /muzzle|flash|barrel|suppressor|silencer|tip|blade|nozzle/i;
const containers = new Map<string, Promise<Asset | null>>();
let placeholderMaterial: StandardMaterial | null = null;
let bladeMaterial: StandardMaterial | null = null;
let polymerMaterial: StandardMaterial | null = null;
let woodMaterial: StandardMaterial | null = null;

export class WeaponModels {
	private readonly visuals = new Map<string, WeaponVisual>();

	public constructor(private readonly app: AppBase, private readonly parent: Entity) {}

	/** The held model for a weapon (created on first use, hidden until shown). */
	public visualFor(definition: WeaponDefinition): WeaponVisual | null {
		const spec = definition.model;
		if (!spec) return null;
		const existing = this.visuals.get(definition.id);
		if (existing) return existing;

		const root = new Entity(`weapon-${definition.id}`);
		root.enabled = false;
		this.parent.addChild(root);
		const visual: WeaponVisual = {
			root,
			muzzle: new Vec3(0, 0, -spec.length),
			hands: { main: spec.hands?.main ? new Vec3(...spec.hands.main) : null, off: spec.hands?.off ? new Vec3(...spec.hands.off) : null },
			stock: 0,
		};
		this.visuals.set(definition.id, visual);

		const placeholder = buildPlaceholder(definition);
		root.addChild(placeholder);
		(visual.muzzle as Vec3).set(0, placeholderMuzzleHeight(definition), -spec.length * (1 - spec.grip.along));
		visual.stock = measureStock(root, placeholder);

		loadContainer(this.app, `${WEAPON_MODEL_BASE}/${spec.file}`).then((asset) => {
			if (!asset || this.visuals.get(definition.id) !== visual) return;
			const model = (asset.resource as { instantiateRenderEntity: () => Entity }).instantiateRenderEntity();
			const fitted = fitModel(model, spec, visual.muzzle as Vec3);
			if (!fitted) {
				console.warn(`Weapon model ${spec.file} has no visible meshes; keeping the placeholder.`);
				model.destroy();
				return;
			}
			placeholder.destroy();
			root.addChild(fitted);
			centreAcross(root, fitted);
			visual.stock = measureStock(root, fitted);
		}).catch((error: unknown) => {
			console.warn(`Weapon model ${spec.file} couldn't be fitted; keeping the placeholder.`, error);
		});
		return visual;
	}

	public destroy(): void {
		for (const visual of this.visuals.values()) visual.root.destroy();
		this.visuals.clear();
	}
}

/**
 * Whether a file is there. Asked before the engine is: its loader throws an unhandled rejection
 * from inside a promise when a model 404s, which a game with art still to come would hit for every
 * weapon that doesn't have its model yet.
 */
async function fileExists(url: string): Promise<boolean> {
	try {
		return (await fetch(url, { method: "HEAD" })).ok;
	} catch {
		return false;
	}
}

/** Loads a GLB once per URL; resolves null if the file is missing or broken. */
function loadContainer(app: AppBase, url: string): Promise<Asset | null> {
	let pending = containers.get(url);
	if (!pending) {
		pending = fileExists(url).then((found) => {
			if (!found) {
				// Not all weapon art exists yet: the placeholder stays.
				containers.delete(url);
				return null;
			}
			return new Promise<Asset | null>((resolve) => {
				app.assets.loadFromUrl(url, "container", (error: string | null, asset?: Asset) => {
					if (error || !asset) {
						console.warn(`Weapon model ${url} failed to load:`, error);
						containers.delete(url);
						resolve(null);
						return;
					}
					resolve(asset);
				});
			});
		});
		containers.set(url, pending);
	}
	return pending;
}

/**
 * Wraps `model` in a fitted entity: muzzle to -Z, top to +Y, real length, grip at the origin.
 * Writes the muzzle's position (in the wrapper's parent space) into `muzzleOut`.
 */
function fitModel(model: Entity, spec: WeaponModelSpec, muzzleOut: Vec3): Entity | null {
	if (spec.hideNodes) {
		model.forEach((node) => {
			if (spec.hideNodes!.test(node.name)) (node as Entity).enabled = false;
		});
	}
	const instances = visibleInstances(model);
	if (instances.length === 0) return null;
	const bounds = boundsIn(model, instances);
	const half = bounds.halfExtents;
	const extents = [half.x, half.y, half.z];
	const longIndex = extents.indexOf(Math.max(...extents));
	const longAxis = (["x", "y", "z"] as const)[longIndex];

	const muzzleAxis: Axis = spec.muzzleAxis ?? detectMuzzle(model, bounds, longAxis);
	const forward = axisVector(muzzleAxis);
	// Top of the weapon: +Y, unless the weapon was modelled standing up.
	const up = longAxis === "y" ? new Vec3(0, 0, 1) : new Vec3(0, 1, 0);
	const back = forward.clone().mulScalar(-1);
	const right = new Vec3().cross(up, back);
	// A rotation whose rows are the model's right, up and back: rotation * v = (right·v, up·v,
	// back·v), which sends right to +X, up to +Y and back to +Z (so the muzzle ends up on -Z).
	const rotation = new Mat4();
	const d = rotation.data;
	const rows = [right, up, back];
	for (let row = 0; row < 3; row++) {
		d[0 * 4 + row] = rows[row].x;
		d[1 * 4 + row] = rows[row].y;
		d[2 * 4 + row] = rows[row].z;
	}
	const quat = new Quat().setFromMat4(rotation);

	const longHalf = extents[longIndex];
	const upHalf = longAxis === "y" ? half.z : half.y;
	const scale = spec.length / Math.max(longHalf * 2, 1e-6);
	const centre = bounds.center;
	const rearEnd = centre.clone().add(back.clone().mulScalar(longHalf));
	const grip = rearEnd.clone().add(forward.clone().mulScalar(spec.grip.along * longHalf * 2)).sub(up.clone().mulScalar(spec.grip.below * upHalf));
	const muzzleEnd = centre.clone().add(forward.clone().mulScalar(longHalf));

	const wrapper = new Entity("weapon-model");
	wrapper.addChild(model);
	wrapper.setLocalRotation(quat);
	wrapper.setLocalScale(scale, scale, scale);
	const offset = quat.transformVector(grip).mulScalar(-scale);
	wrapper.setLocalPosition(offset);
	muzzleOut.copy(quat.transformVector(muzzleEnd.sub(grip)).mulScalar(scale));

	for (const render of model.findComponents("render") as unknown as { castShadows: boolean; receiveShadows: boolean }[]) {
		render.castShadows = true;
		render.receiveShadows = true;
	}
	return wrapper;
}

/**
 * Puts the weapon's centreline on the holder's x = 0. The fit centres on the model's overall
 * bounds, but a rifle's sights, rails and stock aren't symmetrical about the barrel, so the
 * barrel (and the hands, which are placed on that centreline) ended up a few centimetres off.
 * Measured from the meshes as they are once fitted.
 */
function centreAcross(root: Entity, fitted: Entity): void {
	const instances = visibleInstances(fitted);
	if (instances.length === 0) return;
	const shift = boundsIn(root, instances).center.x;
	if (Math.abs(shift) < 1e-4) return;
	const position = fitted.getLocalPosition();
	fitted.setLocalPosition(position.x - shift, position.y, position.z);
}

/**
 * How far the weapon reaches back from the grip — its stock — in the holder's space. Measured
 * from `model` rather than the holder, which is switched off until the weapon is drawn and would
 * report nothing under it.
 */
function measureStock(root: Entity, model: Entity): number {
	const instances = visibleInstances(model);
	if (instances.length === 0) return 0;
	return Math.max(0, boundsIn(root, instances).getMax().z);
}

/**
 * Mesh instances under `root`, skipping switched-off branches. Walked by hand: a model not yet
 * in the scene reports every node as disabled through `enabled`, which includes the hierarchy.
 */
function visibleInstances(root: Entity): MeshInstance[] {
	const instances: MeshInstance[] = [];
	const visit = (entity: Entity) => {
		if ((entity as unknown as { _enabled: boolean })._enabled === false) return;
		if (entity.render) instances.push(...entity.render.meshInstances);
		for (const child of entity.children) visit(child as Entity);
	};
	visit(root);
	return instances;
}

/** Bounds of the instances in `frame`'s own space, from each mesh's box and node transform. */
function boundsIn(frame: Entity, instances: readonly MeshInstance[]): BoundingBox {
	const inverse = new Mat4().copy(frame.getWorldTransform()).invert();
	const relative = new Mat4();
	const min = new Vec3(Infinity, Infinity, Infinity);
	const max = new Vec3(-Infinity, -Infinity, -Infinity);
	const corner = new Vec3();
	for (const instance of instances) {
		const lo = instance.mesh.aabb.getMin();
		const hi = instance.mesh.aabb.getMax();
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

/** Which end of the long axis the muzzle/tip is at, judged by a node named like one. */
function detectMuzzle(model: Entity, bounds: BoundingBox, axis: "x" | "y" | "z"): Axis {
	let offset = 0;
	model.forEach((node) => {
		if (offset !== 0 || !MUZZLE_NODE.test(node.name)) return;
		const instances = visibleInstances(node as Entity);
		if (instances.length === 0) return;
		const part = boundsIn(model, instances);
		offset = part.center[axis] - bounds.center[axis];
	});
	return `${offset < 0 ? "-" : "+"}${axis}` as Axis;
}

function axisVector(axis: Axis): Vec3 {
	const sign = axis[0] === "-" ? -1 : 1;
	return new Vec3(axis[1] === "x" ? sign : 0, axis[1] === "y" ? sign : 0, axis[1] === "z" ? sign : 0);
}

function gunmetal(): StandardMaterial {
	if (placeholderMaterial) return placeholderMaterial;
	placeholderMaterial = new StandardMaterial();
	placeholderMaterial.name = "weapon-placeholder";
	placeholderMaterial.diffuse.set(0.06, 0.065, 0.07);
	placeholderMaterial.useMetalness = true;
	placeholderMaterial.metalness = 0.6;
	placeholderMaterial.gloss = 0.55;
	placeholderMaterial.update();
	return placeholderMaterial;
}

function steel(): StandardMaterial {
	if (bladeMaterial) return bladeMaterial;
	bladeMaterial = new StandardMaterial();
	bladeMaterial.name = "weapon-blade";
	bladeMaterial.diffuse.set(0.75, 0.77, 0.8);
	bladeMaterial.useMetalness = true;
	bladeMaterial.metalness = 1;
	bladeMaterial.gloss = 0.82;
	bladeMaterial.update();
	return bladeMaterial;
}

/** Matt black polymer: grips, frames, trigger guards. */
function polymer(): StandardMaterial {
	if (polymerMaterial) return polymerMaterial;
	polymerMaterial = new StandardMaterial();
	polymerMaterial.name = "weapon-polymer";
	polymerMaterial.diffuse.set(0.035, 0.035, 0.04);
	polymerMaterial.useMetalness = true;
	polymerMaterial.metalness = 0;
	polymerMaterial.gloss = 0.28;
	polymerMaterial.update();
	return polymerMaterial;
}

/** Varnished walnut: stocks and fore-ends. */
function wood(): StandardMaterial {
	if (woodMaterial) return woodMaterial;
	woodMaterial = new StandardMaterial();
	woodMaterial.name = "weapon-wood";
	woodMaterial.diffuse.set(0.32, 0.17, 0.075);
	woodMaterial.useMetalness = true;
	woodMaterial.metalness = 0;
	woodMaterial.gloss = 0.4;
	woodMaterial.update();
	return woodMaterial;
}

function placeholderMuzzleHeight(definition: WeaponDefinition): number {
	if (definition.id === "rocketLauncher") return LAUNCHER_TUBE_HEIGHT;
	return definition.type === "melee" ? 0 : 0.035;
}

/** The launcher's tube sits this far above the grip; the hand hangs below it, not in it. */
const LAUNCHER_TUBE_HEIGHT = 0.155;

/**
 * Stand-in shapes, sized from the spec, grip at the origin and muzzle towards -Z. Built to look
 * like the weapon they stand for and to put a grip or fore-end where the hands go (see each
 * weapon's `hands`), so the hold reads correctly before any art arrives.
 */
function buildPlaceholder(definition: WeaponDefinition): Entity {
	const spec = definition.model!;
	const root = new Entity("weapon-placeholder");
	type Rotation = [number, number, number];
	const part = (name: string, size: [number, number, number], at: [number, number, number], material: StandardMaterial = gunmetal(), type = "box", rotation?: Rotation) => {
		const entity = new Entity(name);
		entity.addComponent("render", { type, material, castShadows: true });
		entity.setLocalScale(...size);
		entity.setLocalPosition(...at);
		// A cylinder is authored standing up; lying along the barrel it's turned a quarter.
		const turn: Rotation = rotation ?? (type === "cylinder" ? [90, 0, 0] : [0, 0, 0]);
		entity.setLocalEulerAngles(...turn);
		root.addChild(entity);
	};
	const barrel = (radius: number, from: number, to: number, y: number, material: StandardMaterial = gunmetal()) => (
		part("barrel", [radius * 2, Math.abs(to - from), radius * 2], [0, y, (from + to) / 2], material, "cylinder")
	);
	const length = spec.length;
	const front = length * (1 - spec.grip.along);
	const rear = length * spec.grip.along;
	const centreZ = (rear - front) / 2;
	switch (definition.id) {
		case "sword":
			part("blade", [0.045, 0.008, length * 0.78], [0, 0, -length * 0.39 - 0.1], steel());
			part("guard", [0.18, 0.025, 0.03], [0, 0, -0.08]);
			part("hilt", [0.03, 0.03, 0.2], [0, 0, 0.02], polymer());
			part("pommel", [0.04, 0.04, 0.03], [0, 0, 0.13]);
			break;
		case "pistol":
			// Slide over a polymer frame, a raked grip and a trigger guard.
			part("slide", [0.03, 0.034, 0.185], [0, 0.045, -0.058]);
			part("frame", [0.028, 0.022, 0.15], [0, 0.02, -0.03], polymer());
			part("grip", [0.03, 0.105, 0.05], [0, -0.03, 0.028], polymer(), "box", [-12, 0, 0]);
			part("trigger-guard", [0.012, 0.026, 0.055], [0, 0.0, -0.05], polymer());
			part("sight", [0.008, 0.01, 0.012], [0, 0.066, 0.03]);
			break;
		case "shotgun":
			// A pump: barrel over a magazine tube, walnut fore-end where the off hand goes, a dropped stock.
			barrel(0.013, -0.12, -front, 0.035);
			barrel(0.011, -0.12, -front + 0.2, 0.004);
			part("receiver", [0.046, 0.062, 0.22], [0, 0.025, -0.02]);
			part("fore-end", [0.056, 0.05, 0.17], [0, 0.0, -0.3], wood());
			part("wrist", [0.036, 0.07, 0.085], [0, -0.02, 0.055], wood());
			part("stock", [0.04, 0.09, 0.22], [0, -0.012, rear - 0.11], wood(), "box", [7, 0, 0]);
			part("butt-pad", [0.042, 0.105, 0.018], [0, -0.03, rear + 0.005], polymer(), "box", [7, 0, 0]);
			part("trigger-guard", [0.01, 0.03, 0.07], [0, -0.024, -0.055], polymer());
			part("bead", [0.008, 0.012, 0.008], [0, 0.056, -front + 0.01]);
			break;
		case "rocketLauncher":
			// A shoulder-fired tube with flared ends, a sight, a shoulder pad and two grips.
			part("tube", [0.11, length, 0.11], [0, LAUNCHER_TUBE_HEIGHT, centreZ], gunmetal(), "cylinder");
			part("muzzle-ring", [0.135, 0.06, 0.135], [0, LAUNCHER_TUBE_HEIGHT, -front + 0.03], gunmetal(), "cylinder");
			part("rear-ring", [0.14, 0.06, 0.14], [0, LAUNCHER_TUBE_HEIGHT, rear - 0.03], gunmetal(), "cylinder");
			part("sight", [0.02, 0.05, 0.09], [0, LAUNCHER_TUBE_HEIGHT + 0.08, -0.12], polymer());
			part("shoulder-pad", [0.09, 0.028, 0.2], [0, LAUNCHER_TUBE_HEIGHT - 0.065, 0.24], polymer());
			part("grip", [0.035, 0.16, 0.05], [0, 0.02, 0], polymer());
			part("foregrip", [0.035, 0.12, 0.05], [0, 0.04, -0.28], polymer());
			break;
		default: {
			part("body", [0.04, 0.06, length], [0, 0.035, centreZ]);
			part("grip", [0.03, 0.1, 0.04], [0, -0.03, 0.02], polymer());
			part("stock", [0.035, 0.08, length * 0.25], [0, 0.01, rear - length * 0.12], polymer());
		}
	}
	return root;
}
