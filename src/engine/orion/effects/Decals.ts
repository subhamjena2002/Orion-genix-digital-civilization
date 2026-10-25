import {
	ADDRESS_CLAMP_TO_EDGE,
	BLEND_NORMAL,
	CULLFACE_NONE,
	Entity,
	FILTER_LINEAR,
	FILTER_LINEAR_MIPMAP_LINEAR,
	Mesh,
	MeshInstance,
	PIXELFORMAT_SRGBA8,
	PRIMITIVE_TRIANGLES,
	Quat,
	StandardMaterial,
	Texture,
	Vec3,
	type AppBase,
	type GraphicsDevice,
} from "playcanvas";

import { makeCanvas, seededRandom, type Canvas2D } from "../rendering/CanvasTextures";

/**
 * Marks left on surfaces: the star a round leaves in glass and the web of cracks a windscreen
 * crazes into, bullet holes in paintwork and plaster, soot round a burnt-out engine, a wet patch
 * where a fire crew's water landed, the glitter of broken glass on the road.
 *
 * Each mark is a small quad laid on the surface it marks (a little out along the surface's normal
 * so it doesn't fight it for depth) and parented to whatever it's on, so it moves with a car. They
 * come from one pool of a fixed size, with the oldest reused once it's full, so a long gunfight
 * can't build up marks without end or allocate per shot. The textures are painted in code once.
 */

export type DecalKind = "crack" | "web" | "metal" | "plaster" | "soot" | "wet" | "crumbs" | "rubber" | "broken";

const POOL_SIZE = 260;
/** Marks sit this far out from the surface (m). */
const LIFT = 0.004;
const TEXTURE_SIZE = 256;

interface Decal {
	entity: Entity;
	instance: MeshInstance;
	kind: DecalKind;
	owner: Entity | null;
	/** Seconds left before it fades; Infinity for a mark that stays. */
	life: number;
	fade: number;
	opacity: number;
	age: number;
	inUse: boolean;
}

/** A placed mark, to move or take away later. */
export interface DecalHandle {
	readonly id: number;
}

interface KindStyle {
	/** Cut out (crisp lines, writes depth) or blended (soft stains). */
	cutout: boolean;
	diffuse: [number, number, number];
	emissive: number;
	gloss: number;
	opacity: number;
	paint: (context: Canvas2D, random: () => number) => void;
}

const STYLES: Readonly<Record<DecalKind, KindStyle>> = {
	crack: { cutout: true, diffuse: [0.86, 0.9, 0.92], emissive: 0.18, gloss: 0.85, opacity: 1, paint: paintStar },
	web: { cutout: true, diffuse: [0.82, 0.87, 0.9], emissive: 0.14, gloss: 0.8, opacity: 1, paint: paintWeb },
	metal: { cutout: true, diffuse: [1, 1, 1], emissive: 0, gloss: 0.55, opacity: 1, paint: paintMetalHole },
	plaster: { cutout: true, diffuse: [1, 1, 1], emissive: 0, gloss: 0.1, opacity: 1, paint: paintPlasterHole },
	rubber: { cutout: true, diffuse: [1, 1, 1], emissive: 0, gloss: 0.2, opacity: 1, paint: paintRubberHole },
	soot: { cutout: false, diffuse: [0.02, 0.018, 0.016], emissive: 0, gloss: 0.05, opacity: 0.9, paint: paintSoot },
	wet: { cutout: false, diffuse: [0.02, 0.025, 0.03], emissive: 0, gloss: 0.95, opacity: 0.55, paint: paintWet },
	crumbs: { cutout: true, diffuse: [0.8, 0.88, 0.88], emissive: 0.12, gloss: 0.95, opacity: 1, paint: paintCrumbs },
	broken: { cutout: true, diffuse: [1, 1, 1], emissive: 0, gloss: 0.6, opacity: 1, paint: paintBrokenPane },
};

const UP = new Vec3(0, 1, 0);
const FORWARD = new Vec3(0, 0, 1);

