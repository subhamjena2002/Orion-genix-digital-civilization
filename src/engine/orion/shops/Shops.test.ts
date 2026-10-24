import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearPickups, dropWeapon, MAX_PICKUPS, PICKUP_LIFETIME, pickups, takePickupsNear, updatePickups } from "../combat/Pickups";
import { MAX_ARMOUR, setPlayerSupplies, type PlayerSupplies } from "../combat/PlayerSupplies";
import { WEAPONS, weaponById } from "../combat/WeaponData";
import { WeaponInventory } from "../combat/WeaponInventory";
import { SAFEHOUSE } from "../missions/MissionCatalog";
import { addCash, addToGarage, ownsWeapon, readProgress, setProgressStorage } from "../missions/Progress";
import { LANDMARK_BLIPS } from "../navigation/Navigation";
import { pavedHeightAt } from "../roads/RoadNetwork";
import { ORION_BUILDING_MAP } from "../buildings/Buildings";
import { KASPER_SHOWROOM, ORION_ARMS, SHOPS, type ShopItem } from "./ShopCatalog";
import { KASPER_LOT_BAYS, KASPER_LOT_PLACES, ORION_ARMS_DISPLAYS, ORION_ARMS_WALL, toWorld, type ShopSite } from "./ShopLayouts";
import { buy, checkItem, priceOf } from "./Shops";

/** The player's rounds and armour, as their combat would hand them to a shop. */
function supplies(): PlayerSupplies & { inventory: WeaponInventory } {
	const inventory = new WeaponInventory(WEAPONS, "fists");
	let armour = 0;
	return {
		inventory,
		spareFor: (weapon) => inventory.spareFor(weapon),
		addAmmo: (weapon, rounds) => inventory.addAmmo(weapon, rounds),
		get armour() {
			return armour;
		},
		addArmour: (amount) => {
			const added = Math.min(amount, MAX_ARMOUR - armour);
			armour += added;
			return added;
		},
	};
}

const item = (shop: typeof ORION_ARMS, id: string): ShopItem => shop.items.find((candidate) => candidate.id === id)!;

let player: ReturnType<typeof supplies>;

beforeEach(() => {
	setProgressStorage(null);
	player = supplies();
	setPlayerSupplies(player);
});

afterEach(() => {
	setPlayerSupplies(null);
	setProgressStorage(undefined);
	clearPickups();
});

describe("buying", () => {
	it("sells a gun for what it costs, once", () => {
		const shotgun = item(ORION_ARMS, "shotgun");
		expect(checkItem(shotgun)).toEqual({ buyable: false, reason: "Not enough cash" });
		addCash(2000);
		expect(buy(shotgun).ok).toBe(true);
		expect(ownsWeapon("shotgun")).toBe(true);
		expect(readProgress().cash).toBe(2000 - shotgun.price);
		expect(buy(shotgun)).toEqual({ ok: false, message: "Owned" });
		expect(readProgress().cash).toBe(2000 - shotgun.price);
	});

	it("sells rounds only for a gun the player has, and no more than they can carry", () => {
		addCash(10_000);
		expect(checkItem(item(ORION_ARMS, "ammo-ar"))).toEqual({ buyable: false, reason: "Get the gun first" });
		const pistol = item(ORION_ARMS, "ammo-pistol");
		const before = player.spareFor("pistol");
		expect(buy(pistol).ok).toBe(true);
		expect(player.spareFor("pistol")).toBe(before + 36);
		// Near the limit, a box costs only for what still fits; at it, there's nothing to sell.
		const max = weaponById("pistol").maxAmmo;
		player.inventory.addAmmo("pistol", max - player.spareFor("pistol") - 12);
		expect(priceOf(pistol)).toBeLessThan(pistol.price);
		const cash = readProgress().cash;
		buy(pistol);
		expect(player.spareFor("pistol")).toBe(max);
		expect(readProgress().cash).toBe(cash - 50);
		expect(checkItem(pistol)).toEqual({ buyable: false, reason: "Full" });
	});

	it("puts a vest on, and won't sell another while it's whole", () => {
		addCash(2000);
		const vest = item(ORION_ARMS, "vest");
		expect(buy(vest)).toEqual({ ok: true, message: "Armour on" });
		expect(player.armour).toBe(MAX_ARMOUR);
		expect(checkItem(vest)).toEqual({ buyable: false, reason: "Full" });
	});

	it("delivers a car to the garage, not twice, and not into a full garage", () => {
		addCash(100_000);
		const hatch = item(KASPER_SHOWROOM, "hatch-red");
		expect(buy(hatch).ok).toBe(true);
		expect(readProgress().garage.map((car) => car.id)).toContain("bought-hatch-red");
		expect(checkItem(hatch)).toEqual({ buyable: false, reason: "In your garage" });
		for (let bay = readProgress().garage.length; bay < SAFEHOUSE.bays.length; bay++) addToGarage({ id: `filler-${bay}`, style: "sedan", colour: "#000000" });
		expect(checkItem(item(KASPER_SHOWROOM, "vesper-silver"))).toEqual({ buyable: false, reason: "Garage full" });
	});

	it("can't sell rounds or armour before the player's in the world", () => {
		setPlayerSupplies(null);
		addCash(5000);
		expect(checkItem(item(ORION_ARMS, "vest"))).toEqual({ buyable: false, reason: "Not now" });
	});
});

