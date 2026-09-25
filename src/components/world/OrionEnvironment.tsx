"use client";

import { useEffect, useState } from "react";
import { Environment } from "@playcanvas/react/components";
import { useApp, useTexture } from "@playcanvas/react/hooks";
import { Asset, EnvLighting, type Texture } from "playcanvas";
import { ORION_ASSET_PATHS } from "@/engine/orion/assets/AssetPaths";
import { ORION_ACTIVE_TIME_OF_DAY, ORION_ENVIRONMENT_PROFILES } from "@/engine/orion/rendering/Environment";

/**
 * Sky and image-based lighting from the HDRI. Until it's baked the world has no sky and almost no
 * ambient light — near black — so `onReady` tells the caller when it's safe to show the world.
 */
export function OrionEnvironment({ onReady }: Readonly<{ onReady?: () => void }>) {
	const app = useApp();
	const { asset: hdrAsset } = useTexture(ORION_ASSET_PATHS.environments);
	const [atlasAsset, setAtlasAsset] = useState<Asset | null>(null);
	// Bumped when the GPU context comes back after being lost: the baked atlas lived on the GPU
	// and is gone, so it has to be baked again or the world stays dark.
	const [deviceGeneration, setDeviceGeneration] = useState(0);
	const profile = ORION_ENVIRONMENT_PROFILES[ORION_ACTIVE_TIME_OF_DAY];

	useEffect(() => {
		if (!app) return;
		const device = app.graphicsDevice;
		const restored = () => setDeviceGeneration((generation) => generation + 1);
		device.on("devicerestored", restored);
		return () => {
			device.off("devicerestored", restored);
		};
	}, [app]);

	useEffect(() => {
		const source = hdrAsset?.resource as Texture | undefined;
		if (!app || !source) return;

		const lightingSource = EnvLighting.generateLightingSource(source);
		const atlasTexture = EnvLighting.generateAtlas(lightingSource);
		lightingSource.destroy();

		const asset = new Asset("orion-env-atlas", "texture");
		asset.resource = atlasTexture;
		asset.loaded = true;
		// The atlas can only be baked once the GPU texture has loaded, so this result
		// is intrinsically effect-derived rather than a value computable during render.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setAtlasAsset(asset);

		return () => {
			atlasTexture.destroy();
			setAtlasAsset(null);
		};
	}, [app, hdrAsset, deviceGeneration]);

	useEffect(() => {
		if (atlasAsset) onReady?.();
	}, [atlasAsset, onReady]);

	if (!atlasAsset) return null;

	return (
		<Environment
			envAtlas={atlasAsset}
			showSkybox
			skyboxIntensity={profile.skyboxIntensity}
			exposure={profile.exposure}
		/>
	);
}
