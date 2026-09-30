"use client";

import { Container, Entity } from "@playcanvas/react";
import { Collision, RigidBody, Script } from "@playcanvas/react/components";
import { useModel } from "@playcanvas/react/hooks";
import { memo } from "react";

import { GUNSHIP_MODEL } from "@/engine/orion/aircraft/GunshipModel";
import { GUNSHIP_CG_HEIGHT } from "@/engine/orion/aircraft/HelicopterFlight";
import { OrionGunship } from "@/engine/orion/aircraft/OrionGunship";

/**
 * The gunship, parked on its pad (see engine/aircraft/OrionGunship). The entity sits at the
 * centre of mass; the model, whose origin is on the ground under the mast, hangs below it.
 * A kinematic box round the fuselage keeps people and cars out of it.
 */
export const Gunship = memo(function Gunship({ x, z, ground, heading }: Readonly<{ x: number; z: number; ground: number; heading: number }>) {
	const { asset } = useModel(GUNSHIP_MODEL);
	return (
		<Entity name="gunship" position={[x, ground + GUNSHIP_CG_HEIGHT, z]} rotation={[0, heading, 0]}>
			<Collision type="box" halfExtents={[1.4, 1.6, 7.3]} linearOffset={[0, 0.05, -3.2]} />
			<RigidBody type="kinematic" />
			{asset ? (
				<Entity name="gunship-model" position={[0, -GUNSHIP_CG_HEIGHT, 0]}>
					<Container asset={asset} castShadows />
				</Entity>
			) : null}
			<Script script={OrionGunship} homeX={x} homeZ={z} homeGround={ground} homeHeading={heading} />
		</Entity>
	);
});
