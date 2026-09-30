"use client";

import { useEffect, useState } from "react";

import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { limitNewcomers, nearbyWithHysteresis, sameMembers, streamingFocus } from "@/engine/orion/world/Proximity";

/**
 * The items near the player, re-evaluated on a timer. State only changes when an item actually
 * enters or leaves (see nearbyWithHysteresis), so a caller re-renders when the set changes rather
 * than every time the player moves — each re-render there remounts scene entities. Moving fast or
 * high up, the set reaches further and leans along the direction of travel (see streamingFocus).
 * `maxNewPerSample` caps how many items join per sample (nearest first), so arrivals are spread
 * over frames rather than landing in one.
 */
export function useNearby<T>(
	items: readonly T[],
	positionOf: (item: T) => readonly [number, number],
	enterRadius: number,
	exitRadius: number,
	intervalMs: number,
	maxNewPerSample = Infinity,
): readonly T[] {
	const [nearby, setNearby] = useState<readonly T[]>(() => {
		const pose = readPlayerPose();
		return nearbyWithHysteresis(items, positionOf, pose.x, pose.z, enterRadius, exitRadius, new Set());
	});

	useEffect(() => {
		// Velocity comes from the pose between samples.
		let lastX = readPlayerPose().x;
		let lastZ = readPlayerPose().z;
		let lastTime = performance.now();
		const id = window.setInterval(() => {
			const pose = readPlayerPose();
			const now = performance.now();
			const seconds = Math.max((now - lastTime) / 1000, 1e-3);
			const focus = streamingFocus(pose.x, pose.y, pose.z, (pose.x - lastX) / seconds, (pose.z - lastZ) / seconds);
			lastX = pose.x;
			lastZ = pose.z;
			lastTime = now;
			setNearby((previous) => {
				const current = new Set(previous);
				const reachable = nearbyWithHysteresis(items, positionOf, focus.x, focus.z, enterRadius + focus.grow, exitRadius + focus.grow, current);
				const next = limitNewcomers(reachable, current, positionOf, pose.x, pose.z, maxNewPerSample);
				return sameMembers(next, current) ? previous : next;
			});
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [items, positionOf, enterRadius, exitRadius, intervalMs, maxNewPerSample]);

	return nearby;
}
