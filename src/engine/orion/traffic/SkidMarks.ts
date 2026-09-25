import { BLEND_NORMAL, CULLFACE_NONE, Entity, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, StandardMaterial, type AppBase } from "playcanvas";

/**
 * Tyre marks left on the road while a car slides. Every mark in the world lives in one
 * dynamic mesh: a ring buffer of quads, so the oldest marks are overwritten rather than the
 * scene growing without bound.
 */

const MAX_SEGMENTS = 900;
/** A new quad is laid each time a tyre has moved this far. */
const SEGMENT_LENGTH = 0.35;
/** Lift off the road so the marks don't flicker against it. */
const LIFT = 0.012;
const MAX_ALPHA = 200;

interface TrailEnd {
	x: number;
	y: number;
	z: number;
	/** Half-width offset of the tyre, perpendicular to travel. */
	sx: number;
	sz: number;
	alpha: number;
}

class SkidMarkLayer {
	private readonly positions = new Float32Array(MAX_SEGMENTS * 12);
	private readonly colours = new Uint8Array(MAX_SEGMENTS * 16);
	private readonly mesh: Mesh;
	private readonly trails = new Map<string, TrailEnd>();
	private next = 0;
	private dirty = false;

	public constructor(app: AppBase) {
		const normals = new Float32Array(MAX_SEGMENTS * 12);
		const indices = new Uint16Array(MAX_SEGMENTS * 6);
		for (let i = 0; i < MAX_SEGMENTS; i++) {
			for (let v = 0; v < 4; v++) normals[(i * 4 + v) * 3 + 1] = 1;
			const base = i * 4;
			indices.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], i * 6);
		}
		this.mesh = new Mesh(app.graphicsDevice);
		this.mesh.setPositions(this.positions);
		this.mesh.setNormals(normals);
		this.mesh.setColors32(this.colours);
		this.mesh.setIndices(indices);
		this.mesh.update(PRIMITIVE_TRIANGLES, false);

		const material = new StandardMaterial();
		material.diffuse.set(0.03, 0.03, 0.03);
		material.gloss = 0.2;
		material.opacityVertexColor = true;
		material.opacityVertexColorChannel = "a";
		material.blendType = BLEND_NORMAL;
		material.depthWrite = false;
		material.cull = CULLFACE_NONE;
		material.update();

		const instance = new MeshInstance(this.mesh, material);
		// The buffer covers the whole city, so bounds-based culling would only ever get it wrong.
		instance.cull = false;
		const entity = new Entity("skid-marks");
		entity.addComponent("render", { meshInstances: [instance], castShadows: false, receiveShadows: true });
		app.root.addChild(entity);
	}

	/**
	 * Continues the mark for one tyre. `strength` 0 lifts the tyre off the road, ending the
	 * trail; above 0 lays rubber whose darkness follows the strength.
	 */
	public track(key: string, x: number, y: number, z: number, width: number, strength: number) {
		if (strength <= 0) {
			this.trails.delete(key);
			return;
		}
		const last = this.trails.get(key);
		const alpha = Math.round(Math.min(1, strength) * MAX_ALPHA);
		if (!last) {
			this.trails.set(key, { x, y, z, sx: 0, sz: 0, alpha });
			return;
		}
		const dx = x - last.x;
		const dz = z - last.z;
		const length = Math.hypot(dx, dz);
		if (length < SEGMENT_LENGTH) return;
		// A long jump means the car was teleported or recycled: start a fresh trail.
		if (length > 4) {
			this.trails.set(key, { x, y, z, sx: 0, sz: 0, alpha });
			return;
		}
		const sx = (-dz / length) * width * 0.5;
		const sz = (dx / length) * width * 0.5;
		// Join onto the previous quad's end so the trail has no gaps at bends.
		const startSx = last.sx || sx;
		const startSz = last.sz || sz;
		this.writeSegment(
			[last.x - startSx, last.y + LIFT, last.z - startSz],
			[last.x + startSx, last.y + LIFT, last.z + startSz],
			[x - sx, y + LIFT, z - sz],
			[x + sx, y + LIFT, z + sz],
			last.alpha,
			alpha,
		);
		this.trails.set(key, { x, y, z, sx, sz, alpha });
	}

	/** Pushes this frame's new marks to the GPU. */
	public flush() {
		if (!this.dirty) return;
		this.dirty = false;
		this.mesh.setPositions(this.positions);
		this.mesh.setColors32(this.colours);
		this.mesh.update(PRIMITIVE_TRIANGLES, false);
	}

	private writeSegment(a: number[], b: number[], c: number[], d: number[], alphaStart: number, alphaEnd: number) {
		const offset = this.next * 12;
		this.positions.set(a, offset);
		this.positions.set(b, offset + 3);
		this.positions.set(c, offset + 6);
		this.positions.set(d, offset + 9);
		const colourOffset = this.next * 16;
		for (let v = 0; v < 4; v++) {
			this.colours.set([10, 10, 10, v < 2 ? alphaStart : alphaEnd], colourOffset + v * 4);
		}
		this.next = (this.next + 1) % MAX_SEGMENTS;
		this.dirty = true;
	}
}

const layers = new WeakMap<AppBase, SkidMarkLayer>();

export function skidMarks(app: AppBase): SkidMarkLayer {
	let layer = layers.get(app);
	if (!layer) {
		layer = new SkidMarkLayer(app);
		layers.set(app, layer);
	}
	return layer;
}
