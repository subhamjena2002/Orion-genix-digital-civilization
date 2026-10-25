import type { WeaponId } from "../combat/WeaponData";
import type { PersonLook, RewardVehicle } from "../missions/MissionDirector";
import { KASPER_LOT_PLACES, KASPER_LOT_SITE, ORION_ARMS_ROOM, ORION_ARMS_SITE, toWorld, yawToWorld, type ShopSite } from "./ShopLayouts";

/**
 * Where the player spends what the missions pay: Orion Arms for guns, rounds and body armour,
 * and Kasper Motors' showroom for cars, delivered to the safehouse garage. Data only, like the mission
 * catalog; buying is in Shops, the buildings in components/world/ShopBuildings and the counters
 * in components/world/Shops, laid out in ShopLayouts.
 *
 * Prices are set against what the missions pay: a street job (about $350) buys a box of rounds,
 * a story mission (a few thousand) a new gun, and the showroom's cars are something to save for.
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

/**
 * Kasper Motors' Prestige showroom: the five premium cars, each only ever had by buying it here (see
 * PREMIUM_STYLES), delivered to the garage. Each wears its own paint (keepPaint); `colour` is what
 * stands in while the model loads.
 */
export const KASPER_SHOWROOM: Shop = {
	id: "kasper-showroom",
	name: "Kasper Motors",
	kind: "cars",
	tagline: "The Prestige Collection. Delivered to your garage in Hillcrest.",
	...at(KASPER_LOT_SITE, KASPER_LOT_PLACES.customer),
	site: KASPER_LOT_SITE,
	keeper: {
		id: "keeper-kasper-lot",
		look: { model: "womanSuit", palette: { skin: "#c48a62", shirt: "#1b1b1f", pants: "#141418", hair: "#3a2416" } },
		...at(KASPER_LOT_SITE, KASPER_LOT_PLACES.keeper),
		// Behind the desk, facing the door and the customer.
		yaw: yawToWorld(KASPER_LOT_SITE, 0),
	},
	items: [
		{ kind: "vehicle", id: "ascendant", vehicle: { id: "bought-ascendant", style: "grandSuv", colour: "#7a6040", name: "Orion Ascendant" }, price: 75000, detail: "Grand SUV. V8, a floating roof, room for five" },
		{ kind: "vehicle", id: "solenne-gt", vehicle: { id: "bought-solenne-gt", style: "grandTourer", colour: "#6b0a12", name: "Orion Solenne GT" }, price: 90000, detail: "V8 grand tourer. Two doors, tan leather, long legs" },
		{ kind: "vehicle", id: "regalia", vehicle: { id: "bought-regalia", style: "flagship", colour: "#0d1a3a", name: "Orion Regalia" }, price: 110000, detail: "V12 flagship. Two-tone, cream leather in the back" },
		{ kind: "vehicle", id: "calliope", vehicle: { id: "bought-calliope", style: "roadster", colour: "#0b3a22", name: "Orion Calliope Spider" }, price: 125000, detail: "Straight-six roadster. Roof up or down with O" },
		{ kind: "vehicle", id: "halcyon", vehicle: { id: "bought-halcyon", style: "hypercar", colour: "#e8e9ea", name: "Orion Halcyon EV" }, price: 180000, detail: "Electric hypercar. Nothing in the city keeps up" },
	],
};

export const SHOPS: readonly Shop[] = [ORION_ARMS, KASPER_SHOWROOM];
