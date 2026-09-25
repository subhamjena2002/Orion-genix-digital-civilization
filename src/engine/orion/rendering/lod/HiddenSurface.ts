/**
 * Finds the triangles of a model that can be seen from outside it.
 *
 * Detailed car models are built in layers: a body shell under the paint, an engine and chassis
 * inside, backing panels behind trim. At full detail the outer layer hides the rest exactly;
 * but simplify the layers separately and they drift by up to the error budget, and the inner
 * shell shows through the paint in patches. Removing never-visible triangles first fixes that,
 * and gives the simplifier far less to chew on.
 *
 * Method: the model is rendered from 26 directions around it (faces, edges and corners of a
 * cube) with orthographic cameras into an ID buffer — every triangle writes its own index as a
 * colour — and every index read back is visible. Transparent parts are left out of the render,
 * so what's behind glass (the cabin) still counts as visible; they are always kept themselves.
 *
 * Runs in a worker on an OffscreenCanvas with its own WebGL2 context, independent of the game's.
 */

export interface VisibilityInput {
	positions: Float32Array;
	indices: Uint32Array;
	/** Opaque geometry hides what's behind it; glass doesn't, and is always kept. */
	occluder: boolean;
}

const VERTEX_SHADER = `#version 300 es
in vec3 position;
uniform mat4 viewProjection;
uniform uint idOffset;
flat out uint triangleId;
void main() {
	// Draws are unindexed, so every three vertices are one triangle.
	triangleId = idOffset + uint(gl_VertexID / 3) + 1u;
	gl_Position = viewProjection * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
flat in uint triangleId;
out vec4 colour;
void main() {
	colour = vec4(float(triangleId & 255u), float((triangleId >> 8) & 255u), float((triangleId >> 16) & 255u), 255.0) / 255.0;
}`;

/** Whether this environment can run the ID render. */
export function canComputeVisibility(): boolean {
	if (typeof OffscreenCanvas === "undefined") return false;
	try {
		return new OffscreenCanvas(1, 1).getContext("webgl2") !== null;
	} catch {
		return false;
	}
}

/**
 * Per input, a flag per triangle: 1 if seen from any direction. Returns null if WebGL2 isn't
 * available here, or the model has more triangles than the ID encoding holds.
 */
