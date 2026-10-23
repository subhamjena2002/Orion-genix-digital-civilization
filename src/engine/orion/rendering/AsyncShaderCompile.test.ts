import type { AppBase } from "playcanvas";
import { describe, expect, it } from "vitest";

import { enableAsyncShaderCompile } from "./AsyncShaderCompile";

interface FakeShader {
	ready: boolean;
}

/** A device, forward renderer and shadow renderer shaped like the engine's, recording each setShader. */
function fakeApp(withExtension = true) {
	const calls: { shader: FakeShader; asyncCompile: boolean | undefined }[] = [];
	const device = {
		shader: null as FakeShader | null,
		shaderValid: undefined as boolean | undefined,
		extParallelShaderCompile: withExtension ? {} : null,
		setShader(shader: FakeShader, asyncCompile?: boolean) {
			calls.push({ shader, asyncCompile });
			if (shader !== this.shader) {
				this.shader = shader;
				this.shaderValid = undefined;
			}
		},
	};
	const renderer = {
		renderForwardInternal(shader: FakeShader) {
			device.setShader(shader, false);
		},
		shadowRenderer: {
			submitCasters(shader: FakeShader) {
				device.setShader(shader);
			},
		},
	};
	const app = { graphicsDevice: device, renderer } as unknown as AppBase;
	/** A full-screen pass (post effects, clears): sets its shader outside the mesh passes. */
	const quad = (shader: FakeShader) => device.setShader(shader);
	return { app, device, renderer, quad, calls };
}

describe("async shader compile", () => {
	it("compiles mesh and shadow-caster shaders in the background once enabled", () => {
		const { app, renderer, calls } = fakeApp();
		const disable = enableAsyncShaderCompile(app);
		renderer.renderForwardInternal({ ready: false });
		renderer.shadowRenderer.submitCasters({ ready: false });
		expect(calls.map((call) => call.asyncCompile)).toEqual([true, true]);
		disable();
	});

	it("never changes full-screen passes, which must not skip a frame", () => {
		const { app, quad, calls } = fakeApp();
		const disable = enableAsyncShaderCompile(app);
		quad({ ready: false });
		expect(calls[0].asyncCompile).toBeUndefined();
		disable();
	});

	it("re-checks a still-compiling shader that is set again", () => {
		const { app, device, renderer } = fakeApp();
		const shader = { ready: false };
		const disable = enableAsyncShaderCompile(app);
		renderer.renderForwardInternal(shader);
		// The engine found it still compiling and skipped the draw.
		device.shaderValid = false;
		renderer.renderForwardInternal(shader);
		expect(device.shaderValid).toBeUndefined();
		disable();
	});

	it("puts everything back when disabled, and disabling twice is harmless", () => {
		const { app, device, renderer, calls } = fakeApp();
		const { setShader } = device;
		const { renderForwardInternal } = renderer;
		const { submitCasters } = renderer.shadowRenderer;
		const disable = enableAsyncShaderCompile(app);
		disable();
		disable();
		expect(device.setShader).toBe(setShader);
		expect(renderer.renderForwardInternal).toBe(renderForwardInternal);
		expect(renderer.shadowRenderer.submitCasters).toBe(submitCasters);
		renderer.renderForwardInternal({ ready: false });
		expect(calls[0].asyncCompile).toBe(false);
	});

	it("does nothing without the parallel-compile extension", () => {
		const { app, device, renderer, calls } = fakeApp(false);
		const { setShader } = device;
		const disable = enableAsyncShaderCompile(app);
		expect(device.setShader).toBe(setShader);
		renderer.renderForwardInternal({ ready: false });
		expect(calls[0].asyncCompile).toBe(false);
		disable();
	});
});

describe("async shader compile, held by several callers", () => {
	it("stays on until the last caller lets go, in whatever order they release", () => {
		const { app, device, renderer, calls } = fakeApp();
		const { setShader } = device;
		const { renderForwardInternal } = renderer;
		const first = enableAsyncShaderCompile(app);
		const second = enableAsyncShaderCompile(app);
		// Installed once, not wrapped twice.
		first();
		renderer.renderForwardInternal({ ready: false });
		expect(calls.at(-1)?.asyncCompile).toBe(true);
		first();
		second();
		expect(device.setShader).toBe(setShader);
		expect(renderer.renderForwardInternal).toBe(renderForwardInternal);
		// And it can be switched on again afterwards.
		const third = enableAsyncShaderCompile(app);
		renderer.renderForwardInternal({ ready: false });
		expect(calls.at(-1)?.asyncCompile).toBe(true);
		third();
		expect(device.setShader).toBe(setShader);
	});
});
