import { useState } from "react";

import type { PropertyRecord } from "@/engine/orion/properties/Properties";
import { HistoryPanel } from "./HistoryPanel";

interface SelectionPanelProps {
	property: PropertyRecord;
	onAcquire: (propertyId: string) => void;
	onOffer: (propertyId: string) => void;
	onClear: () => void;
}

function formatOwner(ownerId: string | null) {
	return ownerId ? "Player 001" : "Unowned";
}

export function SelectionPanel({
	property,
	onAcquire,
	onOffer,
	onClear,
}: Readonly<SelectionPanelProps>) {
	const [historyOpen, setHistoryOpen] = useState(false);
	const isOwned = property.status === "owned";

	return (
		<section className="orion-selection-panel pointer-events-auto">
			<div className="flex items-start justify-between gap-5">
				<div>
					<p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#d7b77a]">Property / {property.id}</p>
					<h2 className="mt-2 text-[17px] font-medium uppercase tracking-[0.08em] text-[#f1ede2]">{property.metadata.displayName}</h2>
					<p className="mt-1 text-[11px] text-white/42">{property.metadata.category}</p>
				</div>
				<button type="button" onClick={onClear} className="orion-focus text-[10px] uppercase tracking-[0.14em] text-white/40 transition-colors hover:text-white" aria-label="Close property details">
					Close
				</button>
			</div>

			<div className="orion-panel-rule mt-5 pt-4">
				<div className="flex items-center justify-between gap-4">
					<Detail label={isOwned ? "Owned by" : "Status"} value={isOwned ? formatOwner(property.ownerId) : "Available"} accent={!isOwned} />
					<div className="text-right">
						<p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/38">Value</p>
						<p className="mt-1 text-[17px] font-medium tracking-[0.01em] text-[#f1ede2]">{property.value.toLocaleString("en-US")} <span className="text-[9px] font-normal tracking-[0.12em] text-[#d7b77a]">ORION</span></p>
					</div>
				</div>
			</div>

			<div className="mt-5 flex items-center gap-4">
				<button
					type="button"
					onClick={() => isOwned ? onOffer(property.id) : onAcquire(property.id)}
					className="orion-action orion-focus"
				>
					<span>{isOwned ? "Make an Offer" : "Acquire Property"}</span><span className="orion-action-arrow" aria-hidden="true">→</span>
				</button>
				<button
					type="button"
					onClick={() => setHistoryOpen((open) => !open)}
					className="orion-focus text-[10px] uppercase tracking-[0.12em] text-white/45 transition-colors hover:text-white/85"
					aria-expanded={historyOpen}
				>
					History · {String(property.lineage.length).padStart(2, "0")}
				</button>
			</div>

			{historyOpen ? <HistoryPanel lineage={property.lineage} /> : null}
		</section>
	);
}

function Detail({ label, value, accent = false }: Readonly<{ label: string; value: string; accent?: boolean }>) {
	return (
		<div>
			<p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/38">{label}</p>
			<p className={`mt-1 flex items-center gap-2 text-[13px] ${accent ? "text-[#d7b77a]" : "text-white/88"}`}>
				{accent ? <span className="h-1.5 w-1.5 rounded-full bg-[#d7b77a]" aria-hidden="true" /> : null}
				{value}
			</p>
		</div>
	);
}