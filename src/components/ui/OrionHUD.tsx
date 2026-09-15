"use client";

import { useEffect, useState } from "react";

import type { PropertyRecord } from "@/engine/orion/properties/Properties";
import { SelectionPanel } from "./SelectionPanel";
import { WorldContext } from "./WorldContext";
import { WorldHeader } from "./WorldHeader";

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
		<div id="world" className="pointer-events-none absolute inset-0 z-10 p-5 text-[#f1ede2] sm:p-8">
			<WorldHeader />

			<div className="absolute bottom-5 left-5 sm:bottom-8 sm:left-8">
				<WorldContext />
			</div>

			{property ? (
				<div className="absolute bottom-5 right-5 flex max-w-[calc(100%-2.5rem)] flex-col items-end sm:bottom-8 sm:right-8">
					<SelectionPanel property={property} onAcquire={onAcquire} onOffer={handleOffer} onClear={onClear} />
					{offerNotice ? (
						<div role="status" className="orion-notice pointer-events-auto mt-3 border border-white/10 bg-[#10191e]/80 px-3 py-2 text-[11px] text-white/75 backdrop-blur-md">
							Offer submitted to the Orion market.
						</div>
					) : null}
				</div>
			) : null}

			<div className="absolute bottom-5 right-5 hidden font-mono text-[9px] uppercase tracking-[0.16em] text-white/35 sm:block sm:bottom-8 sm:right-8">
				W A S D&nbsp;&nbsp; Move&nbsp;&nbsp; · &nbsp;&nbsp;Shift&nbsp;&nbsp; Run&nbsp;&nbsp; · &nbsp;&nbsp;Mouse&nbsp;&nbsp; Look
			</div>
		</div>
	);
}