class DecalLayer {
	private readonly pool: Decal[] = [];
	private readonly byOwner = new Map<Entity, Set<Decal>>();
	private readonly materials = new Map<DecalKind, StandardMaterial>();
	private readonly quad: Mesh;
	private readonly root: Entity;
	private readonly rotation = new Quat();
	private readonly twist = new Quat();
	private readonly axis = new Vec3();
	private readonly normal = new Vec3();
	private next = 0;
	private fading = 0;

	public constructor(private readonly app: AppBase) {
		this.quad = buildQuad(app.graphicsDevice);
		this.quad.incRefCount();
		this.root = new Entity("decals");
		app.root.addChild(this.root);
	}

	/** Materials to compile at load, so the first mark doesn't hitch on a shader. */
	public get prewarmMaterials(): StandardMaterial[] {
		return (Object.keys(STYLES) as DecalKind[]).map((kind) => this.material(kind));
	}

	/**
	 * Lays a mark at (x, y, z) on a surface facing (nx, ny, nz), `size` metres across, on
	 * `owner` (it moves with it; null for the static world). `life` in seconds fades it out then;
	 * leave it out for a mark that stays until taken away.
	 */
	public place(kind: DecalKind, owner: Entity | null, x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, options: { life?: number; opacity?: number; spin?: number; aspect?: number } = {}): DecalHandle {
		const decal = this.acquire();
		decal.kind = kind;
		decal.life = options.life ?? Infinity;
		decal.fade = Math.min(3, (options.life ?? 0) * 0.4);
		decal.opacity = options.opacity ?? STYLES[kind].opacity;
		decal.age = 0;
		decal.instance.material = this.material(kind);
		decal.instance.setParameter("material_opacity", decal.opacity);
		const parent = owner ?? this.root;
		if (decal.entity.parent !== parent) decal.entity.reparent(parent);
		decal.owner = owner;
		if (owner) {
			let set = this.byOwner.get(owner);
			if (!set) this.byOwner.set(owner, (set = new Set()));
			set.add(decal);
		}
		// Quad faces +Z: turn that onto the normal, then a random twist about it.
		const normal = this.normal.set(nx, ny, nz);
		if (normal.lengthSq() < 1e-8) normal.copy(UP);
		normal.normalize();
		const dot = FORWARD.dot(normal);
		if (dot < -0.9999) this.rotation.setFromAxisAngle(UP, 180);
		else {
			this.axis.cross(FORWARD, normal);
			const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
			if (this.axis.lengthSq() < 1e-10) this.rotation.set(0, 0, 0, 1);
			else this.rotation.setFromAxisAngle(this.axis.normalize(), angle);
		}
		this.twist.setFromAxisAngle(FORWARD, options.spin ?? Math.random() * 360);
		this.rotation.mul(this.twist);
		decal.entity.setPosition(x + normal.x * LIFT, y + normal.y * LIFT, z + normal.z * LIFT);
		decal.entity.setRotation(this.rotation);
		// Scale is local: undo the owner's own scale so a mark is the size asked for.
		const ownerScale = owner ? owner.getWorldTransform().getScale(this.axis).x || 1 : 1;
		const height = size * (options.aspect ?? 1);
		decal.entity.setLocalScale(size / ownerScale, height / ownerScale, size / ownerScale);
		decal.entity.enabled = true;
		decal.inUse = true;
		if (decal.life !== Infinity) this.fading++;
		return decal as unknown as DecalHandle;
	}

	/** Grows a placed mark (a crack spreading). */
	public grow(handle: DecalHandle, factor: number): void {
		const decal = handle as unknown as Decal;
		if (!decal.inUse) return;
		const scale = decal.entity.getLocalScale();
		decal.entity.setLocalScale(scale.x * factor, scale.y * factor, scale.z * factor);
	}

	public release(handle: DecalHandle): void {
		const decal = handle as unknown as Decal;
		if (!decal.inUse) return;
		this.free(decal);
	}

	/** Takes away every mark on `owner` (a repaired car). */
	public releaseAll(owner: Entity): void {
		const set = this.byOwner.get(owner);
		if (!set) return;
		for (const decal of [...set]) this.free(decal);
		this.byOwner.delete(owner);
	}

