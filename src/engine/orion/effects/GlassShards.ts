import {
	Color,
	CULLFACE_NONE,
	Entity,
	Mesh,
	MeshInstance,
	PRIMITIVE_TRIANGLES,
	Quat,
	StandardMaterial,
	Vec3,
	type AppBase,
	type GraphicsDevice,
} from "playcanvas";

/**
 * Glass coming out of a frame: toughened car glass bursts into a spray of small cubes, a shop's
 * plate glass drops in long blades. Each piece flies, tumbles, falls, bounces once or twice and
 * skids to rest on the ground under it, lies there a few seconds and shrinks away.
 *
 * Pieces are drawn as one small wedge mesh shared by all of them, from a fixed pool: a window
 * going is a few dozen entities moved for a few seconds, with no physics bodies and nothing
 * allocated, and a pane breaking while the pool is busy just reuses the oldest pieces.
 */

const POOL_SIZE = 140;
const GRAVITY = 9.81;
/** Share of speed kept off the ground, and the friction while sliding (1/s). */
const BOUNCE = 0.22;
const SLIDE_FRICTION = 6;
/** The last part of a piece's life it spends shrinking away. */
const SHRINK_SECONDS = 0.7;

interface Shard {
	entity: Entity;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	/** Tumble: axis (unit) and degrees per second. */
	ax: number;
	ay: number;
	az: number;
	spin: number;
	angle: number;
	size: [number, number, number];
	floor: number;
	age: number;
	life: number;
	resting: boolean;
	alive: boolean;
}

export type ShardStyle = "cubes" | "plate";

export interface ShardBurst {
	x: number;
	y: number;
	z: number;
	/** Main direction the glass goes (unit-ish): out of the side that was struck. */
	dirX: number;
	dirY: number;
	dirZ: number;
	/** Half-size of the area the pane covered, to spread the pieces over it (m). */
	spread: number;
	count: number;
	/** Ground height below. */
	floor: number;
	style: ShardStyle;
	/** Velocity of what the glass was in (a moving car). */
	carryX?: number;
	carryZ?: number;
}

class GlassShardLayer {
	private readonly shards: Shard[] = [];
	private readonly material: StandardMaterial;
	private readonly mesh: Mesh;
	private readonly rotation = new Quat();
	private readonly axis = new Vec3();
	private next = 0;
	private active = 0;

	public constructor(app: AppBase) {
		this.mesh = buildWedge(app.graphicsDevice);
		this.mesh.incRefCount();
		this.material = new StandardMaterial();
		this.material.name = "glass-shard";
		this.material.diffuse = new Color(0.62, 0.72, 0.72);
		this.material.useMetalness = true;
		this.material.metalness = 0;
		this.material.gloss = 0.96;
		this.material.specular = new Color(1, 1, 1);
		this.material.emissive = new Color(0.08, 0.1, 0.1);
		this.material.cull = CULLFACE_NONE;
		this.material.update();
		const root = new Entity("glass-shards");
		app.root.addChild(root);
		for (let i = 0; i < POOL_SIZE; i++) {
			const entity = new Entity("glass-shard");
			const instance = new MeshInstance(this.mesh, this.material);
			entity.addComponent("render", { meshInstances: [instance], castShadows: false, receiveShadows: false });
			entity.enabled = false;
			root.addChild(entity);
			this.shards.push({
				entity, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 1, az: 0, spin: 0, angle: 0,
				size: [0.02, 0.02, 0.02], floor: 0, age: 0, life: 0, resting: false, alive: false,
			});
		}
	}

	public get prewarmMaterial(): StandardMaterial {
		return this.material;
	}

