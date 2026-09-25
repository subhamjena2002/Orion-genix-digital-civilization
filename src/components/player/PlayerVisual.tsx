"use client";

import { Container, Entity } from "@playcanvas/react";
import { Render, Script } from "@playcanvas/react/components";
import { useMaterial, useModel } from "@playcanvas/react/hooks";

import { ORION_ASSET_PATHS } from "@/engine/orion/assets/AssetPaths";
import { OrionCharacterAnimation } from "@/engine/orion/player/OrionCharacterAnimation";
import { OrionPlayerBody } from "@/engine/orion/player/OrionPlayerBody";
import { OrionSkinnedCharacterAnimation } from "@/engine/orion/player/OrionSkinnedCharacterAnimation";
import { PLAYER_VISUAL_NAME } from "@/engine/orion/player/PlayerPose";

/**
 * The GLB's skeleton measures ~4.75 units tall (its armature carries a 100x scale), while the
 * player's collision capsule is 1.8 — so the raw model renders ~2.6x oversized and dwarfs the
 * buildings. This brings it down to capsule height; the offset drops the feet onto the
 * capsule's base rather than leaving the character hovering above it.
 */
const CHARACTER_SCALE = 1.8 / 4.75;

/** The primitive placeholder is authored ~2.59 units tall with its feet at -0.32. */
const PRIMITIVE_SCALE = 1.8 / 2.59;
const PRIMITIVE_FOOT_LIFT = 0.32 * PRIMITIVE_SCALE;

/**
 * Real rigged/animated character (Quaternius "Animated Men Pack", CC0). Falls back to the
 * primitive placeholder while it streams in, matching the pattern used for hero buildings.
 */
export function PlayerVisual() {
	const { asset, loading } = useModel(ORION_ASSET_PATHS.character);
	const { asset: bodyAsset } = useModel(ORION_ASSET_PATHS.playerCharacter);

	// The player's own entity is a dynamic rigidbody with its rotation locked by physics,
	// which overwrites any transform the controller sets on it. So facing is applied to this
	// visual child instead — the collider is a capsule, so its own spin is irrelevant.
	return (
		<Entity name={PLAYER_VISUAL_NAME} position={[0, -0.9, 0]}>
			{loading || !asset ? (
				<Entity name="fallback-scale" position={[0, PRIMITIVE_FOOT_LIFT, 0]} scale={[PRIMITIVE_SCALE, PRIMITIVE_SCALE, PRIMITIVE_SCALE]}>
					<PrimitivePlayerVisual />
				</Entity>
			) : (
				<>
					{/* Animates the player. Hidden once the player's own body below is ready, which it drives. */}
					<Entity name="character-scale" scale={[CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE]}>
						<Container asset={asset}>
							<Script script={OrionSkinnedCharacterAnimation} asset={asset} />
						</Container>
					</Entity>
					{bodyAsset ? (
						<Entity name="player-body">
							<Container asset={bodyAsset}>
								<Script script={OrionPlayerBody} sourceAsset={asset} />
							</Container>
						</Entity>
					) : null}
				</>
			)}
		</Entity>
	);
}

