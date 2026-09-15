export function WorldContext() {
	return (
		<div className="pointer-events-none flex items-start gap-3 text-white/55">
			<span className="orion-coordinate-mark" aria-hidden="true">⌖</span>
			<div>
				<p className="font-mono text-[9px] uppercase tracking-[0.24em]">Earth / Sector 01</p>
				<p className="mt-1 text-xs tracking-[0.05em] text-white/80">North District</p>
				<p className="mt-2 font-mono text-[8px] uppercase tracking-[0.2em] text-white/30">N 41.403 · E 2.174</p>
			</div>
		</div>
	);
}