"use client";

export function WorldHeader() {
	return (
		<header className="pointer-events-auto flex items-start justify-between gap-8">
			<div>
				<a
					href="#world"
					className="orion-focus rounded-sm font-mono text-[11px] font-medium uppercase tracking-[0.32em] text-[#f1ede2] transition-colors hover:text-[#d7b77a]"
				>
					OrionGenix
				</a>
				<p className="mt-2 font-mono text-[8px] uppercase tracking-[0.24em] text-white/32">Digital civilization / 001</p>
			</div>

			<nav aria-label="World navigation" className="flex items-center gap-5 text-[10px] uppercase tracking-[0.18em] text-white/55">
				<button type="button" className="orion-nav-item orion-nav-active orion-focus">Explore</button>
				<button type="button" className="orion-nav-item orion-focus">Profile</button>
				<button type="button" className="orion-nav-item orion-focus">World</button>
			</nav>
		</header>
	);
}