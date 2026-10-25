import {
	calculateNormals,
	Entity,
	Mat4,
	Mesh,
	MeshInstance,
	PRIMITIVE_TRIANGLES,
	Quat,
	SEMANTIC_COLOR,
	SEMANTIC_NORMAL,
	SEMANTIC_POSITION,
	Vec3,
	type AppBase,
	type RenderComponent,
} from "playcanvas";

import { estimateRimRadius, radial, sagPoint, tyreTriangles } from "./FlatTyreGeometry";

/**
 * One wheel's flat tyre, as the player sees it. The wheel model is one spinning mesh, rim and
 * tyre together; once its tyre is holed that mesh is cut in two. The rim (and hub, brake) stays
 * on the spinning wheel; the tyre moves to a mesh of its own that turns with the steering but
 * doesn't spin, so its sag stays where the road is. The sag itself follows the air going out:
 * the tread drops towards the rim, flattens against the road and the sidewalls bulge (see
 * FlatTyreGeometry). Restoring puts the original wheel back exactly as it was.
 *
 * Built only for a wheel that's actually punctured: a city of cars costs nothing for this.
 */

/** Re-shape the tyre only when the air has moved on by this much. */
const RESHAPE_STEP = 0.04;

interface Part {
	instance: MeshInstance;
	original: Mesh;
	/** The rim-only replacement (null if the whole part was tyre and is hidden instead). */
	rim: Mesh | null;
}

export class FlatTyre {
	public readonly entity: Entity;
	private readonly parts: Part[] = [];
	/** Each tyre mesh, with its vertices at rest in the wheel frame (a, y, z) and its triangles. */
	private readonly shapes: { mesh: Mesh; frame: Float32Array; indices: number[] }[] = [];
	private tyreRadius = 0;
	private rimRadius = 0;
	private shown = -1;
	private readonly scratch: number[] = [0, 0, 0];
	private readonly turn = new Quat();