/** Where a point in the world is in a site's own frame (the inverse of toWorld). */
function toLocal(site: ShopSite, x: number, z: number): [number, number] {
	const radians = (site.yaw * Math.PI) / 180;
	const dx = x - site.x;
	const dz = z - site.z;
	return [dx * Math.cos(radians) - dz * Math.sin(radians), dx * Math.sin(radians) + dz * Math.cos(radians)];
}

const inside = (site: ShopSite, x: number, z: number) => {
	const [lx, lz] = toLocal(site, x, z);
	return Math.abs(lx) < site.width / 2 && Math.abs(lz) < site.depth / 2;
};

describe("the shops", () => {
	it("serve at a counter inside their own place, with someone behind it, on the map", () => {
		for (const shop of SHOPS) {
			expect(inside(shop.site, shop.x, shop.z), shop.id).toBe(true);
			expect(inside(shop.site, shop.keeper.x, shop.keeper.z), shop.id).toBe(true);
			expect(Math.hypot(shop.keeper.x - shop.x, shop.keeper.z - shop.z), shop.id).toBeLessThan(4);
			expect(LANDMARK_BLIPS.some((blip) => blip.id === shop.id)).toBe(true);
		}
	});

	it("take the plots of real grid buildings, their fronts on the street", () => {
		for (const shop of SHOPS) {
			for (const id of shop.site.replaces) expect(ORION_BUILDING_MAP.some((placement) => placement.id === id), id).toBe(true);
			// Out past the site's street side (and the store's paved step) is the pavement or the road.
			const [x, , z] = toWorld(shop.site, [0, 0, shop.site.depth / 2 + 2.5]);
			expect(pavedHeightAt(x, z), shop.id).not.toBeNull();
		}
	});

	it("have everything for sale on show", () => {
		for (const sold of ORION_ARMS.items) expect(ORION_ARMS_DISPLAYS[sold.id], sold.id).toBeDefined();
		for (const sold of KASPER_SHOWROOM.items) expect(KASPER_LOT_BAYS[sold.id], sold.id).toBeDefined();
		for (const gun of ORION_ARMS_WALL) expect(weaponById(gun.weapon).model, gun.weapon).not.toBeNull();
	});

	it("keep the kiosk window out of reach of the cars on the lot, so it's the shop that's offered", () => {
		const [cx, , cz] = KASPER_LOT_PLACES.customer;
		for (const [id, bay] of Object.entries(KASPER_LOT_BAYS)) {
			// The driver's door is about a metre off the car's middle; boarding reaches 3.2 m from it.
			expect(Math.hypot(bay.x - cx, bay.z - cz), id).toBeGreaterThan(4.5);
		}
	});

	it("sell the guns the game has, each car once", () => {
		for (const sold of ORION_ARMS.items) if (sold.kind === "weapon" || sold.kind === "ammo") expect(weaponById(sold.weapon).maxAmmo).toBeGreaterThan(0);
		const cars = KASPER_SHOWROOM.items.flatMap((sold) => (sold.kind === "vehicle" ? [sold.vehicle.id] : []));
		expect(new Set(cars).size).toBe(cars.length);
	});
});

describe("weapons dropped in the street", () => {
	it("are picked up from close by, and only what's wanted", () => {
		dropWeapon("pistol", 24, 10, 0, 10);
		dropWeapon("ar", 60, 11, 0, 10);
		expect(takePickupsNear(0, 0, 2)).toEqual([]);
		const taken = takePickupsNear(10.5, 10, 1.4, (pickup) => pickup.weapon === "ar");
		expect(taken.map((pickup) => pickup.weapon)).toEqual(["ar"]);
		expect(pickups().map((pickup) => pickup.weapon)).toEqual(["pistol"]);
	});

	it("are cleared away after a while, the oldest first in a big fight", () => {
		dropWeapon("pistol", 24, 0, 0, 0);
		updatePickups(PICKUP_LIFETIME - 1);
		expect(pickups()).toHaveLength(1);
		updatePickups(1.5);
		expect(pickups()).toHaveLength(0);
		for (let index = 0; index < MAX_PICKUPS + 3; index++) dropWeapon("pistol", index, index, 0, 0);
		expect(pickups()).toHaveLength(MAX_PICKUPS);
		expect(pickups()[0].rounds).toBe(3);
	});

	it("fill a weapon's spares no further than it can carry", () => {
		const inventory = new WeaponInventory(WEAPONS, "fists");
		const max = weaponById("shotgun").maxAmmo;
		const room = max - inventory.spareFor("shotgun");
		expect(inventory.addAmmo("shotgun", room + 50)).toBe(room);
		expect(inventory.addAmmo("shotgun", 10)).toBe(0);
	});
});
