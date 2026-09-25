"use client";

import { useEffect, useMemo, useState } from "react";

import { ORION_BUILDING_MAP } from "@/engine/orion/buildings/Buildings";
import { ORION_ROAD_SEGMENTS } from "@/engine/orion/roads/RoadNetwork";
import { RAIL_CROSSINGS, railPolyline } from "@/engine/orion/rail/RailLine";
import { ORION_DISTRICTS } from "@/engine/orion/world/WorldModel";
import { landBounds, landPath, ORION_LAND } from "@/engine/orion/world/StateOutline";
import { POLICE_STATION } from "@/engine/orion/police/Police";
import { usePlayerPose } from "@/components/world/usePlayerPose";

const MINIMAP_SIZE = 190;
/** How many world units the corner minimap shows across its full width. */
const MINIMAP_SPAN = 420;

/** The rail loop as SVG points; the route never changes, so it is worked out once. */
const RAIL_PATH = railPolyline().map((point) => `${point.x},${point.z}`).join(" ");

interface Bounds {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
}

/** Sea shown around the outermost coast on the full map. */
const STATE_MAP_MARGIN = 90;
const EXPANDED_WIDTH_PX = 900;
const SCALE_BAR_UNITS = 250;
/** Matches the sand ring StateTerrain lays around every coast. */
const BEACH_MAP_WIDTH = 26;

function getStateBounds(): Bounds {
	const bounds = landBounds();
	return {
		minX: bounds.minX - STATE_MAP_MARGIN,
		maxX: bounds.maxX + STATE_MAP_MARGIN,
		minZ: bounds.minZ - STATE_MAP_MARGIN,
		maxZ: bounds.maxZ + STATE_MAP_MARGIN,
	};
}

/** Short map labels; the full names are too long to sit inside a district at state scale. */
function shortDistrictName(name: string): string {
	return name.replace(/ District$/, "").replace("Low-Density Residential", "Residential").replace("High-Density Residential", "Uptown");
}

