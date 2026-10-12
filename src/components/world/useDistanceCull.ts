"use client";

import { useApp } from "@playcanvas/react/hooks";
import type { AppBase, Entity as PlayCanvasEntity, MeshInstance } from "playcanvas";
import { useEffect } from "react";

import { registerDistanceCull, updateDistanceCull } from "@/engine/orion/rendering/DistanceCull";

/**
 * Hides `entity` (by switching it off) when the camera is further than `maxDistance` from it.
 * Its position is read at each check, so a jet or gunship that has flown off is judged where
 * it is now.
 */
export function useDistanceCull(entity: PlayCanvasEntity | null, maxDistance: number, halfSize: number) {
	useEffect(() => {
		if (!entity) return;
		return registerDistanceCull({
			get x() {
				return entity.getPosition().x;
			},
			get z() {
				return entity.getPosition().z;
			},
			halfX: halfSize,
			halfZ: halfSize,
			maxDistance,
			isShown: () => entity.enabled,
			apply: (shown) => {
				entity.enabled = shown;
			},
		});
	}, [entity, maxDistance, halfSize]);
}

interface BatchHandle {
	batchGroupId: number;
	meshInstance: MeshInstance;
}

/**
 * A static batch group as a cull target: its merged meshes are hidden by their visibility flag,
 * which (unlike switching the source entities off) doesn't make the batcher rebuild them.
 */
export function cullBatchGroup(app: AppBase, groupId: number, box: { x: number; z: number; halfX: number; halfZ: number }, maxDistance: number): () => void {
	// The batch list isn't public API; read each time, as a rebuild replaces it. Once the app is
	// destroyed (leaving the page unmounts the scene after it) there's no batcher: nothing to show.
	const batches = () => ((app.batcher as unknown as { _batchList: BatchHandle[] } | null)?._batchList ?? []).filter((batch) => batch.batchGroupId === groupId);
	return registerDistanceCull({
		...box,
		maxDistance,
		isShown: () => batches().some((batch) => batch.meshInstance.visible),
		apply: (shown) => {
			for (const batch of batches()) batch.meshInstance.visible = shown;
		},
	});
}

/** Runs the distance checks once a frame. Mount once, in the scene. */
export function DistanceCulling() {
	const app = useApp();
	useEffect(() => {
		if (!app) return;
		app.on("update", updateDistanceCull);
		return () => {
			app.off("update", updateDistanceCull);
		};
	}, [app]);
	return null;
}
