import { BLEND_NORMAL, Color, Entity, Mat4, Mesh, PRIMITIVE_TRIANGLES, Quat, SEMANTIC_NORMAL, SEMANTIC_POSITION, StandardMaterial, Vec3, type AppBase, type GraphNode, type MeshInstance, type RenderComponent } from "playcanvas";

import { decals, type DecalHandle, type DecalKind } from "../effects/Decals";
import { applyDent, applySag, refreshNormals } from "./BodyDeform";
import { CarGlass, type GlassHit, type PaneResult } from "./CarGlass";
import type { CarjackRig } from "./Carjack";
import { forgetTriangles } from "./MeshRaycast";
import { BUILDS, dentFor, glassAfter, wear, type GlassState, type VehicleBuild } from "./VehicleDamage";

/**
 * What a crash does to a car's body, as you'd see it: the panel that took the blow dented in,
 * paint scuffed and dulled, glass crazed and then gone, a bumper torn down and hanging, and on
 * models built with separate panels, the bonnet sprung, the boot lid up, doors swinging loose.
 * Bits of glass and trim fly off on a hard hit.
 *
 * Works on any model: the body (the parts merged into one mesh per material by
 * OrionVehicleModel) is dented as a mesh, so it needs no named parts. Cars of a model share one
 * merged mesh, so a car gets its own copy the first time it's dented, and gives it back when it's
 * repaired.
 */

/** Hits closer together than this (s) on one car are one crash (a scrape runs every frame). */
const MIN_HIT_GAP = 0.12;
/** Size of the folds a crumpled panel takes, metres. */
const CRUMPLE_WAVELENGTH = 0.35;
/** An end hit is one within this share of the half-length from the end. */
const END_ZONE = 0.45;

/** Names of panels that can come loose, when a model has them as separate parts. */
const LOOSE_PART = /hood|bonnet|trunk|tailgate|bumper|door/i;
const NOT_LOOSE = /handle|win|glass|inner|jamb|sill|light|lamp|badge|plate|mirror/i;

/** A panel that can hang loose: kept out of the merged body so it can swing. */
export function isLoosePart(node: GraphNode): boolean {
	return LOOSE_PART.test(node.name) && !NOT_LOOSE.test(node.name);
}

type PartKind = "hood" | "trunk" | "bumper" | "door";

interface LoosePart {
	entity: Entity;
	kind: PartKind;
	/** Which end or side of the car it's on: +1 front/left, -1 rear/right. */
	end: 1 | -1;
	side: 1 | -1;
	/** Hinge point and axis in the part's parent's space. */
	hinge: Vec3;
	axis: Vec3;
	localPosition: Vec3;
	localRotation: Quat;
	/** Swing (degrees), its speed, and where it hangs once loose (0 = still attached). */
	angle: number;
	velocity: number;
	hang: number;
}

interface Deformable {
	instance: MeshInstance;
	shared: Mesh;
	mesh: Mesh;
	positions: Float32Array;
	rest: Float32Array;
	normals: Float32Array;
	indices: number[];
	/** Rest extents along the car's own axes, in mesh space. */
	along: [number, number];
	up: [number, number];
	across: [number, number];
}

let crazedGlass: StandardMaterial | null = null;
let chipMaterial: StandardMaterial | null = null;

/** Bullet holes and soot kept on one car; the oldest goes as the next is made. */
const MAX_MARKS = 28;

/** Crazed safety glass: frosted white, nearly opaque, still a little glossy. */
export function crackedGlassMaterial(): StandardMaterial {
	if (crazedGlass) return crazedGlass;
	crazedGlass = new StandardMaterial();
	crazedGlass.name = "crazed-glass";
	crazedGlass.diffuse = new Color(0.78, 0.82, 0.84);
	crazedGlass.opacity = 0.82;
	crazedGlass.blendType = BLEND_NORMAL;
	crazedGlass.depthWrite = false;
	crazedGlass.gloss = 0.55;
	crazedGlass.update();
	return crazedGlass;
}

/** Plastic and trim chips: dark grey, a little shiny. */
function debrisMaterial(): StandardMaterial {
	if (chipMaterial) return chipMaterial;
	chipMaterial = new StandardMaterial();
	chipMaterial.name = "crash-debris";
	chipMaterial.diffuse = new Color(0.12, 0.12, 0.13);
	chipMaterial.gloss = 0.5;
	chipMaterial.update();
	return chipMaterial;
}

