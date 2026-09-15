"use client";

import {
  useState } from "react";

import {
  Application,
  Entity,
  } from "@playcanvas/react";

import { Light } from "@playcanvas/react/components";
import { Camera } from "@playcanvas/react/components";
import type { Entity as PlayCanvasEntity } from "playcanvas";
import { usePhysics } from "@playcanvas/react/hooks";

import { ORION_CHUNK_MANAGER, ORION_WORLD } from "@/engine/orion/OrionWorld";
import { usePropertyStore } from "@/engine/orion/properties/PropertyStore";
import type { PropertyRecord } from "@/engine/orion/properties/Properties";
import { OrionHUD } from "@/components/ui/OrionHUD";
import { PlayerController } from "@/components/player/PlayerController";
import { DistrictScene } from "./DistrictScene";

interface OrionWorldProps {
  properties: readonly PropertyRecord[];
}

function OrionWorld({ properties }: Readonly<OrionWorldProps>) {
  const [cameraEntity, setCameraEntity] = useState<PlayCanvasEntity | null>(null);
  const { isPhysicsLoaded, physicsError } = usePhysics();
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
      <Entity ref={setCameraEntity} name="third-person-camera" position={[0, 4.5, 7]}>
        <Camera
          fov={ORION_WORLD.rendering.cameraFov}
          nearClip={ORION_WORLD.rendering.cameraNearClip}
          farClip={ORION_WORLD.rendering.cameraFarClip}
          clearColor={ORION_WORLD.rendering.clearColor}
        />
      </Entity>

      <Entity
        name="key-light"
        rotation={[38, -35, 0]}
      >
        <Light
          type="directional"
          intensity={ORION_WORLD.rendering.keyLightIntensity}
          castShadows
          shadowDistance={200}
          shadowResolution={2048}
        />
      </Entity>

      <Entity name="fill-light" rotation={[55, 135, 0]}>
        <Light type="directional" intensity={ORION_WORLD.rendering.fillLightIntensity} />
      </Entity>

      <DistrictScene properties={properties} />

      {cameraEntity ? <PlayerController cameraEntity={cameraEntity} /> : null}
    </>
  );
}

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


