import type { WeaponId } from "../combat/WeaponData";
import type { PersonLook, RewardVehicle } from "../missions/MissionDirector";
import { KASPER_LOT_PLACES, KASPER_LOT_SITE, ORION_ARMS_ROOM, ORION_ARMS_SITE, toWorld, yawToWorld, type ShopSite } from "./ShopLayouts";

/**
 * Where the player spends what the missions pay: Orion Arms for guns, rounds and body armour,
 * and Kasper Motors' lot for cars, delivered to the safehouse garage. Data only, like the mission
 * catalog; buying is in Shops, the buildings in components/world/ShopBuildings and the counters
 * in components/world/Shops, laid out in ShopLayouts.
 *
 * Prices are set against what the missions pay: a street job (about $350) buys a box of rounds,
 * a story mission (a few thousand) a new gun, and the Vesper is something to save for.
 */

export type ShopItem =
	/** A weapon to own for good (as a mission reward would give it). */
	| { kind: "weapon"; id: string; weapon: WeaponId; price: number; detail: string }
	/** A box of rounds for a weapon the player has. */
	| { kind: "ammo"; id: string; weapon: WeaponId; rounds: number; price: number }
	/** A vest: armour topped up to full. */
	| { kind: "armour"; id: string; price: number; detail: string }
	/** A car, delivered to the next free bay of the safehouse garage. */
	| { kind: "vehicle"; id: string; vehicle: RewardVehicle; price: number; detail: string };

/** Who serves at the counter: someone in the people pool, stood there while the player's about. */
export interface ShopKeeper {
	id: string;
	look: PersonLook;
	x: number;
	z: number;
	/** Facing, degrees about Y. */
	yaw: number;
}

export interface Shop {
	id: string;
	name: string;
	kind: "guns" | "cars";
	/** A line under the name. */
	tagline: string;
	/** The counter: where the player stands to be served (and where the shop is on the map). */
	x: number;
	z: number;
	site: ShopSite;
	keeper: ShopKeeper;
	items: readonly ShopItem[];
}

function at(site: ShopSite, local: readonly [number, number, number]): { x: number; z: number } {
	const [x, , z] = toWorld(site, local);
	return { x, z };
}

/** The store across the arterial from Kasper Motors: in at the door, served over the counter. */
export const ORION_ARMS: Shop = {
	id: "orion-arms",
	name: "Orion Arms",
	kind: "guns",
	tagline: "Guns, rounds and vests. No questions.",
	...at(ORION_ARMS_SITE, ORION_ARMS_ROOM.customer),
	site: ORION_ARMS_SITE,
	keeper: {
		id: "keeper-orion-arms",
		look: { model: "man", palette: { skin: "#b07a52", shirt: "#3b402c", pants: "#1f1f22", hair: "#2a1d14" } },
		...at(ORION_ARMS_SITE, ORION_ARMS_ROOM.keeper),
		yaw: yawToWorld(ORION_ARMS_SITE, 0),
	},
	items: [
		{ kind: "weapon", id: "shotgun", weapon: "shotgun", price: 1800, detail: "Pump action. Brutal up close" },
		{ kind: "weapon", id: "ar", weapon: "ar", price: 4500, detail: "Automatic, steady at range" },
		{ kind: "weapon", id: "rocket-launcher", weapon: "rocketLauncher", price: 15000, detail: "For the car that won't stop" },
		{ kind: "ammo", id: "ammo-pistol", weapon: "pistol", rounds: 36, price: 150 },
		{ kind: "ammo", id: "ammo-shotgun", weapon: "shotgun", rounds: 12, price: 240 },
		{ kind: "ammo", id: "ammo-ar", weapon: "ar", rounds: 90, price: 450 },
		{ kind: "ammo", id: "ammo-rockets", weapon: "rocketLauncher", rounds: 2, price: 1200 },
		{ kind: "armour", id: "vest", price: 500, detail: "Takes the hits before you do" },
	],
};

/** Benny's lot beside Kasper Motors: the cars on it to keep, delivered to the garage. */
export const KASPER_SHOWROOM: Shop = {
	id: "kasper-showroom",
	name: "Kasper Motors",
	kind: "cars",
	tagline: "Delivered to your garage in Hillcrest.",
	...at(KASPER_LOT_SITE, KASPER_LOT_PLACES.customer),
	site: KASPER_LOT_SITE,
	keeper: {
		id: "keeper-kasper-lot",
		look: { model: "womanSuit", palette: { skin: "#c48a62", shirt: "#1f3a6b", pants: "#1b1f27", hair: "#3a2416" } },
		...at(KASPER_LOT_SITE, KASPER_LOT_PLACES.keeper),
		// Out of the kiosk's window at the customer.
		yaw: yawToWorld(KASPER_LOT_SITE, -90),
	},
	items: [
		{ kind: "vehicle", id: "hatch-red", vehicle: { id: "bought-hatch-red", style: "hatchback", colour: "#b3121b", name: "Red Orion Hatch" }, price: 8500, detail: "Compact crossover, quick through traffic" },
		{ kind: "vehicle", id: "saloon-blue", vehicle: { id: "bought-saloon-blue", style: "sedan", colour: "#1f3a6b", name: "Midnight Orion Saloon" }, price: 12000, detail: "Four doors, smooth and quiet" },
		{ kind: "vehicle", id: "suv-white", vehicle: { id: "bought-suv-white", style: "suv", colour: "#e8e8e6", name: "White Orion SUV" }, price: 18000, detail: "High, heavy, hard to push off the road" },
		{ kind: "vehicle", id: "vesper-silver", vehicle: { id: "bought-vesper-silver", style: "luxury", colour: "#b8bcc2", name: "Silver Vesper GT" }, price: 45000, detail: "Mid-engined. The fastest thing in the city" },
		{ kind: "vehicle", id: "vesper-black", vehicle: { id: "bought-vesper-black", style: "luxury", colour: "#151517", name: "Black Vesper GT" }, price: 60000, detail: "The same, in black. Nobody sees you coming" },
	],
};

export const SHOPS: readonly Shop[] = [ORION_ARMS, KASPER_SHOWROOM];
