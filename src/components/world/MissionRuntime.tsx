"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity as PlayCanvasEntity, StandardMaterial } from "playcanvas";
import { memo, useEffect, useState } from "react";

import { readCombatHud } from "@/engine/orion/combat/CombatHud";
import { missionActorMarkers, missionStage, updateMissionActors } from "@/engine/orion/missions/MissionActors";
import { MISSIONS } from "@/engine/orion/missions/MissionCatalog";
import { missions, type MissionDefinition, type PlayerView } from "@/engine/orion/missions/MissionDirector";
import { playMissionFromGiver } from "@/engine/orion/missions/MissionFlow";
import { availableMissions, onProgressChange, readProgress, recordPass, resetProgress } from "@/engine/orion/missions/Progress";
import { clearWaypoint } from "@/engine/orion/navigation/Navigation";
import { clearWanted, readWanted } from "@/engine/orion/police/Wanted";
import { setControlsHeld } from "@/engine/orion/player/ControlHold";
import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { pavedHeightAt } from "@/engine/orion/roads/RoadNetwork";
import { terrainHeightAt } from "@/engine/orion/world/Mountains";

/** Step this close to a giver's marker to be offered their mission. */
const GIVER_TRIGGER = 2.6;
/** Walk this far off during the briefing and it's declined; and this far before it's offered again. */
const GIVER_LEAVE = 6;
/** Markers are only lit within this distance (they're seen from about a block away). */
const MARKER_RANGE = 220;
const MARKER_COLOUR = new Color(1, 0.78, 0.2);
/** Over a mission's cars and people: blue for a car to get in, red for whatever's to be destroyed. */
const FRIENDLY_COLOUR = new Color(0.25, 0.6, 1);
const TARGET_COLOUR = new Color(1, 0.2, 0.18);
/** At most this many cars and people out for a mission at once. */
const ACTOR_MARKERS = 8;
/** Heights of the marker above the ground under a car, and a person. */
const OVER_VEHICLE = 3.1;
const OVER_PERSON = 2.6;

/**
 * Missions in the world: ticks the director once a frame with where the player is, puts each
 * mission's cars and people in (see MissionActors), lights a gold marker at every giver with a
 * mission on offer, and opens the briefing when the player steps into one on foot. A mission
 * passed is paid out and saved (see Progress).
 */
