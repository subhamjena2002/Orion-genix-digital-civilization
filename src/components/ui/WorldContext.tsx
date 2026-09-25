export function WorldContext() {
	return (
		<div className="orion-surface orion-location-card pointer-events-none">
			<span className="orion-location-icon" aria-hidden="true">⌖</span>
			<div>
				<p className="orion-kicker">Earth · Sector 01</p>
				<p className="mt-1 text-[13px] font-medium tracking-[0.01em] text-[var(--oi-text-primary)]">North District</p>
				<p className="mt-1 font-mono text-[9.5px] tracking-[0.08em] text-[var(--oi-text-tertiary)]">N 41.403 · E 2.174</p>
			</div>
		</div>
	);
}
