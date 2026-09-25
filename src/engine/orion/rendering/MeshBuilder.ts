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
