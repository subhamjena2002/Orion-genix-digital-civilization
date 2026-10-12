"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

import { usePlayerPose } from "@/components/world/usePlayerPose";
import { activeTarget, clearWaypoint, getWaypoint, LANDMARK_BLIPS, navigationVersion, onNavigationChange, routeTo, setWaypoint, type Blip, type BlipKind, type Target } from "@/engine/orion/navigation/Navigation";
import type { Route } from "@/engine/orion/navigation/RoadGraph";
import { missionBlips } from "@/engine/orion/missions/MissionBlips";
import { readCameraView } from "@/engine/orion/player/PlayerPose";
import { policeMarkers, type PoliceMarker } from "@/engine/orion/traffic/OrionVehicle";
import { ESTATE_NAMES } from "@/engine/orion/world/Estates";
import { isOnLand, landBounds } from "@/engine/orion/world/StateOutline";
import { ORION_DISTRICTS } from "@/engine/orion/world/WorldModel";
import { BLIP_LABELS, BlipIcon } from "./MapIcons";
import { MAP_COLOURS, MapLayers } from "./MapLayers";
import { useTouchDevice } from "./useTouchDevice";

/**
 * The map: a radar in the corner that turns with the camera, and the full map (M) to zoom, pan and
 * set a waypoint on. Wherever the player is being sent — their waypoint, or a mission's objective
 * (see navigation/Navigation) — the GPS route is drawn on both, by road, and redrawn as they go.
 */

const MINIMAP_SIZE = 190;
const TOUCH_MINIMAP_SIZE = 124;
/** World metres across the radar. */
const MINIMAP_SPAN = 360;
/** Sea round the coast on the full map, metres. */
const STATE_MAP_MARGIN = 90;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
/** A press that moves less than this (px) is a tap (set waypoint), not a drag. */
const TAP_SLOP = 6;
/** Re-plan the route once the player has moved this far (m). */
const REPLAN_DISTANCE = 10;
/** Icon sizes on screen, px. */
const ICON_EXPANDED = 20;
const ICON_MINIMAP = 15;

const STATE = (() => {
	const bounds = landBounds();
	return { minX: bounds.minX - STATE_MAP_MARGIN, maxX: bounds.maxX + STATE_MAP_MARGIN, minZ: bounds.minZ - STATE_MAP_MARGIN, maxZ: bounds.maxZ + STATE_MAP_MARGIN };
})();
const STATE_W = STATE.maxX - STATE.minX;
const STATE_H = STATE.maxZ - STATE.minZ;
const STATE_CENTRE: readonly [number, number] = [(STATE.minX + STATE.maxX) / 2, (STATE.minZ + STATE.maxZ) / 2];

