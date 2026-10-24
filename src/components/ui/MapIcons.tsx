import type { BlipKind } from "@/engine/orion/navigation/Navigation";
import { MAP_COLOURS } from "./MapLayers";

/**
 * Map icons ("blips"), drawn in a unit box about the origin: scale them by the size wanted on
 * screen. Shared by the map and its legend, so the legend always matches.
 */

export const BLIP_LABELS: Readonly<Record<BlipKind, string>> = {
	player: "You",
	waypoint: "Waypoint",
	objective: "Objective",
	mission: "Mission",
	target: "Target",
	missionVehicle: "Mission vehicle",
	ally: "Contact",
	lead: "Street lead",
	safehouse: "Safehouse",
	gunShop: "Gun shop",
	showroom: "Car showroom",
	hospital: "Hospital",
	police: "Police",
	airport: "Air base",
	army: "Army base",
};

function star(r: number): string {
	const points: string[] = [];
	for (let i = 0; i < 10; i++) {
		const radius = i % 2 === 0 ? r : r * 0.42;
		const angle = -Math.PI / 2 + (i * Math.PI) / 5;
		points.push(`${(Math.cos(angle) * radius).toFixed(3)} ${(Math.sin(angle) * radius).toFixed(3)}`);
	}
	return `M ${points.join(" L ")} Z`;
}

/** One icon, about 1 unit across, centred on the origin. */
export function BlipIcon({ kind }: Readonly<{ kind: BlipKind }>) {
	switch (kind) {
		case "hospital":
			return (
				<g>
					<circle r={0.5} fill="#ffffff" stroke="#c81e1e" strokeWidth={0.08} />
					<rect x={-0.3} y={-0.09} width={0.6} height={0.18} fill="#c81e1e" />
					<rect x={-0.09} y={-0.3} width={0.18} height={0.6} fill="#c81e1e" />
				</g>
			);
		case "police":
			return (
				<g>
					<circle r={0.5} fill="#1e4fb8" stroke="#ffffff" strokeWidth={0.08} />
					<path d={star(0.32)} fill="#ffffff" />
				</g>
			);
		case "airport":
			return (
				<g>
					<circle r={0.5} fill="#3a8fd1" stroke="#ffffff" strokeWidth={0.08} />
					{/* A plane seen from above, nose up. */}
					<path d="M0 -0.36 L0.06 -0.1 L0.34 0.06 L0.34 0.13 L0.06 0.04 L0.05 0.24 L0.14 0.31 L0.14 0.36 L0 0.32 L-0.14 0.36 L-0.14 0.31 L-0.05 0.24 L-0.06 0.04 L-0.34 0.13 L-0.34 0.06 L-0.06 -0.1 Z" fill="#ffffff" />
				</g>
			);
		case "army":
			return (
				<g>
					<circle r={0.5} fill="#4f5a33" stroke="#e9dfb8" strokeWidth={0.08} />
					<path d={star(0.32)} fill="#e9dfb8" />
				</g>
			);
		case "waypoint":
			return (
				<g>
					{/* A map pin, its point at the origin. */}
					<path d="M0 0 C -0.12 -0.22 -0.36 -0.42 -0.36 -0.66 A 0.36 0.36 0 1 1 0.36 -0.66 C 0.36 -0.42 0.12 -0.22 0 0 Z" fill={MAP_COLOURS.waypoint} stroke="#ffffff" strokeWidth={0.08} />
					<circle cy={-0.66} r={0.13} fill="#ffffff" />
				</g>
			);
		case "objective":
		case "mission":
			return (
				<g>
					<circle r={0.5} fill={MAP_COLOURS.objective} stroke="#3b3832" strokeWidth={0.08} />
					<text y={0.2} fontSize={0.6} fontWeight={800} textAnchor="middle" fill="#3b3832" fontFamily="var(--font-geist-sans), sans-serif">{kind === "mission" ? "M" : "!"}</text>
				</g>
			);
		case "target":
			return (
				<g>
					<circle r={0.42} fill="#d42a2a" stroke="#ffffff" strokeWidth={0.1} />
					<circle r={0.14} fill="#ffffff" />
				</g>
			);
		case "missionVehicle":
			return (
				<g>
					<circle r={0.45} fill="#2f7fd6" stroke="#ffffff" strokeWidth={0.08} />
					{/* A car from above, nose up. */}
					<rect x={-0.16} y={-0.3} width={0.32} height={0.6} rx={0.1} fill="#ffffff" />
					<rect x={-0.11} y={-0.14} width={0.22} height={0.14} fill="#2f7fd6" />
				</g>
			);
		case "ally":
			return (
				<g>
					<circle r={0.42} fill="#2f7fd6" stroke="#ffffff" strokeWidth={0.1} />
					{/* A person: head and shoulders. */}
					<circle cy={-0.1} r={0.12} fill="#ffffff" />
					<path d="M-0.2 0.24 Q0 0.02 0.2 0.24 Z" fill="#ffffff" />
				</g>
			);
		case "lead":
			return (
				<g>
					<circle r={0.42} fill="#1f8a7a" stroke="#ffffff" strokeWidth={0.08} />
					<text y={0.17} fontSize={0.52} fontWeight={800} textAnchor="middle" fill="#ffffff" fontFamily="var(--font-geist-sans), sans-serif">$</text>
				</g>
			);
		case "safehouse":
			return (
				<g>
					<circle r={0.5} fill="#2e7d4f" stroke="#ffffff" strokeWidth={0.08} />
					<path d="M0 -0.3 L0.3 -0.04 L0.2 -0.04 L0.2 0.26 L-0.2 0.26 L-0.2 -0.04 L-0.3 -0.04 Z" fill="#ffffff" />
				</g>
			);
		case "gunShop":
			return (
				<g>
					<circle r={0.5} fill="#c8402a" stroke="#ffffff" strokeWidth={0.08} />
					{/* A pistol side on, muzzle to the right. */}
					<path d="M-0.3 -0.16 L0.32 -0.16 L0.32 0 L-0.04 0 L-0.08 0.28 L-0.26 0.28 L-0.2 0 L-0.3 0 Z" fill="#ffffff" />
				</g>
			);
		case "showroom":
			return (
				<g>
					<circle r={0.5} fill="#1f9d5a" stroke="#ffffff" strokeWidth={0.08} />
					{/* A car side on. */}
					<path d="M-0.34 0.12 L-0.34 -0.02 L-0.18 -0.04 L-0.08 -0.18 L0.14 -0.18 L0.24 -0.04 L0.34 -0.02 L0.34 0.12 Z" fill="#ffffff" />
					<circle cx={-0.18} cy={0.14} r={0.07} fill="#1f9d5a" stroke="#ffffff" strokeWidth={0.04} />
					<circle cx={0.18} cy={0.14} r={0.07} fill="#1f9d5a" stroke="#ffffff" strokeWidth={0.04} />
				</g>
			);
		case "player":
			return (
				<g>
					<path d="M0 -0.55 L0.38 0.42 L0 0.22 L-0.38 0.42 Z" fill="#ffffff" stroke="#1d2a35" strokeWidth={0.1} strokeLinejoin="round" />
				</g>
			);
		default:
			return <circle r={0.4} fill="#ffffff" stroke="#3b3832" strokeWidth={0.08} />;
	}
}
