"use client";

import { Container, Entity } from "@playcanvas/react";
import { Script } from "@playcanvas/react/components";
import { useModel } from "@playcanvas/react/hooks";
import { memo } from "react";

import { OrionPedestrian } from "@/engine/orion/characters/OrionPedestrian";
import { ORION_PEDESTRIANS, type PedestrianSpawn } from "@/engine/orion/characters/Pedestrians";
import { MISSIONS } from "@/engine/orion/missions/MissionCatalog";

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

/** A crew's colours: dark trousers, the gang's red, so they read as a group from down the street. */
const HOSTILE_PALETTE = { skin: "#8d5a3b", shirt: "#a31515", pants: "#1c1c1f", hair: "#141010" };
const HOSTILE_MODEL = { path: "/models/characters/orion-citizen/orion-citizen-casual.glb", scale: 1.8 / 4.74 };

/** Everyone any mission sets against the player, each their own slot: out of the world until needed. */
const MISSION_HOSTILES: readonly PedestrianSpawn[] = [
	...new Set(MISSIONS
		.flatMap((mission) => [...(mission.spawns ?? []), ...mission.objectives.flatMap((objective) => objective.spawns ?? [])])
		.flatMap((spawn) => spawn.type === "hostile" ? [spawn.id] : [])),
].map((id, index) => ({ id, assetPath: HOSTILE_MODEL.path, scale: HOSTILE_MODEL.scale, speed: 1.3, walkSpeed: 1.5, seed: 7717 * (index + 1), palette: HOSTILE_PALETTE }));

/** A mission's hostiles (see OrionPedestrian.placeForMission). */
export const MissionHostiles = memo(function MissionHostiles() {
	return (
		<>
			{MISSION_HOSTILES.map((person, index) => <PedestrianVisual key={person.id} person={person} missionSlot={index} />)}
		</>
	);
});

function PedestrianVisual({ person, missionSlot = -1 }: Readonly<{ person: PedestrianSpawn; missionSlot?: number }>) {
	const { asset, loading } = useModel(person.assetPath);
	if (loading || !asset) return null;

	return (
		<Entity name={person.id} scale={[person.scale, person.scale, person.scale]}>
			<Container asset={asset} />
			<Script
				script={OrionPedestrian}
				asset={asset}
				speed={person.speed}
				walkSpeed={person.walkSpeed}
				seed={person.seed}
				palette={person.palette}
				missionSlot={missionSlot}
			/>
		</Entity>
	);
}
