import {
	ADDRESS_REPEAT,
	BLEND_PREMULTIPLIED,
	BUFFER_DYNAMIC,
	CULLFACE_NONE,
	Entity,
	FILTER_LINEAR,
	FILTER_LINEAR_MIPMAP_LINEAR,
	Mesh,
	MeshInstance,
	PIXELFORMAT_RGBA8,
	PRIMITIVE_TRIANGLES,
	SEMANTIC_ATTR10,
	SEMANTIC_ATTR11,
	SEMANTIC_ATTR8,
	SEMANTIC_ATTR9,
	SEMANTIC_POSITION,
	ShaderMaterial,
	Texture,
	TYPE_FLOAT32,
	VertexBuffer,
	VertexFormat,
	type AppBase,
} from "playcanvas";

import { EFFECT_FRAGMENT_GLSL, EFFECT_VERTEX_GLSL } from "./EffectShaders";
import { generateNoiseTexture } from "./NoiseTexture";
import type { ParticleField } from "./ParticleField";

const FLOATS_PER_PARTICLE = 16;
const NOISE_SIZE = 256;

/**
 * Draws a ParticleField as one instanced draw call: a single quad, stretched and shaded per
 * particle on the GPU. However many cars are burning, the effects cost one draw call, one
 * shader and one small buffer upload a frame.
 */
export class ParticleRenderer {
	private readonly buffer: VertexBuffer;
	private readonly data: Float32Array;
	private readonly order: Uint16Array;
	private readonly instance: MeshInstance;
	private readonly material: ShaderMaterial;
	private readonly noise: Texture;
	private readonly entity: Entity;
	private readonly sun = new Float32Array(3);
	private readonly sunColour = new Float32Array(3);
	private readonly ambient = new Float32Array(3);
	private time = 0;

	public constructor(app: AppBase, capacity: number) {
		const device = app.graphicsDevice;
		const format = new VertexFormat(device, [
			{ semantic: SEMANTIC_ATTR8, components: 4, type: TYPE_FLOAT32 },
			{ semantic: SEMANTIC_ATTR9, components: 4, type: TYPE_FLOAT32 },
			{ semantic: SEMANTIC_ATTR10, components: 4, type: TYPE_FLOAT32 },
			{ semantic: SEMANTIC_ATTR11, components: 4, type: TYPE_FLOAT32 },
		]);
		this.buffer = new VertexBuffer(device, format, capacity, { usage: BUFFER_DYNAMIC });
		this.data = new Float32Array(this.buffer.lock() as ArrayBuffer);
		this.order = new Uint16Array(capacity);

		this.noise = new Texture(device, {
			name: "effect-noise",
			width: NOISE_SIZE,
			height: NOISE_SIZE,
			format: PIXELFORMAT_RGBA8,
			mipmaps: true,
			addressU: ADDRESS_REPEAT,
			addressV: ADDRESS_REPEAT,
			minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
			magFilter: FILTER_LINEAR,
		});
		(this.noise.lock() as Uint8Array).set(generateNoiseTexture(NOISE_SIZE));
		this.noise.unlock();

		this.material = new ShaderMaterial({
			uniqueName: "OrionEffects",
			vertexGLSL: EFFECT_VERTEX_GLSL,
			fragmentGLSL: EFFECT_FRAGMENT_GLSL,
			attributes: {
				vertex_position: SEMANTIC_POSITION,
				aPositionSize: SEMANTIC_ATTR8,
				aAgeSeedRotationKind: SEMANTIC_ATTR9,
				aVelocityIntensity: SEMANTIC_ATTR10,
				aToneGlow: SEMANTIC_ATTR11,
			},
		});
		this.material.blendType = BLEND_PREMULTIPLIED;
		this.material.depthWrite = false;
		this.material.cull = CULLFACE_NONE;
		this.material.setParameter("uNoise", this.noise);
		this.material.update();

		const quad = new Mesh(device);
		quad.setPositions([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
		quad.setIndices([0, 1, 2, 0, 2, 3]);
		quad.update(PRIMITIVE_TRIANGLES);

		this.instance = new MeshInstance(quad, this.material);
		this.instance.setInstancing(this.buffer);
		this.instance.instancingCount = 0;
		// The sprites span the whole city, so bounds-based culling could only get it wrong. And
		// they're drawn after every other transparent surface: they're sorted among themselves.
		this.instance.cull = false;
		this.instance.calculateSortDistance = () => 0;

		this.entity = new Entity("effects-batch");
		this.entity.addComponent("render", { meshInstances: [this.instance], castShadows: false, receiveShadows: false });
		app.root.addChild(this.entity);
		this.instance.visible = false;
		this.setLighting([0.4, 0.8, 0.45], [1.05, 1, 0.94], [0.34, 0.37, 0.42]);
	}

	/** Direction towards the sun (world space), its colour and the sky's ambient light. */
	public setLighting(sunDirection: readonly number[], sunColour: readonly number[], ambient: readonly number[]) {
		const length = Math.hypot(sunDirection[0], sunDirection[1], sunDirection[2]) || 1;
		for (let i = 0; i < 3; i++) {
			this.sun[i] = sunDirection[i] / length;
			this.sunColour[i] = sunColour[i];
			this.ambient[i] = ambient[i];
		}
		this.material.setParameter("uSunDirection", this.sun);
		this.material.setParameter("uSunColour", this.sunColour);
		this.material.setParameter("uAmbient", this.ambient);
	}

	/** Uploads this frame's particles, sorted back to front for the camera. */
	public draw(field: ParticleField, dt: number, cameraX: number, cameraY: number, cameraZ: number) {
		this.time += dt;
		this.material.setParameter("uTime", this.time);
		const count = field.sortBackToFront(cameraX, cameraY, cameraZ, this.order);
		this.instance.visible = count > 0;
		if (count === 0) return;

		const data = this.data;
		const { x, y, z, vx, vy, vz, age, life, seed, rotation, kind, intensity, tone, glow } = field;
		for (let n = 0; n < count; n++) {
			const i = this.order[n];
			const o = n * FLOATS_PER_PARTICLE;
			data[o] = x[i];
			data[o + 1] = y[i];
			data[o + 2] = z[i];
			data[o + 3] = field.currentSize(i);
			data[o + 4] = age[i] / life[i];
			data[o + 5] = seed[i];
			data[o + 6] = rotation[i];
			data[o + 7] = kind[i];
			data[o + 8] = vx[i];
			data[o + 9] = vy[i];
			data[o + 10] = vz[i];
			data[o + 11] = intensity[i];
			data[o + 12] = tone[i];
			data[o + 13] = glow[i];
			data[o + 14] = 0;
			data[o + 15] = 0;
		}
		this.buffer.unlock();
		this.instance.instancingCount = count;
	}

	public destroy() {
		this.entity.destroy();
		this.buffer.destroy();
		this.noise.destroy();
		this.material.destroy();
	}
}