/** Police on a chase, sampled for the map a few times a second. */
function usePoliceMarkers(intervalMs: number): readonly PoliceMarker[] {
	const [markers, setMarkers] = useState<readonly PoliceMarker[]>([]);
	useEffect(() => {
		const scratch: PoliceMarker[] = [];
		const id = window.setInterval(() => {
			const count = policeMarkers(scratch);
			setMarkers((previous) => (count === 0 && previous.length === 0 ? previous : scratch.slice(0, count).map((marker) => ({ ...marker }))));
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return markers;
}

/** Mission givers, targets and the safehouse, sampled for the map a few times a second. */
function useMissionBlips(intervalMs: number): readonly Blip[] {
	const [blips, setBlips] = useState<readonly Blip[]>([]);
	useEffect(() => {
		const sample = () => setBlips((previous) => {
			const next = missionBlips();
			const same = next.length === previous.length && next.every((blip, index) => {
				const old = previous[index];
				return old.id === blip.id && old.kind === blip.kind && Math.abs(old.x - blip.x) < 0.5 && Math.abs(old.z - blip.z) < 0.5;
			});
			return same ? previous : next;
		});
		sample();
		const id = window.setInterval(sample, intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return blips;
}

/** The current destination, re-read whenever navigation changes. */
function useTarget(): Target | null {
	const version = useSyncExternalStore(onNavigationChange, navigationVersion, () => 0);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	return useMemo(() => activeTarget(), [version]);
}

/**
 * The GPS route from the player to the target, re-planned as they move: from where they are to
 * the nearest REPLAN_DISTANCE (the route starts at the nearest road anyway).
 */
function useRoute(target: Target | null, x: number, z: number): Route | null {
	const fromX = Math.round(x / REPLAN_DISTANCE) * REPLAN_DISTANCE;
	const fromZ = Math.round(z / REPLAN_DISTANCE) * REPLAN_DISTANCE;
	return useMemo(() => (target ? routeTo(fromX, fromZ, target.x, target.z) : null), [target, fromX, fromZ]);
}

function formatDistance(metres: number): string {
	return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`;
}

/** Where the player is, by name: an estate, a district, or just the state. */
function placeName(x: number, z: number): string {
	const estate = ESTATE_NAMES.find((candidate) => Math.hypot(candidate.x - x, candidate.z - z) < 140);
	if (estate) return estate.name;
	const district = ORION_DISTRICTS.find((candidate) => Math.abs(candidate.bounds.center[0] - x) <= candidate.bounds.size[0] / 2 + 20 && Math.abs(candidate.bounds.center[2] - z) <= candidate.bounds.size[1] / 2 + 20);
	return district ? district.name : "Orion State";
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function WorldMap() {
	const [expanded, setExpanded] = useState(false);
	const touch = useTouchDevice();
	const police = usePoliceMarkers(150);
	const mission = useMissionBlips(200);
	const pose = usePlayerPose(60);
	const target = useTarget();
	const route = useRoute(target, pose.x, pose.z);
	const waypoint = getWaypoint();

	// The full map's view: centre and zoom, and the frame's size in pixels.
	const [centre, setCentre] = useState<readonly [number, number]>(STATE_CENTRE);
	const [zoom, setZoom] = useState(1);
	const frameRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const [frame, setFrame] = useState({ width: 900, height: 560 });

	useEffect(() => {
		const element = frameRef.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setFrame({ width: element.clientWidth || 1, height: element.clientHeight || 1 }));
		observer.observe(element);
		return () => observer.disconnect();
	}, [expanded]);

	const open = useCallback((next: boolean) => {
		setExpanded(next);
		if (next) {
			// The cursor is needed on the map: let go of mouse-look.
			if (document.pointerLockElement) document.exitPointerLock();
			setZoom(1);
			setCentre(STATE_CENTRE);
		}
	}, []);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.code === "KeyM") open(!expanded);
			if (event.code === "Escape") setExpanded(false);
			if (expanded && (event.code === "Equal" || event.code === "NumpadAdd")) setZoom((value) => clamp(value * 1.4, MIN_ZOOM, MAX_ZOOM));
			if (expanded && (event.code === "Minus" || event.code === "NumpadSubtract")) setZoom((value) => clamp(value / 1.4, MIN_ZOOM, MAX_ZOOM));
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [expanded, open]);

	// ---- View ----------------------------------------------------------------------------------
	const minimapPx = touch ? TOUCH_MINIMAP_SIZE : MINIMAP_SIZE;
	const spanW = expanded ? STATE_W / zoom : MINIMAP_SPAN;
	const spanH = expanded ? STATE_H / zoom : MINIMAP_SPAN;
	const viewX = expanded ? centre[0] : pose.x;
	const viewZ = expanded ? centre[1] : pose.z;
	const viewBox = `${viewX - spanW / 2} ${viewZ - spanH / 2} ${spanW} ${spanH}`;
	// World metres per screen pixel ("meet" fits the tighter axis).
	const unit = expanded ? Math.max(spanW / frame.width, spanH / frame.height) : MINIMAP_SPAN / minimapPx;
	const px = (value: number) => value * unit;
	// The radar turns so the camera's view is up.
	const camera = readCameraView();
	const heading = camera.known ? (Math.atan2(camera.forwardZ, camera.forwardX) * 180) / Math.PI : -90;
	const turn = expanded ? 0 : -90 - heading;
	const turnRadians = (turn * Math.PI) / 180;
	const edge = MINIMAP_SPAN / 2 - px(10);

	/** A world offset from the player, turned onto the radar and pinned inside its edge. */
	const pinned = (dx: number, dz: number): { x: number; z: number; out: boolean; angle: number } => {
		const sx = dx * Math.cos(turnRadians) - dz * Math.sin(turnRadians);
		const sz = dx * Math.sin(turnRadians) + dz * Math.cos(turnRadians);
		const reach = Math.max(Math.abs(sx), Math.abs(sz));
		const out = reach > edge;
		const k = out ? edge / reach : 1;
		// Back into world space (the drawing is inside the turned group).
		const bx = sx * k * Math.cos(-turnRadians) - sz * k * Math.sin(-turnRadians);
		const bz = sx * k * Math.sin(-turnRadians) + sz * k * Math.cos(-turnRadians);
		return { x: pose.x + bx, z: pose.z + bz, out, angle: (Math.atan2(sz, sx) * 180) / Math.PI };
	};

	// ---- Interaction (full map) ---------------------------------------------------------------
	const pointers = useRef(new Map<number, { x: number; y: number }>());
	const gesture = useRef<{ startX: number; startY: number; centre: readonly [number, number]; zoom: number; moved: boolean; pinch: number | null }>({ startX: 0, startY: 0, centre: STATE_CENTRE, zoom: 1, moved: false, pinch: null });

	/**
	 * Screen to world, worked out from the map's box and its view ("meet": the view scaled to fit
	 * and centred). getScreenCTM was off by the map's own offset on the page in some browsers.
	 */
	const toWorld = (clientX: number, clientY: number): [number, number] | null => {
		const svg = svgRef.current;
		if (!svg) return null;
		const rect = svg.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		const scale = Math.min(rect.width / spanW, rect.height / spanH);
		const left = rect.left + (rect.width - spanW * scale) / 2;
		const top = rect.top + (rect.height - spanH * scale) / 2;
		return [viewX - spanW / 2 + (clientX - left) / scale, viewZ - spanH / 2 + (clientY - top) / scale];
	};

	const clampCentre = (x: number, z: number, atZoom: number): [number, number] => {
		const halfW = STATE_W / atZoom / 2;
		const halfH = STATE_H / atZoom / 2;
		return [clamp(x, STATE.minX + halfW, STATE.maxX - halfW), clamp(z, STATE.minZ + halfH, STATE.maxZ - halfH)];
	};

	const zoomAround = (factor: number, clientX: number, clientY: number, from = zoom, fromCentre = centre) => {
		const anchor = toWorld(clientX, clientY);
		const next = clamp(from * factor, MIN_ZOOM, MAX_ZOOM);
		if (!anchor) {
			setZoom(next);
			return;
		}
		const ratio = from / next;
		setZoom(next);
		setCentre(clampCentre(anchor[0] + (fromCentre[0] - anchor[0]) * ratio, anchor[1] + (fromCentre[1] - anchor[1]) * ratio, next));
	};

	const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
		if (!expanded) return;
		zoomAround(Math.pow(1.0015, -event.deltaY), event.clientX, event.clientY);
	};

	const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
		if (!expanded) return;
		pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
		try {
			// Keeps a drag going when the pointer leaves the map; not every pointer can be captured.
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Fine without.
		}
		const points = [...pointers.current.values()];
		gesture.current = {
			startX: event.clientX,
			startY: event.clientY,
			centre,
			zoom,
			moved: pointers.current.size > 1,
			pinch: points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : null,
		};
	};

	const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
		if (!expanded || !pointers.current.has(event.pointerId)) return;
		pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
		const state = gesture.current;
		const points = [...pointers.current.values()];
		if (points.length === 2 && state.pinch) {
			const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
			zoomAround(distance / state.pinch, (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2, state.zoom, state.centre);
			return;
		}
		const dx = event.clientX - state.startX;
		const dy = event.clientY - state.startY;
		if (!state.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
		state.moved = true;
		setCentre(clampCentre(state.centre[0] - dx * unit, state.centre[1] - dy * unit, zoom));
	};

	const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
		if (!expanded || !pointers.current.has(event.pointerId)) return;
		pointers.current.delete(event.pointerId);
		const state = gesture.current;
		if (pointers.current.size > 0 || state.moved || event.button === 2) return;
		const point = toWorld(event.clientX, event.clientY);
		if (!point) return;
		// Tapping the waypoint again takes it away; anywhere else on land puts it there.
		if (waypoint && Math.hypot(waypoint.x - point[0], waypoint.z - point[1]) < px(14)) clearWaypoint();
		else if (isOnLand(point[0], point[1])) setWaypoint(point[0], point[1]);
	};

	// ---- Drawing -------------------------------------------------------------------------------
	const iconScale = px(expanded ? ICON_EXPANDED : ICON_MINIMAP);
	const icon = (kind: BlipKind, x: number, z: number, key: string, scale = iconScale) => (
		<g key={key} transform={`translate(${x} ${z}) rotate(${-turn}) scale(${scale})`}>
			<BlipIcon kind={kind} />
		</g>
	);
	const routePoints = route ? route.points.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(" ") : "";
	const targetDistance = target ? (route?.length ?? Math.hypot(target.x - pose.x, target.z - pose.z)) : 0;
	const nearestPolice = police.reduce((nearest, unit) => Math.min(nearest, Math.hypot(unit.x - pose.x, unit.z - pose.z)), Infinity);
	const targetPin = target && !expanded ? pinned(target.x - pose.x, target.z - pose.z) : null;
	const north = !expanded ? pinned(0, -MINIMAP_SPAN) : null;

	return (
		<div className={expanded ? "orion-map-expanded pointer-events-auto" : "orion-map-corner pointer-events-auto"}>
			<div ref={frameRef} className="orion-map-frame" onClick={!expanded ? () => open(true) : undefined}>
				<svg
					ref={svgRef}
					viewBox={viewBox}
					width="100%"
					height="100%"
					preserveAspectRatio={expanded ? "xMidYMid meet" : "xMidYMid slice"}
					role="img"
					aria-label="World map"
					className={expanded ? "orion-map-canvas" : undefined}
					onWheel={onWheel}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={onPointerUp}
					onContextMenu={(event) => {
						event.preventDefault();
						if (expanded) clearWaypoint();
					}}
				>
					<defs>
						<linearGradient id="orion-sea" x1="0" y1="0" x2="1" y2="1">
							<stop offset="0%" stopColor={MAP_COLOURS.sea} />
							<stop offset="100%" stopColor={MAP_COLOURS.seaDeep} />
						</linearGradient>
						<pattern id="orion-sea-lines" width={40} height={40} patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
							<line x1="0" y1="0" x2="0" y2="40" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
						</pattern>
					</defs>
					<g transform={turn ? `rotate(${turn} ${pose.x} ${pose.z})` : undefined}>
						<rect x={STATE.minX - 3000} y={STATE.minZ - 3000} width={STATE_W + 6000} height={STATE_H + 6000} fill="url(#orion-sea)" />
						<rect x={STATE.minX - 3000} y={STATE.minZ - 3000} width={STATE_W + 6000} height={STATE_H + 6000} fill="url(#orion-sea-lines)" />
						<MapLayers unit={expanded ? Math.round(unit * 20) / 20 : unit} labels={expanded} />

						{/* The GPS route, on a white casing so it reads over the roads. */}
						{route ? (
							<g fill="none" strokeLinecap="round" strokeLinejoin="round">
								<polyline points={routePoints} stroke="#ffffff" strokeWidth={Math.max(9, px(7))} />
								<polyline points={routePoints} stroke={target?.kind === "waypoint" ? MAP_COLOURS.route : MAP_COLOURS.objective} strokeWidth={Math.max(5, px(4.2))} />
							</g>
						) : null}

						{LANDMARK_BLIPS.map((blip) => {
							if (expanded) return icon(blip.kind, blip.x, blip.z, blip.id);
							const dx = blip.x - pose.x;
							const dz = blip.z - pose.z;
							return Math.hypot(dx, dz) < MINIMAP_SPAN * 0.75 ? icon(blip.kind, blip.x, blip.z, blip.id) : null;
						})}

						{/* Mission targets stay on the radar's edge when out of range, like the police. */}
						{mission.map((blip) => {
							if (expanded) return icon(blip.kind, blip.x, blip.z, blip.id);
							const dx = blip.x - pose.x;
							const dz = blip.z - pose.z;
							if (blip.kind === "target" || blip.kind === "missionVehicle") {
								const pin = pinned(dx, dz);
								return icon(blip.kind, pin.x, pin.z, blip.id);
							}
							return Math.hypot(dx, dz) < MINIMAP_SPAN * 0.75 ? icon(blip.kind, blip.x, blip.z, blip.id) : null;
						})}

						{police.map((unit, index) => {
							if (expanded) return <circle key={index} className="orion-map-police" cx={unit.x} cy={unit.z} r={px(5)} stroke="#ffffff" strokeWidth={px(1.2)} />;
							const pin = pinned(unit.x - pose.x, unit.z - pose.z);
							return <circle key={index} className="orion-map-police" cx={pin.x} cy={pin.z} r={px(5)} stroke="#ffffff" strokeWidth={px(1.2)} />;
						})}

						{target ? (
							expanded
								? icon(target.kind === "waypoint" ? "waypoint" : "objective", target.x, target.z, "target", px(ICON_EXPANDED * 1.3))
								: targetPin ? icon(target.kind === "waypoint" ? "waypoint" : "objective", targetPin.x, targetPin.z, "target", px(ICON_MINIMAP * 1.3)) : null
						) : null}

						{/* The player: an arrow the way they face. */}
						<g transform={`translate(${pose.x} ${pose.z}) rotate(${180 - pose.yaw}) scale(${px(expanded ? 18 : 16)})`}>
							<BlipIcon kind="player" />
						</g>

						{north ? (
							<g transform={`translate(${north.x} ${north.z}) rotate(${-turn})`}>
								<circle r={px(7)} fill="rgba(29,42,53,0.85)" />
								<text y={px(3)} fontSize={px(9)} fontWeight={800} textAnchor="middle" fill="#ffffff" fontFamily="var(--font-geist-sans), sans-serif">N</text>
							</g>
						) : null}
					</g>
				</svg>

				{expanded ? (
					<>
						<div className="orion-map-legend">
							<p className="orion-map-legend-title">Map legend</p>
							<ul>
								{(["player", "waypoint", "objective", "mission", "target", "safehouse", "hospital", "police", "airport", "army"] as const).map((kind) => (
									<li key={kind}>
										<svg viewBox={kind === "waypoint" ? "-0.6 -1.15 1.2 1.2" : "-0.6 -0.6 1.2 1.2"} width={16} height={16} aria-hidden="true"><BlipIcon kind={kind} /></svg>
										{BLIP_LABELS[kind]}
									</li>
								))}
								<li>
									<span className="orion-map-legend-route" aria-hidden="true" />
									GPS route
								</li>
							</ul>
						</div>
						<div className="orion-map-zoom">
							<button type="button" className="orion-focus" aria-label="Zoom in" onClick={() => setZoom((value) => clamp(value * 1.5, MIN_ZOOM, MAX_ZOOM))}>+</button>
							<button type="button" className="orion-focus" aria-label="Zoom out" onClick={() => { const next = clamp(zoom / 1.5, MIN_ZOOM, MAX_ZOOM); setZoom(next); setCentre((value) => clampCentre(value[0], value[1], next)); }}>−</button>
							<button type="button" className="orion-focus" aria-label="Centre on me" onClick={() => { const next = Math.max(zoom, 4); setZoom(next); setCentre(clampCentre(pose.x, pose.z, next)); }}>◎</button>
						</div>
						<p className="orion-map-hint">
							{touch ? "Tap to set a waypoint · Pinch to zoom · Drag to move" : "Click to set a waypoint · Right-click to clear · Scroll to zoom · Drag to move"}
						</p>
					</>
				) : null}
			</div>

			<div className="orion-map-footer">
				{police.length > 0 ? (
					<span className="orion-kicker orion-map-police-label" role="status">Police · {Math.round(nearestPolice)} m</span>
				) : target ? (
					<span className="orion-kicker orion-map-target-label" role="status">
						<span className="orion-map-target-dot" style={{ background: target.kind === "waypoint" ? MAP_COLOURS.waypoint : MAP_COLOURS.objective }} aria-hidden="true" />
						{target.label} · {formatDistance(targetDistance)}
					</span>
				) : (
					<span className="orion-kicker">{expanded ? "Orion State" : placeName(pose.x, pose.z)}</span>
				)}
				<span className="flex items-center gap-3">
					{expanded && waypoint ? (
						<button type="button" onClick={() => clearWaypoint()} className="orion-map-toggle orion-focus">Clear waypoint</button>
					) : null}
					<button type="button" onClick={(event) => { event.stopPropagation(); open(!expanded); }} className="orion-map-toggle orion-focus">
						{touch ? (expanded ? "Close" : "Map") : expanded ? "Close · Esc" : "Map · M"}
					</button>
				</span>
			</div>
		</div>
	);
}
