"use client";

import { memo, useEffect, useMemo, useState } from "react";

import { ORION_BUILDING_MAP } from "@/engine/orion/buildings/Buildings";
import { POLICE_STATION } from "@/engine/orion/police/Police";
import { RAIL_CROSSINGS, railPolyline } from "@/engine/orion/rail/RailLine";
import { ORION_ROAD_SEGMENTS } from "@/engine/orion/roads/RoadNetwork";
import { AIRFIELD_FENCE, AIRFIELD_SURFACES, RUNWAY, SHELTER, SHELTERS } from "@/engine/orion/world/Airfield";
import { ESTATE_NAMES, ESTATE_ROADS, HOUSE_LOTS, lotOutline } from "@/engine/orion/world/Estates";
import { HOSPITAL_REPLACED_BUILDINGS, HOSPITALS } from "@/engine/orion/world/Hospitals";
import { ACCESS_ROAD, BASE, BASE_BOUNDS } from "@/engine/orion/world/MilitaryBase";
import { landPath, ORION_LAND } from "@/engine/orion/world/StateOutline";
import { ORION_DISTRICTS, ORION_PARCELS } from "@/engine/orion/world/WorldModel";
import { HIGHWAY_MAP, mapRelief, type ReliefImage } from "./MapRelief";

/**
 * Everything on the map that doesn't move: sea, coast and beach, parks, hills, roads, rail,
 * buildings, the estates and the landmarks — in a light, legible style: pale land, white roads on
 * a dark casing, green parks and gardens, sand along every coast, blue water.
 *
 * Memoised, so the map redrawing for the player's position a few times a second doesn't rebuild
 * the thousands of elements underneath.
 */

export const MAP_COLOURS = {
	sea: "#3f7f99",
	seaDeep: "#2e6680",
	shelf: "rgba(150,210,222,0.35)",
	beach: "#eadcae",
	land: "#d3cfc3",
	park: "#8fbc76",
	garden: "#a2c98a",
	block: "#b4ac9d",
	house: "#c9bba3",
	pool: "#4fc3e0",
	roadCasing: "#6f7378",
	road: "#ffffff",
	highwayCasing: "#8a6420",
	highway: "#f3c04f",
	rail: "#55524c",
	label: "#3b3832",
	halo: "rgba(255,255,255,0.85)",
	waypoint: "#ff4fb8",
	objective: "#ffc634",
	route: "#ff4fb8",
} as const;

/** District names show at this many metres per pixel or closer. */
const DISTRICT_LABEL_UNIT = 1.6;
/** Sand ring StateTerrain lays round every coast. */
const BEACH_MAP_WIDTH = 26;

const RAIL_PATH = railPolyline().map((point) => `${point.x},${point.z}`).join(" ");
const COAST_PATHS = ORION_LAND.map((land) => ({ ...land, d: landPath(land.points) }));
const PARKS = ORION_PARCELS.filter((parcel) => parcel.zoning === "park");
const CITY_BUILDINGS = ORION_BUILDING_MAP.filter((placement) => !POLICE_STATION.replacesBuildings.includes(placement.id) && !HOSPITAL_REPLACED_BUILDINGS.includes(placement.id));
const ESTATE_LINES = ESTATE_ROADS.map((road) => ({ id: road.id, points: road.points.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(" "), deadEnds: [!road.startJoins ? road.points[0] : null, !road.endJoins ? road.points[road.points.length - 1] : null].filter((point): point is readonly [number, number] => point !== null) }));
const LOT_SHAPES = HOUSE_LOTS.map((lot) => ({ lot, garden: lotOutline(lot).map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(" ") }));

function useRelief(): readonly ReliefImage[] {
	// Drawn on a canvas, so only in the browser, and after the first paint.
	const [relief, setRelief] = useState<readonly ReliefImage[]>([]);
	useEffect(() => {
		const id = window.setTimeout(() => setRelief(mapRelief()), 0);
		return () => window.clearTimeout(id);
	}, []);
	return relief;
}

