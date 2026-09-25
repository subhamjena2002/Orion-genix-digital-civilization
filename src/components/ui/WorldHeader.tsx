"use client";

export function WorldHeader() {
	return (
		<header className="orion-topbar pointer-events-auto flex items-center justify-between gap-8 px-5 py-4 sm:px-8">
			<div className="flex min-w-0 items-center gap-3">
				<span className="orion-brand-mark shrink-0" aria-hidden="true">O</span>
				<div className="min-w-0">
					<a
						href="#world"
						className="orion-focus block truncate text-[13px] font-semibold uppercase tracking-[0.22em] text-[#f1ede2] transition-colors hover:text-[#d7b77a]"
					>
						OrionGenix
					</a>
					<p className="orion-kicker mt-0.5 hidden truncate sm:block">Digital civilization · 001</p>
				</div>
			</div>

			<nav aria-label="World navigation" className="hidden items-center gap-1 sm:flex">
				<button type="button" className="orion-nav-item orion-nav-active orion-focus">Explore</button>
				<button type="button" className="orion-nav-item orion-focus">Profile</button>
				<button type="button" className="orion-nav-item orion-focus">World</button>
			</nav>

			<div className="flex items-center gap-3">
				<span className="orion-status-pill">
					<span className="orion-status-dot" aria-hidden="true" />
					Live
				</span>
				<button type="button" className="orion-icon-button orion-focus" aria-label="Notifications">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
						<path d="M6 8a6 6 0 0 1 12 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7Z" />
						<path d="M9.5 19a2.5 2.5 0 0 0 5 0" />
					</svg>
				</button>
				<button type="button" className="orion-icon-button orion-focus" aria-label="Account">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="12" cy="8" r="3.4" />
						<path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" />
					</svg>
				</button>
			</div>
		</header>
	);
}
