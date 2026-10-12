"use client";

import { Entity } from "@playcanvas/react";
import { Render, Script } from "@playcanvas/react/components";
import { useApp } from "@playcanvas/react/hooks";
import { memo, useEffect, useMemo } from "react";

import { ORION_OCEAN } from "@/engine/orion/world/Ocean";
import { createOceanMaterial, createSeabedMaterial, createWaveNormalMap, OCEAN_SPAN, OrionOcean } from "@/engine/orion/world/OceanSurface";

/** How far below the surface the open-sea floor lies (where the beach's slope ends). */
const SEABED_DEPTH = 8.4;

/**
 * Open water surrounding the city, out to the horizon (see engine/world/OceanSurface).
 * Deliberately has no collider — the player falls through it and drowns (see
 * OrionThirdPersonController), rather than walking on the surface.
 */
export const Ocean = memo(function Ocean() {
	const app = useApp();
	const surface = useMemo(() => {
		if (!app) return null;
		const waves = createWaveNormalMap(app.graphicsDevice);
		return { waves, material: createOceanMaterial(waves), seabed: createSeabedMaterial() };
	}, [app]);

	useEffect(() => () => {
		surface?.material.destroy();
		surface?.seabed.destroy();
		surface?.waves.destroy();
	}, [surface]);

	if (!surface) return null;
	return (
		<Entity name="ocean" position={[0, ORION_OCEAN.level, 0]} scale={[OCEAN_SPAN, 1, OCEAN_SPAN]}>
			<Render type="plane" material={surface.material} castShadows={false} />
			{/* Travels with the sea (a child of it): under the land it's hidden by the ground. */}
			<Entity name="seabed" position={[0, -SEABED_DEPTH, 0]}>
				<Render type="plane" material={surface.seabed} castShadows={false} receiveShadows={false} />
			</Entity>
			<Script script={OrionOcean} material={surface.material} />
		</Entity>
	);
});