	/** Fades out marks with a life. */
	public update(dt: number): void {
		if (this.fading === 0) return;
		for (const decal of this.pool) {
			if (!decal.inUse || decal.life === Infinity) continue;
			decal.age += dt;
			const left = decal.life - decal.age;
			if (left <= 0) {
				this.free(decal);
				continue;
			}
			if (left < decal.fade) decal.instance.setParameter("material_opacity", decal.opacity * (left / decal.fade));
		}
	}

	private acquire(): Decal {
		if (this.pool.length < POOL_SIZE) {
			const entity = new Entity("decal");
			const instance = new MeshInstance(this.quad, this.material("crack"));
			instance.castShadow = false;
			entity.addComponent("render", { meshInstances: [instance], castShadows: false, receiveShadows: true });
			this.root.addChild(entity);
			const decal: Decal = { entity, instance, kind: "crack", owner: null, life: Infinity, fade: 0, opacity: 1, age: 0, inUse: false };
			this.pool.push(decal);
			return decal;
		}
		// Full: the next one round, free or not (the oldest placed, near enough).
		for (let tries = 0; tries < this.pool.length; tries++) {
			const decal = this.pool[this.next];
			this.next = (this.next + 1) % this.pool.length;
			if (!decal.inUse) return this.repairIfDestroyed(decal);
		}
		const decal = this.pool[this.next];
		this.next = (this.next + 1) % this.pool.length;
		this.free(decal);
		return this.repairIfDestroyed(decal);
	}

	/** An owner destroyed with marks still on it takes their entities with it: make new ones. */
	private repairIfDestroyed(decal: Decal): Decal {
		if (decal.entity.render) return decal;
		const entity = new Entity("decal");
		const instance = new MeshInstance(this.quad, this.material("crack"));
		entity.addComponent("render", { meshInstances: [instance], castShadows: false, receiveShadows: true });
		this.root.addChild(entity);
		decal.entity = entity;
		decal.instance = instance;
		return decal;
	}

	private free(decal: Decal): void {
		if (decal.life !== Infinity && decal.inUse) this.fading = Math.max(0, this.fading - 1);
		decal.inUse = false;
		if (decal.owner) this.byOwner.get(decal.owner)?.delete(decal);
		decal.owner = null;
		if (!decal.entity.render) return;
		decal.entity.enabled = false;
		if (decal.entity.parent !== this.root) decal.entity.reparent(this.root);
	}

	private material(kind: DecalKind): StandardMaterial {
		let material = this.materials.get(kind);
		if (material) return material;
		const style = STYLES[kind];
		const texture = paintTexture(this.app.graphicsDevice, kind, style);
		material = new StandardMaterial();
		material.name = `decal-${kind}`;
		material.diffuse.set(...style.diffuse);
		material.diffuseMap = texture;
		material.opacityMap = texture;
		material.opacityMapChannel = "a";
		material.gloss = style.gloss;
		material.useMetalness = true;
		material.metalness = kind === "metal" ? 0.4 : 0;
		if (style.emissive > 0) {
			material.emissive.set(style.emissive, style.emissive, style.emissive);
			material.emissiveMap = texture;
		}
		material.cull = CULLFACE_NONE;
		material.depthBias = -1;
		material.slopeDepthBias = -1;
		if (style.cutout) {
			material.alphaTest = 0.35;
		} else {
			material.blendType = BLEND_NORMAL;
			material.depthWrite = false;
		}
		material.opacity = style.opacity;
		material.update();
		this.materials.set(kind, material);
		return material;
	}
}

