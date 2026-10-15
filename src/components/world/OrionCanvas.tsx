"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useState } from "react";

import {
  Application,
  Entity,
  } from "@playcanvas/react";

import { Light } from "@playcanvas/react/components";
import { Camera } from "@playcanvas/react/components";
import type { Entity as PlayCanvasEntity } from "playcanvas";
import { useApp, usePhysics } from "@playcanvas/react/hooks";

import { DEFAULT_GRAPHICS_SETTINGS, loadGraphicsSettings } from "@/engine/orion/rendering/GraphicsSettings";
import { shadowNormalOffset } from "@/engine/orion/rendering/RenderPipeline";
import { installTextureBudget, textureCapFor, thisDeviceClass } from "@/engine/orion/rendering/TextureBudget";
import { ORION_CHUNK_MANAGER, ORION_WORLD } from "@/engine/orion/OrionWorld";
import { OrionHUD } from "@/components/ui/OrionHUD";
import { PlayerController } from "@/components/player/PlayerController";
import { DistrictScene } from "./DistrictScene";
import { OrionEnvironment } from "./OrionEnvironment";
import { RenderPipeline } from "./RenderPipeline";
import { applyDisplayPixelRatio } from "@/engine/orion/rendering/Renderer";
import { onPlayerRig, playerRig } from "@/engine/orion/player/PlayerRig";
import { LoadingScreen } from "./LoadingScreen";

// Module-level so re-renders hand the same arrays back: a fresh literal would make the entity
// re-apply its starting transform, snapping the camera back for a frame.
const CAMERA_START: [number, number, number] = [0, 4.5, 7];
/**
 * The sun, about 52° up. Its bearing lights the streets from the side: it used to sit behind the
 * camera at the spawn view, which front-lit everything flat and dropped every shadow out of sight
 * behind the thing casting it. Side light is what gives buildings and people their shape.
 */
const KEY_LIGHT_ROTATION: [number, number, number] = [38, 55, 0];
/**
 * The fill: straight opposite the sun's bearing, low (28° up), no shadows. Facades turned away
 * from the sun only had the sky's dim ambient, so a street looked bright one way and murky the
 * other; lit from behind as well, every side of the city reads in daylight.
 */
const FILL_LIGHT_ROTATION: [number, number, number] = [62, 235, 0];
/**
 * Longest the world stays hidden waiting for the sky. If the HDRI can't load at all, the world is
 * shown anyway (lit by the sun alone) rather than stuck behind the loading screen.
 */
/** Leans the cascade splits towards the camera, where texel density shows most. */
const SHADOW_CASCADE_DISTRIBUTION = 0.62;
const SHADOW_CASCADE_BLEND = 0.1;
/**
 * Shadow biasing. With the engine's defaults (no normal offset) every surface lit at a grazing
 * angle shadowed itself in fine diagonal stripes — "shadow acne" — which read as blotchy, cheap
 * paint on every car and van side. A normal offset sized to the shadow texel removes it (see
 * shadowNormalOffset; adaptive quality re-applies it when it changes the atlas size); checked
 * against the parked patrol cars at three times this value that shadows still meet the wheels.
 */
const SHADOW_BIAS = 0.02;
const SHADOW_NORMAL_OFFSET = shadowNormalOffset(DEFAULT_GRAPHICS_SETTINGS.shadowAtlasSize);
const ENVIRONMENT_WAIT_MS = 30_000;
/**
 * Longest the world waits for the player's own body (a large model). Until it's ready the player
 * would be drawn as the stand-in citizen, so the loading screen stays up; if the body never
 * arrives the stand-in is shown rather than nothing.
 */
const PLAYER_BODY_WAIT_MS = 45_000;
/**
 * Once the sky and the player are in, the screen also waits for the models and textures already
 * requested to finish — but no longer than this, in case one is stuck on a slow connection.
 */
const ASSETS_SETTLE_MS = 15_000;

/** Shares of the bar: engine and physics, then the world's files, then the sky and the player. */
const PHYSICS_SHARE = 0.12;
const ASSETS_SHARE = 0.72;

/**
 * How far the game has got: physics, then the share of requested assets (models, textures, the
 * sky) that have arrived, then the sky's lighting and the player's body. Sampled a few times a
 * second; the bar never moves backwards as more files are requested.
 */
function useLoadProgress(app: ReturnType<typeof useApp> | null, physicsReady: boolean, environmentReady: boolean, playerReady: boolean) {
  const [state, setState] = useState({ progress: 0.04, assetsSettled: false });
  useEffect(() => {
    let best = 0.04;
    let settledSince = 0;
    const sample = () => {
      let requested = 0;
      let arrived = 0;
      for (const asset of app?.assets.list() ?? []) {
        if (asset.loaded) {
          requested++;
          arrived++;
        } else if (asset.loading) {
          requested++;
        }
      }
      const files = requested === 0 ? 0 : arrived / requested;
      let target = physicsReady ? PHYSICS_SHARE + ASSETS_SHARE * files : 0.06;
      if (environmentReady) target += 0.08;
      if (playerReady) target += 0.08;
      const pending = requested - arrived;
      const now = performance.now();
      if (environmentReady && playerReady && settledSince === 0) settledSince = now;
      const settled = environmentReady && playerReady && (pending === 0 || now - settledSince > ASSETS_SETTLE_MS);
      // Short of done, the bar stops just shy of the end.
      best = Math.max(best, settled ? 1 : Math.min(0.97, target));
      setState((previous) => (previous.progress === best && previous.assetsSettled === settled ? previous : { progress: best, assetsSettled: settled }));
    };
    sample();
    const id = window.setInterval(sample, 150);
    return () => window.clearInterval(id);
  }, [app, physicsReady, environmentReady, playerReady]);
  return state;
}