function PrimitivePlayerVisual() {
	const skin = useMaterial({ diffuse: "#8d5b43", gloss: 0.3 });
	const jacket = useMaterial({ diffuse: "#1d2a35", gloss: 0.32 });
	const shirt = useMaterial({ diffuse: "#2c4256", gloss: 0.22 });
	const accent = useMaterial({ diffuse: "#d7b77a", gloss: 0.5, metalness: 0.15 });
	const trousers = useMaterial({ diffuse: "#1a1e24", gloss: 0.24 });
	const shoes = useMaterial({ diffuse: "#0f1215", gloss: 0.46 });
	const sole = useMaterial({ diffuse: "#3a332c", gloss: 0.1 });
	const hair = useMaterial({ diffuse: "#171313", gloss: 0.22 });
	const eyes = useMaterial({ diffuse: "#0b1218", gloss: 0.55 });

	return (
		<Entity name="male-player-character">
			<Script script={OrionCharacterAnimation} />

			<Entity name="torso" position={[0, 1.02, 0]}>
				<Entity name="torso-body" scale={[0.6, 0.78, 0.34]}>
					<Render type="box" material={jacket} castShadows />
				</Entity>
				<Entity name="torso-shirt" position={[0, 0.05, 0.16]} scale={[0.32, 0.5, 0.06]}>
					<Render type="box" material={shirt} />
				</Entity>
				<Entity name="torso-collar" position={[0, 0.36, 0.1]} rotation={[18, 0, 0]} scale={[0.44, 0.08, 0.22]}>
					<Render type="box" material={accent} castShadows />
				</Entity>
				<Entity name="torso-belt" position={[0, -0.38, 0]} scale={[0.62, 0.09, 0.36]}>
					<Render type="box" material={accent} />
				</Entity>
				<Entity name="neck" position={[0, 0.44, 0]} scale={[0.2, 0.12, 0.2]}>
					<Render type="cylinder" material={skin} castShadows />
				</Entity>
				<Entity name="left-shoulder" position={[-0.31, 0.32, 0]} scale={[0.22, 0.22, 0.22]}>
					<Render type="sphere" material={jacket} castShadows />
				</Entity>
				<Entity name="right-shoulder" position={[0.31, 0.32, 0]} scale={[0.22, 0.22, 0.22]}>
					<Render type="sphere" material={jacket} castShadows />
				</Entity>
			</Entity>

			<Entity name="head" position={[0, 1.86, 0]} scale={[0.33, 0.35, 0.33]}>
				<Render type="sphere" material={skin} castShadows />
			</Entity>
			<Entity name="hair" position={[0, 2.08, -0.02]} scale={[0.345, 0.16, 0.345]}>
				<Render type="sphere" material={hair} castShadows />
			</Entity>
			<Entity name="left-eye" position={[-0.11, 1.9, 0.3]} scale={[0.04, 0.04, 0.02]}>
				<Render type="sphere" material={eyes} />
			</Entity>
			<Entity name="right-eye" position={[0.11, 1.9, 0.3]} scale={[0.04, 0.04, 0.02]}>
				<Render type="sphere" material={eyes} />
			</Entity>

			<Entity name="left-arm" position={[-0.44, 1.36, 0]} rotation={[0, 0, -5]} scale={[0.16, 0.62, 0.16]}>
				<Render type="capsule" material={jacket} castShadows />
				<Entity name="left-hand" position={[0, -0.58, 0]} scale={[0.62, 0.34, 0.62]}>
					<Render type="sphere" material={skin} castShadows />
				</Entity>
			</Entity>
			<Entity name="right-arm" position={[0.44, 1.36, 0]} rotation={[0, 0, 5]} scale={[0.16, 0.62, 0.16]}>
				<Render type="capsule" material={jacket} castShadows />
				<Entity name="right-hand" position={[0, -0.58, 0]} scale={[0.62, 0.34, 0.62]}>
					<Render type="sphere" material={skin} castShadows />
				</Entity>
			</Entity>

			<Entity name="left-leg" position={[-0.2, 0.34, 0]} scale={[0.19, 0.66, 0.19]}>
				<Render type="capsule" material={trousers} castShadows />
				<Entity name="left-shoe" position={[0, -0.62, 0.1]} scale={[1.15, 0.34, 2.1]}>
					<Render type="box" material={shoes} castShadows />
				</Entity>
				<Entity name="left-sole" position={[0, -0.79, 0.1]} scale={[1.2, 0.08, 2.2]}>
					<Render type="box" material={sole} />
				</Entity>
			</Entity>
			<Entity name="right-leg" position={[0.2, 0.34, 0]} scale={[0.19, 0.66, 0.19]}>
				<Render type="capsule" material={trousers} castShadows />
				<Entity name="right-shoe" position={[0, -0.62, 0.1]} scale={[1.15, 0.34, 2.1]}>
					<Render type="box" material={shoes} castShadows />
				</Entity>
				<Entity name="right-sole" position={[0, -0.79, 0.1]} scale={[1.2, 0.08, 2.2]}>
					<Render type="box" material={sole} />
				</Entity>
			</Entity>
		</Entity>
	);
}