function cloneMesh(app: AppBase, source: Mesh): { mesh: Mesh; positions: Float32Array; normals: Float32Array; indices: number[] } | null {
	const buffer = source.vertexBuffer;
	if (!buffer) return null;
	const count = buffer.numVertices;
	const mesh = new Mesh(app.graphicsDevice);
	let positions: Float32Array | null = null;
	let normals: Float32Array | null = null;
	for (const element of buffer.format.elements) {
		const data: number[] = [];
		source.getVertexStream(element.name, data);
		if (data.length < count * element.numComponents) return null;
		mesh.setVertexStream(element.name, data, element.numComponents, count, element.dataType, element.normalize, element.asInt);
		if (element.name === SEMANTIC_POSITION) positions = new Float32Array(data);
		if (element.name === SEMANTIC_NORMAL) normals = new Float32Array(data);
	}
	const indices: number[] = [];
	source.getIndices(indices);
	if (!positions || !normals || indices.length === 0) return null;
	mesh.setIndices(indices);
	mesh.update(PRIMITIVE_TRIANGLES);
	return { mesh, positions, normals, indices };
}

export interface CrashHit {
	/** Point of contact in world space, and the direction of the blow into the body. */
	x: number;
	y: number;
	z: number;
	dirX: number;
	dirZ: number;
	deltaV: number;
	/** Condition lost so far in all (100 - integrity), including this hit. */
	lost: number;
}

export class BodyDamage {
	private deformables: Deformable[] | null = null;
	/** The windows, pane by pane (see CarGlass). */
	public readonly glassPanes: CarGlass;
	/** How far crashes have got with the glass as a whole (crazed, then out). */
	private glass: GlassState = "intact";
	/** Bullet holes and soot on the body. */
	private readonly marks: DecalHandle[] = [];
	private sootLevel = 0;
	private parts: LoosePart[] = [];
	private sinceHit = Infinity;
	private wearLevel = 0;
	/** Each paint material's own colour, gloss and lacquer before it was worn. */
	private readonly paintBase = new Map<StandardMaterial, { diffuse: Color; gloss: number; clearCoat: number }>();
	private readonly inverse = new Mat4();
	private readonly point = new Vec3();
	private readonly dir = new Vec3();
	private readonly swing = new Quat();
	private readonly scratch = new Vec3();
	private readonly carInverse = new Mat4();

	public constructor(
		private readonly app: AppBase,
		/** The car's own entity: +Z forward, +X left, +Y up. */
		private readonly car: Entity,
		/** The merged body (dented), and the model it belongs to. */
		private readonly body: Entity | null,
		model: Entity,
		private readonly build: VehicleBuild,
		private readonly paint: () => readonly StandardMaterial[],
		private readonly carjack: () => CarjackRig | null,
		batchGroupId: number | null,
		/** Holds the car's marks: moves with the body, hidden with it at a distance. */
		private readonly decalOwner: Entity,
		groundY: () => number,
		velocity: () => { x: number; z: number },
	) {
		this.glassPanes = new CarGlass(app, model, decalOwner, groundY, velocity, crackedGlassMaterial, batchGroupId);
		this.findParts(model);
	}

	/** Anything to put right. */
	public get damaged(): boolean {
		return this.deformables !== null || this.glass !== "intact" || this.glassPanes.damaged || this.wearLevel > 0 || this.sootLevel > 0
			|| this.marks.length > 0 || this.parts.some((part) => part.hang !== 0);
	}

	/** The nearest unbroken pane along a unit world ray (see CarGlass.raycast). */
	public raycastGlass(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number, out: GlassHit): boolean {
		return this.glassPanes.raycast(ox, oy, oz, dx, dy, dz, maxDistance, out);
	}

	/** A round into a pane (see CarGlass.shoot). */
	public shootGlass(pane: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number, damage: number): PaneResult {
		return this.glassPanes.shoot(pane, x, y, z, nx, ny, nz, dx, dy, dz, damage);
	}

