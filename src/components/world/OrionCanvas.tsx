"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  Application,
  Entity,
  } from "@playcanvas/react";

import { Light } from "@playcanvas/react/components";
import { Camera } from "@playcanvas/react/components";
import type { Entity as PlayCanvasEntity } from "playcanvas";
import { useApp, usePhysics } from "@playcanvas/react/hooks";
import { fetchAsset } from "@playcanvas/react/utils";

import { DEFAULT_GRAPHICS_SETTINGS, loadGraphicsSettings } from "@/engine/orion/rendering/GraphicsSettings";
import { shadowNormalOffset } from "@/engine/orion/rendering/RenderPipeline";
import { startResourceTracking, markGameReady } from "@/engine/orion/loading/GameResources";
import { playerControllerReady, setGameShowing } from "@/engine/orion/loading/GameReadiness";
import { isDeferredModel, loadDeferredModels } from "@/engine/orion/rendering/DeferredModels";
import { installTextureBudget, textureCapFor, thisDeviceClass } from "@/engine/orion/rendering/TextureBudget";
import { ORION_CHUNK_MANAGER, ORION_WORLD } from "@/engine/orion/OrionWorld";
import { OrionHUD } from "@/components/ui/OrionHUD";
import { PlayerController } from "@/components/player/PlayerController";
import { playerBodyUrl } from "@/components/player/PlayerVisual";
import { ORION_ASSET_PATHS } from "@/engine/orion/assets/AssetPaths";
import { DistrictScene } from "./DistrictScene";
import { OrionEnvironment } from "./OrionEnvironment";
import { RenderPipeline } from "./RenderPipeline";
import { applyDisplayPixelRatio } from "@/engine/orion/rendering/Renderer";
import { onPlayerRig, playerRig } from "@/engine/orion/player/PlayerRig";
import { BackgroundLoadStatus } from "./BackgroundLoadStatus";
import { GamePause } from "./GamePause";
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
 * How long the screen waits for the player's own body before settling for the stand-in: the
 * animated citizen the body is driven from, a complete working character. Only once that stand-in
 * is actually there — the screen never lifts on a timer alone with nobody to play.
 */
const PLAYER_BODY_WAIT_MS = 45_000;
/**
 * Once everything the game needs is up, the screen also waits for the other models and textures
 * already requested (cars, pedestrians, ground) to finish — but no longer than this, in case one
 * is stuck on a slow connection: each of those has a stand-in of its own while it loads.
 */
const ASSETS_SETTLE_MS = 15_000;
const SAMPLE_MS = 150;

/** Shares of the bar: engine and physics, then the world's files, then the sky and the player. */
const PHYSICS_SHARE = 0.12;
const ASSETS_SHARE = 0.72;

interface LoadState {
  progress: number;
  /** The game is playable (see below); stays true once it is. */
  assetsSettled: boolean;
  /** The player can be shown and moved. */
  playerReady: boolean;
  /** Startup files downloaded so far (ResourceLedger), and of those, what came from a cache. */
  loadedBytes: number;
  cachedBytes: number;
}

/**
 * How far the game has got, and whether it is ready. Ready means all of:
 *
 * - physics is running and the sky's lighting is baked (or, after ENVIRONMENT_WAIT_MS without
 *   the sky file, the world lit by the sun alone);
 * - the player's controller has started and its physics body exists: input moves the player;
 * - the player is visible: their own body, or after PLAYER_BODY_WAIT_MS the stand-in character —
 *   never nothing;
 * - the startup files requested so far have arrived (or ASSETS_SETTLE_MS has passed with only
 *   models that have stand-ins of their own still coming).
 *
 * The models deliberately loaded after this screen (DeferredModels) aren't waited for and aren't
 * counted. Sampled a few times a second until ready, then not at all; the bar never moves backwards.
 */
