"use client";

import { useApp } from "@playcanvas/react/hooks";
import { Vec3, type Entity } from "playcanvas";
import { useEffect } from "react";

import type { PropertyRecord } from "@/engine/orion/properties/Properties";
import { sceneCamera } from "@/engine/orion/rendering/SceneCamera";

/** The parcels' surface entity (see DistrictScene's Parcel), and their footprint. */
const PARCEL_SURFACE = "parcel-surface";
const PARCEL_HALF_WIDTH = 6.5;
const PARCEL_HALF_DEPTH = 6;

interface Physics {
	raycastFirst(from: Vec3, to: Vec3): { entity: Entity; point: Vec3 } | null;
}

/**
 * Clicking a parcel selects its property: one physics ray, cast only when there's a click.
 *
 * The parcels used to carry an `onClick`, and any pointer handler in the scene makes
 * @playcanvas/react pick through the GPU on every frame the pointer has moved — which, with the
 * mouse steering the camera, is every frame of play: the whole scene drawn a second time into a
 * picking buffer, plus a search of every node for the camera. That was most of the game's stutter.
 * With the pointer locked (aiming), the click picks under the crosshair at the centre.
 */
export function useParcelClicks(properties: readonly PropertyRecord[], onSelect: (propertyId: string) => void) {
	const app = useApp();
	useEffect(() => {
		if (!app) return;
		const canvas = app.graphicsDevice.canvas;
		const from = new Vec3();
		const to = new Vec3();
		const onClick = (event: MouseEvent) => {
			const camera = sceneCamera(app);
			const physics = app.systems.rigidbody as unknown as Physics | undefined;
			if (!camera || !physics) return;
			const rect = canvas.getBoundingClientRect();
			const locked = document.pointerLockElement === canvas;
			const x = locked ? rect.width / 2 : event.clientX - rect.left;
			const y = locked ? rect.height / 2 : event.clientY - rect.top;
			camera.screenToWorld(x, y, camera.nearClip, from);
			camera.screenToWorld(x, y, camera.farClip, to);
			const hit = physics.raycastFirst(from, to);
			if (!hit || hit.entity.name !== PARCEL_SURFACE) return;
			const property = properties.find((candidate) => (
				Math.abs(hit.point.x - candidate.position[0]) <= PARCEL_HALF_WIDTH
				&& Math.abs(hit.point.z - candidate.position[2]) <= PARCEL_HALF_DEPTH
			));
			if (property) onSelect(property.id);
		};
		canvas.addEventListener("click", onClick);
		return () => canvas.removeEventListener("click", onClick);
	}, [app, properties, onSelect]);
}
