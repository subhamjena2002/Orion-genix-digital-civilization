import { Color, Mesh, type GraphicsDevice } from "playcanvas";

/**
 * Accumulates simple flat-shaded shapes into one mesh.
 *
 * Street furniture repeats hundreds of times across the city; merging it into a few meshes
 * turns what would be thousands of entities and draw calls into a handful.
 */
export class MeshBuilder {
	private positions: number[] = [];
	private normals: number[] = [];
	private uvs: number[] = [];
	private indices: number[] = [];
	private colors: number[] = [];
	private colour: [number, number, number, number] = [1, 1, 1, 1];
	private coloured = false;

	/** Vertex colour for shapes added after this call (used with a vertex-colour material). */
	withColour(hex: string): this {
		const colour = new Color().fromString(hex);
		this.colour = [colour.r, colour.g, colour.b, 1];
		this.coloured = true;
		return this;
	}

	get isEmpty(): boolean {
		return this.indices.length === 0;
	}

	/** Axis-aligned box rotated by `yawDegrees` about its own centre. */
	addBox(center: readonly [number, number, number], size: readonly [number, number, number], yawDegrees = 0): this {
		const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
		const yaw = (yawDegrees * Math.PI) / 180;
		const cos = Math.cos(yaw);
		const sin = Math.sin(yaw);
		const rotate = (x: number, z: number): [number, number] => [x * cos + z * sin, -x * sin + z * cos];

		// Each face: outward normal (local) and two in-plane axes.
		const faces: [number[], number[], number[]][] = [
			[[1, 0, 0], [0, 0, -1], [0, 1, 0]],
			[[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
			[[0, 1, 0], [1, 0, 0], [0, 0, -1]],
			[[0, -1, 0], [1, 0, 0], [0, 0, 1]],
			[[0, 0, 1], [1, 0, 0], [0, 1, 0]],
			[[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
		];
		for (const [n, u, v] of faces) {
			const base = this.positions.length / 3;
			for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
				const lx = (n[0] + u[0] * su + v[0] * sv) * hx;
				const ly = (n[1] + u[1] * su + v[1] * sv) * hy;
				const lz = (n[2] + u[2] * su + v[2] * sv) * hz;
				const [rx, rz] = rotate(lx, lz);
				this.positions.push(center[0] + rx, center[1] + ly, center[2] + rz);
				this.colors.push(...this.colour);
				const [nx, nz] = rotate(n[0], n[2]);
				this.normals.push(nx, n[1], nz);
				this.uvs.push((su + 1) / 2, (sv + 1) / 2);
			}
			this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
		}
		return this;
	}

	/** A flat disc facing the horizontal direction (`facingX`, `facingZ`). */
	addDisc(center: readonly [number, number, number], radius: number, facingX: number, facingZ: number, segments = 14): this {
		const length = Math.hypot(facingX, facingZ) || 1;
		const nx = facingX / length;
		const nz = facingZ / length;
		// In-plane axes: horizontal tangent and world up.
		const tx = -nz;
		const tz = nx;
		const base = this.positions.length / 3;
		this.positions.push(center[0], center[1], center[2]);
		this.colors.push(...this.colour);
		this.normals.push(nx, 0, nz);
		this.uvs.push(0.5, 0.5);
		for (let i = 0; i < segments; i++) {
			const angle = (i / segments) * Math.PI * 2;
			const c = Math.cos(angle) * radius;
			const s = Math.sin(angle) * radius;
			this.positions.push(center[0] + tx * c, center[1] + s, center[2] + tz * c);
			this.colors.push(...this.colour);
			this.normals.push(nx, 0, nz);
			this.uvs.push(0.5 + Math.cos(angle) / 2, 0.5 + Math.sin(angle) / 2);
		}
		for (let i = 0; i < segments; i++) {
			const a = base + 1 + i;
			const b = base + 1 + ((i + 1) % segments);
			this.indices.push(base, b, a);
		}
		return this;
	}

	/** A closed cylinder lying along the X axis (a wheel). */
	addCylinderX(center: readonly [number, number, number], radius: number, width: number, segments = 14): this {
		const half = width / 2;
		for (const side of [-1, 1]) {
			// End caps.
			const base = this.positions.length / 3;
			this.positions.push(center[0] + side * half, center[1], center[2]);
			this.colors.push(...this.colour);
			this.normals.push(side, 0, 0);
			this.uvs.push(0.5, 0.5);
			for (let i = 0; i < segments; i++) {
				const angle = (i / segments) * Math.PI * 2;
				this.positions.push(center[0] + side * half, center[1] + Math.sin(angle) * radius, center[2] + Math.cos(angle) * radius);
				this.colors.push(...this.colour);
				this.normals.push(side, 0, 0);
				this.uvs.push(0.5 + Math.cos(angle) / 2, 0.5 + Math.sin(angle) / 2);
			}
			for (let i = 0; i < segments; i++) {
				const a = base + 1 + i;
				const b = base + 1 + ((i + 1) % segments);
				if (side > 0) this.indices.push(base, b, a);
				else this.indices.push(base, a, b);
			}
		}
		// Tread.
		const base = this.positions.length / 3;
		for (let i = 0; i <= segments; i++) {
			const angle = (i / segments) * Math.PI * 2;
			const y = Math.sin(angle);
			const z = Math.cos(angle);
			for (const side of [-1, 1]) {
				this.positions.push(center[0] + side * half, center[1] + y * radius, center[2] + z * radius);
				this.colors.push(...this.colour);
				this.normals.push(0, y, z);
				this.uvs.push(i / segments, (side + 1) / 2);
			}
		}
		for (let i = 0; i < segments; i++) {
			const a = base + i * 2;
			const b = a + 1;
			const c = a + 2;
			const d = a + 3;
			this.indices.push(a, b, c, b, d, c);
		}
		return this;
	}

	/**
	 * A round tube between two points, tapering from `radiusFrom` to `radiusTo`: a pole, an arm, a
	 * lamp's visor. Open at the ends unless `capped`. `openBelow` (radians) leaves a slot that wide
	 * along the underside of a lying tube, as a signal's visor is cut away beneath.
	 */
	addTube(from: readonly [number, number, number], to: readonly [number, number, number], radiusFrom: number, radiusTo: number, segments = 12, capped = false, openBelow = 0): this {
		const ax = to[0] - from[0];
		const ay = to[1] - from[1];
		const az = to[2] - from[2];
		const length = Math.hypot(ax, ay, az) || 1;
		const [dx, dy, dz] = [ax / length, ay / length, az / length];
		// Two directions across the axis: any helper not parallel to it, crossed twice.
		const [hx, hy, hz] = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		let ux = dy * hz - dz * hy;
		let uy = dz * hx - dx * hz;
		let uz = dx * hy - dy * hx;
		const ul = Math.hypot(ux, uy, uz);
		ux /= ul;
		uy /= ul;
		uz /= ul;
		const vx = dy * uz - dz * uy;
		const vy = dz * ux - dx * uz;
		const vz = dx * uy - dy * ux;
		const ring = (centre: readonly [number, number, number], radius: number, angle: number): [number, number, number, number, number, number] => {
			const c = Math.cos(angle);
			const s = Math.sin(angle);
			const nx = ux * c + vx * s;
			const ny = uy * c + vy * s;
			const nz = uz * c + vz * s;
			return [centre[0] + nx * radius, centre[1] + ny * radius, centre[2] + nz * radius, nx, ny, nz];
		};
		const base = this.positions.length / 3;
		// Angle π/2 is straight down for a lying tube (v points down there): the slot is centred on it.
		const arcStart = Math.PI / 2 + openBelow / 2;
		const arc = Math.PI * 2 - openBelow;
		for (let i = 0; i <= segments; i++) {
			const angle = arcStart + (i / segments) * arc;
			for (const [centre, radius, v] of [[from, radiusFrom, 0], [to, radiusTo, 1]] as const) {
				const [x, y, z, nx, ny, nz] = ring(centre, radius, angle);
				this.positions.push(x, y, z);
				this.normals.push(nx, ny, nz);
				this.uvs.push(i / segments, v);
				this.colors.push(...this.colour);
			}
		}
		for (let i = 0; i < segments; i++) {
			const a = base + i * 2;
			this.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
		}
		if (capped && openBelow === 0) {
			for (const [centre, radius, sign] of [[from, radiusFrom, -1], [to, radiusTo, 1]] as const) {
				const middle = this.positions.length / 3;
				this.positions.push(centre[0], centre[1], centre[2]);
				this.normals.push(dx * sign, dy * sign, dz * sign);
				this.uvs.push(0.5, 0.5);
				this.colors.push(...this.colour);
				for (let i = 0; i < segments; i++) {
					const [x, y, z] = ring(centre, radius, (i / segments) * Math.PI * 2);
					this.positions.push(x, y, z);
					this.normals.push(dx * sign, dy * sign, dz * sign);
					this.uvs.push(0.5, 0.5);
					this.colors.push(...this.colour);
				}
				for (let i = 0; i < segments; i++) {
					const a = middle + 1 + i;
					const b = middle + 1 + ((i + 1) % segments);
					if (sign > 0) this.indices.push(middle, a, b);
					else this.indices.push(middle, b, a);
				}
			}
		}
		return this;
	}

	/**
	 * An upright rectangle facing the horizontal direction (`facingX`, `facingZ`), its texture the
	 * right way round for someone looking at it: u runs left to right, v bottom to top.
	 */
	addQuad(center: readonly [number, number, number], width: number, height: number, facingX: number, facingZ: number): this {
		const length = Math.hypot(facingX, facingZ) || 1;
		const nx = facingX / length;
		const nz = facingZ / length;
		// The viewer's right, looking back along the facing.
		const rx = nz;
		const rz = -nx;
		const base = this.positions.length / 3;
		for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			this.positions.push(center[0] + rx * su * width / 2, center[1] + sv * height / 2, center[2] + rz * su * width / 2);
			this.normals.push(nx, 0, nz);
			this.uvs.push((su + 1) / 2, (sv + 1) / 2);
			this.colors.push(...this.colour);
		}
		this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
		return this;
	}

	build(device: GraphicsDevice): Mesh {
		const mesh = new Mesh(device);
		mesh.setPositions(this.positions);
		mesh.setNormals(this.normals);
		mesh.setUvs(0, this.uvs);
		if (this.coloured) mesh.setColors(this.colors);
		mesh.setIndices(this.indices);
		mesh.update();
		return mesh;
	}
}
