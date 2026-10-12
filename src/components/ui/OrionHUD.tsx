"use client";

import { useEffect } from "react";

import { CombatHud } from "./CombatHud";
import { DrivingHud } from "./DrivingHud";
import { DrowningOverlay } from "./DrowningOverlay";
import { FlightHud } from "./FlightHud";
import { enterFullscreen, useFullscreen } from "./fullscreen";
import { LandscapeMode } from "./LandscapeMode";
import { MissionHud } from "./MissionHud";
import { MissionLog } from "./MissionLog";
import { TouchControls } from "./TouchControls";
import { useTouchDevice } from "./useTouchDevice";
import { WorldContext } from "./WorldContext";
import { WorldHeader } from "./WorldHeader";
import { WorldMap } from "./WorldMap";

/**
 * On a laptop or desktop, the first click into the game — the one that takes the mouse for
 * looking round — takes the page full screen too. Once only: leave with Esc and it stays left,
 * with the header button to go back in.
 */
function useFullscreenOnFirstClick(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		const first = (event: PointerEvent) => {
			if (!(event.target instanceof HTMLCanvasElement)) return;
			window.removeEventListener("pointerdown", first, true);
			void enterFullscreen();
		};
		window.addEventListener("pointerdown", first, true);
		return () => window.removeEventListener("pointerdown", first, true);
	}, [enabled]);
}

export function OrionHUD() {
	const touch = useTouchDevice();
	const { fullscreen } = useFullscreen();
	useFullscreenOnFirstClick(!touch);

	return (
		<div id="world" data-input={touch ? "touch" : "mouse"} data-fullscreen={fullscreen ? "true" : "false"} className="pointer-events-none absolute inset-0 z-10 flex flex-col text-[#f1ede2]">
			<DrowningOverlay />
			<WorldHeader />

			<div className="relative flex-1 p-5 sm:p-8">
				{/* Under everything else in the HUD, so the open map sits over the buttons. */}
				{touch ? <TouchControls /> : null}

				<div className="orion-hud-map absolute bottom-5 left-5 flex flex-col gap-3 sm:bottom-8 sm:left-8">
					<WorldMap />
					<MissionLog />
					{touch ? null : <WorldContext />}
				</div>

				<DrivingHud touch={touch} />
				<CombatHud />
				<MissionHud />
				<FlightHud touch={touch} />
				{touch ? <LandscapeMode /> : null}
			</div>
		</div>
	);
}
