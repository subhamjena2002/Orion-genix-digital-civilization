"use client";

import { useEffect, useState } from "react";

import type { PropertyRecord } from "@/engine/orion/properties/Properties";
import { CombatHud } from "./CombatHud";
import { DrivingHud } from "./DrivingHud";
import { DrowningOverlay } from "./DrowningOverlay";
import { LandscapeMode } from "./LandscapeMode";
import { SelectionPanel } from "./SelectionPanel";
import { TouchControls } from "./TouchControls";
import { useTouchDevice } from "./useTouchDevice";
import { WorldContext } from "./WorldContext";
import { WorldHeader } from "./WorldHeader";
import { WorldMap } from "./WorldMap";

interface OrionHUDProps {
	property: PropertyRecord | null;
	onAcquire: (propertyId: string) => void;
	onOffer: (propertyId: string) => void;
	onClear: () => void;
}

export function OrionHUD({
	property,
	onAcquire,
	onOffer,
	onClear,
}: Readonly<OrionHUDProps>) {
	const [offerNotice, setOfferNotice] = useState(false);
	const touch = useTouchDevice();

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setOfferNotice(false);
				onClear();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClear]);

	function handleOffer(propertyId: string) {
		onOffer(propertyId);
		setOfferNotice(true);
	}

	return (
		<div id="world" data-input={touch ? "touch" : "mouse"} className="pointer-events-none absolute inset-0 z-10 flex flex-col text-[#f1ede2]">
			<DrowningOverlay />
			<WorldHeader />

			<div className="relative flex-1 p-5 sm:p-8">
				{/* Under everything else in the HUD, so a panel or the open map sits over the buttons. */}
				{touch ? <TouchControls /> : null}

				<div className="orion-hud-map absolute bottom-5 left-5 flex flex-col gap-3 sm:bottom-8 sm:left-8">
					<WorldMap />
					{touch ? null : <WorldContext />}
				</div>

				{property ? (
					<div className="absolute bottom-5 right-5 flex max-w-[calc(100%-2.5rem)] flex-col items-end sm:bottom-8 sm:right-8">
						<SelectionPanel property={property} onAcquire={onAcquire} onOffer={handleOffer} onClear={onClear} />
						{offerNotice ? (
							<div role="status" className="orion-notice orion-surface pointer-events-auto mt-3 flex items-center gap-2 px-3.5 py-2.5 text-[11.5px] text-[var(--oi-text-secondary)]">
								<span className="orion-badge-dot" aria-hidden="true" />
								Offer submitted to the Orion market.
							</div>
						) : null}
					</div>
				) : null}

				<DrivingHud touch={touch} />
				<CombatHud />
				{touch ? <LandscapeMode /> : null}
			</div>
		</div>
	);
}
