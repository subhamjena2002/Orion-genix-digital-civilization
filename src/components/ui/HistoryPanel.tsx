import type { LineageEvent } from "@/engine/orion/properties/Properties";

interface HistoryPanelProps {
	lineage: readonly LineageEvent[];
}

export function HistoryPanel({ lineage }: Readonly<HistoryPanelProps>) {
	return (
		<div className="orion-history mt-4 border-t border-white/10 pt-4">
			<p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/45">Archive / ownership history</p>
			<ol className="orion-timeline mt-4 space-y-3">
				{lineage.map((event) => (
					<li key={`${event.type}-${event.occurredAt}`} className="orion-timeline-item flex items-baseline justify-between gap-4 pl-4 text-[11px]">
						<span className="text-white/80">{event.label}</span>
						<span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">{event.occurredAt.slice(0, 4)}</span>
					</li>
				))}
			</ol>
		</div>
	);
}