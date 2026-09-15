"use client";

import { Entity } from "@playcanvas/react";
import { Render, Script } from "@playcanvas/react/components";
import { useMaterial } from "@playcanvas/react/hooks";

import { OrionCharacterAnimation } from "@/engine/orion/player/OrionCharacterAnimation";

export function PlayerVisual() {
	const skin = useMaterial({ diffuse: "#8d5b43", gloss: 0.32 });
	const shirt = useMaterial({ diffuse: "#273b4d", gloss: 0.24 });
	const trousers = useMaterial({ diffuse: "#20262d", gloss: 0.26 });
	const shoes = useMaterial({ diffuse: "#121619", gloss: 0.42 });
	const hair = useMaterial({ diffuse: "#171313", gloss: 0.2 });
	const eyes = useMaterial({ diffuse: "#101820", gloss: 0.5 });

	return (
		<Entity name="male-player-character" position={[0, -0.65, 0]}>
			<Script script={OrionCharacterAnimation} />
			<Entity name="torso" position={[0, 1.02, 0]} scale={[0.65, 1, 0.38]}>
				<Render type="box" material={shirt} castShadows />
			</Entity>
			<Entity name="head" position={[0, 1.93, 0]} scale={[0.38, 0.4, 0.38]}>
				<Render type="sphere" material={skin} castShadows />
			</Entity>
			<Entity name="hair" position={[0, 2.18, -0.02]} scale={[0.39, 0.18, 0.39]}>
				<Render type="sphere" material={hair} castShadows />
			</Entity>
			<Entity name="left-eye" position={[-0.13, 1.98, 0.34]} scale={[0.045, 0.045, 0.025]}>
				<Render type="sphere" material={eyes} />
			</Entity>
			<Entity name="right-eye" position={[0.13, 1.98, 0.34]} scale={[0.045, 0.045, 0.025]}>
				<Render type="sphere" material={eyes} />
			</Entity>
			<Entity name="left-arm" position={[-0.48, 1.03, 0]} rotation={[0, 0, -5]} scale={[0.18, 0.66, 0.18]}>
				<Render type="capsule" material={shirt} castShadows />
			</Entity>
			<Entity name="right-arm" position={[0.48, 1.03, 0]} rotation={[0, 0, 5]} scale={[0.18, 0.66, 0.18]}>
				<Render type="capsule" material={shirt} castShadows />
			</Entity>
			<Entity name="left-leg" position={[-0.22, 0.26, 0]} scale={[0.21, 0.62, 0.21]}>
				<Render type="capsule" material={trousers} castShadows />
			</Entity>
			<Entity name="right-leg" position={[0.22, 0.26, 0]} scale={[0.21, 0.62, 0.21]}>
				<Render type="capsule" material={trousers} castShadows />
			</Entity>
			<Entity name="left-shoe" position={[-0.22, -0.24, 0.08]} scale={[0.25, 0.16, 0.42]}>
				<Render type="box" material={shoes} castShadows />
			</Entity>
			<Entity name="right-shoe" position={[0.22, -0.24, 0.08]} scale={[0.25, 0.16, 0.42]}>
				<Render type="box" material={shoes} castShadows />
			</Entity>
		</Entity>
	);
}