function useLoadProgress(app: ReturnType<typeof useApp> | null, physicsReady: boolean, environmentReady: boolean, playerBodyReady: boolean): LoadState {
  const [state, setState] = useState<LoadState>({ progress: 0.04, assetsSettled: false, playerReady: false, loadedBytes: 0, cachedBytes: 0 });
  // Across re-runs of the effect below (its inputs change as loading goes on): when loading began,
  // and whether it has finished — once ready, nothing that arrives later can undo it.
  const [startedAt] = useState(() => performance.now());
  const finished = useRef(false);
  useEffect(() => {
    if (finished.current) return;
    const ledger = startResourceTracking();
    let best = 0.04;
    let settledSince = 0;
    let player: PlayCanvasEntity | null = null;
    let id = 0;
    const sample = () => {
      let requested = 0;
      let arrived = 0;
      for (const asset of app?.assets.list() ?? []) {
        const url = (asset.file as { url?: string } | null)?.url;
        if (url && isDeferredModel(url)) continue;
        if (asset.loaded) {
          requested++;
          arrived++;
        } else if (asset.loading) {
          requested++;
        }
      }
      const now = performance.now();
      // Found once; the scene is only searched until the player exists.
      player ??= (app?.root.findByName("player") as PlayCanvasEntity | null) ?? null;
      const controllerUp = playerControllerReady() && Boolean(player?.rigidbody?.body);
      const standIn = Boolean(player?.findByName("character-scale"));
      const visible = playerBodyReady || (now - startedAt > PLAYER_BODY_WAIT_MS && standIn);
      const playerReady = controllerUp && visible;

      const files = requested === 0 ? 0 : arrived / requested;
      let target = physicsReady ? PHYSICS_SHARE + ASSETS_SHARE * files : 0.06;
      if (environmentReady) target += 0.08;
      if (playerReady) target += 0.08;
      const pending = requested - arrived;
      const essentials = physicsReady && environmentReady && playerReady;
      if (essentials && settledSince === 0) settledSince = now;
      const settled = essentials && (pending === 0 || now - settledSince > ASSETS_SETTLE_MS);
      if (settled) {
        finished.current = true;
        markGameReady();
        setGameShowing();
        window.clearInterval(id);
      }
      // Short of done, the bar stops just shy of the end.
      best = Math.max(best, settled ? 1 : Math.min(0.97, target));
      const loadedBytes = ledger?.startup.bytes ?? 0;
      const cachedBytes = ledger?.startup.cachedBytes ?? 0;
      setState((previous) => (
        previous.progress === best && previous.assetsSettled === settled && previous.playerReady === playerReady
          && previous.loadedBytes === loadedBytes && previous.cachedBytes === cachedBytes
          ? previous
          : { progress: best, assetsSettled: settled, playerReady, loadedBytes, cachedBytes }
      ));
    };
    sample();
    if (!finished.current) id = window.setInterval(sample, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [app, physicsReady, environmentReady, playerBodyReady, startedAt]);
  return state;
}

const OrionWorld = memo(function OrionWorld() {
  const [cameraEntity, setCameraEntity] = useState<PlayCanvasEntity | null>(null);
  const { isPhysicsLoaded, physicsError } = usePhysics();
  const app = useApp();
  // The world is near black until the sky's lighting is baked (the HDRI arrives alongside
  // the car and character models), so it stays behind the loading screen until then.
  const [environmentReady, setEnvironmentReady] = useState(false);
  const markEnvironmentReady = useCallback(() => setEnvironmentReady(true), []);
  const [playerBodyReady, setPlayerBodyReady] = useState(() => playerRig() !== null);

  useEffect(() => (app ? applyDisplayPixelRatio(app) : undefined), [app]);
  // Before any model loads (their fetches start in passive effects): caps their textures and
  // lets go of each bitmap once it's on the GPU.
  useLayoutEffect(() => {
    if (!app) return;
    return installTextureBudget(app, textureCapFor(thisDeviceClass(!loadGraphicsSettings().adaptiveQuality)));
  }, [app]);
  // The player's character first: the body is the largest file the game waits for, and requested
  // from PlayerVisual (mounted after the camera) it queued behind every car on the map. Started
  // here, before any component's own fetch (those run in passive effects); PlayerVisual's
  // useModel then picks up these same loads.
  useLayoutEffect(() => {
    if (!app) return;
    for (const url of [ORION_ASSET_PATHS.character, playerBodyUrl()]) {
      fetchAsset({ app, url, type: "container" }).catch(() => {
        // PlayerVisual handles a missing body: the stand-in stays.
      });
    }
  }, [app]);
  useEffect(() => {
    const timer = window.setTimeout(markEnvironmentReady, ENVIRONMENT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [markEnvironmentReady]);
  useEffect(() => onPlayerRig((rig) => {
    if (rig) setPlayerBodyReady(true);
  }), []);
	const activeChunks = ORION_CHUNK_MANAGER.update([0, 0, 0]);
  const load = useLoadProgress(app, isPhysicsLoaded, environmentReady, playerBodyReady);
  // The train, the army base, the aircraft and a few vehicles only start downloading once the
  // game is showing.
  useEffect(() => {
    if (!app || !cameraEntity || !load.assetsSettled) return;
    return loadDeferredModels(app, cameraEntity);
  }, [app, cameraEntity, load.assetsSettled]);

  if (physicsError) {
    return <LoadingScreen progress={load.progress} label="The physics engine couldn't start. Try reloading, or another browser." error />;
  }

  if (!isPhysicsLoaded) {
    return <LoadingScreen progress={load.progress} label="Starting the engine" loadedBytes={load.loadedBytes} cachedBytes={load.cachedBytes} />;
  }

  if (activeChunks.length === 0) {
    return <LoadingScreen progress={load.progress} label="The world couldn't be found. Try reloading." error />;
  }

  const label = load.assetsSettled
    ? "Ready"
    : !environmentReady
      ? "Loading the city"
      : !load.playerReady
        ? "Loading your character"
        : "Finishing up";

  return (
    <>
      <OrionEnvironment onReady={markEnvironmentReady} />
      <LoadingScreen progress={load.progress} label={label} done={load.assetsSettled} loadedBytes={load.loadedBytes} cachedBytes={load.cachedBytes} />
      {load.assetsSettled ? <BackgroundLoadStatus /> : null}

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
        <GamePause />
      </Application>

      <OrionHUD />
    </main>
  );
}


