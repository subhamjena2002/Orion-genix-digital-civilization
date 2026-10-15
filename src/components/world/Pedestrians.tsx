"use client";

import { Container, Entity } from "@playcanvas/react";
import { Script } from "@playcanvas/react/components";
import { useModel } from "@playcanvas/react/hooks";
import { memo } from "react";

import { OrionPedestrian } from "@/engine/orion/characters/OrionPedestrian";
import { ORION_PEDESTRIANS, type PedestrianSpawn } from "@/engine/orion/characters/Pedestrians";
import { ALL_MISSIONS } from "@/engine/orion/missions/MissionCatalog";
import { missionSpawns, type PersonLook } from "@/engine/orion/missions/MissionDirector";

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
const CITIZEN = "/models/characters/orion-citizen";
/** The models a mission's people can wear, each scaled to human height (see Pedestrians). */
const PERSON_MODELS: Readonly<Record<NonNullable<PersonLook["model"]>, { path: string; scale: number; walkSpeed: number }>> = {
	manCasual: { path: `${CITIZEN}/orion-citizen-casual.glb`, scale: 1.8 / 4.74, walkSpeed: 1.5 },
	man: { path: `${CITIZEN}/orion-citizen.glb`, scale: 1.8 / 4.75, walkSpeed: 1.5 },
	woman: { path: `${CITIZEN}/citizen-woman-a.glb`, scale: 1, walkSpeed: 1 },
	womanSuit: { path: `${CITIZEN}/citizen-woman-suit.glb`, scale: 1, walkSpeed: 1 },
	womanWorker: { path: `${CITIZEN}/citizen-woman-worker.glb`, scale: 1, walkSpeed: 1 },
	womanCasual: { path: `${CITIZEN}/citizen-woman-casual.glb`, scale: 1, walkSpeed: 1 },
};

/**
 * Everyone any mission puts in the world, each their own slot (out of the world until needed). A
 * person several missions use is one slot, dressed as they're first listed.
 */
const MISSION_HOSTILES: readonly PedestrianSpawn[] = [
	...new Map(ALL_MISSIONS
		.flatMap(missionSpawns)
		.flatMap((spawn) => spawn.type === "hostile" ? [[spawn.id, spawn] as const] : [])).values(),
].map((spawn, index) => {
	const model = PERSON_MODELS[spawn.model ?? "manCasual"];
	return { id: spawn.id, assetPath: model.path, scale: model.scale, speed: 1.3, walkSpeed: model.walkSpeed, seed: 7717 * (index + 1), palette: spawn.palette ?? HOSTILE_PALETTE };
});

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