	/** A mark on the body where a round struck: a hole through the paint, a scuff on a tyre. */
	public mark(kind: DecalKind, x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number): void {
		const layer = decals(this.app);
		if (this.marks.length >= MAX_MARKS) layer.release(this.marks.shift()!);
		this.marks.push(layer.place(kind, this.decalOwner, x, y, z, nx, ny, nz, size));
	}

	/**
	 * Fire damage that stays after the flames: the paint blistered dark and dull, with soot laid
	 * over the surfaces the fire licked (`spots`: points on the body and their normals). `level`
	 * 0..1 only ever goes up.
	 */
	public soot(level: number, spots: readonly { x: number; y: number; z: number; nx: number; ny: number; nz: number; size: number }[]): void {
		if (level <= this.sootLevel + 0.02) return;
		this.sootLevel = level;
		for (const material of this.paint()) {
			let base = this.paintBase.get(material);
			if (!base) {
				base = { diffuse: material.diffuse.clone(), gloss: material.gloss, clearCoat: material.clearCoat };
				this.paintBase.set(material, base);
			}
			const worn = Math.max(this.wearLevel, level);
			const darken = 1 - level * 0.72;
			// Scorched paint goes brown-black before it goes black.
			material.diffuse = new Color(
				base.diffuse.r * darken * 0.95 + 0.03 * level,
				base.diffuse.g * darken * 0.85 + 0.02 * level,
				base.diffuse.b * darken * 0.75 + 0.015 * level,
			);
			material.clearCoat = base.clearCoat * Math.max(0, 1 - worn * 1.2);
			material.gloss = base.gloss * (1 - level * 0.7);
			material.update();
		}
		const layer = decals(this.app);
		for (const spot of spots) {
			if (this.marks.length >= MAX_MARKS) layer.release(this.marks.shift()!);
			this.marks.push(layer.place("soot", this.decalOwner, spot.x, spot.y, spot.z, spot.nx, spot.ny, spot.nz, spot.size, { opacity: 0.55 + level * 0.4 }));
		}
	}

	/** Every window out (the car going up, a blast). */
	public shatterGlass(x: number, y: number, z: number): void {
		this.glassPanes.shatterAll(x, y, z);
		this.glass = "shattered";
	}

	/** Takes a crash. */
	public hit(hit: CrashHit): void {
		if (this.sinceHit < MIN_HIT_GAP) return;
		const dent = dentFor(hit.deltaV, this.build);
		if (!dent) return;
		this.sinceHit = 0;
		const spec = BUILDS[this.build];

		// Where on the car: front, back or side, and which side.
		this.carInverse.copy(this.car.getWorldTransform()).invert();
		const local = this.carInverse.transformPoint(this.point.set(hit.x, hit.y, hit.z), this.scratch);
		const halfLength = this.halfLength();
		const end = local.z > halfLength * (1 - END_ZONE) ? 1 : local.z < -halfLength * (1 - END_ZONE) ? -1 : 0;
		const side: 1 | -1 = local.x >= 0 ? 1 : -1;
		const across = local.x;

		this.dentBody(hit, dent, end, across, hit.deltaV >= spec.sagDeltaV);
		this.loosen(end, side, hit.deltaV, hit.lost);
		this.crackGlass(hit);
		this.wearPaint(hit.lost);
		this.throwDebris(hit, dent.depth);
	}

	/** Swings the loose panels with the car's motion. */
	public update(dt: number, acceleration: number, turnRate: number): void {
		this.sinceHit += dt;
		for (const part of this.parts) {
			if (part.hang === 0 && part.angle === 0) continue;
			// A sprung pendulum about its hinge, kicked by braking, accelerating and turning.
			const drive = part.kind === "door" ? -acceleration * 6 * part.end + turnRate * 40 * part.side : part.kind === "bumper" ? acceleration * 3 * part.end : -acceleration * 4;
			const stiffness = part.kind === "door" ? 18 : 40;
			const accel = -stiffness * (part.angle - part.hang) - 4 * part.velocity + drive;
			part.velocity += accel * dt;
			part.angle += part.velocity * dt;
			this.pose(part);
		}
	}

