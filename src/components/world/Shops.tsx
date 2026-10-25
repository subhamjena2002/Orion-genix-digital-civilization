"use client";

import { useApp } from "@playcanvas/react/hooks";
import { memo, useEffect } from "react";

import { placeMissionHostile, releaseMissionHostiles } from "@/engine/orion/characters/OrionPedestrian";
import { readCombatHud } from "@/engine/orion/combat/CombatHud";
import { missions } from "@/engine/orion/missions/MissionDirector";
import { readWanted } from "@/engine/orion/police/Wanted";
import { setCinematicView, type CinematicView } from "@/engine/orion/player/CinematicCamera";
import { setControlsHeld } from "@/engine/orion/player/ControlHold";
import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { SHOPS, type Shop } from "@/engine/orion/shops/ShopCatalog";
import { KASPER_LOT_BAYS, ORION_ARMS_DISPLAYS, toWorld, type DisplaySpot, type Point3 } from "@/engine/orion/shops/ShopLayouts";
import { closeShop, counterInReach, currentShop, openCounterInReach, setCounterInReach, shopSelection } from "@/engine/orion/shops/Shops";
import { releasePointer } from "@/components/ui/pause";

/** Served from this close to the counter. */
const COUNTER_REACH = 1.6;
/** The staff are at the counter while the player's this near, and gone again past the further mark. */
const KEEPER_RANGE = 60;
const KEEPER_RELEASE = 80;
/** How quickly the browsing camera moves from one thing on show to the next (1/s). */
const CAMERA_EASE = 4.5;
/** Before anything's chosen: the gun wall, seen over the counter. */
const OVERVIEW: DisplaySpot = { at: [0.4, 2.3, -5.4], from: [0.6, 1.9, -0.6] };

/** Where the camera stands to show an item: a gun on the wall, the shelves, a car on the lot. */
function showing(shop: Shop, index: number): DisplaySpot {
	const item = shop.items[index];
	if (!item) return OVERVIEW;
	if (shop.kind === "cars") return KASPER_LOT_BAYS[item.id]?.view ?? OVERVIEW;
	return ORION_ARMS_DISPLAYS[item.id] ?? OVERVIEW;
}

function place(shop: Shop, local: Point3, out: { x: number; y: number; z: number }): void {
	const [x, y, z] = toWorld(shop.site, local);
	out.x = x;
	out.y = shop.site.ground + y;
	out.z = z;
}

/**
 * The shops' counters (the places themselves are ShopBuildings): whoever serves stands there while
 * the player's about, and a player on foot at the counter is offered the shop ("E · Shop", see
 * DrivingHud) — not in a cutscene or being briefed, and not while wanted (they're told to lose the
 * police first). Being served holds the player still, lets the mouse go for the panel (components/
 * ui/ShopPanel), and turns the camera to whatever's chosen: the gun on the wall, the car on the lot.
 */
export const Shops = memo(function Shops() {
	const app = useApp();

	useEffect(() => {
		if (!app) return;
		const placed = new Map<string, boolean>();
		/** Turned away at this counter (wanted): said once, until the player steps off it. */
		let warned: string | null = null;
		const want = { from: { x: 0, y: 0, z: 0 }, at: { x: 0, y: 0, z: 0 } };
		const view: CinematicView = { fromX: 0, fromY: 0, fromZ: 0, atX: 0, atY: 0, atZ: 0, faceX: Number.NaN, faceZ: Number.NaN };
		let filming: Shop | null = null;

		const serve = () => {
			if (!openCounterInReach()) return;
			// The panel's clicked, not the world: let the mouse go.
			releasePointer();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.code === "KeyE" && !event.repeat && counterInReach() && !currentShop()) serve();
		};
		window.addEventListener("keydown", handleKeyDown);

		const update = (dt: number) => {
			const pose = readPlayerPose();
			const combat = readCombatHud();
			const wanted = readWanted().stars > 0;
			const onFoot = !pose.inVehicle && !combat.wasted && !combat.busted;
			const free = onFoot && !wanted && !missions.inScene && missions.phase !== "briefing";

			// The staff, at their counters while the player's near enough to see them.
			for (const shop of SHOPS) {
				const distance = Math.hypot(shop.site.x - pose.x, shop.site.z - pose.z);
				const keeper = shop.keeper;
				if (!placed.get(keeper.id) && distance < KEEPER_RANGE) {
					placed.set(keeper.id, placeMissionHostile(keeper.id, keeper.x, keeper.z, false, 1, "passive", keeper.yaw));
				} else if (placed.get(keeper.id) && distance > KEEPER_RELEASE) {
					releaseMissionHostiles([keeper.id]);
					placed.set(keeper.id, false);
				}
			}

			const open = currentShop();
			// Whatever ends the visit: trouble, a cutscene, a briefing.
			if (open && !free) closeShop();

			let reach: Shop | null = null;
			for (const shop of SHOPS) if (Math.hypot(shop.x - pose.x, shop.z - pose.z) < COUNTER_REACH) reach = shop;
			if (reach && onFoot && wanted && warned !== reach.id) {
				warned = reach.id;
				missions.notice("Lose the police first");
			}
			if (!reach) warned = null;
			setCounterInReach(free && !currentShop() ? reach : null);
			setControlsHeld(currentShop() !== null, "shop");

			// Browsing: the camera on whatever's chosen, easing from one thing to the next.
			const shop = currentShop();
			if (!shop) {
				if (filming) setCinematicView(null);
				filming = null;
				return;
			}
			const spot = showing(shop, shopSelection());
			place(shop, spot.from, want.from);
			place(shop, spot.at, want.at);
			if (filming !== shop) {
				filming = shop;
				view.fromX = want.from.x;
				view.fromY = want.from.y;
				view.fromZ = want.from.z;
				view.atX = want.at.x;
				view.atY = want.at.y;
				view.atZ = want.at.z;
			} else {
				const k = 1 - Math.exp(-CAMERA_EASE * dt);
				view.fromX += (want.from.x - view.fromX) * k;
				view.fromY += (want.from.y - view.fromY) * k;
				view.fromZ += (want.from.z - view.fromZ) * k;
				view.atX += (want.at.x - view.atX) * k;
				view.atY += (want.at.y - view.atY) * k;
				view.atZ += (want.at.z - view.atZ) * k;
			}
			// The player faces whoever's serving.
			view.faceX = shop.keeper.x;
			view.faceZ = shop.keeper.z;
			setCinematicView(view);
		};
		app.on("update", update);
		return () => {
			app.off("update", update);
			window.removeEventListener("keydown", handleKeyDown);
			closeShop();
			setCounterInReach(null);
			setControlsHeld(false, "shop");
			if (filming) setCinematicView(null);
			releaseMissionHostiles([...placed.keys()]);
		};
	}, [app]);

	return null;
});
