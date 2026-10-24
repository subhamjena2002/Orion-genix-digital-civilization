"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity as PlayCanvasEntity, StandardMaterial } from "playcanvas";
import { memo, useEffect, useState } from "react";

import { createMissionVoice } from "@/engine/orion/audio/MissionVoice";
import { faceMissionPerson, missionPersonState, placeMissionHostile, releaseMissionHostiles } from "@/engine/orion/characters/OrionPedestrian";
import { readCombatHud } from "@/engine/orion/combat/CombatHud";
import { ALL_MANIFESTS_CASH, MANIFEST_CASH, MANIFESTS, manifestInReach } from "@/engine/orion/missions/Collectibles";
import { streetLeads } from "@/engine/orion/missions/Leads";
import { shotView, type ShotContext, type ShotPlace, type ShotSubject } from "@/engine/orion/missions/Cutscenes";
import { missionActorKind, missionActorMarkers, missionStage, updateMissionActors } from "@/engine/orion/missions/MissionActors";
import { isPassive, quarryOf } from "@/engine/orion/missions/MissionBlips";
import { ALL_MISSIONS, MISSIONS } from "@/engine/orion/missions/MissionCatalog";
import { giverPersonId, holds, missions, type MissionDefinition, type PlayerView } from "@/engine/orion/missions/MissionDirector";
import { abandonMission, playMissionFromGiver, retryMission } from "@/engine/orion/missions/MissionFlow";
import { availableMissions, collect, hasCollected, hasFlag, hasPassed, onProgressChange, readProgress, recordJob, recordPass, resetProgress, setFlags } from "@/engine/orion/missions/Progress";
import { clearWaypoint } from "@/engine/orion/navigation/Navigation";
import { clearWanted, readWanted } from "@/engine/orion/police/Wanted";
import { setCinematicView, type CinematicView } from "@/engine/orion/player/CinematicCamera";
import { setControlsHeld } from "@/engine/orion/player/ControlHold";
import { readCameraView, readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { pavedHeightAt } from "@/engine/orion/roads/RoadNetwork";
import { highwayGroundAt } from "@/engine/orion/world/Highways";
import { terrainHeightAt } from "@/engine/orion/world/Mountains";

/** Step this close to a giver's marker to be offered their mission. */
const GIVER_TRIGGER = 2.6;
/** Walk this far off during the briefing and it's declined; and this far before it's offered again. */
const GIVER_LEAVE = 6;
/** Markers are only lit within this distance (they're seen from about a block away). */
const MARKER_RANGE = 220;
const MARKER_COLOUR = new Color(1, 0.78, 0.2);
/** A street lead's marker: smaller, and teal, so it doesn't read as a story mission. */
const LEAD_COLOUR = new Color(0.2, 0.85, 0.72);
/** Over a mission's cars and people: blue for a car to get in or a friend, red for whatever's to be dealt with. */
const FRIENDLY_COLOUR = new Color(0.25, 0.6, 1);
const TARGET_COLOUR = new Color(1, 0.2, 0.18);
/** A manifest page's glint. */
const PAGE_COLOUR = new Color(1, 0.95, 0.8);
/** At most this many cars and people out for a mission at once. */
const ACTOR_MARKERS = 10;
/** Heights of the marker above the ground under a car, and a person. */
const OVER_VEHICLE = 3.1;
const OVER_PERSON = 2.6;
/** Manifest pages glint from this close. */
const PAGE_RANGE = 70;
/** A giver stands at their marker, in person, once the player's this close. */
const GIVER_RANGE = 70;
/** How high a cutscene looks at someone, a car, and a spot. */
const PERSON_HEIGHT = 1.62;
const VEHICLE_HEIGHT = 1.15;
const SPOT_HEIGHT = 1.5;

/** The ground a marker stands on: the streets, an expressway's deck, or the land. */
function groundAt(x: number, z: number): number {
	return pavedHeightAt(x, z) ?? highwayGroundAt(x, z) ?? terrainHeightAt(x, z);
}

/**
 * Missions in the world: ticks the director once a frame with where the player is, puts each
 * mission's cars and people in (see MissionActors), lights a gold marker at every giver with a
 * mission on offer and a teal one at a street lead, and opens the briefing when the player steps
 * into one on foot. A giver who has a look stands at their marker in person, and tells the
 * briefing to the player's face. A mission passed is paid out and saved (see Progress); so is a
 * street job, and a manifest page picked up.
 *
 * Cutscenes: the director says which shot is up; this works out where the camera stands for it
 * (see Cutscenes) and hands that to the player's camera, and holds the player still meanwhile.
 */
export const MissionRuntime = memo(function MissionRuntime() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		missions.setStage(missionStage);
		missions.setFlagSource(hasFlag);
		// Dialogue said out loud as well as shown (browser speech; silent where there's none).
		const voice = createMissionVoice();
		missions.setVoice(voice);
		const stopListening = missions.on((event) => {
			if (event.type === "started") {
				clearWanted();
				clearWaypoint();
			} else if (event.type === "complete") {
				if (event.mission.chapter === "job") {
					const extra = event.extras.reduce((sum, reward) => sum + (reward.cash ?? 0), 0);
					recordJob((event.mission.reward.cash ?? 0) + extra, event.mission.reward.rep);
				} else {
					recordPass(event.mission, event.seconds, { flags: event.flags, rating: event.rating, extras: event.extras });
				}
			}
			if ((event.type === "complete" || event.type === "failed") && event.mission.chapter === "job") streetLeads.finished();
		});
		const development = process.env.NODE_ENV !== "production";
		if (development) {
			// For trying missions out: __orionMissions.start("convoy"), .choose(0), .flags("dez-owes") and so on.
			(window as unknown as Record<string, unknown>).__orionMissions = {
				list: () => ALL_MISSIONS.map((mission) => mission.id),
				start: (id: string) => playMissionFromGiver(id),
				choose: (index: number) => missions.choose(index),
				retry: (fromCheckpoint = true) => retryMission(fromCheckpoint),
				abandon: () => abandonMission(),
				progress: () => readProgress(),
				reset: () => resetProgress(),
				flags: (...flags: string[]) => setFlags(flags),
				loseWanted: () => clearWanted(),
				leads: streetLeads,
				director: missions,
			};
		}
		return () => {
			stopListening();
			missions.stop();
			missions.setStage(null);
			missions.setFlagSource(null);
			missions.setVoice(null);
			voice?.dispose();
			if (development) delete (window as unknown as Record<string, unknown>).__orionMissions;
		};
	}, []);

	useEffect(() => {
		if (!app || !root) return;
		const glow = (colour: Color, name: string) => {
			const made = new StandardMaterial();
			made.name = name;
			made.diffuse = new Color(0, 0, 0);
			made.emissive = colour;
			made.emissiveIntensity = 2;
			made.opacity = 0.4;
			made.blendType = BLEND_ADDITIVE;
			made.depthWrite = false;
			made.cull = CULLFACE_NONE;
			made.useLighting = false;
			made.useFog = false;
			made.update();
			return made;
		};
		const material = glow(MARKER_COLOUR, "mission-marker");
		const leadMaterial = glow(LEAD_COLOUR, "lead-marker");

		const makeMarker = (name: string, markerMaterial: StandardMaterial, size: number) => {
			const marker = new PlayCanvasEntity(name);
			const column = new PlayCanvasEntity("column");
			column.addComponent("render", { type: "cylinder", material: markerMaterial, castShadows: false, receiveShadows: false });
			column.setLocalScale(1.6 * size, 3 * size, 1.6 * size);
			column.setLocalPosition(0, 1.5 * size, 0);
			const ring = new PlayCanvasEntity("ring");
			ring.addComponent("render", { type: "torus", material: markerMaterial, castShadows: false, receiveShadows: false });
			ring.setLocalScale(GIVER_TRIGGER * 2 * size, 0.5, GIVER_TRIGGER * 2 * size);
			ring.setLocalPosition(0, 0.12, 0);
			marker.addChild(column);
			marker.addChild(ring);
			marker.enabled = false;
			root.addChild(marker);
			return marker;
		};

		// One marker per mission, made once and switched on and off: a glowing column and a ring.
		const markers = new Map<string, PlayCanvasEntity>();
		const columns = new Map<string, PlayCanvasEntity>();
		for (const mission of MISSIONS) {
			const marker = makeMarker(`mission-marker-${mission.id}`, material, 1);
			const column = marker.findByName("column");
			if (column instanceof PlayCanvasEntity) columns.set(mission.id, column);
			const { x, z } = mission.giver;
			marker.setPosition(x, groundAt(x, z), z);
			markers.set(mission.id, marker);
		}
		// One for whichever street lead is up, moved to it.
		const leadMarker = makeMarker("lead-marker", leadMaterial, 0.75);
		let leadAt = "";

		// Manifest pages: a small bright sheet turning over the pavement, one per page.
		const pageMaterial = new StandardMaterial();
		pageMaterial.name = "manifest-page";
		pageMaterial.diffuse = new Color(0.9, 0.88, 0.8);
		pageMaterial.emissive = PAGE_COLOUR;
		pageMaterial.emissiveIntensity = 0.9;
		pageMaterial.useFog = false;
		pageMaterial.update();
		const pages = MANIFESTS.map((manifest) => {
			const page = new PlayCanvasEntity(`manifest-${manifest.id}`);
			page.addComponent("render", { type: "box", material: pageMaterial, castShadows: false, receiveShadows: false });
			page.setLocalScale(0.42, 0.02, 0.56);
			page.setPosition(manifest.x, groundAt(manifest.x, manifest.z) + 0.9, manifest.z);
			page.enabled = false;
			root.addChild(page);
			return page;
		});

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

		// What's on offer only changes when progress does.
		let offered: MissionDefinition[] = availableMissions(MISSIONS);
		let unlocked = hasPassed("cold-open");
		const stopWatchingProgress = onProgressChange(() => {
			offered = availableMissions(MISSIONS);
			unlocked = hasPassed("cold-open");
		});
		/** Declined (or just finished) here: not offered again until the player has walked off. */
		let heldBack: string | null = null;
		const view: PlayerView = { x: 0, y: 0, z: 0, vehicleIntegrity: 100, wantedStars: 0 };
		const leadContext = { free: false, unlocked: false, x: 0, z: 0, inVehicle: false, open: (job: MissionDefinition) => holds(job.onlyIf, hasFlag) };
		let announced = streetLeads.announced;
		let time = 0;

		// The giver out in person: who, for which mission, and whether they're stood there yet.
		let giverOut: { id: string; mission: MissionDefinition; placed: boolean } | null = null;
		const showGiver = (mission: MissionDefinition | null, pose: { x: number; z: number }) => {
			const id = mission?.giver.look ? giverPersonId(mission.giver) : null;
			if (giverOut && giverOut.id !== id) {
				releaseMissionHostiles([giverOut.id]);
				giverOut = null;
			}
			if (!mission || !id) return;
			if (!giverOut) giverOut = { id, mission, placed: false };
			giverOut.mission = mission;
			if (!giverOut.placed) {
				const { x, z } = mission.giver;
				// Facing whoever's coming; they turn to the player as they get close.
				giverOut.placed = placeMissionHostile(id, x, z, false, 1, "passive", Math.atan2(pose.x - x, pose.z - z) * 180 / Math.PI);
			}
		};

		// Cutscenes: where things are for the camera, and where the game's camera was as the scene began.
		const sceneCamera = { x: 0, z: 0 };
		let filming = false;
		const placeOf = (subject: ShotSubject): ShotPlace | null => {
			if (typeof subject !== "string") return { x: subject.x, z: subject.z, height: SPOT_HEIGHT };
			if (subject === "player") {
				const pose = readPlayerPose();
				return { x: pose.x, z: pose.z, height: pose.inVehicle ? VEHICLE_HEIGHT : PERSON_HEIGHT };
			}
			if (subject === "giver") {
				const giver = missions.mission?.giver;
				if (!giver) return null;
				const person = giverOut?.placed ? missionPersonState(giverOut.id) : null;
				return { x: person?.x ?? giver.x, z: person?.z ?? giver.z, height: PERSON_HEIGHT };
			}
			const actor = missionStage.actor?.(subject);
			if (!actor) return null;
			return { x: actor.x, z: actor.z, height: missionActorKind(subject) === "vehicle" ? VEHICLE_HEIGHT : PERSON_HEIGHT };
		};
		const shotContext: ShotContext = { locate: placeOf, player: { x: 0, z: 0 }, camera: sceneCamera };
		const cinematic: CinematicView = { fromX: 0, fromY: 0, fromZ: 0, atX: 0, atY: 0, atZ: 0, faceX: Number.NaN, faceZ: Number.NaN };
		const film = () => {
			const scene = missions.sceneShot;
			if (!scene) {
				if (filming) setCinematicView(null);
				filming = false;
				return;
			}
			if (!filming) {
				const camera = readCameraView();
				sceneCamera.x = camera.x;
				sceneCamera.z = camera.z;
				filming = true;
			}
			const pose = readPlayerPose();
			shotContext.player.x = pose.x;
			shotContext.player.z = pose.z;
			const view = shotView(scene.shot, scene.progress, shotContext);
			if (!view) {
				setCinematicView(null);
				return;
			}
			const ground = groundAt(view.atX, view.atZ);
			cinematic.fromX = view.fromX;
			cinematic.fromY = ground + view.fromHeight;
			cinematic.fromZ = view.fromZ;
			cinematic.atX = view.atX;
			cinematic.atY = ground + view.atHeight;
			cinematic.atZ = view.atZ;
			// The player turns to whoever else is in the shot: the giver in a briefing.
			const { on, over } = scene.shot;
			// And someone the shot's on looks at the player: they're talking to them. Not a guard: a
			// sentry turned to the player would see them.
			const mission = missions.mission;
			const talker = on === "giver" ? giverOut?.id : typeof on === "string" && mission && missionActorKind(on) === "person" && isPassive(mission, on) ? on : undefined;
			if (talker) faceMissionPerson(talker, (Math.atan2(pose.x - view.atX, pose.z - view.atZ) * 180) / Math.PI);
			const other = missions.phase === "briefing" ? "giver" : on === "player" ? over : over === "player" ? on : undefined;
			const face = other !== undefined ? placeOf(other) : null;
			cinematic.faceX = face?.x ?? Number.NaN;
			cinematic.faceZ = face?.z ?? Number.NaN;
			setCinematicView(cinematic);
		};

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
			film();
			// On the grid through a race's countdown, and still through a cutscene.
			setControlsHeld(missions.raceCountdown > 0 || missions.inScene);

			const phase = missions.phase;
			// Givers only deal with someone who's on foot, alive, and not wanted by the police.
			const free = phase !== "active" && phase !== "briefing";
			const combat = readCombatHud();
			const alive = !combat.wasted && !combat.busted;
			const canStart = free && !pose.inVehicle && alive && wanted.stars === 0;
			time += dt;
			const pulse = 0.32 + 0.1 * Math.sin(time * 2.5);
			material.opacity = pulse;
			material.update();
			// In person: the giver being listened to (or still in their opening scene), else the nearest with work on offer.
			const current = missions.mission;
			let giverFor: MissionDefinition | null = null;
			if (phase === "briefing" || (phase === "active" && missions.inScene && current && Math.hypot(current.giver.x - pose.x, current.giver.z - pose.z) < GIVER_RANGE)) {
				giverFor = current;
			} else if (free) {
				let nearest = GIVER_RANGE;
				for (const mission of offered) {
					const distance = Math.hypot(mission.giver.x - pose.x, mission.giver.z - pose.z);
					if (mission.giver.look && distance < nearest) {
						nearest = distance;
						giverFor = mission;
					}
				}
			}
			showGiver(giverFor, pose);
			for (const [id, marker] of markers) {
				const mission = offered.find((candidate) => candidate.id === id);
				const distance = mission ? Math.hypot(mission.giver.x - pose.x, mission.giver.z - pose.z) : Infinity;
				const lit = free && distance < MARKER_RANGE;
				if (marker.enabled !== lit) marker.enabled = lit;
				// Someone stood there in person needs no glowing column, just the ring at their feet.
				const column = columns.get(id);
				const standing = giverOut?.placed === true && !!mission && giverPersonId(mission.giver) === giverOut.id;
				if (column && column.enabled === standing) column.enabled = !standing;
				if (!mission) continue;
				if (heldBack === id && distance > GIVER_LEAVE) heldBack = null;
				if (canStart && heldBack !== id && distance < GIVER_TRIGGER) {
					heldBack = id;
					missions.brief(mission);
				}
			}

			// Street leads: one at a time, announced once, started by walking (or driving) into it.
			leadContext.free = free && alive && wanted.stars === 0;
			leadContext.unlocked = unlocked;
			leadContext.x = pose.x;
			leadContext.z = pose.z;
			leadContext.inVehicle = pose.inVehicle;
			const job = streetLeads.update(dt, leadContext);
			if (job) {
				missions.start(job);
				missions.notice(job.title);
			}
			const lead = streetLeads.lead;
			if (streetLeads.announced !== announced) {
				announced = streetLeads.announced;
				if (lead) missions.say([{ who: "Phone", text: `New lead: ${lead.giver.role ?? lead.title}. It's on your map.` }]);
			}
			const leadLit = !!lead && free && Math.hypot(lead.giver.x - pose.x, lead.giver.z - pose.z) < MARKER_RANGE;
			if (lead && leadAt !== lead.id) {
				leadAt = lead.id;
				leadMarker.setPosition(lead.giver.x, groundAt(lead.giver.x, lead.giver.z), lead.giver.z);
			}
			if (leadMarker.enabled !== leadLit) leadMarker.enabled = leadLit;
			if (leadLit) {
				leadMaterial.opacity = pulse;
				leadMaterial.update();
			}

			// Manifest pages: glinting when near, picked up by walking or driving over one.
			for (let index = 0; index < pages.length; index++) {
				const manifest = MANIFESTS[index];
				const page = pages[index];
				const near = Math.abs(manifest.x - pose.x) < PAGE_RANGE && Math.abs(manifest.z - pose.z) < PAGE_RANGE && !hasCollected(manifest.id);
				if (page.enabled !== near) page.enabled = near;
				if (near) page.setEulerAngles(18, time * 70, 0);
			}
			const found = alive ? manifestInReach(pose.x, pose.z, pose.inVehicle, hasCollected) : null;
			if (found && collect(found.id, MANIFEST_CASH)) {
				const count = MANIFESTS.filter((manifest) => hasCollected(manifest.id)).length;
				missions.say([{ who: `Manifest ${count}/${MANIFESTS.length}`, text: found.text, seconds: 6 }]);
				if (count === MANIFESTS.length && collect("manifests-complete", ALL_MANIFESTS_CASH)) {
					missions.notice(`Every manifest found · +$${ALL_MANIFESTS_CASH.toLocaleString("en-US")}`);
				} else {
					missions.notice(`Manifest found · +$${MANIFEST_CASH}`);
				}
			}

			// Chevrons over the mission's people, and its cars (bar the one the player's driving).
			let used = 0;
			// Not in a cutscene: it's a film for a moment, not a game.
			if (phase === "active" && !missions.inScene) {
				const mission = missions.mission;
				const quarry = quarryOf(missions.objective);
				const actors = missionActorMarkers();
				const bob = Math.sin(time * 3) * 0.25;
				const place = (x: number, z: number, height: number, target: boolean) => {
					const chevron = chevrons[used++];
					if (!chevron) return;
					const chevronMaterial = target ? hostile : friendly;
					const render = chevron.render;
					if (render && render.material !== chevronMaterial) render.material = chevronMaterial;
					chevron.setPosition(x, groundAt(x, z) + height + bob, z);
					chevron.setEulerAngles(180, time * 90, 0);
					if (!chevron.enabled) chevron.enabled = true;
				};
				for (const person of actors.people) place(person.x, person.z, OVER_PERSON, !(mission && isPassive(mission, person.id)));
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
			setCinematicView(null);
			if (giverOut) releaseMissionHostiles([giverOut.id]);
			stopWatchingProgress();
			for (const marker of markers.values()) marker.destroy();
			leadMarker.destroy();
			for (const page of pages) page.destroy();
			for (const chevron of chevrons) chevron.destroy();
			material.destroy();
			leadMaterial.destroy();
			pageMaterial.destroy();
			friendly.destroy();
			hostile.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="missions" />;
});

