"use client";

import { usePlayerPose } from "@/components/world/usePlayerPose";

/** Underwater warning: tints the screen and counts down to the respawn. */
export function DrowningOverlay() {
	const { drowning } = usePlayerPose(100);
	if (drowning <= 0) return null;

	return (
		<div className="orion-drowning" style={{ opacity: 0.25 + drowning * 0.6 }} role="status">
			<div className="orion-drowning-panel">
				<p className="orion-kicker">Submerged</p>
				<p className="mt-1 text-[15px] font-semibold tracking-[0.02em] text-[var(--oi-text-primary)]">
					Out of air
				</p>
				<div className="orion-drowning-meter" aria-hidden="true">
					<span style={{ width: `${Math.round(drowning * 100)}%` }} />
				</div>
			</div>
		</div>
	);
}
