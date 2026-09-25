import { Layer, type AppBase, type Entity } from "playcanvas";

const KEY_LIGHT_NAME = "key-light";
const layers = new WeakMap<AppBase, Layer>();

/**
 * A layer whose contents cast the sun's shadow but are never drawn by the camera.
 *
 * The shadow renderer gathers casters from every layer the light shines on, not just the ones
 * the camera renders. So a simplified stand-in placed here can cast a detailed object's shadow
 * in one draw call while the object itself draws without casting. Used for distant cars, whose
 * shadow is a few texels across: a single-mesh proxy casts the same shadow as forty material
 * groups did.
 *
 * Returns null until the sun exists.
 */
export function shadowOnlyLayer(app: AppBase): Layer | null {
	const existing = layers.get(app);
	if (existing) return existing;
	const light = (app.root.findByName(KEY_LIGHT_NAME) as Entity | null)?.light;
	if (!light) return null;
	const layer = new Layer({ name: "ShadowOnly" });
	app.scene.layers.push(layer);
	light.layers = [...light.layers, layer.id];
	layers.set(app, layer);
	return layer;
}
