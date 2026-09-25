"use client";

import { Container, Entity } from "@playcanvas/react";
import { useModel } from "@playcanvas/react/hooks";
import { memo } from "react";
import { ORION_ASSET_PATHS } from "@/engine/orion/assets/AssetPaths";

/**
 * Main_Intersection_v2.glb is a ~712x552-unit multi-block scene, far larger than the
 * procedural 4-way crossing it was originally meant to sit on. Rather than squash it
 * to fit (losing all detail) or overlay it on live gameplay geometry, it's placed at a
 * fixed location well clear of every procedural district as a standalone "showcase" —
 * a hero area demonstrating HD fidelity, not a literal replacement of any live intersection.
 *
 * Licensing note: this model's own glTF metadata embeds `copyright: "Numena GmbH"` — a
 * named commercial source, not a generic/CC0 asset. Verify licensing before public launch.
 */
export const SHOWCASE_POSITION: [number, number, number] = [0, 0, 900];

export const IntersectionShowcase = memo(function IntersectionShowcase() {
	const { asset, loading } = useModel(ORION_ASSET_PATHS.intersection);

	if (loading || !asset) return null;

	return (
		<Entity name="intersection-showcase" position={SHOWCASE_POSITION}>
			<Container asset={asset} />
		</Entity>
	);
});
