import {
	BLEND_NONE,
	Mesh,
	Entity,
	MeshInstance,
	PRIMITIVE_TRIANGLES,
	Vec3,
	type AppBase,
	type RenderComponent,
	type StandardMaterial,
} from "playcanvas";

import { playAt } from "../audio/SoundBank";
import { combatAudio } from "../combat/CombatAudio";
import { decals, type DecalHandle } from "../effects/Decals";
import { glassShards } from "../effects/GlassShards";
import { carPaneKind, crackSize, hitPane, newPane, worsenPane, type PaneKind, type PaneOutcome, type PaneStage, type PaneState } from "./GlassDamage";
import { connectedPatches, rayInstance, triangleData, type InstanceHit } from "./MeshRaycast";

/**
 * A car's windows, pane by pane. Each window keeps its own state (see GlassDamage): a round
 * stars it where it went in, more rounds spread the cracks (a windscreen crazes all over), and
 * enough of them bring it down — the pane goes, a burst of glass flies out and lands on the road,
 * the frame stands empty. It stays that way until the car is repaired or recycled.
 *
 * Glass parts are often several panes in one mesh (both rear quarter-lights, a bus's row of side
 * windows), so on the first damage each such part is split into one mesh per pane (connected
 * patches of triangles) and taken out of the car's batch so a pane can change on its own.
 */

/** Crack stars kept on one pane; past this the oldest goes as the next is added. */
const MAX_CRACKS_PER_PANE = 7;
/** Crumbs of glass on the road under a broken window stay this long (s). */
const CRUMBS_LIFE = 90;

interface Source {
	instance: MeshInstance;
	render: RenderComponent;
	kind: PaneKind;
	/** Patch (pane) number per triangle, and the pane for each patch. */
	patch: Uint16Array;
	panes: Pane[];
	/** Per triangle: 1 once its pane is gone, so rays pass through. */
	gone: Uint8Array;
}

interface Pane {
	id: number;
	source: Source;
	patch: number;
	state: PaneState;
	/** What's drawn for the pane once its part is split (the original part until then). */
	view: MeshInstance | null;
	cracks: DecalHandle[];
	/** Its own mesh, if split off (destroyed on reset). */
	mesh: Mesh | null;
}

export interface GlassHit {
	distance: number;
	pane: number;
	nx: number;
	ny: number;
	nz: number;
}

/** What a pane hit was, for the caller (the sound of a shattering pane is played here). */
export interface PaneResult {
	outcome: PaneOutcome;
	kind: PaneKind;
}

const scratchHit: InstanceHit = { distance: 0, tri: 0, nx: 0, ny: 0, nz: 0 };
const point = new Vec3();

export class CarGlass {
	private readonly sources: Source[] = [];
	private readonly panes: Pane[] = [];
	private split = false;
	private readonly originalMaterials = new Map<MeshInstance, StandardMaterial | null>();
	/** Render components taken out of the batch, and their group. */
	private unbatched: { render: RenderComponent; group: number }[] = [];
	/** Entities holding the split panes (one per glass part that holds several), and the originals they stand in for. */
	private splitParts: { holder: Entity; original: MeshInstance }[] = [];

	public constructor(
		private readonly app: AppBase,
		model: Entity,
		/** Where the crack decals hang (moves with the car, hidden at far detail). */
		private readonly decalOwner: Entity,
		/** Road height under the car, for falling glass. */
		private readonly groundY: () => number,
		/** The car's velocity, carried by glass leaving it. */
		private readonly velocity: () => { x: number; z: number },
		private readonly crazedMaterial: () => StandardMaterial,
		private readonly batchGroupId: number | null,
	) {
		for (const render of model.findComponents("render") as RenderComponent[]) {
			// The simplified far-away bodies carry glass too, but nobody shoots at those.
			if (/lod/i.test(render.entity.name)) continue;
			for (const instance of render.meshInstances) {
				const material = instance.material as StandardMaterial | null;
				if (!material || material.blendType === BLEND_NONE || !/glass|window|windshield|windscreen/i.test(material.name ?? "")) continue;
				if (/light|lamp|lens|mirror/i.test(`${material.name} ${instance.node.name}`)) continue;
				const data = triangleData(instance.mesh);
				if (!data) continue;
				// A windscreen or rear screen is one sheet however it was modelled (often two mirrored
				// halves); a part of side windows is one pane per window.
				const whole = /windscreen|windshield|rear-glass/i.test(instance.node.name);
				const { patch, count } = whole ? { patch: new Uint16Array(data.indices.length / 3), count: 1 } : connectedPatches(data);
				const source: Source = { instance, render, kind: carPaneKind(instance.node.name), patch, panes: [], gone: new Uint8Array(patch.length) };
				for (let p = 0; p < count; p++) {
					const pane: Pane = { id: this.panes.length, source, patch: p, state: newPane(), view: null, cracks: [], mesh: null };
					source.panes.push(pane);
					this.panes.push(pane);
				}
				this.sources.push(source);
			}
		}
	}

