"use client";

import { Container, Entity } from "@playcanvas/react";
import { Collision, RigidBody, Script } from "@playcanvas/react/components";
import { useModel } from "@playcanvas/react/hooks";
import { memo } from "react";

import { JET_CG_HEIGHT } from "@/engine/orion/aircraft/JetFlight";
import { JET_GEOMETRY, JET_MODEL } from "@/engine/orion/aircraft/JetModel";
import { OrionJet } from "@/engine/orion/aircraft/OrionJet";

const [, CG_Y, CG_Z] = JET_GEOMETRY.centreOfMass;

/**
 * A jet, parked on its stand (see engine/aircraft/OrionJet). The entity sits at the centre of
 * mass; the model, whose origin is at the ground between the wheels, hangs off it so that point
 * lands where it should. A kinematic box round the fuselage keeps people and cars out of it.
 */
export const Jet = memo(function Jet({ x, z, ground, heading }: Readonly<{ x: number; z: number; ground: number; heading: number }>) {
	const { asset } = useModel(JET_MODEL);
	return (
		<Entity name="jet" position={[x, ground + JET_CG_HEIGHT, z]} rotation={[0, heading, 0]}>
			<Collision type="box" halfExtents={[1.6, 1.3, 9.5]} linearOffset={[0, 0.2, 1.4]} />
			<RigidBody type="kinematic" />
			{asset ? (
				<Entity name="jet-model" position={[0, -CG_Y, -CG_Z]}>
					<Container asset={asset} castShadows />
				</Entity>
			) : null}
			<Script script={OrionJet} homeX={x} homeZ={z} homeGround={ground} homeHeading={heading} />
		</Entity>
	);
});