	/** Back to factory condition (a recycled or repaired car). */
	public reset(): void {
		if (this.deformables) {
			for (const entry of this.deformables) {
				entry.instance.mesh = entry.shared;
				entry.mesh.destroy();
			}
			this.deformables = null;
		}
		this.glassPanes.reset();
		this.glass = "intact";
		const layer = decals(this.app);
		for (const mark of this.marks) layer.release(mark);
		this.marks.length = 0;
		this.sootLevel = 0;
		for (const part of this.parts) {
			part.angle = 0;
			part.velocity = 0;
			part.hang = 0;
			part.entity.setLocalPosition(part.localPosition);
			part.entity.setLocalRotation(part.localRotation);
		}
		this.wearLevel = 0;
		for (const [material, base] of this.paintBase) {
			material.diffuse = base.diffuse.clone();
			material.gloss = base.gloss;
			material.clearCoat = base.clearCoat;
			material.update();
		}
		this.paintBase.clear();
	}

	private halfLength(): number {
		const script = this.car.script?.get("orionVehicle") as unknown as { halfLength?: number } | undefined;
		return script?.halfLength ?? 2.2;
	}

	// ---- Dents ---------------------------------------------------------------------------------

	private ensureDeformables(): Deformable[] {
		if (this.deformables) return this.deformables;
		const result: Deformable[] = [];
		const render = this.body?.render as RenderComponent | undefined;
		if (render) {
			const toMesh = this.inverse.copy(this.body!.getWorldTransform()).invert();
			const carMatrix = this.car.getWorldTransform();
			const forward = toMesh.transformVector(carMatrix.getZ(new Vec3()), new Vec3()).normalize();
			const up = toMesh.transformVector(carMatrix.getY(new Vec3()), new Vec3()).normalize();
			const side = toMesh.transformVector(carMatrix.getX(new Vec3()), new Vec3()).normalize();
			for (const instance of render.meshInstances) {
				const shared = instance.mesh;
				const copy = cloneMesh(this.app, shared);
				if (!copy) continue;
				instance.mesh = copy.mesh;
				const range = (axis: Vec3): [number, number] => {
					let min = Infinity;
					let max = -Infinity;
					for (let i = 0; i < copy.positions.length; i += 3) {
						const d = copy.positions[i] * axis.x + copy.positions[i + 1] * axis.y + copy.positions[i + 2] * axis.z;
						min = Math.min(min, d);
						max = Math.max(max, d);
					}
					return [min, max];
				};
				result.push({
					instance,
					shared,
					mesh: copy.mesh,
					positions: copy.positions,
					rest: copy.positions.slice(),
					normals: copy.normals,
					indices: copy.indices,
					along: range(forward),
					up: range(up),
					across: range(side),
				});
			}
		}
		this.deformables = result;
		return result;
	}

	private dentBody(hit: CrashHit, dent: { depth: number; radius: number; crumple: number }, end: number, across: number, sag: boolean): void {
		if (!this.body) return;
		const entries = this.ensureDeformables();
		if (entries.length === 0) return;
		const toMesh = this.inverse.copy(this.body.getWorldTransform()).invert();
		const worldScale = this.body.getWorldTransform().getScale(this.scratch).x || 1;
		const point = toMesh.transformPoint(this.point.set(hit.x, hit.y, hit.z), new Vec3());
		const direction = toMesh.transformVector(this.dir.set(hit.dirX, 0, hit.dirZ), new Vec3()).normalize();
		const carMatrix = this.car.getWorldTransform();
		const forward = toMesh.transformVector(carMatrix.getZ(new Vec3()), new Vec3()).normalize();
		const up = toMesh.transformVector(carMatrix.getY(new Vec3()), new Vec3()).normalize();
		const side = toMesh.transformVector(carMatrix.getX(new Vec3()), new Vec3()).normalize();
		const maxDent = BUILDS[this.build].maxDent / worldScale;
		const seed = Math.floor(Math.random() * 1e6);
		for (const entry of entries) {
			const moved = new Set<number>(applyDent(entry.positions, entry.rest, {
				point: [point.x, point.y, point.z],
				direction: [direction.x, direction.y, direction.z],
				depth: dent.depth / worldScale,
				radius: dent.radius / worldScale,
				crumple: dent.crumple,
				wavelength: CRUMPLE_WAVELENGTH / worldScale,
				seed,
			}, maxDent));
			if (sag && end !== 0) {
				const length = entry.along[1] - entry.along[0];
				const height = entry.up[1] - entry.up[0];
				for (const index of applySag(entry.positions, entry.rest, {
					forward: [forward.x, forward.y, forward.z],
					up: [up.x, up.y, up.z],
					side: [side.x, side.y, side.z],
					end: end as 1 | -1,
					hitAcross: across / worldScale,
					drop: Math.min(0.22, 0.05 + (hit.deltaV - BUILDS[this.build].sagDeltaV) * 0.012) / worldScale,
					reach: Math.min(length * 0.14, 0.7 / worldScale),
					band: Math.min(height * 0.32, 0.55 / worldScale),
					alongRange: entry.along,
					upRange: entry.up,
					acrossRange: entry.across,
				}, maxDent)) moved.add(index);
			}
			if (moved.size === 0) continue;
			const list = [...moved];
			refreshNormals(entry.positions, entry.normals, entry.indices, list);
			entry.mesh.setPositions(entry.positions);
			entry.mesh.setNormals(entry.normals);
			entry.mesh.update(PRIMITIVE_TRIANGLES);
			// Rounds now strike the dented panel where it is.
			forgetTriangles(entry.mesh);
		}
	}

