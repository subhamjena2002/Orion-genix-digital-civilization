import { MAX_ARMOUR, playerSupplies } from "../combat/PlayerSupplies";
import { weaponById } from "../combat/WeaponData";
import { SAFEHOUSE } from "../missions/MissionCatalog";
import { addToGarage, grantWeapon, ownsWeapon, readProgress, spendCash } from "../missions/Progress";
import type { Shop, ShopItem } from "./ShopCatalog";

/**
 * Buying: what an item is called, what it costs right now, whether it can be had (and why not),
 * and the purchase itself — cash out of the save, the gun, the car or the rounds in. Plus the
 * counter the player can be served at, the shop they're being served in, and which item they're
 * looking at: for the prompt, the panel (components/ui/ShopPanel) and the browsing camera
 * (components/world/Shops).
 */

export type ItemCheck = { buyable: true } | { buyable: false; reason: string };

export function itemName(item: ShopItem): string {
	switch (item.kind) {
		case "weapon":
			return weaponById(item.weapon).name;
		case "ammo":
			return `${weaponById(item.weapon).name} rounds`;
		case "armour":
			return "Body armour";
		case "vehicle":
			return item.vehicle.name ?? item.vehicle.style;
	}
}

/** What's in it for the player as things stand: rounds carried, armour worn, a car's pitch. */
export function itemDetail(item: ShopItem): string {
	const supplies = playerSupplies();
	switch (item.kind) {
		case "weapon":
		case "vehicle":
			return item.detail;
		case "ammo": {
			const max = weaponById(item.weapon).maxAmmo;
			return supplies ? `${item.rounds} rounds · carrying ${supplies.spareFor(item.weapon)}/${max}` : `${item.rounds} rounds`;
		}
		case "armour":
			return supplies ? `${item.detail} · wearing ${Math.round(supplies.armour)}/${MAX_ARMOUR}` : item.detail;
	}
}

/** Rounds that would actually go in: no more than the weapon can carry. */
function roomFor(item: Extract<ShopItem, { kind: "ammo" }>): number {
	const supplies = playerSupplies();
	if (!supplies) return 0;
	return Math.max(0, Math.min(item.rounds, weaponById(item.weapon).maxAmmo - supplies.spareFor(item.weapon)));
}

/** The price now: a box that won't all fit costs only for what goes in. */
export function priceOf(item: ShopItem): number {
	if (item.kind !== "ammo") return item.price;
	const room = roomFor(item);
	return room >= item.rounds || room === 0 ? item.price : Math.ceil((item.price * room) / item.rounds / 5) * 5;
}

/** Whether it can be bought now, and if not, why. */
export function checkItem(item: ShopItem): ItemCheck {
	const supplies = playerSupplies();
	switch (item.kind) {
		case "weapon":
			if (ownsWeapon(item.weapon)) return { buyable: false, reason: "Owned" };
			break;
		case "ammo":
			if (!ownsWeapon(item.weapon)) return { buyable: false, reason: "Get the gun first" };
			if (!supplies) return { buyable: false, reason: "Not now" };
			if (roomFor(item) === 0) return { buyable: false, reason: "Full" };
			break;
		case "armour":
			if (!supplies) return { buyable: false, reason: "Not now" };
			if (supplies.armour >= MAX_ARMOUR) return { buyable: false, reason: "Full" };
			break;
		case "vehicle": {
			const garage = readProgress().garage;
			if (garage.some((car) => car.id === item.vehicle.id)) return { buyable: false, reason: "In your garage" };
			if (garage.length >= SAFEHOUSE.bays.length) return { buyable: false, reason: "Garage full" };
			break;
		}
	}
	if (readProgress().cash < priceOf(item)) return { buyable: false, reason: "Not enough cash" };
	return { buyable: true };
}

/** Buys it, if it can be bought: the cash taken and the thing handed over. */
export function buy(item: ShopItem): { ok: boolean; message: string } {
	const check = checkItem(item);
	if (!check.buyable) return { ok: false, message: check.reason };
	if (!spendCash(priceOf(item))) return { ok: false, message: "Not enough cash" };
	const name = itemName(item);
	switch (item.kind) {
		case "weapon":
			grantWeapon(item.weapon);
			return { ok: true, message: `Bought: ${name}` };
		case "ammo": {
			const added = playerSupplies()?.addAmmo(item.weapon, item.rounds) ?? 0;
			return { ok: true, message: `+${added} ${name}` };
		}
		case "armour":
			playerSupplies()?.addArmour(MAX_ARMOUR);
			return { ok: true, message: "Armour on" };
		case "vehicle":
			addToGarage(item.vehicle);
			return { ok: true, message: `${name} delivered to your garage` };
	}
}

// ---- The counter the player's at --------------------------------------------------------------

let open: Shop | null = null;
/** The counter the player's stood at, not yet served: "E · Shop". */
let inReach: Shop | null = null;
/** The item on show in the open shop, by its place in the list. */
let selection = 0;
const listeners = new Set<() => void>();

function changed(): void {
	for (const listener of [...listeners]) listener();
}

export function openShop(shop: Shop): void {
	if (open === shop) return;
	open = shop;
	selection = 0;
	changed();
}

export function closeShop(): void {
	if (!open) return;
	open = null;
	changed();
}

/** The shop whose counter the player's at, or null. */
export function currentShop(): Shop | null {
	return open;
}

/** The counter within reach (or null): set each frame by the counters in the world. */
export function setCounterInReach(shop: Shop | null): void {
	if (inReach === shop) return;
	inReach = shop;
	changed();
}

export function counterInReach(): Shop | null {
	return inReach;
}

/** Served at the counter within reach (E, or the touch screen's Shop button): false if there's none. */
export function openCounterInReach(): boolean {
	if (!inReach || open) return false;
	openShop(inReach);
	return true;
}

/** The item the panel has chosen: the camera shows it on the wall, or on the lot. */
export function setShopSelection(index: number): void {
	selection = index;
}

export function shopSelection(): number {
	return selection;
}

export function onShopChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
