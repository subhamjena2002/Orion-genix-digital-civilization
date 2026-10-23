"use client";

import { Container, Entity } from "@playcanvas/react";
import { Collision, Script } from "@playcanvas/react/components";
import type { Entity as PlayCanvasEntity } from "playcanvas";
import { memo, useState } from "react";

import { KinematicBody } from "./KinematicBody";
import { useDeferredModel } from "./useDeferredModel";
import { useDistanceCull } from "./useDistanceCull";

import { GUNSHIP_MODEL } from "@/engine/orion/aircraft/GunshipModel";
import { GUNSHIP_CG_HEIGHT } from "@/engine/orion/aircraft/HelicopterFlight";
import { OrionGunship } from "@/engine/orion/aircraft/OrionGunship";
import { ARMY_BASE_AREA } from "@/engine/orion/rendering/DeferredModels";

/**
 * The gunship, parked on its pad (see engine/aircraft/OrionGunship). The entity sits at the
 * centre of mass; the model, whose origin is on the ground under the mast, hangs below it.
 * A kinematic box round the fuselage keeps people and cars out of it.
 */
export const Gunship = memo(function Gunship({ x, z, ground, heading }: Readonly<{ x: number; z: number; ground: number; heading: number }>) {
	const [model, setModel] = useState<PlayCanvasEntity | null>(null);
	// Parked across the city, it's a speck in the haze: not drawn beyond 280 m.
	useDistanceCull(model, 280, 9);
	// Loads after the loading screen, or at once if the player heads for the base (DeferredModels).
	const asset = useDeferredModel(GUNSHIP_MODEL, ARMY_BASE_AREA);
	return (
		<Entity name="gunship" position={[x, ground + GUNSHIP_CG_HEIGHT, z]} rotation={[0, heading, 0]}>
			<Collision type="box" halfExtents={[1.4, 1.6, 7.3]} linearOffset={[0, 0.05, -3.2]} />
			<KinematicBody />
			{asset ? (
				<Entity ref={setModel} name="gunship-model" position={[0, -GUNSHIP_CG_HEIGHT, 0]}>
					<Container asset={asset} castShadows />
				</Entity>
			) : null}
			<Script script={OrionGunship} homeX={x} homeZ={z} homeGround={ground} homeHeading={heading} />
		</Entity>
	);
});