	// ---- Glass ---------------------------------------------------------------------------------

	/** Crashes craze the glass, and then knock it out (see VehicleDamage.glassAfter). */
	private crackGlass(hit: CrashHit): void {
		const next = glassAfter(this.glass, hit.deltaV, hit.lost, this.build);
		if (next === this.glass) return;
		this.glass = next;
		this.glassPanes.crash(next === "shattered" ? "shattered" : "cracked", hit.x, hit.y + 0.4, hit.z, hit.dirX, hit.dirZ);
	}

	// ---- Paint ---------------------------------------------------------------------------------

	private wearPaint(lost: number): void {
		const level = wear(lost);
		if (level <= this.wearLevel + 0.02) return;
		this.wearLevel = level;
		// Scuffed and dulled: the lacquer goes first, then the colour loses its depth.
		for (const material of this.paint()) {
			let base = this.paintBase.get(material);
			if (!base) {
				base = { diffuse: material.diffuse.clone(), gloss: material.gloss, clearCoat: material.clearCoat };
				this.paintBase.set(material, base);
			}
			material.clearCoat = base.clearCoat * Math.max(0, 1 - level * 0.9);
			material.gloss = base.gloss * (1 - level * 0.5);
			const darken = 1 - level * 0.28;
			material.diffuse = new Color(base.diffuse.r * darken, base.diffuse.g * darken, base.diffuse.b * darken);
			material.update();
		}
	}

	// ---- Debris --------------------------------------------------------------------------------

	private throwDebris(hit: CrashHit, depth: number): void {
		if (depth < 0.06) return;
		const count = Math.min(14, Math.round(depth * 40));
		const material = this.paint()[0] ?? debrisMaterial();
		const carjack = this.carjack();
		if (!carjack) return;
		// Paint chips and trim, back the way the blow came.
		carjack.spray(this.point.set(hit.x, hit.y, hit.z), -hit.dirX, -hit.dirZ, Math.ceil(count * 0.6), material, 0.07);
		carjack.spray(this.point.set(hit.x, hit.y - 0.2, hit.z), -hit.dirX, -hit.dirZ, Math.floor(count * 0.4), debrisMaterial(), 0.09);
	}

	// ---- Loose panels --------------------------------------------------------------------------

