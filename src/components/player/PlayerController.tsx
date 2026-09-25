"use client";

import { Entity } from "@playcanvas/react";
import { Collision, RigidBody, Script } from "@playcanvas/react/components";
import type { Entity as PlayCanvasEntity } from "playcanvas";
import { memo } from "react";

import { OrionThirdPersonController } from "@/engine/orion/player/OrionThirdPersonController";
import { PlayerVisual } from "./PlayerVisual";

interface PlayerControllerProps {
	cameraEntity: PlayCanvasEntity;
}

export const PlayerController = memo(function PlayerController({ cameraEntity }: Readonly<PlayerControllerProps>) {
	// Spawns on the pavement beside the central junction, out of the traffic.
	return (
		<Entity name="player" position={[8, 0.65, 16]}>
			<Collision type="capsule" radius={0.45} height={1.8} />
			<RigidBody type="dynamic" mass={70} linearDamping={0.02} angularDamping={1} angularFactor={[0, 0, 0]} />
			<PlayerVisual />
			<Script
				script={OrionThirdPersonController}
				camera={cameraEntity}
				walkSpeed={2}
				runSpeed={5.5}
				acceleration={16}
				braking={22}
				mouseSensitivity={0.12}
				jumpForce={450}
				cameraDistance={5.2}
				cameraHeight={1.5}
			/>
		</Entity>
	);
});