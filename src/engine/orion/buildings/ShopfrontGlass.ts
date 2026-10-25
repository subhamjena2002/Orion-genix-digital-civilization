import { Mat4, Vec3, type AppBase, type Entity } from "playcanvas";

import { playAt } from "../audio/SoundBank";
import { combatAudio } from "../combat/CombatAudio";
import type { DamageType } from "../combat/Damage";
import { decals, type DecalHandle } from "../effects/Decals";
import { glassShards } from "../effects/GlassShards";
import { crackSize, glassDamage, hitPane, newPane, type PaneState } from "../traffic/GlassDamage";
import { onWorldReset } from "../world/WorldReset";
import { shopPaneAt } from "./ShopfrontLayout";

/**
 * Shop windows that break. The glass is painted on the buildings' ground floors (one texture for
 * the whole street), so each pane's damage is kept here by building, face and bay, and drawn on
 * top: cracks running out from each hit, and once it goes, the empty frame — the dark shop
 * behind, jagged glass left round the edges — with the plate glass dropping out onto the pavement.
 *
 * The building's collider is untouched (a broken window never opens a way into a building or
 * blocks one), so nothing about where people and cars can go changes. Broken panes stay broken
 * while the player is about, up to a limit, oldest mended first; a new game mends them all.
 */

interface ShopBuilding {
	root: Entity;
	width: number;
	depth: number;
	uOffset: number;
}

interface PaneRecord {
	state: PaneState;
	cracks: DecalHandle[];
	hole: DecalHandle | null;
}

/** What a round into a building found. */
export type ShopfrontHit = "none" | "glass" | "hole";

const MAX_DAMAGED_PANES = 48;
const MAX_CRACKS_PER_PANE = 6;
const CRUMBS_LIFE = 120;

const buildings = new Map<Entity, ShopBuilding>();
const panes = new Map<string, PaneRecord>();
const inverse = new Mat4();
const local = new Vec3();
const world = new Vec3();
const normal = new Vec3();
let resetHooked = false;

/** A building with shops along its ground floor; returns the call that forgets it. */
export function registerShopBuilding(root: Entity, width: number, depth: number, uOffset: number): () => void {
	buildings.set(root, { root, width, depth, uOffset });
	return () => {
		if (buildings.get(root)?.root === root) buildings.delete(root);
	};
}

/**
 * A round that hit a building's collider at (x, y, z), travelling (dx, dy, dz). If it struck shop
 * glass the pane takes it — cracks, or goes — and "glass" is returned; "hole" if it went through
 * a pane already gone (into the dark of the shop); "none" if it was the wall.
 */
export function shootShopfront(app: AppBase, collider: Entity, x: number, y: number, z: number, dx: number, dz: number, type: DamageType, amount: number): ShopfrontHit {
	hookReset(app);
	const building = buildings.get(collider.parent as Entity);
	if (!building) return "none";
	const transform = building.root.getWorldTransform();
	inverse.copy(transform).invert();
	inverse.transformPoint(local.set(x, y, z), local);
	const pane = shopPaneAt(building.width, building.depth, building.uOffset, local.x, local.y, local.z);
	if (!pane) return "none";
	const key = `${building.root.name}:${pane.side}:${pane.bay}:${Math.round(pane.x * 10)}:${Math.round(pane.z * 10)}`;
	let record = panes.get(key);
	if (record?.state.stage === "shattered") return "hole";
	if (!record) {
		record = { state: newPane(), cracks: [], hole: null };
		panes.set(key, record);
		trim(app);
	} else {
		// Most recently hit last, so the oldest damage is mended first.
		panes.delete(key);
		panes.set(key, record);
	}
	transform.transformVector(normal.set(pane.nx, 0, pane.nz), normal).normalize();
	const outcome = hitPane(record.state, "plate", glassDamage(type, amount));
	const layer = decals(app);
	if (outcome === "crack" || outcome === "spread" || outcome === "craze") {
		for (const crack of record.cracks) layer.grow(crack, 1.1);
		if (record.cracks.length >= MAX_CRACKS_PER_PANE) layer.release(record.cracks.shift()!);
		record.cracks.push(layer.place("crack", null, x, y, z, normal.x, normal.y, normal.z, crackSize("plate", record.state)));
		combatAudio().play("bulletGlass", x, y, z, 0.8);
		return "glass";
	}
	if (outcome !== "shatter") return "glass";
	for (const crack of record.cracks) layer.release(crack);
	record.cracks.length = 0;
	transform.transformPoint(world.set(pane.x, pane.y, pane.z), world);
	// The empty frame over where the glass was.
	record.hole = layer.place("broken", null, world.x, world.y, world.z, normal.x, normal.y, normal.z, pane.halfWidth * 2, { spin: 0, aspect: pane.halfHeight / pane.halfWidth });
	const ground = transform.getTranslation(local).y;
	glassShards(app).burst({
		x: world.x, y: world.y + pane.halfHeight * 0.3, z: world.z,
		dirX: normal.x * 0.6 + dx * 0.4, dirY: 0, dirZ: normal.z * 0.6 + dz * 0.4,
		spread: Math.min(pane.halfWidth, 1.2),
		count: 26,
		floor: ground,
		style: "plate",
	});
	layer.place("crumbs", null, world.x + normal.x * 0.7, ground + 0.01, world.z + normal.z * 0.7, 0, 1, 0, Math.min(3, pane.halfWidth * 2.2), { life: CRUMBS_LIFE });
	playAt("glass", world.x, world.y, world.z, { level: 0.95, rate: 0.88, variation: 0.08, channel: "impacts" });
	return "glass";
}

/** Mends the oldest damaged panes past the limit. */
function trim(app: AppBase): void {
	while (panes.size > MAX_DAMAGED_PANES) {
		const [key, record] = panes.entries().next().value as [string, PaneRecord];
		mend(app, record);
		panes.delete(key);
	}
}

function mend(app: AppBase, record: PaneRecord): void {
	const layer = decals(app);
	for (const crack of record.cracks) layer.release(crack);
	if (record.hole) layer.release(record.hole);
}

function hookReset(app: AppBase): void {
	if (resetHooked) return;
	resetHooked = true;
	onWorldReset(() => {
		for (const record of panes.values()) mend(app, record);
		panes.clear();
	});
}