export const MissionRuntime = memo(function MissionRuntime() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		missions.setStage(missionStage);
		const stopListening = missions.on((event) => {
			if (event.type === "started") {
				clearWanted();
				clearWaypoint();
			} else if (event.type === "complete") {
				recordPass(event.mission, event.seconds);
			}
		});
		const development = process.env.NODE_ENV !== "production";
		if (development) {
			// For trying missions out: __orionMissions.start("convoy") and so on.
			(window as unknown as Record<string, unknown>).__orionMissions = {
				list: () => MISSIONS.map((mission) => mission.id),
				start: (id: string) => playMissionFromGiver(id),
				progress: () => readProgress(),
				reset: () => resetProgress(),
				loseWanted: () => clearWanted(),
				director: missions,
			};
		}
		return () => {
			stopListening();
			missions.stop();
			missions.setStage(null);
			if (development) delete (window as unknown as Record<string, unknown>).__orionMissions;
		};
	}, []);

	useEffect(() => {
		if (!app || !root) return;
		const material = new StandardMaterial();
		material.name = "mission-marker";
		material.diffuse = new Color(0, 0, 0);
		material.emissive = MARKER_COLOUR;
		material.emissiveIntensity = 2;
		material.opacity = 0.4;
		material.blendType = BLEND_ADDITIVE;
		material.depthWrite = false;
		material.cull = CULLFACE_NONE;
		material.useLighting = false;
		material.useFog = false;
		material.update();

		// One marker per mission, made once and switched on and off: a glowing column and a ring.
		const markers = new Map<string, PlayCanvasEntity>();
		for (const mission of MISSIONS) {
			const marker = new PlayCanvasEntity(`mission-marker-${mission.id}`);
			const column = new PlayCanvasEntity("column");
			column.addComponent("render", { type: "cylinder", material, castShadows: false, receiveShadows: false });
			column.setLocalScale(1.6, 3, 1.6);
			column.setLocalPosition(0, 1.5, 0);
			const ring = new PlayCanvasEntity("ring");
			ring.addComponent("render", { type: "torus", material, castShadows: false, receiveShadows: false });
			ring.setLocalScale(GIVER_TRIGGER * 2, 0.5, GIVER_TRIGGER * 2);
			ring.setLocalPosition(0, 0.12, 0);
			marker.addChild(column);
			marker.addChild(ring);
			const { x, z } = mission.giver;
			marker.setPosition(x, pavedHeightAt(x, z) ?? terrainHeightAt(x, z), z);
			marker.enabled = false;
			root.addChild(marker);
			markers.set(mission.id, marker);
		}

		// Chevrons over the mission's cars and people, made once and reused.
		const actorMaterial = (colour: Color) => {
			const made = new StandardMaterial();
			made.diffuse = new Color(0, 0, 0);
			made.emissive = colour;
			made.emissiveIntensity = 1.6;
			made.useLighting = false;
			made.useFog = false;
			made.update();
			return made;
		};
		const friendly = actorMaterial(FRIENDLY_COLOUR);
		const hostile = actorMaterial(TARGET_COLOUR);
		const chevrons = Array.from({ length: ACTOR_MARKERS }, (_, index) => {
			const chevron = new PlayCanvasEntity(`mission-chevron-${index}`);
			chevron.addComponent("render", { type: "cone", material: friendly, castShadows: false, receiveShadows: false });
			chevron.setLocalScale(0.7, 0.9, 0.7);
			chevron.enabled = false;
			root.addChild(chevron);
			return chevron;
		});

		// What's on offer only changes when a mission is passed.
		let offered: MissionDefinition[] = availableMissions(MISSIONS);
		const stopWatchingProgress = onProgressChange(() => {
			offered = availableMissions(MISSIONS);
		});
		/** Declined (or just finished) here: not offered again until the player has walked off. */
		let heldBack: string | null = null;
		const view: PlayerView = { x: 0, y: 0, z: 0, vehicleIntegrity: 100, wantedStars: 0 };
		let time = 0;

		const update = (dt: number) => {
			const pose = readPlayerPose();
			const wanted = readWanted();
			view.x = pose.x;
			view.y = pose.y;
			view.z = pose.z;
			view.vehicleIntegrity = pose.vehicleIntegrity;
			view.wantedStars = wanted.stars;
			updateMissionActors();
			missions.update(dt, view);
			// On the grid through a race's countdown.
			setControlsHeld(missions.raceCountdown > 0);

			const phase = missions.phase;
			// Givers only deal with someone who's on foot, alive, and not wanted by the police.
			const free = phase !== "active" && phase !== "briefing";
			const combat = readCombatHud();
			const canStart = free && !pose.inVehicle && !combat.wasted && !combat.busted && wanted.stars === 0;
			time += dt;
			material.opacity = 0.32 + 0.1 * Math.sin(time * 2.5);
			material.update();
			for (const [id, marker] of markers) {
				const mission = offered.find((candidate) => candidate.id === id);
				const distance = mission ? Math.hypot(mission.giver.x - pose.x, mission.giver.z - pose.z) : Infinity;
				const lit = free && distance < MARKER_RANGE;
				if (marker.enabled !== lit) marker.enabled = lit;
				if (!mission) continue;
				if (heldBack === id && distance > GIVER_LEAVE) heldBack = null;
				if (canStart && heldBack !== id && distance < GIVER_TRIGGER) {
					heldBack = id;
					missions.brief(mission);
				}
			}

			// Chevrons over the mission's people, and its cars (bar the one the player's driving).
			let used = 0;
			if (phase === "active") {
				const objective = missions.objective;
				const quarry = objective?.kind === "destroyVehicles" ? objective.ids : [];
				const actors = missionActorMarkers();
				const bob = Math.sin(time * 3) * 0.25;
				const place = (x: number, z: number, height: number, target: boolean) => {
					const chevron = chevrons[used++];
					if (!chevron) return;
					const material = target ? hostile : friendly;
					const render = chevron.render;
					if (render && render.material !== material) render.material = material;
					chevron.setPosition(x, (pavedHeightAt(x, z) ?? terrainHeightAt(x, z)) + height + bob, z);
					chevron.setEulerAngles(180, time * 90, 0);
					if (!chevron.enabled) chevron.enabled = true;
				};
				for (const person of actors.people) place(person.x, person.z, OVER_PERSON, true);
				for (const car of actors.vehicles) {
					const target = quarry.includes(car.id);
					if (!target && pose.inVehicle && Math.hypot(car.x - pose.x, car.z - pose.z) < 4) continue;
					place(car.x, car.z, OVER_VEHICLE, target);
				}
			}
			for (let index = used; index < chevrons.length; index++) if (chevrons[index].enabled) chevrons[index].enabled = false;

			// Walked out of the briefing: the offer's off.
			const briefing = missions.phase === "briefing" ? missions.mission : null;
			if (briefing && Math.hypot(briefing.giver.x - pose.x, briefing.giver.z - pose.z) > GIVER_LEAVE) missions.decline();
		};
		app.on("update", update);
		return () => {
			app.off("update", update);
			setControlsHeld(false);
			stopWatchingProgress();
			for (const marker of markers.values()) marker.destroy();
			for (const chevron of chevrons) chevron.destroy();
			material.destroy();
			friendly.destroy();
			hostile.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="missions" />;
});