	public burst(burst: Readonly<ShardBurst>): void {
		const plate = burst.style === "plate";
		for (let i = 0; i < burst.count; i++) {
			const shard = this.shards[this.next];
			this.next = (this.next + 1) % this.shards.length;
			if (!shard.alive) this.active++;
			const across = (Math.random() - 0.5) * 2 * burst.spread;
			const up = (Math.random() - 0.5) * 2 * burst.spread;
			// Spread over the pane: sideways in the horizontal plane across the direction, and up.
			const flat = Math.hypot(burst.dirX, burst.dirZ) || 1;
			const sideX = -burst.dirZ / flat;
			const sideZ = burst.dirX / flat;
			shard.x = burst.x + sideX * across;
			shard.y = burst.y + up * (plate ? 1 : 0.6);
			shard.z = burst.z + sideZ * across;
			// Toughened glass bursts outwards; plate glass mostly falls, slipping out of the frame.
			const push = plate ? 0.4 + Math.random() * 1.6 : 1.2 + Math.random() * 3.4;
			shard.vx = burst.dirX * push + (Math.random() - 0.5) * (plate ? 0.8 : 2.2) + (burst.carryX ?? 0);
			shard.vy = burst.dirY * push + (plate ? Math.random() * 0.6 : 0.4 + Math.random() * 2.2);
			shard.vz = burst.dirZ * push + (Math.random() - 0.5) * (plate ? 0.8 : 2.2) + (burst.carryZ ?? 0);
			const ax = Math.random() - 0.5;
			const ay = Math.random() - 0.5;
			const az = Math.random() - 0.5;
			const length = Math.hypot(ax, ay, az) || 1;
			shard.ax = ax / length;
			shard.ay = ay / length;
			shard.az = az / length;
			shard.spin = (plate ? 200 : 600) + Math.random() * 700;
			shard.angle = Math.random() * 360;
			if (plate) {
				const s = 0.05 + Math.random() * 0.16;
				shard.size = [s * (0.4 + Math.random() * 0.6), 0.006, s];
			} else {
				const s = 0.008 + Math.random() * 0.012;
				shard.size = [s, s * (0.6 + Math.random() * 0.5), s * (0.7 + Math.random() * 0.6)];
			}
			shard.floor = burst.floor + 0.004;
			shard.age = 0;
			shard.life = (plate ? 5 : 4) + Math.random() * 3;
			shard.resting = false;
			shard.alive = true;
			shard.entity.setLocalScale(shard.size[0], shard.size[1], shard.size[2]);
			shard.entity.enabled = true;
		}
	}

	public update(dt: number): void {
		if (this.active === 0) return;
		for (const shard of this.shards) {
			if (!shard.alive) continue;
			shard.age += dt;
			if (shard.age >= shard.life) {
				shard.alive = false;
				shard.entity.enabled = false;
				this.active--;
				continue;
			}
			if (!shard.resting) {
				shard.vy -= GRAVITY * dt;
				shard.x += shard.vx * dt;
				shard.y += shard.vy * dt;
				shard.z += shard.vz * dt;
				shard.angle += shard.spin * dt;
				if (shard.y <= shard.floor) {
					shard.y = shard.floor;
					if (Math.abs(shard.vy) > 1.2) {
						shard.vy = -shard.vy * BOUNCE;
						shard.spin *= 0.5;
					} else {
						shard.vy = 0;
						const keep = Math.exp(-SLIDE_FRICTION * dt);
						shard.vx *= keep;
						shard.vz *= keep;
						shard.spin *= keep;
						if (Math.hypot(shard.vx, shard.vz) < 0.05) {
							shard.resting = true;
							// Lying flat on the road.
							shard.ax = 0;
							shard.ay = 1;
							shard.az = 0;
						}
					}
				}
				this.rotation.setFromAxisAngle(this.axis.set(shard.ax, shard.ay, shard.az), shard.angle);
				shard.entity.setPosition(shard.x, shard.y, shard.z);
				shard.entity.setRotation(this.rotation);
			}
			const left = shard.life - shard.age;
			if (left < SHRINK_SECONDS) {
				const k = Math.max(0.01, left / SHRINK_SECONDS);
				shard.entity.setLocalScale(shard.size[0] * k, shard.size[1] * k, shard.size[2] * k);
			}
		}
	}
}

/** A thin wedge: a triangle extruded, unit-sized, so scale makes it a cube-ish crumb or a blade. */
function buildWedge(device: GraphicsDevice): Mesh {
	const h = 0.5;
	const top: [number, number][] = [[-0.5, -0.5], [0.5, -0.3], [-0.1, 0.5]];
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	const face = (points: number[][], normal: number[]) => {
		const base = positions.length / 3;
		for (const point of points) {
			positions.push(point[0], point[1], point[2]);
			normals.push(normal[0], normal[1], normal[2]);
		}
		for (let i = 1; i < points.length - 1; i++) indices.push(base, base + i, base + i + 1);
	};
	face(top.map(([x, z]) => [x, h, z]), [0, 1, 0]);
	face([...top].reverse().map(([x, z]) => [x, -h, z]), [0, -1, 0]);
	for (let i = 0; i < 3; i++) {
		const [ax, az] = top[i];
		const [bx, bz] = top[(i + 1) % 3];
		const nx = bz - az;
		const nz = -(bx - ax);
		const length = Math.hypot(nx, nz) || 1;
		face([[ax, -h, az], [bx, -h, bz], [bx, h, bz], [ax, h, az]], [nx / length, 0, nz / length]);
	}
	const mesh = new Mesh(device);
	mesh.setPositions(positions);
	mesh.setNormals(normals);
	mesh.setIndices(indices);
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}

const layers = new WeakMap<AppBase, GlassShardLayer>();

export function glassShards(app: AppBase): GlassShardLayer {
	let layer = layers.get(app);
	if (!layer) {
		layer = new GlassShardLayer(app);
		layers.set(app, layer);
	}
	return layer;
}

export type { GlassShardLayer };
