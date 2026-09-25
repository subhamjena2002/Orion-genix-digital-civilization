"use client";

import { useEffect, useState } from "react";

import { readPlayerPose, type PlayerPose } from "@/engine/orion/player/PlayerPose";

/**
 * Samples the player's transform on a timer instead of every frame. Callers pick an interval
 * matching how much churn they can afford — a minimap can update often, world culling should
 * not, since each change there mounts/unmounts scene entities.
 */
export function usePlayerPose(intervalMs: number): PlayerPose {
	const [pose, setPose] = useState<PlayerPose>(() => ({ ...readPlayerPose() }));

	useEffect(() => {
		const id = window.setInterval(() => {
			const next = readPlayerPose();
			setPose((previous) => (
				previous.x === next.x && previous.z === next.z
					&& previous.yaw === next.yaw && previous.drowning === next.drowning
					&& previous.inVehicle === next.inVehicle && previous.nearCar === next.nearCar
					&& previous.vehicleSpeed === next.vehicleSpeed
					&& previous.vehicleIntegrity === next.vehicleIntegrity
					&& previous.vehicleBurning === next.vehicleBurning
					? previous
					: { ...next }
			));
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);

	return pose;
}