/** Text with a white halo, readable over anything. */
function Label({ x, y, size, children, colour = MAP_COLOURS.label, weight = 600, italic = false, spacing = 0, transform }: Readonly<{
	x: number; y: number; size: number; children: string; colour?: string; weight?: number; italic?: boolean; spacing?: number; transform?: string;
}>) {
	return (
		<text
			x={x} y={y} transform={transform}
			fontSize={size} fontWeight={weight} fontStyle={italic ? "italic" : undefined} letterSpacing={spacing}
			fill={colour} stroke={MAP_COLOURS.halo} strokeWidth={size * 0.28} paintOrder="stroke" strokeLinejoin="round"
		>
			{children}
		</text>
	);
}

/** The ground, roads and places. `unit` is world metres per screen pixel, for line widths. */
export const MapLayers = memo(function MapLayers({ unit, labels }: Readonly<{ unit: number; labels: boolean }>) {
	const relief = useRelief();
	const px = (value: number) => value * unit;
	const casing = (width: number) => Math.max(width + px(2.2), px(3.4));
	const fill = (width: number) => Math.max(width, px(2));
	const roads = useMemo(() => ORION_ROAD_SEGMENTS.map((segment) => ({ ...segment, x1: segment.start[0], z1: segment.start[2], x2: segment.end[0], z2: segment.end[2] })), []);

	return (
		<g>
			{/* Shallow water, beach, then the land. */}
			{COAST_PATHS.map((land) => <path key={`${land.id}-shelf`} d={land.d} fill="none" stroke={MAP_COLOURS.shelf} strokeWidth={Math.max(70, px(18))} strokeLinejoin="round" />)}
			{COAST_PATHS.map((land) => <path key={`${land.id}-beach`} d={land.d} fill={MAP_COLOURS.beach} stroke={MAP_COLOURS.beach} strokeWidth={BEACH_MAP_WIDTH * 2} strokeLinejoin="round" />)}
			{COAST_PATHS.map((land) => <path key={land.id} d={land.d} fill={MAP_COLOURS.land} />)}

			{/* Parks and gardens. */}
			{PARKS.map((parcel) => (
				<rect key={parcel.id} x={parcel.position[0] - parcel.bounds[0] / 2 - 2} y={parcel.position[2] - parcel.bounds[1] / 2 - 2} width={parcel.bounds[0] + 4} height={parcel.bounds[1] + 4} rx={2} fill={MAP_COLOURS.park} />
			))}
			{LOT_SHAPES.map(({ lot, garden }) => <polygon key={`${lot.id}-garden`} points={garden} fill={MAP_COLOURS.garden} />)}

			{relief.map((image) => (
				<image key={image.id} href={image.href} x={image.x} y={image.z} width={image.width} height={image.height} preserveAspectRatio="none" opacity={0.9} />
			))}

			{/* The army base and the airfield. */}
			<rect x={BASE_BOUNDS.minX} y={BASE_BOUNDS.minZ} width={BASE.size[0]} height={BASE.size[1]} fill="#9aa27a" stroke="#6d7350" strokeWidth={px(1)} />
			{AIRFIELD_FENCE.map((run, index) => (
				<polyline key={index} points={run.map(([x, z]) => `${x},${z}`).join(" ")} fill="none" stroke="#8e9470" strokeWidth={px(1)} />
			))}
			{AIRFIELD_SURFACES.map((surface) => (
				<rect
					key={surface.id}
					x={surface.x - surface.width / 2} y={surface.z - surface.depth / 2} width={surface.width} height={surface.depth}
					fill={surface.kind === "runway" ? "#5d5f62" : surface.kind === "shoulder" || surface.kind === "blastPad" ? "#8c8c89" : "#a9a8a2"}
				/>
			))}
			<line x1={RUNWAY.x} y1={RUNWAY.northZ + 50} x2={RUNWAY.x} y2={RUNWAY.southZ - 50} stroke="#f4f3ee" strokeWidth={Math.max(1.5, unit)} strokeDasharray="30 20" />
			{SHELTERS.map((shelter) => (
				<rect key={shelter.id} x={shelter.backX} y={shelter.z - SHELTER.width / 2} width={SHELTER.depth} height={SHELTER.width} rx={SHELTER.width / 3} fill="#b9b5a5" stroke="#7d7a70" strokeWidth={px(0.8)} />
			))}

			{/* City blocks, then houses and their pools. */}
			{CITY_BUILDINGS.map((placement) => (
				<rect key={placement.id} x={placement.position[0] - placement.footprint[0] / 2} y={placement.position[2] - placement.footprint[1] / 2} width={placement.footprint[0]} height={placement.footprint[1]} fill={MAP_COLOURS.block} />
			))}
			{LOT_SHAPES.map(({ lot }) => (
				<g key={lot.id} transform={`translate(${lot.x} ${lot.z}) rotate(${-lot.yaw})`}>
					<rect x={-lot.width / 2} y={-lot.depth / 2} width={lot.width} height={lot.depth} fill={MAP_COLOURS.house} />
					{lot.pool ? <rect x={-4} y={-(lot.depth / 2 + 7.5)} width={8} height={4} rx={1} fill={MAP_COLOURS.pool} /> : null}
				</g>
			))}

			{/* Roads: a dark casing under white, so they read on pale ground. Expressways in amber. */}
			<g strokeLinecap="round" strokeLinejoin="round" fill="none">
				{roads.map((road) => <line key={`${road.id}-casing`} x1={road.x1} y1={road.z1} x2={road.x2} y2={road.z2} stroke={MAP_COLOURS.roadCasing} strokeWidth={casing(road.width * 0.75)} />)}
				{ESTATE_LINES.map((road) => <polyline key={`${road.id}-casing`} points={road.points} stroke={MAP_COLOURS.roadCasing} strokeWidth={casing(7)} />)}
				{ESTATE_LINES.flatMap((road) => road.deadEnds.map(([x, z], index) => <circle key={`${road.id}-end-${index}`} cx={x} cy={z} r={10 + px(1.1)} fill={MAP_COLOURS.roadCasing} stroke="none" />))}
				{roads.map((road) => <line key={road.id} x1={road.x1} y1={road.z1} x2={road.x2} y2={road.z2} stroke={MAP_COLOURS.road} strokeWidth={fill(road.width * 0.75)} />)}
				{ESTATE_LINES.map((road) => <polyline key={road.id} points={road.points} stroke={MAP_COLOURS.road} strokeWidth={fill(7)} />)}
				{ESTATE_LINES.flatMap((road) => road.deadEnds.map(([x, z], index) => <circle key={`${road.id}-end-fill-${index}`} cx={x} cy={z} r={10} fill={MAP_COLOURS.road} stroke="none" />))}
				<line x1={ACCESS_ROAD.x} y1={ACCESS_ROAD.fromZ} x2={ACCESS_ROAD.x} y2={ACCESS_ROAD.toZ} stroke={MAP_COLOURS.roadCasing} strokeWidth={casing(ACCESS_ROAD.width * 0.75)} />
				<line x1={ACCESS_ROAD.x} y1={ACCESS_ROAD.fromZ} x2={ACCESS_ROAD.x} y2={ACCESS_ROAD.toZ} stroke={MAP_COLOURS.road} strokeWidth={fill(ACCESS_ROAD.width * 0.75)} />
				{HIGHWAY_MAP.map((highway) => (
					<g key={highway.id}>
						<polyline points={highway.route} stroke={MAP_COLOURS.highwayCasing} strokeWidth={Math.max(30, px(7))} />
						{highway.bridges.map((bridge, index) => <polyline key={index} points={bridge} stroke="#f7f4ea" strokeWidth={Math.max(34, px(8.5))} />)}
						<polyline points={highway.route} stroke={MAP_COLOURS.highway} strokeWidth={Math.max(20, px(4.4))} />
						{highway.tunnels.map((tunnel, index) => (
							<polyline key={index} points={tunnel} stroke={MAP_COLOURS.land} strokeWidth={Math.max(14, px(3))} strokeDasharray={`${Math.max(8, px(3))} ${Math.max(8, px(3))}`} strokeLinecap="butt" />
						))}
					</g>
				))}
			</g>

			{/* The railway: sleepers over a rail. */}
			<polyline points={RAIL_PATH} fill="none" stroke={MAP_COLOURS.rail} strokeWidth={Math.max(3, unit * 1.6)} />
			<polyline points={RAIL_PATH} fill="none" stroke="#e9e5da" strokeWidth={Math.max(3, unit * 1.6)} strokeDasharray={`${Math.max(2, unit)} ${Math.max(4, unit * 2)}`} />
			{RAIL_CROSSINGS.map((crossing) => (
				<circle key={crossing.id} cx={crossing.x} cy={crossing.z} r={Math.max(3, unit * 2)} fill="none" stroke="#c9792b" strokeWidth={Math.max(1.5, unit)} />
			))}

			{/* Landmark footprints (their icons are drawn on top by the map). */}
			{HOSPITALS.map((hospital) => (
				<rect key={hospital.id} x={hospital.position[0] - hospital.footprint[0] / 2} y={hospital.position[1] - hospital.footprint[1] / 2} width={hospital.footprint[0]} height={hospital.footprint[1]} fill="#f2f2ef" stroke="#c9c6bd" strokeWidth={px(0.6)} />
			))}
			<rect x={POLICE_STATION.position[0] - POLICE_STATION.footprint[0] / 2} y={POLICE_STATION.position[1] - POLICE_STATION.footprint[1] / 2} width={POLICE_STATION.footprint[0]} height={POLICE_STATION.footprint[1]} fill="#7f9be0" />

			{labels ? (
				<g fontFamily="var(--font-geist-sans), sans-serif" textAnchor="middle" style={{ pointerEvents: "none" }}>
					{/* District names only once zoomed in: at full extent they crowd each other. */}
					{unit < DISTRICT_LABEL_UNIT && ORION_DISTRICTS.map((district) => (
						<Label key={district.id} x={district.bounds.center[0]} y={district.bounds.center[2] + px(4)} size={px(9)} spacing={px(0.6)} colour="rgba(59,56,50,0.75)">
							{district.name.replace(/ District$/, "").replace("Low-Density Residential", "Residential").replace("High-Density Residential", "Uptown").toUpperCase()}
						</Label>
					))}
					{ESTATE_NAMES.map((estate) => (
						<Label key={estate.id} x={estate.x} y={estate.z} size={px(11)} italic colour="#2f5a2a">{estate.name}</Label>
					))}
					{HIGHWAY_MAP.map((highway) => (
						<Label key={`${highway.id}-label`} x={0} y={-px(8)} size={px(9)} colour="#7a5310" transform={`translate(${highway.labelX} ${highway.labelZ}) rotate(${highway.labelAngle})`}>
							{highway.name.toUpperCase()}
						</Label>
					))}
					{relief.map((image) => (
						<Label key={`${image.id}-label`} x={image.peakX} y={image.peakZ - px(6)} size={px(9)} italic weight={500} colour="#4d4a3a">
							{`▲ ${image.name} · ${Math.round(image.peak)} m`}
						</Label>
					))}
					{ORION_LAND.slice(1).map((land) => (
						<Label key={`${land.id}-label`} x={land.centre[0]} y={land.centre[1] + px(3)} size={px(11)} italic>{land.name}</Label>
					))}
				</g>
			) : null}
		</g>
	);
});
