import type { AppBase, CameraComponent } from "playcanvas";

let cached: CameraComponent | null = null;

/**
 * The scene's camera, found once and kept. `root.findComponents("camera")` walks every node in the
 * scene — around fifteen thousand here — and scripts calling it every frame cost several
 * milliseconds each. It's looked up again only if the camera it had was taken out of the scene.
 */
export function sceneCamera(app: AppBase): CameraComponent | null {
	if (cached && cached.entity && cached.entity.parent && cached.system.app === app) return cached;
	cached = (app.root.findComponents("camera")[0] as CameraComponent | undefined) ?? null;
	return cached;
}
