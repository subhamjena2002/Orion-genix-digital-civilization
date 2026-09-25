import { useState, type ReactNode } from "react";

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
					<span className="orion-id-badge">{property.id}</span>
					<h2 className="mt-2.5 text-[16px] font-semibold tracking-[0.01em] text-[var(--oi-text-primary)]">{property.metadata.displayName}</h2>
					<p className="mt-1 text-[11.5px] text-[var(--oi-text-tertiary)]">{property.metadata.category}</p>
				</div>
				<button type="button" onClick={onClear} className="orion-icon-button orion-focus" aria-label="Close property details">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>

			<div className="orion-panel-rule orion-stat-grid mt-5 pt-4">
				<Stat label={isOwned ? "Owned by" : "Status"} value={isOwned ? formatOwner(property.ownerId) : "Available"} accent={!isOwned} />
				<Stat
					label="Estimated value"
					value={<>{property.value.toLocaleString("en-US")} <span className="text-[10px] font-semibold tracking-[0.1em] text-[var(--oi-accent)]">ORION</span></>}
				/>
				<Stat label="District" value="North / Sector 01" />
				<Stat label="Listing" value={property.saleStatus === "not-listed" ? "Not listed" : "On market"} />
			</div>

			<div className="mt-5 flex items-center gap-3">
				<button
					type="button"
					onClick={() => isOwned ? onOffer(property.id) : onAcquire(property.id)}
					className="orion-action-primary orion-focus"
				>
					<span>{isOwned ? "Make an Offer" : "Acquire Property"}</span><span className="orion-action-arrow" aria-hidden="true">→</span>
				</button>
				<button
					type="button"
					onClick={() => setHistoryOpen((open) => !open)}
					className="orion-action-secondary orion-focus"
					aria-expanded={historyOpen}
				>
					History · {String(property.lineage.length).padStart(2, "0")}
				</button>
			</div>

			{historyOpen ? <HistoryPanel lineage={property.lineage} /> : null}
		</section>
	);
}

function Stat({ label, value, accent = false }: Readonly<{ label: string; value: ReactNode; accent?: boolean }>) {
	return (
		<div>
			<p className="orion-stat-label">{label}</p>
			<p className="orion-stat-value flex items-center">
				{accent ? <span className="orion-badge-dot" aria-hidden="true" /> : null}
				{value}
			</p>
		</div>
	);
}