	private findParts(model: Entity): void {
		this.carInverse.copy(this.car.getWorldTransform()).invert();
		const candidates = model.find(isLoosePart) as Entity[];
		for (const entity of candidates) {
			// Only the outermost match: its children move with it.
			if (candidates.some((other) => other !== entity && isAncestor(other, entity))) continue;
			const bounds = this.carBounds(entity);
			if (!bounds) continue;
			const name = entity.name.toLowerCase();
			const kind: PartKind = /hood|bonnet/.test(name) ? "hood" : /trunk|tailgate/.test(name) ? "trunk" : /bumper/.test(name) ? "bumper" : "door";
			const centreZ = (bounds.min.z + bounds.max.z) / 2;
			const centreX = (bounds.min.x + bounds.max.x) / 2;
			const end: 1 | -1 = centreZ >= 0 ? 1 : -1;
			const side: 1 | -1 = centreX >= 0 ? 1 : -1;
			// Hinge and axis in car space, by kind.
			let hinge: Vec3;
			let axis: Vec3;
			// Axes chosen so a positive angle opens the panel the way it would: a bonnet's front edge
			// and a boot lid's back edge rise, a door's back edge swings out from the body.
			if (kind === "hood") {
				hinge = new Vec3(centreX, bounds.max.y, bounds.min.z); // rear edge
				axis = new Vec3(-1, 0, 0);
			} else if (kind === "trunk") {
				hinge = new Vec3(centreX, bounds.max.y, bounds.max.z); // front edge
				axis = new Vec3(1, 0, 0);
			} else if (kind === "bumper") {
				hinge = new Vec3(bounds.min.x, (bounds.min.y + bounds.max.y) / 2, centreZ); // right-hand end; a negative angle drops the left
				axis = new Vec3(0, 0, 1);
			} else {
				hinge = new Vec3(centreX, (bounds.min.y + bounds.max.y) / 2, bounds.max.z); // front edge
				axis = new Vec3(0, -side, 0);
			}
			// Into the part's parent's space, where its local transform lives.
			const parent = entity.parent as Entity | null;
			if (!parent) continue;
			const toParent = new Mat4().copy(parent.getWorldTransform()).invert().mul(this.car.getWorldTransform());
			this.parts.push({
				entity,
				kind,
				end,
				side,
				hinge: toParent.transformPoint(hinge, new Vec3()),
				axis: toParent.transformVector(axis, new Vec3()).normalize(),
				localPosition: entity.getLocalPosition().clone(),
				localRotation: entity.getLocalRotation().clone(),
				angle: 0,
				velocity: 0,
				hang: 0,
			});
		}
	}

	/** A node's bounds in car space. */
	private carBounds(node: GraphNode): { min: Vec3; max: Vec3 } | null {
		const min = new Vec3(Infinity, Infinity, Infinity);
		const max = new Vec3(-Infinity, -Infinity, -Infinity);
		const corner = new Vec3();
		let any = false;
		const toCar = new Mat4();
		node.forEach((child) => {
			const render = (child as Entity).render;
			if (!render) return;
			for (const instance of render.meshInstances) {
				toCar.mul2(this.carInverse, instance.node.getWorldTransform());
				const { center, halfExtents } = instance.mesh.aabb;
				for (let i = 0; i < 8; i++) {
					corner.set(center.x + (i & 1 ? halfExtents.x : -halfExtents.x), center.y + (i & 2 ? halfExtents.y : -halfExtents.y), center.z + (i & 4 ? halfExtents.z : -halfExtents.z));
					toCar.transformPoint(corner, corner);
					min.min(corner);
					max.max(corner);
					any = true;
				}
			}
		});
		return any ? { min, max } : null;
	}

	/** Knocks loose the panels near the blow: how far each hangs grows with the damage. */
	private loosen(end: number, side: 1 | -1, deltaV: number, lost: number): void {
		for (const part of this.parts) {
			const near = part.kind === "door" ? end === 0 && part.side === side : end !== 0 && part.end === end;
			if (!near && !(lost > 70 && Math.random() < 0.3)) continue;
			const severity = Math.min(1, Math.max(0, (deltaV - 8) / 18) + lost / 160);
			if (severity <= 0.05) continue;
			const limit = part.kind === "hood" ? 32 : part.kind === "trunk" ? 40 : part.kind === "bumper" ? 14 : 55;
			const hang = limit * severity;
			if (Math.abs(hang) <= Math.abs(part.hang)) continue;
			// Bumpers drop at the free end; everything else swings open.
			part.hang = part.kind === "bumper" ? -hang : hang;
			part.velocity += (part.hang - part.angle) * 6;
		}
	}

	private pose(part: LoosePart): void {
		this.swing.setFromAxisAngle(part.axis, part.angle);
		const offset = this.scratch.sub2(part.localPosition, part.hinge);
		this.swing.transformVector(offset, offset);
		part.entity.setLocalPosition(offset.add(part.hinge));
		part.entity.setLocalRotation(new Quat().mul2(this.swing, part.localRotation));
	}
}

function isAncestor(ancestor: GraphNode, node: GraphNode): boolean {
	for (let current = node.parent; current; current = current.parent) if (current === ancestor) return true;
	return false;
}
