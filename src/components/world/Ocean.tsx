"use client";

import { Entity } from "@playcanvas/react";
import { Render } from "@playcanvas/react/components";
import { useMaterial } from "@playcanvas/react/hooks";
import { memo } from "react";

import { ORION_OCEAN } from "@/engine/orion/world/Ocean";

/**
 * Open water surrounding the city. Deliberately has no collider — the player falls through
 * it and drowns (see OrionThirdPersonController), rather than walking on the surface.
 */
export const Ocean = memo(function Ocean() {
	const water = useMaterial({
		diffuse: "#14303f",
		gloss: 0.94,
		metalness: 0.4,
		useMetalness: true,
	});

	return (
		<Entity name="ocean" position={[0, ORION_OCEAN.level, 0]} scale={[ORION_OCEAN.size, 1, ORION_OCEAN.size]}>
			<Render type="plane" material={water} />
		</Entity>
	);
});
