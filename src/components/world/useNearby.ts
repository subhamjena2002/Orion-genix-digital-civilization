"use client";

import { useEffect, useState } from "react";

import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { nearbyWithHysteresis, sameMembers } from "@/engine/orion/world/Proximity";

/**
 * The items near the player, re-evaluated on a timer. State only changes when an item actually
 * enters or leaves (see nearbyWithHysteresis), so a caller re-renders when the set changes rather
 * than every time the player moves — each re-render there remounts scene entities.
 */
export function useNearby<T>(
	items: readonly T[],
	positionOf: (item: T) => readonly [number, number],
	enterRadius: number,
	exitRadius: number,
	intervalMs: number,
): readonly T[] {
	const [nearby, setNearby] = useState<readonly T[]>(() => {
		const pose = readPlayerPose();
		return nearbyWithHysteresis(items, positionOf, pose.x, pose.z, enterRadius, exitRadius, new Set());
	});

	useEffect(() => {
		const id = window.setInterval(() => {
			const pose = readPlayerPose();
			setNearby((previous) => {
				const current = new Set(previous);
				const next = nearbyWithHysteresis(items, positionOf, pose.x, pose.z, enterRadius, exitRadius, current);
				return sameMembers(next, current) ? previous : next;
			});
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [items, positionOf, enterRadius, exitRadius, intervalMs]);

	return nearby;
}