export function visibleTriangles(inputs: readonly VisibilityInput[], resolution = 1024): Uint8Array[] | null {
	const totalTriangles = inputs.reduce((sum, input) => sum + input.indices.length / 3, 0);
	if (totalTriangles >= 0xffffff || typeof OffscreenCanvas === "undefined") return null;
	const canvas = new OffscreenCanvas(resolution, resolution);
	const gl = canvas.getContext("webgl2", { antialias: false, depth: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
	if (!gl) return null;

	const program = linkProgram(gl);
	if (!program) return null;
	gl.useProgram(program);
	const positionLocation = gl.getAttribLocation(program, "position");
	const viewProjectionLocation = gl.getUniformLocation(program, "viewProjection");
	const idOffsetLocation = gl.getUniformLocation(program, "idOffset");

	// Unindexed copies of the opaque geometry, one buffer per input.
	const draws: { buffer: WebGLBuffer; count: number; offset: number }[] = [];
	const offsets: number[] = [];
	let offset = 0;
	let min = [Infinity, Infinity, Infinity];
	let max = [-Infinity, -Infinity, -Infinity];
	for (const input of inputs) {
		offsets.push(offset);
		const triangles = input.indices.length / 3;
		if (input.occluder && triangles > 0) {
			const flat = new Float32Array(input.indices.length * 3);
			for (let i = 0; i < input.indices.length; i++) {
				const vertex = input.indices[i] * 3;
				for (let c = 0; c < 3; c++) {
					const value = input.positions[vertex + c];
					flat[i * 3 + c] = value;
					if (value < min[c]) min[c] = value;
					if (value > max[c]) max[c] = value;
				}
			}
			const buffer = gl.createBuffer();
			if (!buffer) return null;
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, flat, gl.STATIC_DRAW);
			draws.push({ buffer, count: input.indices.length, offset });
		}
		offset += triangles;
	}
	const visible = inputs.map((input) => new Uint8Array(input.indices.length / 3).fill(input.occluder ? 0 : 1));
	if (draws.length === 0) return visible;
	if (!Number.isFinite(min[0])) {
		min = [0, 0, 0];
		max = [0, 0, 0];
	}

	const centre = [0, 1, 2].map((c) => (min[c] + max[c]) / 2);
	const radius = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
	// Maps a global triangle index back to its input and local index.
	const owner = new Uint32Array(offset);
	inputs.forEach((input, index) => owner.fill(index, offsets[index], offsets[index] + input.indices.length / 3));

	gl.viewport(0, 0, resolution, resolution);
	gl.enable(gl.DEPTH_TEST);
	gl.disable(gl.CULL_FACE);
	gl.clearColor(0, 0, 0, 0);
	const pixels = new Uint8Array(resolution * resolution * 4);
	for (const direction of viewDirections()) {
		gl.uniformMatrix4fv(viewProjectionLocation, false, orthographicView(direction, centre, radius));
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		for (const draw of draws) {
			gl.bindBuffer(gl.ARRAY_BUFFER, draw.buffer);
			gl.enableVertexAttribArray(positionLocation);
			gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
			gl.uniform1ui(idOffsetLocation, draw.offset);
			gl.drawArrays(gl.TRIANGLES, 0, draw.count);
		}
		gl.readPixels(0, 0, resolution, resolution, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		for (let i = 0; i < pixels.length; i += 4) {
			const id = pixels[i] | (pixels[i + 1] << 8) | (pixels[i + 2] << 16);
			if (id === 0) continue;
			const global = id - 1;
			const input = owner[global];
			visible[input][global - offsets[input]] = 1;
		}
	}

	for (const draw of draws) gl.deleteBuffer(draw.buffer);
	gl.deleteProgram(program);
	gl.getExtension("WEBGL_lose_context")?.loseContext();
	return visible;
}

/** The index list with only the flagged triangles left. */
export function keepVisible(indices: Uint32Array, visible: Uint8Array): Uint32Array {
	let count = 0;
	for (let i = 0; i < visible.length; i++) count += visible[i];
	const kept = new Uint32Array(count * 3);
	let write = 0;
	for (let triangle = 0; triangle < visible.length; triangle++) {
		if (!visible[triangle]) continue;
		kept[write++] = indices[triangle * 3];
		kept[write++] = indices[triangle * 3 + 1];
		kept[write++] = indices[triangle * 3 + 2];
	}
	return kept;
}

/** The 26 directions from the centre of a cube to its faces, edges and corners, normalised. */
export function viewDirections(): [number, number, number][] {
	const directions: [number, number, number][] = [];
	for (let x = -1; x <= 1; x++) {
		for (let y = -1; y <= 1; y++) {
			for (let z = -1; z <= 1; z++) {
				if (x === 0 && y === 0 && z === 0) continue;
				const length = Math.hypot(x, y, z);
				directions.push([x / length, y / length, z / length]);
			}
		}
	}
	return directions;
}

/**
 * Column-major view-projection for an orthographic camera outside the model looking back along
 * `-direction` at `centre`, framing a sphere of `radius`.
 */
function orthographicView(direction: readonly number[], centre: readonly number[], radius: number): Float32Array {
	const forward = [-direction[0], -direction[1], -direction[2]];
	// Any up vector not parallel to the view direction.
	const helper = Math.abs(forward[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
	const right = normalise(cross(forward, helper));
	const up = cross(right, forward);
	const eye = [centre[0] + direction[0] * radius * 2, centre[1] + direction[1] * radius * 2, centre[2] + direction[2] * radius * 2];
	// View: rows are right, up, -forward; then an ortho box of +-radius, depth radius..3*radius.
	const near = radius;
	const far = radius * 3;
	const sx = 1 / radius;
	const sz = -2 / (far - near);
	const tz = -(far + near) / (far - near);
	const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const back = [-forward[0], -forward[1], -forward[2]];
	const m = new Float32Array(16);
	// Column-major: m[col * 4 + row].
	for (let col = 0; col < 3; col++) {
		m[col * 4] = right[col] * sx;
		m[col * 4 + 1] = up[col] * sx;
		m[col * 4 + 2] = back[col] * sz;
		m[col * 4 + 3] = 0;
	}
	m[12] = -dot(right, eye) * sx;
	m[13] = -dot(up, eye) * sx;
	m[14] = -dot(back, eye) * sz + tz;
	m[15] = 1;
	return m;
}

function cross(a: readonly number[], b: readonly number[]): number[] {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalise(v: number[]): number[] {
	const length = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / length, v[1] / length, v[2] / length];
}

function linkProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
	};
	const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
	const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
	const program = gl.createProgram();
	if (!vertex || !fragment || !program) return null;
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}
