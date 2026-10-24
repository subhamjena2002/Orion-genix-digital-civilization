"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity as PlayCanvasEntity, StandardMaterial } from "playcanvas";
import { memo, useEffect, useState } from "react";

import { activeTarget, checkArrival, onNavigationChange } from "@/engine/orion/navigation/Navigation";
import { readCinematicView } from "@/engine/orion/player/CinematicCamera";
import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { pavedHeightAt } from "@/engine/orion/roads/RoadNetwork";
import { terrainHeightAt } from "@/engine/orion/world/Mountains";

/** Waypoints glow pink, mission objectives gold — the same colours as on the map. */
const WAYPOINT_COLOUR = new Color(1, 0.3, 0.72);
const OBJECTIVE_COLOUR = new Color(1, 0.78, 0.2);
const BEAM_HEIGHT = 140;
const BEAM_RADIUS = 2.4;

/** A ground ring this big; a ring in the air (a checkpoint to fly through) is sized to its radius. */
const GROUND_RING_SCALE = 7;

/**
 * The destination in the world: a tall column of light where the waypoint or objective is, seen
 * from across the city, and a ring on the ground at the spot — or, for a checkpoint in the air,
 * a ring standing up at its height, turned to face the player. Also where arriving at the
 * waypoint is noticed, once a frame (the mission director is ticked by MissionRuntime).
 */
export const WaypointBeacon = memo(function WaypointBeacon() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		if (!app || !root) return;
		const material = new StandardMaterial();
		material.name = "waypoint-beam";
		material.diffuse = new Color(0, 0, 0);
		material.emissive = WAYPOINT_COLOUR.clone();
		material.emissiveIntensity = 2.2;
		material.opacity = 0.35;
		material.blendType = BLEND_ADDITIVE;
		material.depthWrite = false;
		material.cull = CULLFACE_NONE;
		material.useLighting = false;
		material.useFog = false;
		material.update();

		const beacon = new PlayCanvasEntity("waypoint-beacon");
		const beam = new PlayCanvasEntity("waypoint-beam");
		beam.addComponent("render", { type: "cylinder", material, castShadows: false, receiveShadows: false });
		beam.setLocalScale(BEAM_RADIUS * 2, BEAM_HEIGHT, BEAM_RADIUS * 2);
		beam.setLocalPosition(0, BEAM_HEIGHT / 2, 0);
		const ring = new PlayCanvasEntity("waypoint-ring");
		ring.addComponent("render", { type: "torus", material, castShadows: false, receiveShadows: false });
		ring.setLocalScale(GROUND_RING_SCALE, 0.6, GROUND_RING_SCALE);
		// Turned to face the player as a whole; the ring inside it stands up for a ring in the air.
		const pivot = new PlayCanvasEntity("waypoint-pivot");
		pivot.setLocalPosition(0, 0.15, 0);
		pivot.addChild(ring);
		beacon.addChild(beam);
		beacon.addChild(pivot);
		beacon.enabled = false;
		root.addChild(beacon);

		let airborne = false;
		const place = () => {
			const target = activeTarget();
			beacon.enabled = target !== null && target.beacon !== false;
			if (!target) return;
			const y = pavedHeightAt(target.x, target.z) ?? terrainHeightAt(target.x, target.z);
			beacon.setPosition(target.x, y, target.z);
			airborne = target.y !== undefined;
			if (target.y !== undefined) {
				const size = target.radius * 2;
				ring.setLocalScale(size, Math.max(0.6, target.radius * 0.08), size);
				ring.setLocalEulerAngles(90, 0, 0);
				pivot.setLocalPosition(0, target.y - y, 0);
			} else {
				ring.setLocalScale(GROUND_RING_SCALE, 0.6, GROUND_RING_SCALE);
				pivot.setLocalPosition(0, 0.15, 0);
				pivot.setLocalEulerAngles(0, 0, 0);
			}
			material.emissive = target.kind === "waypoint" ? WAYPOINT_COLOUR : OBJECTIVE_COLOUR;
			material.update();
		};
		place();
		const unsubscribe = onNavigationChange(place);

		let time = 0;
		const update = (dt: number) => {
			const pose = readPlayerPose();
			checkArrival(pose.x, pose.z);
			// Out of a cutscene's shots: for a moment it's a film, not a map.
			const filming = readCinematicView() !== null;
			if (beam.enabled === filming) {
				beam.enabled = !filming;
				pivot.enabled = !filming;
			}
			if (!beacon.enabled) return;
			// A slow pulse, and the ring turning — or, up in the air, standing to face the player.
			time += dt;
			material.opacity = 0.28 + 0.1 * Math.sin(time * 3);
			material.update();
			if (airborne) {
				const at = beacon.getPosition();
				pivot.setLocalEulerAngles(0, (Math.atan2(pose.x - at.x, pose.z - at.z) * 180) / Math.PI, 0);
			} else {
				ring.setLocalEulerAngles(0, time * 40, 0);
			}
		};
		app.on("update", update);
		return () => {
			app.off("update", update);
			unsubscribe();
			beacon.destroy();
			material.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="waypoint" />;
});
