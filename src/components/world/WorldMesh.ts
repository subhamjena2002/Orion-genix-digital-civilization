import { Mesh, PRIMITIVE_TRIANGLES, type AppBase, type GraphicsDevice, type MeshInstance } from "playcanvas";

import type { MeshData } from "@/engine/orion/world/MeshData";

/** A PlayCanvas mesh from pure geometry (see MeshData). */
export function toMesh(device: GraphicsDevice, data: MeshData): Mesh {
	const mesh = new Mesh(device);
	mesh.setPositions(data.positions);
	if (data.normals.length) mesh.setNormals(data.normals);
	if (data.uvs.length) mesh.setUvs(0, data.uvs);
	if (data.colors?.length) mesh.setColors(data.colors);
	const wide = data.positions.length / 3 > 65535;
	mesh.setIndices(wide ? new Uint32Array(data.indices) : new Uint16Array(data.indices));
	mesh.update(PRIMITIVE_TRIANGLES);
	return mesh;
}

/** Geometry for physics only: positions and triangles. */
export function toCollisionMesh(device: GraphicsDevice, data: MeshData): Mesh {
	return toMesh(device, { positions: data.positions, normals: [], uvs: [], indices: data.indices });
}

/**
 * Draws `instances` for the first few frames even when they're out of view, then lets culling
 * resume. A material's shaders compile the first time it's drawn; left until the player first
 * looks at the mountains or drives onto a bridge, each one froze the game for ~70 ms. Returns
 * the cancel.
 */
export function compileUpFront(app: AppBase, instances: readonly MeshInstance[], frames = 3): () => void {
	for (const instance of instances) instance.cull = false;
	let left = frames;
	const restore = () => {
		for (const instance of instances) instance.cull = true;
		app.off("frameend", onFrame);
	};
	const onFrame = () => {
		if (--left <= 0) restore();
	};
	app.on("frameend", onFrame);
	return restore;
}
