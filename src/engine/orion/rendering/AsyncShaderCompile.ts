import type { AppBase } from "playcanvas";

/**
 * Lets the GPU driver build new shaders off the main thread: a draw whose shaders are still
 * compiling is skipped, and drawn from the first frame they're done, instead of the frame waiting
 * for them. Used while the models loaded after the loading screen are prewarmed (ModelPrewarm,
 * `gradual`) — a material at a time, so only a couple of programs are ever building at once.
 *
 * The engine always asks for its mesh shaders to be ready before it draws with them, and on an
 * Intel Iris Xe under ANGLE/D3D11 each took ~140 ms of the main thread (profiled in Phase 2.1/2.2:
 * the time is spent in `gl.getProgramParameter`, waiting for the link). With KHR_parallel_shader_
 * compile it can skip and come back instead. Only mesh draws and shadow casters are switched, never
 * the full-screen passes (post effects, clears), which must not skip a frame. Without the extension
 * nothing changes: the engine reports every shader ready and compiles as before.
 *
 * This leans on engine internals (the device's `setShader`/`shaderValid`, the forward renderer's
 * `renderForwardInternal`, the shadow renderer's `submitCasters`); if any is missing, it does
 * nothing.
 */

interface ShaderLike {
	ready: boolean;
}

interface DeviceLike {
	shader: ShaderLike | null;
	shaderValid: boolean | undefined;
	setShader(shader: ShaderLike, asyncCompile?: boolean): void;
	extParallelShaderCompile?: unknown;
}

type Method = (...args: unknown[]) => unknown;

interface RendererLike {
	renderForwardInternal?: Method;
	shadowRenderer?: { submitCasters?: Method };
}

/** Per app: the installed switch and how many callers currently want it. */
const installed = new WeakMap<AppBase, { users: number; uninstall: () => void }>();

/**
 * Switches the mesh passes to compiling in the background; returns the switch back. Counted:
 * several callers (the deferred-model prewarm, the vehicle LOD material prewarm) may want it at
 * once, overlapping in any order, and it stays on until the last lets go — each wrapping and
 * unwrapping the engine methods for itself could leave a stale wrapper installed for good.
 */
export function enableAsyncShaderCompile(app: AppBase): () => void {
	let entry = installed.get(app);
	if (!entry) {
		entry = { users: 0, uninstall: install(app) };
		installed.set(app, entry);
	}
	const held = entry;
	held.users++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--held.users > 0) return;
		held.uninstall();
		if (installed.get(app) === held) installed.delete(app);
	};
}

function install(app: AppBase): () => void {
	const device = app.graphicsDevice as unknown as DeviceLike;
	const renderer = (app as unknown as { renderer?: RendererLike }).renderer;
	const shadows = renderer?.shadowRenderer;
	if (!device.extParallelShaderCompile || typeof device.setShader !== "function"
		|| typeof renderer?.renderForwardInternal !== "function" || typeof shadows?.submitCasters !== "function") {
		return () => {};
	}

	// Depth, so a pass that calls into another still counts as inside one.
	let inMeshPass = 0;
	const setShader = device.setShader;
	device.setShader = function (this: DeviceLike, shader: ShaderLike, asyncCompile?: boolean) {
		if (inMeshPass === 0) return setShader.call(this, shader, asyncCompile);
		// The device only re-checks a shader when a different one is set: a shader that was still
		// compiling when last set would otherwise stay skipped while it is set again and again.
		if (shader === this.shader && !shader.ready) this.shaderValid = undefined;
		return setShader.call(this, shader, true);
	};

	const restores = [wrapPass(renderer, "renderForwardInternal"), wrapPass(shadows, "submitCasters")];
	function wrapPass<T extends object>(owner: T, name: keyof T & string): () => void {
		const original = owner[name] as unknown as Method;
		(owner as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
			inMeshPass++;
			try {
				return original.apply(this, args);
			} finally {
				inMeshPass--;
			}
		};
		return () => {
			(owner as Record<string, unknown>)[name] = original;
		};
	}

	return () => {
		device.setShader = setShader;
		for (const restore of restores) restore();
	};
}
