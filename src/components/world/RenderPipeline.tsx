"use client";

import { useApp } from "@playcanvas/react/hooks";
import type { Entity as PlayCanvasEntity } from "playcanvas";
import { useEffect } from "react";

import { installRenderPipeline } from "@/engine/orion/rendering/RenderPipeline";

/** Mounts the HDR frame, bloom and adaptive-resolution pipeline on the camera. */
export function RenderPipeline({ camera }: Readonly<{ camera: PlayCanvasEntity }>) {
	const app = useApp();

	useEffect(() => {
		const component = camera.camera;
		if (!app || !component) return;
		return installRenderPipeline(app, component);
	}, [app, camera]);

	return null;
}
