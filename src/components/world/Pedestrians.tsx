"use client";

import { Container, Entity } from "@playcanvas/react";
import { Script } from "@playcanvas/react/components";
import { useModel } from "@playcanvas/react/hooks";
import { memo } from "react";

import { OrionPedestrian } from "@/engine/orion/characters/OrionPedestrian";
import { ORION_PEDESTRIANS, type PedestrianSpawn } from "@/engine/orion/characters/Pedestrians";

/**
 * The crowd is a fixed pool rather than a distance-culled list: pedestrians roam the whole
 * road network, so anyone who wanders too far is recycled near the player by their own script.
 * That keeps the population constant instead of mounting and unmounting skinned meshes.
 */
export const Pedestrians = memo(function Pedestrians() {
	return (
		<>
			{ORION_PEDESTRIANS.map((person) => <PedestrianVisual key={person.id} person={person} />)}
		</>
	);
});

function PedestrianVisual({ person }: Readonly<{ person: PedestrianSpawn }>) {
	const { asset, loading } = useModel(person.assetPath);
	if (loading || !asset) return null;

	return (
		<Entity name={person.id} scale={[person.scale, person.scale, person.scale]}>
			<Container asset={asset} />
			<Script
				script={OrionPedestrian}
				asset={asset}
				speed={person.speed}
				seed={person.seed}
				palette={person.palette}
			/>
		</Entity>
	);
}