	public get count(): number {
		return this.panes.length;
	}

	public get damaged(): boolean {
		return this.panes.some((pane) => pane.state.stage !== "intact");
	}

	/** The nearest unbroken pane a unit ray meets within `maxDistance`. */
	public raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number, out: GlassHit): boolean {
		let found = false;
		let best = maxDistance;
		for (const source of this.sources) {
			if (!source.render.enabled || !source.render.entity.enabled) continue;
			if (!rayInstance(ox, oy, oz, dx, dy, dz, best, source.instance, scratchHit, source.gone)) continue;
			best = scratchHit.distance;
			found = true;
			out.distance = scratchHit.distance;
			out.pane = source.panes[source.patch[scratchHit.tri]].id;
			out.nx = scratchHit.nx;
			out.ny = scratchHit.ny;
			out.nz = scratchHit.nz;
		}
		return found;
	}

	/**
	 * A round into pane `id` at (x, y, z), surface normal (nx, ny, nz), travelling (dx, dy, dz),
	 * doing `damage` (GlassDamage.glassDamage) to the glass.
	 */
	public shoot(id: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number, damage: number): PaneResult {
		const pane = this.panes[id];
		if (!pane) return { outcome: "none", kind: "tempered" };
		const kind = pane.source.kind;
		const outcome = hitPane(pane.state, kind, damage);
		if (outcome === "none") return { outcome, kind };
		this.ensureSplit();
		switch (outcome) {
			case "crack":
			case "spread": {
				this.addCrack(pane, x, y, z, nx, ny, nz);
				combatAudio().play("bulletGlass", x, y, z, 0.7);
				break;
			}
			case "craze": {
				this.addCrack(pane, x, y, z, nx, ny, nz);
				this.craze(pane);
				combatAudio().play("bulletGlass", x, y, z, 0.8);
				break;
			}
			case "shatter":
				this.shatter(pane, x, y, z, dx, dy, dz);
				break;
		}
		return { outcome, kind };
	}

	/**
	 * A crash's effect on the glass: crazed all over, or knocked out, from the point of impact
	 * (x, y, z) in the direction of the blow.
	 */
	public crash(stage: Extract<PaneStage, "cracked" | "shattered">, x: number, y: number, z: number, dirX: number, dirZ: number): void {
		if (this.panes.length === 0) return;
		this.ensureSplit();
		for (const pane of this.panes) {
			const target: PaneStage = stage === "shattered" ? "shattered" : pane.source.kind === "laminated" ? "crazed" : "cracked";
			const outcome = worsenPane(pane.state, pane.source.kind, target);
			if (outcome === "shatter") this.shatter(pane, x, y, z, -dirX, 0, -dirZ, true);
			else if (outcome !== "none") this.craze(pane);
		}
	}

	/**
	 * Breaks the panes whose middle is within `radius` of a point (a carjacker's elbow through the
	 * driver's window). "already" when the glass there is gone, so it isn't broken twice.
	 */
	public smashNear(x: number, y: number, z: number, radius: number): "smashed" | "already" | "none" {
		let result: "smashed" | "already" | "none" = "none";
		for (const pane of this.panes) {
			const centre = this.paneCentre(pane, point);
			if (Math.hypot(centre.x - x, centre.y - y, centre.z - z) > radius) continue;
			if (pane.state.stage === "shattered") {
				if (result === "none") result = "already";
				continue;
			}
			this.ensureSplit();
			worsenPane(pane.state, pane.source.kind, "shattered");
			const dx = x - centre.x;
			const dz = z - centre.z;
			const length = Math.hypot(dx, dz) || 1;
			this.shatter(pane, centre.x, centre.y, centre.z, -dx / length, 0, -dz / length);
			result = "smashed";
		}
		return result;
	}

	/** Every pane out at once (the car going up). */
	public shatterAll(x: number, y: number, z: number): void {
		this.ensureSplit();
		for (const pane of this.panes) {
			if (worsenPane(pane.state, pane.source.kind, "shattered") === "shatter") this.shatter(pane, x, y, z, 0, 1, 0, true);
		}
	}

	/** Factory glass again (a repaired or recycled car). */
	public reset(): void {
		const layer = decals(this.app);
		for (const pane of this.panes) {
			for (const crack of pane.cracks) layer.release(crack);
			pane.cracks.length = 0;
			pane.state = newPane();
			// The pane meshes go with their holder entity below.
			pane.mesh = null;
			pane.view = null;
		}
		for (const source of this.sources) source.gone.fill(0);
		for (const { holder, original } of this.splitParts) {
			holder.destroy();
			original.visible = true;
		}
		this.splitParts = [];
		for (const [instance, material] of this.originalMaterials) {
			if (material) instance.material = material;
			instance.visible = true;
		}
		this.originalMaterials.clear();
		for (const { render, group } of this.unbatched) render.batchGroupId = group;
		this.unbatched = [];
		this.split = false;
	}

	/**
	 * Makes every pane its own drawable: parts holding several panes are cut into one mesh per
	 * pane, and the glass leaves the car's batch (a batch draws all its parts alike).
	 */
	private ensureSplit(): void {
		if (this.split) return;
		this.split = true;
		const renders = new Set(this.sources.map((source) => source.render));
		for (const render of renders) {
			if (render.batchGroupId !== -1) {
				this.unbatched.push({ render, group: render.batchGroupId });
				render.batchGroupId = -1;
			}
		}
		// A part with several panes is hidden and stood in for by its panes, each a mesh of its own,
		// on a child entity in the same place. (Replacing a render's instances outright would have
		// the engine destroy the originals, and their meshes are shared by every car of the model.)
		for (const source of this.sources) {
			if (source.panes.length === 1) {
				source.panes[0].view = source.instance;
				continue;
			}
			const instance = source.instance;
			const views: MeshInstance[] = [];
			for (const pane of source.panes) {
				const mesh = subsetMesh(this.app, instance.mesh, source.patch, pane.patch);
				if (!mesh) continue;
				const view = new MeshInstance(mesh, instance.material);
				pane.mesh = mesh;
				pane.view = view;
				views.push(view);
			}
			if (views.length === 0) continue;
			const holder = new Entity("glass-panes");
			holder.addComponent("render", { meshInstances: views, castShadows: false, receiveShadows: true });
			(instance.node as Entity).addChild(holder);
			instance.visible = false;
			this.splitParts.push({ holder, original: instance });
		}
		if (this.unbatched.length > 0 && this.batchGroupId !== null) this.app.batcher?.markGroupDirty(this.batchGroupId);
	}

	private addCrack(pane: Pane, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
		const layer = decals(this.app);
		// Older stars spread a little as the glass weakens round them.
		for (const crack of pane.cracks) layer.grow(crack, 1.08);
		if (pane.cracks.length >= MAX_CRACKS_PER_PANE) layer.release(pane.cracks.shift()!);
		pane.cracks.push(layer.place("crack", this.decalOwner, x, y, z, nx, ny, nz, crackSize(pane.source.kind, pane.state)));
	}

	private craze(pane: Pane): void {
		const view = pane.view;
		if (!view) return;
		if (!this.originalMaterials.has(view)) this.originalMaterials.set(view, view.material as StandardMaterial | null);
		view.material = this.crazedMaterial();
	}

	private shatter(pane: Pane, x: number, y: number, z: number, dx: number, dy: number, dz: number, quiet = false): void {
		const source = pane.source;
		for (let tri = 0; tri < source.patch.length; tri++) if (source.patch[tri] === pane.patch) source.gone[tri] = 1;
		const layer = decals(this.app);
		for (const crack of pane.cracks) layer.release(crack);
		pane.cracks.length = 0;
		const view = pane.view;
		if (view) {
			if (!this.originalMaterials.has(view)) this.originalMaterials.set(view, view.material as StandardMaterial | null);
			view.visible = false;
		}
		// The pane's middle and size, for where the glass comes from.
		const centre = this.paneCentre(pane, point);
		const spread = this.paneSpread(pane);
		const ground = this.groundY();
		const velocity = this.velocity();
		const tempered = source.kind === "tempered";
		glassShards(this.app).burst({
			x: centre.x, y: centre.y, z: centre.z,
			dirX: dx, dirY: Math.max(dy, -0.2), dirZ: dz,
			spread,
			count: Math.min(tempered ? 44 : 20, Math.round((tempered ? 70 : 30) * spread + 8)),
			floor: ground,
			style: tempered ? "cubes" : "plate",
			carryX: velocity.x,
			carryZ: velocity.z,
		});
		// The glass that lands lies there a while: a glitter of crumbs on the road below.
		layer.place("crumbs", null, centre.x + dx * 0.5, ground, centre.z + dz * 0.5, 0, 1, 0, 0.9 + spread * 1.2, { life: CRUMBS_LIFE });
		if (!quiet || Math.random() < 0.35) playAt("glass", x, y, z, { level: tempered ? 0.5 : 0.7, variation: 0.1, channel: "impacts" });
	}

	private paneCentre(pane: Pane, out: Vec3): Vec3 {
		const data = triangleData(pane.source.instance.mesh);
		const world = pane.source.instance.node.getWorldTransform();
		out.set(0, 0, 0);
		if (!data) return world.getTranslation(out);
		let count = 0;
		const p = data.positions;
		for (let tri = 0; tri < pane.source.patch.length; tri++) {
			if (pane.source.patch[tri] !== pane.patch) continue;
			const a = data.indices[tri * 3] * 3;
			out.x += p[a];
			out.y += p[a + 1];
			out.z += p[a + 2];
			count++;
		}
		if (count > 0) out.mulScalar(1 / count);
		return world.transformPoint(out, out);
	}

	private paneSpread(pane: Pane): number {
		const data = triangleData(pane.source.instance.mesh);
		if (!data) return 0.3;
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		let minZ = Infinity;
		let maxZ = -Infinity;
		const p = data.positions;
		for (let tri = 0; tri < pane.source.patch.length; tri++) {
			if (pane.source.patch[tri] !== pane.patch) continue;
			for (let k = 0; k < 3; k++) {
				const v = data.indices[tri * 3 + k] * 3;
				minX = Math.min(minX, p[v]);
				maxX = Math.max(maxX, p[v]);
				minY = Math.min(minY, p[v + 1]);
				maxY = Math.max(maxY, p[v + 1]);
				minZ = Math.min(minZ, p[v + 2]);
				maxZ = Math.max(maxZ, p[v + 2]);
			}
		}
		const scale = pane.source.instance.node.getWorldTransform().getScale(point).x || 1;
		return Math.min(0.9, Math.max(0.12, (Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2) * scale));
	}
}

/** A copy of `source` holding only the triangles of one patch (same vertices, fewer indices). */
function subsetMesh(app: AppBase, source: Mesh, patch: Uint16Array, keep: number): Mesh | null {
	const buffer = source.vertexBuffer;
	if (!buffer) return null;
	const count = buffer.numVertices;
	const mesh = new Mesh(app.graphicsDevice);
	for (const element of buffer.format.elements) {
		const data: number[] = [];
		source.getVertexStream(element.name, data);
		if (data.length < count * element.numComponents) return null;
		mesh.setVertexStream(element.name, data, element.numComponents, count, element.dataType, element.normalize, element.asInt);
	}
	const all: number[] = [];
	source.getIndices(all);
	const indices: number[] = [];
	for (let tri = 0; tri < patch.length; tri++) {
		if (patch[tri] === keep) indices.push(all[tri * 3], all[tri * 3 + 1], all[tri * 3 + 2]);
	}
	if (indices.length === 0) return null;
	mesh.setIndices(indices);
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}