export function WorldMap() {
	const [expanded, setExpanded] = useState(false);
	const pose = usePlayerPose(120);
	const stateBounds = useMemo(() => getStateBounds(), []);
	const coastPaths = useMemo(() => ORION_LAND.map((land) => ({ ...land, d: landPath(land.points) })), []);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.code === "KeyM") setExpanded((open) => !open);
			if (event.code === "Escape") setExpanded(false);
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	// The minimap follows the player; the expanded map shows the whole state at once.
	const view = expanded
		? stateBounds
		: {
			minX: pose.x - MINIMAP_SPAN / 2,
			maxX: pose.x + MINIMAP_SPAN / 2,
			minZ: pose.z - MINIMAP_SPAN / 2,
			maxZ: pose.z + MINIMAP_SPAN / 2,
		};
	const viewBox = `${view.minX} ${view.minZ} ${view.maxX - view.minX} ${view.maxZ - view.minZ}`;
	// The expanded map letterboxes ("meet"), so the pixel scale follows whichever axis is tighter.
	const worldPerPixel = expanded
		? Math.max((view.maxX - view.minX) / EXPANDED_WIDTH_PX, (view.maxZ - view.minZ) / 560)
		: (view.maxX - view.minX) / MINIMAP_SIZE;
	const px = (value: number) => value * worldPerPixel;

	return (
		<div className={expanded ? "orion-map-expanded pointer-events-auto" : "orion-map-corner pointer-events-auto"}>
			<div className="orion-map-frame">
				<svg
					viewBox={viewBox}
					width="100%"
					height="100%"
					preserveAspectRatio={expanded ? "xMidYMid meet" : "xMidYMid slice"}
					role="img"
					aria-label="World map"
				>
					<defs>
						<radialGradient id="orion-sea" cx="50%" cy="50%" r="75%">
							<stop offset="0%" stopColor="#12303d" />
							<stop offset="100%" stopColor="#081820" />
						</radialGradient>
						<pattern id="orion-sea-lines" width={px(14)} height={px(14)} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
							<line x1="0" y1="0" x2="0" y2={px(14)} stroke="rgba(120,180,200,0.05)" strokeWidth={px(1)} />
						</pattern>
					</defs>
					<rect x={view.minX - 2000} y={view.minZ - 2000} width={view.maxX - view.minX + 4000} height={view.maxZ - view.minZ + 4000} fill="url(#orion-sea)" />
					<rect x={view.minX - 2000} y={view.minZ - 2000} width={view.maxX - view.minX + 4000} height={view.maxZ - view.minZ + 4000} fill="url(#orion-sea-lines)" />

					{/* Shallow-water shelf, then beach, then the land itself. */}
					{coastPaths.map((land) => (
						<path key={`${land.id}-shelf`} d={land.d} fill="none" stroke="rgba(92,168,186,0.16)" strokeWidth={Math.max(60, px(16))} strokeLinejoin="round" />
					))}
					{coastPaths.map((land) => (
						<path key={`${land.id}-beach`} d={land.d} fill="#c2ad85" stroke="#c2ad85" strokeWidth={Math.max(BEACH_MAP_WIDTH * 2, px(3))} strokeLinejoin="round" />
					))}
					{coastPaths.map((land) => (
						<path key={land.id} d={land.d} fill="#2f3b2c" stroke="rgba(236,222,190,0.55)" strokeWidth={px(1.2)} strokeLinejoin="round" />
					))}

					{ORION_DISTRICTS.map((district) => {
						const [cx, , cz] = district.bounds.center;
						const [w, d] = district.bounds.size;
						return (
							<rect
								key={district.id}
								x={cx - w / 2}
								y={cz - d / 2}
								width={w}
								height={d}
								rx={12}
								fill={district.contentState === "active" ? "rgba(215,183,122,0.16)" : "rgba(255,255,255,0.04)"}
								stroke={district.contentState === "active" ? "rgba(215,183,122,0.5)" : "rgba(255,255,255,0.1)"}
								strokeWidth={px(1)}
							/>
						);
					})}

					{ORION_ROAD_SEGMENTS.map((segment) => (
						<line
							key={segment.id}
							x1={segment.start[0]}
							y1={segment.start[2]}
							x2={segment.end[0]}
							y2={segment.end[2]}
							stroke="rgba(255,255,255,0.3)"
							strokeWidth={Math.max(segment.width * 0.5, worldPerPixel)}
							strokeLinecap="round"
						/>
					))}

					{/* The rail loop, drawn as sleepers over a rail: dashes on top of a solid line. */}
					<g>
						<polyline
							points={RAIL_PATH}
							fill="none"
							stroke="rgba(228,222,208,0.55)"
							strokeWidth={Math.max(3, worldPerPixel * 1.5)}
						/>
						<polyline
							points={RAIL_PATH}
							fill="none"
							stroke="rgba(30,28,24,0.85)"
							strokeWidth={Math.max(3, worldPerPixel * 1.5)}
							strokeDasharray={`${Math.max(2, worldPerPixel)} ${Math.max(4, worldPerPixel * 2)}`}
						/>
					</g>
					{RAIL_CROSSINGS.map((crossing) => (
						<circle
							key={crossing.id}
							cx={crossing.x} cy={crossing.z}
							r={Math.max(3, worldPerPixel * 2)}
							fill="none"
							stroke="rgba(226,164,92,0.9)"
							strokeWidth={Math.max(1.5, worldPerPixel)}
						/>
					))}

					{ORION_BUILDING_MAP.filter((placement) => !POLICE_STATION.replacesBuildings.includes(placement.id)).map((placement) => (
						<rect
							key={placement.id}
							x={placement.position[0] - placement.footprint[0] / 2}
							y={placement.position[2] - placement.footprint[1] / 2}
							width={placement.footprint[0]}
							height={placement.footprint[1]}
							fill="rgba(215,183,122,0.5)"
						/>
					))}

					<g transform={`translate(${POLICE_STATION.position[0]} ${POLICE_STATION.position[1]})`}>
						<rect
							x={-POLICE_STATION.footprint[0] / 2}
							y={-POLICE_STATION.footprint[1] / 2}
							width={POLICE_STATION.footprint[0]}
							height={POLICE_STATION.footprint[1]}
							fill="#2f5bd3"
						/>
						<circle r={px(6)} fill="#1b3f94" stroke="#ffffff" strokeWidth={px(1.2)} />
						<text y={px(2.6)} fontSize={px(7)} fontWeight={700} textAnchor="middle" fill="#ffffff" fontFamily="var(--font-geist-mono), monospace">P</text>
					</g>

					{expanded ? (
						<g fontFamily="var(--font-geist-mono), monospace" textAnchor="middle" style={{ pointerEvents: "none" }}>
							{ORION_DISTRICTS.map((district) => (
								<text
									key={`${district.id}-label`}
									x={district.bounds.center[0]}
									y={district.bounds.center[2] + district.bounds.size[1] / 2 - px(8)}
									fontSize={px(5.5)}
									letterSpacing={px(0.3)}
									fill="rgba(236,230,214,0.7)"
								>
									{shortDistrictName(district.name).toUpperCase()}
								</text>
							))}
							{ORION_LAND.slice(1).map((land) => (
								<text key={`${land.id}-label`} x={land.centre[0]} y={land.centre[1] + px(3)} fontSize={px(9)} fill="rgba(236,230,214,0.8)">
									{land.name}
								</text>
							))}
							<text x={stateBounds.minX + px(30)} y={stateBounds.maxZ - px(46)} textAnchor="start" fontSize={px(15)} letterSpacing={px(6)} fill="rgba(215,183,122,0.85)">
								ORION STATE
							</text>
							<text x={stateBounds.minX + px(30)} y={stateBounds.maxZ - px(28)} textAnchor="start" fontSize={px(9)} fill="rgba(120,180,200,0.55)" fontStyle="italic">
								Orion Sea
							</text>

							<g transform={`translate(${stateBounds.maxX - px(44)} ${stateBounds.minZ + px(48)})`}>
								<circle r={px(20)} fill="rgba(8,16,20,0.6)" stroke="rgba(236,230,214,0.35)" strokeWidth={px(1)} />
								<path d={`M 0 ${-px(16)} L ${px(5)} 0 L 0 ${px(3)} L ${-px(5)} 0 Z`} fill="#d7b77a" />
								<path d={`M 0 ${px(16)} L ${px(5)} 0 L 0 ${-px(3)} L ${-px(5)} 0 Z`} fill="rgba(236,230,214,0.45)" />
								<text y={-px(24)} fontSize={px(9)} fill="#d7b77a">N</text>
							</g>

							<g transform={`translate(${stateBounds.minX + px(30)} ${stateBounds.minZ + px(40)})`} textAnchor="start">
								<rect width={SCALE_BAR_UNITS} height={px(4)} fill="rgba(236,230,214,0.7)" />
								<rect width={SCALE_BAR_UNITS / 2} height={px(4)} fill="rgba(8,16,20,0.9)" stroke="rgba(236,230,214,0.7)" strokeWidth={px(0.8)} />
								<text y={-px(6)} fontSize={px(8)} fill="rgba(236,230,214,0.7)">{SCALE_BAR_UNITS} m</text>
							</g>
						</g>
					) : null}

					<g transform={`translate(${pose.x} ${pose.z}) rotate(${180 - pose.yaw})`}>
						<circle r={worldPerPixel * 7} fill="rgba(127,184,143,0.2)" />
						<path
							d={`M 0 ${-worldPerPixel * 6} L ${worldPerPixel * 4} ${worldPerPixel * 5} L 0 ${worldPerPixel * 2.5} L ${-worldPerPixel * 4} ${worldPerPixel * 5} Z`}
							fill="#7fb88f"
						/>
					</g>
				</svg>
			</div>

			<div className="orion-map-footer">
				<span className="orion-kicker">{expanded ? "Orion State" : "North District"}</span>
				<button type="button" onClick={() => setExpanded((open) => !open)} className="orion-map-toggle orion-focus">
					{expanded ? "Close · Esc" : "Expand · M"}
				</button>
			</div>
		</div>
	);
}
