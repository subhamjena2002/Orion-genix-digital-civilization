"use client";

import { Entity } from "@playcanvas/react";
import { Collision, RigidBody, Script } from "@playcanvas/react/components";
import type { Entity as PlayCanvasEntity } from "playcanvas";

import { OrionThirdPersonController } from "@/engine/orion/player/OrionThirdPersonController";
import { PlayerVisual } from "./PlayerVisual";

interface PlayerControllerProps {
	cameraEntity: PlayCanvasEntity;
}

export function PlayerController({ cameraEntity }: Readonly<PlayerControllerProps>) {
	return (
		<Entity name="player" position={[0, 0.65, 2.5]}>
			<Collision type="capsule" radius={0.45} height={1.8} />
			<RigidBody type="dynamic" mass={70} linearDamping={0.02} angularDamping={1} angularFactor={[0, 0, 0]} />
			<PlayerVisual />
			<Script
				script={OrionThirdPersonController}
				camera={cameraEntity}
				walkSpeed={4.8}
				runSpeed={9.2}
				acceleration={16}
				braking={22}
				mouseSensitivity={0.12}
				jumpForce={450}
				cameraDistance={5.5}
				cameraDistanceMin={3.2}
				cameraDistanceMax={8}
				cameraHeight={1.35}
				lookSens={0.14}
			/>
		</Entity>
	);
}