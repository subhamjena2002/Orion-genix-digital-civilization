"use client";

import { usePlayerPose } from "@/components/world/usePlayerPose";
import { placeKind, placeName } from "@/engine/orion/world/PlaceNames";

/** Where the player is: the same name the map gives the place, and what kind of place it is. */
export function WorldContext() {
	const pose = usePlayerPose(400);
	return (
		<div className="orion-surface orion-location-card pointer-events-none">
			<span className="orion-location-icon" aria-hidden="true">⌖</span>
			<div>
				<p className="orion-kicker">Orion State</p>
				<p className="mt-1 text-[13px] font-medium tracking-[0.01em] text-[var(--oi-text-primary)]">{placeName(pose.x, pose.z)}</p>
				<p className="mt-1 font-mono text-[9.5px] tracking-[0.08em] text-[var(--oi-text-tertiary)]">{placeKind(pose.x, pose.z)}</p>
			</div>
		</div>
	);
}
