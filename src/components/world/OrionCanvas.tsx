"use client";

import { memo, useCallback, useEffect, useState } from "react";

import {
  Application,
  Entity,
  } from "@playcanvas/react";

import { Light } from "@playcanvas/react/components";
import { Camera } from "@playcanvas/react/components";
import type { Entity as PlayCanvasEntity } from "playcanvas";
import { useApp, usePhysics } from "@playcanvas/react/hooks";

import { DEFAULT_GRAPHICS_SETTINGS } from "@/engine/orion/rendering/GraphicsSettings";
import { ORION_CHUNK_MANAGER, ORION_WORLD } from "@/engine/orion/OrionWorld";
import { usePropertyStore } from "@/engine/orion/properties/PropertyStore";
import type { PropertyRecord } from "@/engine/orion/properties/Properties";
import { OrionHUD } from "@/components/ui/OrionHUD";
import { PlayerController } from "@/components/player/PlayerController";
import { DistrictScene } from "./DistrictScene";
import { OrionEnvironment } from "./OrionEnvironment";
import { RenderPipeline } from "./RenderPipeline";
import { applyDisplayPixelRatio } from "@/engine/orion/rendering/Renderer";
import { onPlayerRig, playerRig } from "@/engine/orion/player/PlayerRig";

// Module-level so re-renders hand the same arrays back: a fresh literal would make the entity
// re-apply its starting transform, snapping the camera back for a frame.
const CAMERA_START: [number, number, number] = [0, 4.5, 7];
const KEY_LIGHT_ROTATION: [number, number, number] = [38, -35, 0];
const FILL_LIGHT_ROTATION: [number, number, number] = [55, 135, 0];
/**
 * Longest the world stays hidden waiting for the sky. If the HDRI can't load at all, the world is
 * shown anyway (lit by the sun alone) rather than stuck behind the loading screen.
 */
/** Leans the cascade splits towards the camera, where texel density shows most. */
const SHADOW_CASCADE_DISTRIBUTION = 0.62;
const SHADOW_CASCADE_BLEND = 0.1;
const ENVIRONMENT_WAIT_MS = 30_000;
/**
 * Longest the world waits for the player's own body (a large model). Until it's ready the player
 * would be drawn as the stand-in citizen, so the loading screen stays up; if the body never
 * arrives the stand-in is shown rather than nothing.
 */
const PLAYER_BODY_WAIT_MS = 45_000;

interface OrionWorldProps {
  properties: readonly PropertyRecord[];
  onSelectProperty: (propertyId: string) => void;
}

const OrionWorld = memo(function OrionWorld({ properties, onSelectProperty }: Readonly<OrionWorldProps>) {
  const [cameraEntity, setCameraEntity] = useState<PlayCanvasEntity | null>(null);
  const { isPhysicsLoaded, physicsError } = usePhysics();
  const app = useApp();
  // The world is near black until the sky's lighting is baked (the HDRI arrives alongside
  // ~100 MB of car and character models), so it stays behind the loading screen until then.
  const [environmentReady, setEnvironmentReady] = useState(false);
  const markEnvironmentReady = useCallback(() => setEnvironmentReady(true), []);
  const [playerReady, setPlayerReady] = useState(() => playerRig() !== null);

  useEffect(() => (app ? applyDisplayPixelRatio(app) : undefined), [app]);
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

  if (physicsError) {
    return <SceneMessage label="Physics could not be initialized" error />;
  }

  if (!isPhysicsLoaded) {
    return <SceneMessage label="Loading physics" />;
  }

  if (activeChunks.length === 0) {
    return <SceneMessage label="No world chunk available" error />;
  }

  return (
    <>
      <OrionEnvironment onReady={markEnvironmentReady} />
      {environmentReady ? (playerReady ? null : <SceneMessage label="Loading character" />) : <SceneMessage label="Loading environment" />}

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
          castShadows
          shadowDistance={DEFAULT_GRAPHICS_SETTINGS.shadowDistance}
          numCascades={DEFAULT_GRAPHICS_SETTINGS.shadowCascades}
          cascadeDistribution={SHADOW_CASCADE_DISTRIBUTION}
          cascadeBlend={SHADOW_CASCADE_BLEND}
          shadowResolution={DEFAULT_GRAPHICS_SETTINGS.shadowAtlasSize}
        />
      </Entity>

      <Entity name="fill-light" rotation={FILL_LIGHT_ROTATION}>
        <Light type="directional" intensity={ORION_WORLD.rendering.fillLightIntensity} />
      </Entity>

      <DistrictScene properties={properties} onSelectProperty={onSelectProperty} />

      {cameraEntity ? <PlayerController cameraEntity={cameraEntity} /> : null}
      {cameraEntity ? <RenderPipeline camera={cameraEntity} /> : null}
    </>
  );
});

function SceneMessage({ label, error = false }: Readonly<{ label: string; error?: boolean }>) {
  return (
    <div className={`absolute inset-0 z-20 flex items-center justify-center ${error ? "bg-[#211919]" : "bg-[#162128]"}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#d5d1c6]">{label}</p>
    </div>
  );
}

export default function OrionCanvas() {
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const { properties, acquireProperty, makeOffer } = usePropertyStore(ORION_WORLD.properties);
  const selectedProperty = properties.find((property) => property.id === selectedPropertyId) ?? null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#162128]">
      <Application
        fillMode="FILL_WINDOW"
        resolutionMode="AUTO"
        usePhysics
      >
        <OrionWorld
          properties={properties}
          onSelectProperty={setSelectedPropertyId}
        />
      </Application>

      <OrionHUD
        property={selectedProperty}
        onAcquire={acquireProperty}
        onOffer={makeOffer}
        onClear={() => setSelectedPropertyId(null)}
      />
    </main>
  );
}


