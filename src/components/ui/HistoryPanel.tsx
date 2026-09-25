import type { LineageEvent } from "@/engine/orion/properties/Properties";

interface HistoryPanelProps {
	lineage: readonly LineageEvent[];
}

export function HistoryPanel({ lineage }: Readonly<HistoryPanelProps>) {
	return (
		<div className="orion-history orion-panel-rule mt-4 pt-4">
			<p className="orion-kicker">Archive · ownership history</p>
			<ol className="orion-timeline mt-4 space-y-3">
				{lineage.map((event) => (
					<li key={`${event.type}-${event.occurredAt}`} className="orion-timeline-item flex items-baseline justify-between gap-4 pl-4 text-[11.5px]">
						<span className="text-[var(--oi-text-primary)]">{event.label}</span>
						<span className="font-mono text-[9.5px] tracking-[0.08em] text-[var(--oi-text-tertiary)]">{event.occurredAt.slice(0, 4)}</span>
					</li>
				))}
			</ol>
		</div>
	);
}