const OrionWorld = memo(function OrionWorld() {
  const [cameraEntity, setCameraEntity] = useState<PlayCanvasEntity | null>(null);
  const { isPhysicsLoaded, physicsError } = usePhysics();
  const app = useApp();
  // The world is near black until the sky's lighting is baked (the HDRI arrives alongside
  // ~100 MB of car and character models), so it stays behind the loading screen until then.
  const [environmentReady, setEnvironmentReady] = useState(false);
  const markEnvironmentReady = useCallback(() => setEnvironmentReady(true), []);
  const [playerReady, setPlayerReady] = useState(() => playerRig() !== null);

  useEffect(() => (app ? applyDisplayPixelRatio(app) : undefined), [app]);
  // Before any model loads (their fetches start in passive effects): caps their textures and
  // lets go of each bitmap once it's on the GPU.
  useLayoutEffect(() => {
    if (!app) return;
    return installTextureBudget(app, textureCapFor(thisDeviceClass(!loadGraphicsSettings().adaptiveQuality)));
  }, [app]);
  useEffect(() => {
    const timer = window.setTimeout(markEnvironmentReady, ENVIRONMENT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [markEnvironmentReady]);
  useEffect(() => {
    const unsubscribe = onPlayerRig((rig) => {
      if (rig) setPlayerReady(true);
    });
    const timer = window.setTimeout(() => setPlayerReady(true), PLAYER_BODY_WAIT_MS);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
	const activeChunks = ORION_CHUNK_MANAGER.update([0, 0, 0]);
  const load = useLoadProgress(app, isPhysicsLoaded, environmentReady, playerReady);

  if (physicsError) {
    return <LoadingScreen progress={load.progress} label="The physics engine couldn't start. Try reloading, or another browser." error />;
  }

  if (!isPhysicsLoaded) {
    return <LoadingScreen progress={load.progress} label="Starting the engine" />;
  }

  if (activeChunks.length === 0) {
    return <LoadingScreen progress={load.progress} label="The world couldn't be found. Try reloading." error />;
  }

  const label = load.assetsSettled
    ? "Ready"
    : !environmentReady
      ? "Loading the city"
      : !playerReady
        ? "Loading your character"
        : "Finishing up";

  return (
    <>
      <OrionEnvironment onReady={markEnvironmentReady} />
      <LoadingScreen progress={load.progress} label={label} done={load.assetsSettled} />

      <Entity ref={setCameraEntity} name="third-person-camera" position={CAMERA_START}>
        <Camera
          fov={ORION_WORLD.rendering.cameraFov}
          nearClip={ORION_WORLD.rendering.cameraNearClip}
          farClip={ORION_WORLD.rendering.cameraFarClip}
          clearColor={ORION_WORLD.rendering.clearColor}
        />
      </Entity>

      <Entity name="key-light" rotation={KEY_LIGHT_ROTATION}>
        {/*
          The shadow settings live here rather than being set once on the light from
          RenderPipeline. @playcanvas/react re-applies a component's whole prop set — defaults
          included — on every render of that component, so anything configured imperatively was
          reset to the engine defaults the next time this tree re-rendered (which it does when
          the environment and the player body finish loading). The sun was running at 40 m with
          one 1024 cascade as a result. Adaptive quality still lowers the resolution from
          RenderPipeline; that is re-applied on each of its own changes.
        */}
        <Light
          type="directional"
          intensity={ORION_WORLD.rendering.keyLightIntensity}
          color={ORION_WORLD.rendering.keyLightColor}
          castShadows
          shadowDistance={DEFAULT_GRAPHICS_SETTINGS.shadowDistance}
          numCascades={DEFAULT_GRAPHICS_SETTINGS.shadowCascades}
          cascadeDistribution={SHADOW_CASCADE_DISTRIBUTION}
          cascadeBlend={SHADOW_CASCADE_BLEND}
          shadowResolution={DEFAULT_GRAPHICS_SETTINGS.shadowAtlasSize}
          shadowBias={SHADOW_BIAS}
          normalOffsetBias={SHADOW_NORMAL_OFFSET}
        />
      </Entity>

      <Entity name="fill-light" rotation={FILL_LIGHT_ROTATION}>
        <Light type="directional" intensity={ORION_WORLD.rendering.fillLightIntensity} color={ORION_WORLD.rendering.fillLightColor} />
      </Entity>

      <DistrictScene />

      {cameraEntity ? <PlayerController cameraEntity={cameraEntity} /> : null}
      {cameraEntity ? <RenderPipeline camera={cameraEntity} /> : null}
    </>
  );
});

export default function OrionCanvas() {

  return (
    <main className="orion-game relative h-dvh w-screen overflow-hidden bg-[#162128]">
      <Application
        fillMode="FILL_WINDOW"
        resolutionMode="AUTO"
        usePhysics
      >
        <OrionWorld />
      </Application>

      <OrionHUD />
    </main>
  );
}