function buildQuad(device: GraphicsDevice): Mesh {
	const mesh = new Mesh(device);
	mesh.setPositions([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
	mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
	mesh.setUvs(0, [0, 0, 1, 0, 1, 1, 0, 1]);
	mesh.setIndices([0, 1, 2, 0, 2, 3]);
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}

function paintTexture(device: GraphicsDevice, kind: DecalKind, style: KindStyle): Texture {
	const context = makeCanvas(TEXTURE_SIZE, TEXTURE_SIZE);
	context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
	style.paint(context, seededRandom(kind.length * 7919 + kind.charCodeAt(0)));
	const pixels = context.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).data;
	const texture = new Texture(device, {
		name: `decal-${kind}`,
		width: TEXTURE_SIZE,
		height: TEXTURE_SIZE,
		format: PIXELFORMAT_SRGBA8,
		mipmaps: true,
		minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
		magFilter: FILTER_LINEAR,
		addressU: ADDRESS_CLAMP_TO_EDGE,
		addressV: ADDRESS_CLAMP_TO_EDGE,
		anisotropy: 4,
	});
	const target = texture.lock() as Uint8Array;
	target.set(pixels);
	texture.unlock();
	return texture;
}

// ---- Painting ---------------------------------------------------------------------------------

const C = TEXTURE_SIZE / 2;

/** A jagged line out from near the centre, thinning as it goes. */
function crackLine(context: Canvas2D, random: () => number, angle: number, from: number, to: number, width: number, jag: number): [number, number][] {
	const points: [number, number][] = [];
	let a = angle;
	let r = from;
	context.beginPath();
	let x = C + Math.cos(a) * r;
	let y = C + Math.sin(a) * r;
	context.moveTo(x, y);
	points.push([x, y]);
	while (r < to) {
		r += 6 + random() * 12;
		a += (random() - 0.5) * jag;
		x = C + Math.cos(a) * r;
		y = C + Math.sin(a) * r;
		context.lineTo(x, y);
		points.push([x, y]);
	}
	context.lineWidth = width;
	context.stroke();
	return points;
}

/** A round's star in glass: the crushed hole, radial cracks to the edge, a ring or two between. */
function paintStar(context: Canvas2D, random: () => number): void {
	context.strokeStyle = "rgba(255,255,255,1)";
	context.lineCap = "round";
	const spokes = 9 + Math.floor(random() * 4);
	const tips: [number, number][][] = [];
	for (let i = 0; i < spokes; i++) {
		const angle = (i / spokes) * Math.PI * 2 + (random() - 0.5) * 0.4;
		tips.push(crackLine(context, random, angle, 10, C * (0.55 + random() * 0.42), 1.6 + random() * 1.2, 0.35));
	}
	// Concentric cracks between neighbouring spokes.
	for (const ring of [0.22, 0.42]) {
		for (let i = 0; i < spokes; i++) {
			if (random() < 0.35) continue;
			const a = tips[i];
			const b = tips[(i + 1) % spokes];
			const ia = Math.min(a.length - 1, Math.max(1, Math.round(a.length * ring)));
			const ib = Math.min(b.length - 1, Math.max(1, Math.round(b.length * ring)));
			context.beginPath();
			context.moveTo(a[ia][0], a[ia][1]);
			context.quadraticCurveTo(C + (a[ia][0] + b[ib][0] - 2 * C) * 0.62, C + (a[ia][1] + b[ib][1] - 2 * C) * 0.62, b[ib][0], b[ib][1]);
			context.lineWidth = 1.2;
			context.stroke();
		}
	}
	// The crushed ring round the hole, and the hole itself.
	context.fillStyle = "rgba(255,255,255,1)";
	context.beginPath();
	context.arc(C, C, 12, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "rgba(25,28,30,1)";
	context.beginPath();
	context.arc(C, C, 5, 0, Math.PI * 2);
	context.fill();
}

/** Crazed laminated glass: a dense web of cracks all over. */
function paintWeb(context: Canvas2D, random: () => number): void {
	context.strokeStyle = "rgba(255,255,255,1)";
	context.lineCap = "round";
	const spokes = 16;
	const lines: [number, number][][] = [];
	for (let i = 0; i < spokes; i++) {
		const angle = (i / spokes) * Math.PI * 2 + (random() - 0.5) * 0.3;
		lines.push(crackLine(context, random, angle, 4, C * 1.05, 1.4, 0.5));
	}
	for (let ring = 0.12; ring < 1; ring += 0.11 + random() * 0.05) {
		for (let i = 0; i < spokes; i++) {
			if (random() < 0.25) continue;
			const a = lines[i];
			const b = lines[(i + 1) % spokes];
			const ia = Math.min(a.length - 1, Math.round(a.length * ring));
			const ib = Math.min(b.length - 1, Math.round(b.length * ring));
			context.beginPath();
			context.moveTo(a[ia][0], a[ia][1]);
			context.lineTo(b[ib][0] + (random() - 0.5) * 4, b[ib][1] + (random() - 0.5) * 4);
			context.lineWidth = 1;
			context.stroke();
		}
	}
}

/** A round through paintwork: a dark hole, a ring of bare metal where the paint flaked off. */
function paintMetalHole(context: Canvas2D, random: () => number): void {
	const chip = context.createRadialGradient(C, C, 18, C, C, 70);
	chip.addColorStop(0, "rgba(176,178,180,1)");
	chip.addColorStop(0.55, "rgba(140,142,145,0.85)");
	chip.addColorStop(1, "rgba(120,120,120,0)");
	context.fillStyle = chip;
	context.beginPath();
	for (let i = 0; i <= 24; i++) {
		const a = (i / 24) * Math.PI * 2;
		const r = 46 + random() * 26;
		if (i === 0) context.moveTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
		else context.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
	}
	context.fill();
	context.fillStyle = "rgba(60,58,56,1)";
	context.beginPath();
	context.arc(C, C, 26, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "rgba(8,8,8,1)";
	context.beginPath();
	context.arc(C, C, 17, 0, Math.PI * 2);
	context.fill();
}

/** A round into plaster or concrete: a ragged crater, chips knocked out round it. */
function paintPlasterHole(context: Canvas2D, random: () => number): void {
	context.fillStyle = "rgba(150,146,138,1)";
	context.beginPath();
	for (let i = 0; i <= 30; i++) {
		const a = (i / 30) * Math.PI * 2;
		const r = 60 + random() * 46;
		if (i === 0) context.moveTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
		else context.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
	}
	context.fill();
	const crater = context.createRadialGradient(C, C, 4, C, C, 58);
	crater.addColorStop(0, "rgba(28,26,24,1)");
	crater.addColorStop(0.45, "rgba(92,88,82,1)");
	crater.addColorStop(1, "rgba(138,134,126,1)");
	context.fillStyle = crater;
	context.beginPath();
	context.arc(C, C, 56, 0, Math.PI * 2);
	context.fill();
	for (let i = 0; i < 14; i++) {
		const a = random() * Math.PI * 2;
		const r = 70 + random() * 50;
		context.fillStyle = `rgba(${110 + random() * 40},${106 + random() * 40},${100 + random() * 40},1)`;
		context.fillRect(C + Math.cos(a) * r, C + Math.sin(a) * r, 4 + random() * 8, 4 + random() * 8);
	}
}

/** A round into a tyre: a small torn hole in the rubber. */
function paintRubberHole(context: Canvas2D, random: () => number): void {
	context.fillStyle = "rgba(48,46,44,1)";
	context.beginPath();
	for (let i = 0; i <= 16; i++) {
		const a = (i / 16) * Math.PI * 2;
		const r = 40 + random() * 22;
		if (i === 0) context.moveTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
		else context.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
	}
	context.fill();
	context.fillStyle = "rgba(4,4,4,1)";
	context.beginPath();
	context.arc(C, C, 22, 0, Math.PI * 2);
	context.fill();
}

/** Soot: a dark stain, heaviest in the middle, ragged at the edge. */
function paintSoot(context: Canvas2D, random: () => number): void {
	for (let i = 0; i < 40; i++) {
		const x = C + (random() - 0.5) * C * 0.9;
		const y = C + (random() - 0.5) * C * 0.9;
		const r = 30 + random() * 60;
		const blot = context.createRadialGradient(x, y, 0, x, y, r);
		blot.addColorStop(0, "rgba(255,255,255,0.22)");
		blot.addColorStop(1, "rgba(255,255,255,0)");
		context.fillStyle = blot;
		context.fillRect(x - r, y - r, r * 2, r * 2);
	}
	const core = context.createRadialGradient(C, C, 0, C, C, C);
	core.addColorStop(0, "rgba(255,255,255,0.85)");
	core.addColorStop(0.6, "rgba(255,255,255,0.35)");
	core.addColorStop(1, "rgba(255,255,255,0)");
	context.fillStyle = core;
	context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
}

/** Water on the ground: an irregular dark, glossy patch. */
function paintWet(context: Canvas2D, random: () => number): void {
	for (let i = 0; i < 26; i++) {
		const a = random() * Math.PI * 2;
		const d = random() * C * 0.55;
		const x = C + Math.cos(a) * d;
		const y = C + Math.sin(a) * d;
		const r = 30 + random() * 55;
		const blot = context.createRadialGradient(x, y, r * 0.5, x, y, r);
		blot.addColorStop(0, "rgba(255,255,255,0.75)");
		blot.addColorStop(1, "rgba(255,255,255,0)");
		context.fillStyle = blot;
		context.beginPath();
		context.arc(x, y, r, 0, Math.PI * 2);
		context.fill();
	}
}

/**
 * A shop window gone: the dark of the shop behind, a hint of shelves, and jagged glass still
 * standing round the frame.
 */
function paintBrokenPane(context: Canvas2D, random: () => number): void {
	const size = TEXTURE_SIZE;
	const inside = context.createLinearGradient(0, 0, 0, size);
	inside.addColorStop(0, "rgba(14,15,16,1)");
	inside.addColorStop(1, "rgba(30,31,32,1)");
	context.fillStyle = inside;
	context.fillRect(0, 0, size, size);
	// Shelves and stock, barely lit.
	for (let y = size * 0.45; y < size * 0.95; y += size * 0.16) {
		context.fillStyle = "rgba(40,40,40,1)";
		context.fillRect(size * 0.05, y, size * 0.9, 4);
		for (let x = size * 0.07; x < size * 0.9; x += 10 + random() * 16) {
			context.fillStyle = `rgba(${40 + random() * 40},${36 + random() * 30},${30 + random() * 30},1)`;
			context.fillRect(x, y - 10 - random() * 14, 6 + random() * 8, 10 + random() * 12);
		}
	}
	// Glass left in the frame: jagged teeth along each edge, glinting.
	const edge = (fromX: number, fromY: number, toX: number, toY: number, inX: number, inY: number) => {
		context.beginPath();
		context.moveTo(fromX, fromY);
		const steps = 7 + Math.floor(random() * 5);
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const depth = random() < 0.3 ? 4 + random() * 10 : 12 + random() * 46;
			context.lineTo(fromX + (toX - fromX) * t + inX * depth, fromY + (toY - fromY) * t + inY * depth);
		}
		context.lineTo(toX, toY);
		context.closePath();
		context.fillStyle = "rgba(150,170,172,1)";
		context.fill();
		context.strokeStyle = "rgba(225,238,240,1)";
		context.lineWidth = 1.5;
		context.stroke();
	};
	edge(0, 0, size, 0, 0, 1);
	edge(size, size, 0, size, 0, -1);
	edge(0, size, 0, 0, 1, 0);
	edge(size, 0, size, size, -1, 0);
}

/** Broken glass on the ground: scattered bright crumbs. */
function paintCrumbs(context: Canvas2D, random: () => number): void {
	for (let i = 0; i < 420; i++) {
		const a = random() * Math.PI * 2;
		const d = Math.sqrt(random()) * C * 0.95;
		const s = 1.5 + random() * 3.5;
		context.fillStyle = `rgba(255,255,255,${0.6 + random() * 0.4})`;
		context.save();
		context.translate(C + Math.cos(a) * d, C + Math.sin(a) * d);
		context.rotate(random() * Math.PI);
		context.fillRect(-s / 2, -s / 2, s, s * (0.6 + random() * 0.8));
		context.restore();
	}
}

const layers = new WeakMap<AppBase, DecalLayer>();

export function decals(app: AppBase): DecalLayer {
	let layer = layers.get(app);
	if (!layer) {
		layer = new DecalLayer(app);
		layers.set(app, layer);
	}
	return layer;
}

export type { DecalLayer };