	/**
	 * `pivot` is the spinning wheel; `model` the car's model entity, whose axes are the car's (+X
	 * left, +Y up, +Z forward) and under which the tyre is hung.
	 */
	public constructor(app: AppBase, private readonly pivot: Entity, model: Entity) {
		this.entity = new Entity("flat-tyre");
		model.addChild(this.entity);
		const toModel = new Mat4().copy(model.getWorldTransform()).invert();
		const centre = toModel.transformPoint(pivot.getPosition(), new Vec3());
		this.entity.setLocalPosition(centre);

		// Every vertex of the wheel in the wheel frame (model axes, centred on the wheel).
		const toWheel = new Mat4();
		const point = new Vec3();
		const pieces: { instance: MeshInstance; positions: number[]; radii: Float32Array; brightness: Float32Array | null; indices: number[]; tyreOnly: boolean; rimOnly: boolean }[] = [];
		let tyreRadius = 0;
		for (const render of pivot.findComponents("render") as RenderComponent[]) {
			if (!render.enabled) continue;
			for (const instance of render.meshInstances) {
				if (!instance.visible) continue;
				const positions: number[] = [];
				const count = instance.mesh.getPositions(positions);
				const indices: number[] = [];
				instance.mesh.getIndices(indices);
				if (count === 0 || indices.length === 0) continue;
				toWheel.mul2(toModel, instance.node.getWorldTransform());
				const radii = new Float32Array(count);
				const local: number[] = new Array(count * 3);
				for (let v = 0; v < count; v++) {
					toWheel.transformPoint(point.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]), point);
					point.sub(centre);
					local[v * 3] = point.x;
					local[v * 3 + 1] = point.y;
					local[v * 3 + 2] = point.z;
					radii[v] = radial(point.y, point.z);
				}
				const colours: number[] = [];
				let brightness: Float32Array | null = null;
				if (instance.mesh.getVertexStream(SEMANTIC_COLOR, colours) > 0) {
					const components = colours.length / count;
					let max = 0;
					for (const value of colours) max = Math.max(max, value);
					const scale = max > 1.5 ? 1 / 255 : 1;
					brightness = new Float32Array(count);
					for (let v = 0; v < count; v++) brightness[v] = ((colours[v * components] + colours[v * components + 1] + colours[v * components + 2]) / 3) * scale;
				}
				const name = `${instance.material?.name ?? ""}`;
				const tyreOnly = /tyre|tire|rubber/i.test(name);
				const rimOnly = /rim|rotor|caliper|hub|chrome|steel|alloy/i.test(name);
				if (!rimOnly) for (let v = 0; v < count; v++) tyreRadius = Math.max(tyreRadius, radii[v]);
				pieces.push({ instance, positions: local, radii, brightness, indices, tyreOnly, rimOnly });
			}
		}
		this.tyreRadius = tyreRadius;
		let rimRadius = 0;
		for (const piece of pieces) {
			if (piece.tyreOnly) continue;
			rimRadius = Math.max(rimRadius, piece.rimOnly ? Math.max(...piece.radii) : estimateRimRadius(piece.radii, piece.brightness, tyreRadius));
		}
		if (!(rimRadius > tyreRadius * 0.4 && rimRadius < tyreRadius * 0.92)) rimRadius = tyreRadius * 0.7;
		this.rimRadius = rimRadius;

		// Each part's tyre triangles go to a mesh of their own; the part keeps the rest.
		const meshInstances: MeshInstance[] = [];
		for (const piece of pieces) {
			if (piece.rimOnly || !piece.instance.material) continue;
			const flags = piece.tyreOnly ? new Uint8Array(piece.indices.length / 3).fill(1) : tyreTriangles(piece.radii, piece.indices, rimRadius);
			const remap = new Map<number, number>();
			const order: number[] = [];
			const rest: number[] = [];
			const tyreIndices: number[] = [];
			for (let t = 0; t < flags.length; t++) {
				const i = t * 3;
				if (!flags[t]) {
					rest.push(piece.indices[i], piece.indices[i + 1], piece.indices[i + 2]);
					continue;
				}
				for (let k = 0; k < 3; k++) {
					const index = piece.indices[i + k];
					let mapped = remap.get(index);
					if (mapped === undefined) {
						mapped = order.length;
						remap.set(index, mapped);
						order.push(index);
					}
					tyreIndices.push(mapped);
				}
			}
			if (order.length === 0) continue;
			const frame = new Float32Array(order.length * 3);
			order.forEach((index, v) => {
				frame[v * 3] = piece.positions[index * 3];
				frame[v * 3 + 1] = piece.positions[index * 3 + 1];
				frame[v * 3 + 2] = piece.positions[index * 3 + 2];
			});
			const mesh = tyreMesh(app, piece.instance.mesh, order, frame, tyreIndices);
			if (!mesh) continue;
			const part: Part = { instance: piece.instance, original: piece.instance.mesh, rim: null };
			if (rest.length > 0) {
				part.rim = withIndices(app, piece.instance.mesh, rest);
				if (part.rim) piece.instance.mesh = part.rim;
			} else {
				piece.instance.visible = false;
			}
			this.parts.push(part);
			this.shapes.push({ mesh, frame, indices: tyreIndices });
			meshInstances.push(new MeshInstance(mesh, piece.instance.material));
		}
		if (meshInstances.length > 0) this.entity.addComponent("render", { meshInstances, castShadows: true, receiveShadows: true });
	}

	/** Tyre and rim radius in the model's units (for the body's sag). */
	public get radii(): { tyre: number; rim: number } {
		return { tyre: this.tyreRadius, rim: this.rimRadius };
	}

	/** Shapes the tyre for how much air is out (0..1). */
	public setDeflation(amount: number): void {
		if (Math.abs(amount - this.shown) < RESHAPE_STEP && !(amount >= 1 && this.shown < 1)) return;
		this.shown = amount;
		for (const { mesh, frame, indices } of this.shapes) {
			const positions = new Float32Array(frame.length);
			for (let i = 0; i < frame.length; i += 3) {
				sagPoint(frame[i], frame[i + 1], frame[i + 2], this.tyreRadius, this.rimRadius, amount, this.scratch);
				positions[i] = this.scratch[0];
				positions[i + 1] = this.scratch[1];
				positions[i + 2] = this.scratch[2];
			}
			mesh.setPositions(positions);
			mesh.setNormals(calculateNormals(positions, indices));
			mesh.update(PRIMITIVE_TRIANGLES);
		}
	}

	/** Steering, as an angle (degrees) about the car's vertical. */
	public steer(degrees: number): void {
		this.turn.setFromAxisAngle(Vec3.UP, degrees);
		this.entity.setLocalRotation(this.turn);
	}

	public set visible(on: boolean) {
		if (this.entity.enabled !== on) this.entity.enabled = on;
	}

	/** Puts the wheel back as it was and removes the flat. */
	public destroy(): void {
		for (const part of this.parts) {
			part.instance.mesh = part.original;
			part.instance.visible = true;
			part.rim?.destroy();
		}
		this.parts.length = 0;
		this.entity.destroy();
		for (const shape of this.shapes) shape.mesh.destroy();
		this.shapes.length = 0;
	}

	/** The spinning wheel this flat belongs to. */
	public get wheel(): Entity {
		return this.pivot;
	}
}

/**
 * The tyre's own mesh: the vertices `order` picks out of `source`, keeping every stream the
 * material reads (colour, texture coordinates), placed at `frame` in the wheel frame.
 */
function tyreMesh(app: AppBase, source: Mesh, order: readonly number[], frame: Float32Array, indices: number[]): Mesh | null {
	const buffer = source.vertexBuffer;
	if (!buffer) return null;
	const count = buffer.numVertices;
	const mesh = new Mesh(app.graphicsDevice);
	for (const element of buffer.format.elements) {
		if (element.name === SEMANTIC_POSITION || element.name === SEMANTIC_NORMAL) continue;
		const data: number[] = [];
		source.getVertexStream(element.name, data);
		const n = element.numComponents;
		if (data.length < count * n) return null;
		const picked = new Array(order.length * n);
		order.forEach((index, v) => {
			for (let k = 0; k < n; k++) picked[v * n + k] = data[index * n + k];
		});
		mesh.setVertexStream(element.name, picked, n, order.length, element.dataType, element.normalize, element.asInt);
	}
	mesh.setPositions(frame);
	mesh.setNormals(calculateNormals(frame, indices));
	mesh.setIndices(indices);
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}

/** A copy of `source` with its own index list (same vertices). */
function withIndices(app: AppBase, source: Mesh, indices: number[]): Mesh | null {
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
	mesh.setIndices(indices);
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}
