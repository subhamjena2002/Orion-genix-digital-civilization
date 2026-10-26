"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import {
	ADDRESS_CLAMP_TO_EDGE,
	ADDRESS_REPEAT,
	BLEND_NORMAL,
	Color,
	Entity as PlayCanvasEntity,
	StandardMaterial,
	Texture,
	Vec2,
	Vec3,
	type AppBase,
	type RenderComponent,
} from "playcanvas";
import { memo, useEffect, useState } from "react";

import { weaponById, type WeaponId } from "@/engine/orion/combat/WeaponData";
import { loadContainer, WeaponModels } from "@/engine/orion/combat/WeaponModels";
import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { KASPER_SHOWROOM } from "@/engine/orion/shops/ShopCatalog";
import {
	KASPER_HALL,
	KASPER_LOT_BAYS,
	KASPER_LOT_SITE,
	ORION_ARMS_CASE,
	ORION_ARMS_GRENADES,
	ORION_ARMS_ROOM,
	ORION_ARMS_SITE,
	ORION_ARMS_WALL,
	toWorld,
	yawToWorld,
	type Point3,
	type ShopSite,
} from "@/engine/orion/shops/ShopLayouts";
import { LAND_Y } from "@/engine/orion/world/Mountains";

import { cullBatchGroup } from "./useDistanceCull";
import { ParkedVehicle } from "./Vehicles";

/** The showroom plot's paving (its top is the site's ground): solid, so the player walks on it. */
const LOT_THICKNESS = KASPER_LOT_SITE.ground - LAND_Y;
/** How much light a room's surfaces give off of their own: under a roof, with no lamp, they'd read black. */
const ROOM_FILL = 0.32;
/** Gun models load after the store does; their shadows are switched off as they arrive, checked this often while near. */
const DISPLAY_CHECK_SECONDS = 2;
const DISPLAY_CHECK_RANGE = 90;
/** The shops' static batch is cut into cells this size (m), so each culls on its own. */
const SHOP_BATCH_CELL = 20;
/** Both places, as one area for distance culling; not drawn from further than this. */
const SHOPS_AREA = {
	x: (ORION_ARMS_SITE.x + KASPER_LOT_SITE.x) / 2,
	z: (ORION_ARMS_SITE.z + KASPER_LOT_SITE.z) / 2,
	halfX: Math.abs(ORION_ARMS_SITE.x - KASPER_LOT_SITE.x) / 2 + 10,
	halfZ: Math.abs(ORION_ARMS_SITE.z - KASPER_LOT_SITE.z) / 2 + 10,
};
const SHOP_DRAW_DISTANCE = 300;

interface Finish {
	gloss?: number;
	/** Glows this much of its own colour: a lit room's walls, a sign. */
	fill?: number;
	map?: Texture | null;
	/** Repeats of `map` across the surface. */
	tiling?: [number, number];
	/** See-through, 0..1. */
	opacity?: number;
	metalness?: number;
	/** Lit by `map` as a sign is. */
	sign?: number;
}

interface Part {
	/** Walked into, not through. */
	solid?: boolean;
	/** The building's shell, out in the sun: casts and takes shadows. Inside, neither. */
	outside?: boolean;
}

type Size = readonly [number, number, number];

/**
 * The shops' places (see engine/shops/ShopLayouts):
 *
 * - **Orion Arms**, a one-storey gun store across the arterial from Kasper Motors. A glass front
 *   with the name lit over it; through the open door, a tiled room with a counter across it and a
 *   glass case of pistols, a pegboard wall of rifles, shotguns and a launcher behind, ammunition
 *   on the shelves and a vest on its stand. The clerk stands behind the counter (components/world/
 *   Shops puts him there).
 * - **Kasper Motors' showroom**, beside Benny's: a glass pavilion with the premium cars on lit
 *   plinths inside, the reception desk facing the door (see buildKasperLot).
 *
 * The rooms' surfaces neither cast nor take shadows and glow a little of their own colour, so the
 * store reads lit inside rather than black under its roof.
 */
export const ShopBuildings = memo(function ShopBuildings() {
	return (
		<>
			<ShopPlaces />
			<ShowroomCars />
		</>
	);
});

/**
 * The cars for sale, on their plinths, locked (`forSale`): they're bought, not taken. Apart from
 * the places' entities, so nothing those do re-renders them: a re-render puts a car's entity back
 * to how it was first given, turning a parked car away from its bay.
 */
const ShowroomCars = memo(function ShowroomCars() {
	return (
		<>
			{KASPER_SHOWROOM.items.map((item, index) => {
				const bay = KASPER_LOT_BAYS[item.id];
				if (item.kind !== "vehicle" || !bay) return null;
				const [x, , z] = toWorld(KASPER_LOT_SITE, [bay.x, 0, bay.z]);
				return (
					<ParkedVehicle
						key={item.id}
						vehicle={{ id: `showroom-${item.id}`, style: item.vehicle.style, colour: item.vehicle.colour, seed: 5303 + index * 31, speedFactor: 1 }}
						home={{ x, z, yaw: yawToWorld(KASPER_LOT_SITE, bay.yaw), ground: KASPER_LOT_SITE.ground + bay.plinth }}
						forSale
					/>
				);
			})}
		</>
	);
});

/** The store and the lot themselves, built once. */
const ShopPlaces = memo(function ShopPlaces() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		if (!app || !root) return;
		const made = { materials: [] as StandardMaterial[], textures: [] as Texture[] };
		const finish = (name: string, colour: string, options: Finish = {}) => {
			const material = new StandardMaterial();
			material.name = name;
			const diffuse = new Color().fromString(colour);
			material.diffuse = diffuse;
			material.gloss = options.gloss ?? 0.25;
			if (options.metalness !== undefined) {
				material.useMetalness = true;
				material.metalness = options.metalness;
			}
			if (options.map) {
				material.diffuseMap = options.map;
				if (options.tiling) material.diffuseMapTiling = new Vec2(options.tiling[0], options.tiling[1]);
			}
			if (options.sign && options.map) {
				material.emissive = new Color(1, 1, 1);
				material.emissiveMap = options.map;
				material.emissiveIntensity = options.sign;
			} else if (options.fill) {
				material.emissive = new Color(diffuse.r * options.fill, diffuse.g * options.fill, diffuse.b * options.fill);
				if (options.map) {
					material.emissiveMap = options.map;
					if (options.tiling) material.emissiveMapTiling = new Vec2(options.tiling[0], options.tiling[1]);
				}
			}
			if (options.opacity !== undefined) {
				material.opacity = options.opacity;
				material.blendType = BLEND_NORMAL;
				material.depthWrite = false;
			}
			material.update();
			made.materials.push(material);
			return material;
		};
		const texture = (width: number, height: number, draw: (context: CanvasRenderingContext2D) => void, repeat = false) => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext("2d");
			if (!context) return null;
			draw(context);
			const made2 = new Texture(app.graphicsDevice, {
				width,
				height,
				addressU: repeat ? ADDRESS_REPEAT : ADDRESS_CLAMP_TO_EDGE,
				addressV: repeat ? ADDRESS_REPEAT : ADDRESS_CLAMP_TO_EDGE,
				mipmaps: true,
			});
			made2.setSource(canvas);
			made.textures.push(made2);
			return made2;
		};

		const store = buildOrionArms(app, root, finish, texture);
		const lot = buildKasperLot(root, finish, texture);

		// Every box and cylinder of both places, one static batch: built part by part they were ~220
		// draws (shadows included) whenever the spawn street was in view. The gun models stay out:
		// they arrive later and have their shadows switched off below.
		const batcher = app.batcher;
		const group = batcher?.addGroup("shop-buildings", false, SHOP_BATCH_CELL) ?? null;
		if (group) {
			for (const place of [store.entity, lot]) {
				for (const render of place.findComponents("render") as RenderComponent[]) {
					if (!render.entity.isDescendantOf(store.displays)) render.batchGroupId = group.id;
				}
			}
		}
		const stopCulling = group ? cullBatchGroup(app, group.id, SHOPS_AREA, SHOP_DRAW_DISTANCE) : null;

		// The gun models arrive after the store: as they do, they stop taking the roof's shadow.
		let sinceCheck = DISPLAY_CHECK_SECONDS;
		const update = (dt: number) => {
			sinceCheck += dt;
			if (sinceCheck < DISPLAY_CHECK_SECONDS) return;
			sinceCheck = 0;
			const pose = readPlayerPose();
			if (Math.hypot(pose.x - ORION_ARMS_SITE.x, pose.z - ORION_ARMS_SITE.z) > DISPLAY_CHECK_RANGE) return;
			for (const render of store.displays.findComponents("render") as RenderComponent[]) {
				if (render.receiveShadows) render.receiveShadows = false;
				if (render.castShadows) render.castShadows = false;
			}
		};
		app.on("update", update);
		return () => {
			app.off("update", update);
			stopCulling?.();
			if (group && batcher) batcher.removeGroup(group.id);
			for (const models of store.models) models.destroy();
			store.entity.destroy();
			lot.destroy();
			for (const material of made.materials) material.destroy();
			for (const made2 of made.textures) made2.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="shop-buildings" />;
});

type MakeFinish = (name: string, colour: string, options?: Finish) => StandardMaterial;
type MakeTexture = (width: number, height: number, draw: (context: CanvasRenderingContext2D) => void, repeat?: boolean) => Texture | null;

/** An entity in place within a site, turned to face its street. */
function siteRoot(parent: PlayCanvasEntity, name: string, site: ShopSite, y: number): PlayCanvasEntity {
	const entity = new PlayCanvasEntity(name);
	parent.addChild(entity);
	entity.setPosition(site.x, y, site.z);
	entity.setEulerAngles(0, site.yaw, 0);
	return entity;
}

/** A box: `centre` and `size` in the parent's frame; solid ones get a static collider of that size. */
function box(parent: PlayCanvasEntity, name: string, centre: Point3, size: Size, material: StandardMaterial, part: Part = {}): PlayCanvasEntity {
	const entity = new PlayCanvasEntity(name);
	parent.addChild(entity);
	entity.setLocalPosition(centre[0], centre[1], centre[2]);
	entity.setLocalScale(size[0], size[1], size[2]);
	const outside = part.outside ?? false;
	entity.addComponent("render", { type: "box", material, castShadows: outside && material.opacity >= 1, receiveShadows: outside });
	if (part.solid) {
		// A primitive collider ignores the entity's scale: its size is given outright.
		entity.addComponent("collision", { type: "box", halfExtents: new Vec3(size[0] / 2, size[1] / 2, size[2] / 2) });
		entity.addComponent("rigidbody", { type: "static" });
	}
	return entity;
}

function cylinder(parent: PlayCanvasEntity, name: string, centre: Point3, size: Size, material: StandardMaterial, outside = false): PlayCanvasEntity {
	const entity = new PlayCanvasEntity(name);
	parent.addChild(entity);
	entity.setLocalPosition(centre[0], centre[1], centre[2]);
	entity.setLocalScale(size[0], size[1], size[2]);
	entity.addComponent("render", { type: "cylinder", material, castShadows: outside, receiveShadows: outside });
	return entity;
}

function sphere(parent: PlayCanvasEntity, name: string, centre: Point3, diameter: number, material: StandardMaterial, outside = false): PlayCanvasEntity {
	const entity = new PlayCanvasEntity(name);
	parent.addChild(entity);
	entity.setLocalPosition(centre[0], centre[1], centre[2]);
	entity.setLocalScale(diameter, diameter, diameter);
	entity.addComponent("render", { type: "sphere", material, castShadows: outside, receiveShadows: outside });
	return entity;
}

/** A pistol's barely a hand long: shown this much larger, as a display does, or it's lost on the wall. */
const PISTOL_SHOWN = 1.8;

/** Hangs a weapon's model at `at` (its middle there), lengthways across the room; `flat` lays it on its side. */
function hangWeapon(app: AppBase, parent: PlayCanvasEntity, weapon: WeaponId, at: Point3, flat = false): WeaponModels {
	const mount = new PlayCanvasEntity(`display-${weapon}`);
	parent.addChild(mount);
	mount.setLocalPosition(at[0], at[1], at[2]);
	const shown = weapon === "pistol" ? PISTOL_SHOWN : 1;
	mount.setLocalScale(shown, shown, shown);
	// The model's muzzle is along its -Z: turned a quarter, it points along the wall.
	mount.setLocalEulerAngles(0, 90, 0);
	const holder = new PlayCanvasEntity("holder");
	mount.addChild(holder);
	if (flat) holder.setLocalEulerAngles(0, 0, 90);
	const models = new WeaponModels(app, holder);
	const definition = weaponById(weapon);
	const visual = models.visualFor(definition);
	const spec = definition.model;
	if (visual && spec) {
		visual.root.enabled = true;
		// The grip's at the model's origin, `along` of the way from the stock: centred on the mount.
		visual.root.setLocalPosition(0, 0, (spec.length * (1 - 2 * spec.grip.along)) / 2);
	}
	return models;
}

/** Stands a grenade on its base at `at`, fuze up, turned `yaw` degrees. */
function standGrenade(app: AppBase, parent: PlayCanvasEntity, at: Point3, yaw: number): WeaponModels {
	const mount = new PlayCanvasEntity("display-grenade");
	parent.addChild(mount);
	mount.setLocalPosition(at[0], at[1], at[2]);
	// The model's fuze is along its -Z: tipped back a quarter, it points up.
	mount.setLocalEulerAngles(90, 0, 0);
	const holder = new PlayCanvasEntity("holder");
	mount.addChild(holder);
	holder.setLocalEulerAngles(0, 0, yaw);
	const models = new WeaponModels(app, holder);
	const visual = models.visualFor(weaponById("grenade"));
	if (visual) visual.root.enabled = true;
	return models;
}

/** The plate carrier players wear (see player/WornVest), as modelled on a body standing at the origin. */
const VEST_MODEL = "/models/props/armour-vest.glb";

// ---- Orion Arms ------------------------------------------------------------------------------

function buildOrionArms(app: AppBase, root: PlayCanvasEntity, finish: MakeFinish, texture: MakeTexture) {
	const site = ORION_ARMS_SITE;
	const room = ORION_ARMS_ROOM;
	const entity = siteRoot(root, "orion-arms", site, site.ground);
	const half = site.width / 2;
	const deep = site.depth / 2;
	const { height, wall } = room;
	const door = room.door;

	// The outside: cream render, charcoal trim, a red band; the glass front.
	const render = finish("arms-render", "#d6cfc0", { gloss: 0.18 });
	const trim = finish("arms-trim", "#24272b", { gloss: 0.35 });
	const red = finish("arms-red", "#b3221a", { gloss: 0.4 });
	const glass = finish("arms-glass", "#8fa6b2", { gloss: 0.92, opacity: 0.2 });
	const paving = finish("arms-paving", "#bdb7ab", { gloss: 0.12 });

	// The room: pale walls, a dark gun wall, a tiled floor, wood and steel.
	const tiles = texture(256, 256, (context) => {
		context.fillStyle = "#a8a397";
		context.fillRect(0, 0, 256, 256);
		for (const [x, y, colour] of [[0, 0, "#dad6cc"], [128, 0, "#c3beb2"], [0, 128, "#c3beb2"], [128, 128, "#dad6cc"]] as const) {
			context.fillStyle = colour;
			context.fillRect(x + 2, y + 2, 124, 124);
		}
	}, true);
	// Tan pegboard, as gun shops have: the dark guns stand out against it.
	const pegboardMap = texture(256, 256, (context) => {
		context.fillStyle = "#b3a68f";
		context.fillRect(0, 0, 256, 256);
		context.fillStyle = "#5e5244";
		for (let x = 8; x < 256; x += 16) for (let y = 8; y < 256; y += 16) context.fillRect(x - 2, y - 2, 4, 4);
	}, true);
	const ammoMap = texture(512, 128, (context) => {
		const boxes = [["#3d5a2e", "9MM"], ["#7a1f1a", "12 GA"], ["#2b4a6b", "5.56"], ["#8a6a1e", "9MM"], ["#3d5a2e", "12 GA"], ["#5a2a4a", "RKT"], ["#7a1f1a", "5.56"], ["#2b4a6b", "9MM"]] as const;
		context.fillStyle = "#2a2b2e";
		context.fillRect(0, 0, 512, 128);
		boxes.forEach(([colour, label], index) => {
			const x = index * 64;
			context.fillStyle = colour;
			context.fillRect(x + 3, 14, 58, 110);
			context.fillStyle = "rgba(255,255,255,0.85)";
			context.font = "bold 15px Arial, sans-serif";
			context.textAlign = "center";
			context.fillText(label, x + 32, 72);
			context.fillRect(x + 12, 84, 40, 3);
		});
	}, true);
	const sign = texture(1024, 160, (context) => {
		context.fillStyle = "#111214";
		context.fillRect(0, 0, 1024, 160);
		context.fillStyle = "#c4261c";
		context.fillRect(0, 0, 26, 160);
		context.fillRect(0, 148, 1024, 12);
		// A crosshair, then the name.
		context.strokeStyle = "#e8e2d4";
		context.lineWidth = 7;
		context.beginPath();
		context.arc(118, 76, 44, 0, Math.PI * 2);
		context.stroke();
		context.fillStyle = "#e8e2d4";
		context.fillRect(114, 18, 8, 116);
		context.fillRect(60, 72, 116, 8);
		context.fillStyle = "#c4261c";
		context.beginPath();
		context.arc(118, 76, 9, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = "#f4efe4";
		context.textAlign = "left";
		context.textBaseline = "middle";
		context.font = "900 92px Arial, sans-serif";
		context.fillText("ORION ARMS", 196, 70);
		context.font = "bold 26px Arial, sans-serif";
		context.fillStyle = "#e0463a";
		context.fillText("GUNS  ·  AMMUNITION  ·  BODY ARMOUR", 200, 128);
	});
	const lining = finish("arms-lining", "#e6e1d6", { gloss: 0.2, fill: ROOM_FILL });
	const darkWall = finish("arms-dark-wall", "#5b4433", { gloss: 0.3, fill: ROOM_FILL });
	const floor = finish("arms-floor", "#ffffff", { gloss: 0.45, map: tiles, tiling: [site.width - 0.6, site.depth - 0.6], fill: ROOM_FILL * 0.8 });
	const ceiling = finish("arms-ceiling", "#f1efe9", { gloss: 0.1, fill: ROOM_FILL });
	const pegboard = finish("arms-pegboard", "#ffffff", { gloss: 0.15, map: pegboardMap, tiling: [10, 3], fill: ROOM_FILL * 0.55 });
	const wood = finish("arms-wood", "#4b3425", { gloss: 0.4, fill: ROOM_FILL * 0.6 });
	const velvet = finish("arms-velvet", "#5c1616", { gloss: 0.1, fill: ROOM_FILL });
	const caseGlass = finish("arms-case-glass", "#cfe3ea", { gloss: 0.95, opacity: 0.18 });
	const steel = finish("arms-steel", "#6a6f77", { gloss: 0.55, metalness: 0.6, fill: ROOM_FILL * 0.5 });
	const ammo = finish("arms-ammo", "#ffffff", { gloss: 0.2, map: ammoMap, tiling: [3, 1], fill: ROOM_FILL });
	const lamp = finish("arms-lamp", "#fff8ea", { gloss: 0.3, fill: 1.4 });
	const signFace = finish("arms-sign", "#ffffff", { gloss: 0.3, map: sign, sign: 0.9 });

	const outside: Part = { outside: true };
	const solidOutside: Part = { outside: true, solid: true };
	const frontZ = deep - wall / 2;
	const doorHalf = door.width / 2;
	const paneWidth = half - doorHalf - 0.9;

	// The shell: side and back walls, the roof and its parapet.
	box(entity, "wall-left", [-half + wall / 2, height / 2, 0], [wall, height, site.depth], render, solidOutside);
	box(entity, "wall-right", [half - wall / 2, height / 2, 0], [wall, height, site.depth], render, solidOutside);
	box(entity, "wall-back", [0, height / 2, -deep + wall / 2], [site.width, height, wall], render, solidOutside);
	box(entity, "roof", [0, height + 0.15, 0], [site.width + 0.2, 0.3, site.depth + 0.2], trim, solidOutside);
	box(entity, "parapet", [0, height + 0.55, deep - 0.05], [site.width + 0.2, 0.5, 0.3], trim, outside);
	box(entity, "parapet-band", [0, height + 0.32, deep + 0.11], [site.width + 0.2, 0.12, 0.04], red, outside);

	// The front: a pier each end and either side of the door, glass between, a header over all.
	const windowTop = 3.05;
	for (const side of [-1, 1]) {
		box(entity, `pier-end-${side}`, [side * (half - 0.25), windowTop / 2, frontZ], [0.5, windowTop, wall], render, outside);
		box(entity, `pier-door-${side}`, [side * (doorHalf + 0.2), windowTop / 2, frontZ], [0.4, windowTop, wall], render, outside);
		box(entity, `kick-${side}`, [side * (doorHalf + 0.4 + paneWidth / 2), 0.25, frontZ], [paneWidth, 0.5, wall], trim, outside);
		box(entity, `glass-${side}`, [side * (doorHalf + 0.4 + paneWidth / 2), 0.5 + (windowTop - 0.5) / 2, frontZ], [paneWidth, windowTop - 0.5, 0.06], glass, outside);
		// The wall either side of the door, solid where the glass is: one collider each side.
		const span = half - doorHalf;
		const collider = new PlayCanvasEntity(`front-collider-${side}`);
		entity.addChild(collider);
		collider.setLocalPosition(side * (doorHalf + span / 2), height / 2, frontZ);
		collider.addComponent("collision", { type: "box", halfExtents: new Vec3(span / 2, height / 2, wall / 2) });
		collider.addComponent("rigidbody", { type: "static" });
	}
	box(entity, "header", [0, windowTop + (height - windowTop) / 2, frontZ], [site.width, height - windowTop, wall], render, outside);
	box(entity, "door-head", [0, door.height + (windowTop - door.height) / 2, frontZ], [door.width, windowTop - door.height, wall], render, outside);
	box(entity, "door-frame", [0, door.height + 0.03, deep + 0.01], [door.width + 0.16, 0.08, 0.06], trim, outside);
	box(entity, "awning", [0, windowTop + 0.05, deep + 0.35], [site.width - 0.6, 0.12, 0.7], red, outside);
	box(entity, "sign", [0, windowTop + 0.72, deep + 0.03], [8.2, 1.28, 0.06], signFace, outside);
	// The paved step out to the pavement.
	box(entity, "forecourt", [0, -0.012, deep + 1], [site.width, 0.02, 2], paving, outside);

	// The room's own surfaces, just inside the shell: lit as a room is, not shadowed by its roof.
	const inside = deep - wall;
	const across = half - wall;
	box(entity, "floor", [0, 0.002, 0], [across * 2, 0.02, inside * 2], floor);
	box(entity, "ceiling", [0, height - 0.03, 0], [across * 2, 0.04, inside * 2], ceiling);
	box(entity, "lining-left", [-across + 0.01, height / 2, 0], [0.02, height, inside * 2], lining);
	box(entity, "lining-right", [across - 0.01, height / 2, 0], [0.02, height, inside * 2], lining);
	box(entity, "lining-back", [0, height / 2, -inside + 0.01], [across * 2, height, 0.02], darkWall);
	box(entity, "lining-header", [0, windowTop + (height - windowTop) / 2, inside - 0.01], [across * 2, height - windowTop, 0.02], lining);
	for (const [index, z] of [-3.6, 0, 3.4].entries()) box(entity, `lamp-${index}`, [0, height - 0.07, z], [3.2, 0.04, 0.5], lamp);

	// The gun wall: a pegboard, a lamp strip over it, the guns hung on it.
	const board = room.pegboardZ;
	box(entity, "pegboard", [0, 2.45, board - 0.02], [10.6, 3.1, 0.04], pegboard);
	box(entity, "pegboard-frame", [0, 4.05, board], [10.8, 0.1, 0.08], wood);
	box(entity, "gun-lamp", [0, 4.0, board + 0.12], [10.2, 0.05, 0.1], lamp);
	box(entity, "back-door", [4.6, 1.1, board - 0.01], [1.0, 2.2, 0.04], wood);
	const displays = new PlayCanvasEntity("displays");
	entity.addChild(displays);
	const models: WeaponModels[] = [];
	for (const gun of ORION_ARMS_WALL) models.push(hangWeapon(app, displays, gun.weapon, [gun.x, gun.y, board + 0.08]));

	// The counter, a glass case of pistols along its top.
	const counter = room.counter;
	const counterZ = counter.z - counter.depth / 2;
	box(entity, "counter", [0, counter.height / 2, counterZ], [counter.halfWidth * 2, counter.height, counter.depth], wood, { solid: true });
	box(entity, "counter-kick", [0, 0.08, counter.z + 0.01], [counter.halfWidth * 2, 0.16, 0.02], steel);
	box(entity, "case-bed", [0, counter.height + 0.01, counterZ], [counter.halfWidth * 2 - 0.2, 0.02, counter.depth - 0.16], velvet);
	box(entity, "case-glass", [0, counter.height + 0.17, counterZ], [counter.halfWidth * 2 - 0.1, 0.32, counter.depth - 0.08], caseGlass);
	box(entity, "case-rail", [0, counter.height + 0.34, counterZ], [counter.halfWidth * 2, 0.03, counter.depth], steel);
	for (const x of ORION_ARMS_CASE) models.push(hangWeapon(app, displays, "pistol", [x, counter.height + 0.06, counterZ], true));
	// Six grenades in two rows on the velvet at the left end, each turned its own way.
	for (let i = 0; i < 6; i++) {
		const x = ORION_ARMS_GRENADES + ((i % 3) - 1) * 0.12;
		const z = counterZ + (i < 3 ? -0.09 : 0.09);
		models.push(standGrenade(app, displays, [x, counter.height + 0.05, z], i * 67));
	}

	// Ammunition on steel shelving down the left wall.
	const shelves = room.shelves;
	const shelfLength = shelves.toZ - shelves.fromZ;
	const shelfZ = (shelves.fromZ + shelves.toZ) / 2;
	box(entity, "shelf-back", [shelves.x - shelves.depth / 2 + 0.02, shelves.height / 2, shelfZ], [0.03, shelves.height, shelfLength], steel);
	for (const z of [shelves.fromZ, shelves.toZ]) box(entity, `shelf-end-${z}`, [shelves.x, shelves.height / 2, z], [shelves.depth, shelves.height, 0.04], steel);
	for (const [index, y] of [0.3, 0.8, 1.3, 1.8].entries()) {
		box(entity, `shelf-${index}`, [shelves.x, y, shelfZ], [shelves.depth, 0.03, shelfLength], steel);
		box(entity, `ammo-${index}`, [shelves.x + 0.02, y + 0.17, shelfZ], [shelves.depth - 0.1, 0.3, shelfLength - 0.12], ammo);
	}
	const shelfCollider = new PlayCanvasEntity("shelf-collider");
	entity.addChild(shelfCollider);
	shelfCollider.setLocalPosition(shelves.x, shelves.height / 2, shelfZ);
	shelfCollider.addComponent("collision", { type: "box", halfExtents: new Vec3(shelves.depth / 2, shelves.height / 2, shelfLength / 2) });
	shelfCollider.addComponent("rigidbody", { type: "static" });

	// A vest on a torso stand by the right-hand window, facing into the room: a dummy's grey torso
	// on a pole, wearing the same plate carrier the player does.
	const [vx, , vz] = room.vest;
	const vest = new PlayCanvasEntity("vest-stand");
	entity.addChild(vest);
	vest.setLocalPosition(vx, 0, vz);
	vest.setLocalEulerAngles(0, -90, 0);
	const dummy = finish("arms-dummy", "#8d9096", { gloss: 0.35, fill: ROOM_FILL * 0.6 });
	cylinder(vest, "vest-base", [0, 0.03, 0], [0.55, 0.06, 0.55], steel);
	cylinder(vest, "vest-pole", [0, 0.5, 0], [0.06, 0.95, 0.06], steel);
	// Sized to sit inside the vest, which was fitted to the player's chest.
	box(vest, "dummy-chest", [0, 1.22, 0], [0.22, 0.42, 0.15], dummy);
	cylinder(vest, "dummy-neck", [0, 1.5, 0], [0.1, 0.16, 0.1], dummy);
	const worn = new PlayCanvasEntity("vest-worn");
	displays.addChild(worn);
	worn.setLocalPosition(vx, 0, vz);
	worn.setLocalEulerAngles(0, -90, 0);
	loadContainer(app, VEST_MODEL).then((asset) => {
		if (!asset || !worn.parent) return;
		worn.addChild((asset.resource as { instantiateRenderEntity: () => PlayCanvasEntity }).instantiateRenderEntity());
	}).catch(() => {
		// The dummy stands bare.
	});

	return { entity, displays, models };
}

// ---- Kasper Motors' showroom -------------------------------------------------------------------

/** Gold lettering on black: the showroom's signs. */
function drawSign(context: CanvasRenderingContext2D, width: number, height: number, vertical: boolean) {
	context.fillStyle = "#0c0c0e";
	context.fillRect(0, 0, width, height);
	const gold = context.createLinearGradient(0, 0, 0, height);
	gold.addColorStop(0, "#f3dc9a");
	gold.addColorStop(0.5, "#c9a24f");
	gold.addColorStop(1, "#f0d590");
	context.fillStyle = gold;
	context.textAlign = "center";
	context.textBaseline = "middle";
	if (vertical) {
		context.font = "600 132px Georgia, 'Times New Roman', serif";
		[..."KASPER"].forEach((letter, index) => context.fillText(letter, width / 2, 150 + index * 140));
		context.fillRect(width * 0.2, height - 60, width * 0.6, 4);
		return;
	}
	context.font = "600 150px Georgia, 'Times New Roman', serif";
	context.fillText("K A S P E R   M O T O R S", width / 2, height * 0.42);
	context.fillRect(width * 0.18, height * 0.66, width * 0.64, 3);
	context.font = "500 54px Georgia, 'Times New Roman', serif";
	context.fillText("THE PRESTIGE COLLECTION", width / 2, height * 0.82);
}

/**
 * The Prestige showroom: a glass pavilion behind a stone forecourt under a bronze-edged canopy, its
 * name lit in gold over the door and on a totem at the corner. Inside: a polished black marble
 * floor, the five cars on white plinths with light under them, a walnut feature wall with the name
 * on it at the back, lines of light across the ceiling, and the reception desk facing the door.
 *
 * The roof casts no shadow: the hall is meant to read sunlit through its glass, not dim. Its
 * surfaces are all boxes and cylinders in the shops' one static batch.
 */
function buildKasperLot(root: PlayCanvasEntity, finish: MakeFinish, texture: MakeTexture): PlayCanvasEntity {
	const site = KASPER_LOT_SITE;
	const hall = KASPER_HALL;
	const entity = siteRoot(root, "kasper-showroom", site, LAND_Y);
	const floorY = LOT_THICKNESS;
	const top = floorY + hall.height;
	const outside: Part = { outside: true };

	const marbleMap = texture(512, 512, (context) => {
		// Two 1.2 m tiles a repeat: black marble with faint veins and fine light joints.
		context.fillStyle = "#1b1c1f";
		context.fillRect(0, 0, 512, 512);
		context.strokeStyle = "rgba(200, 200, 210, 0.10)";
		context.lineWidth = 2;
		for (let vein = 0; vein < 9; vein++) {
			context.beginPath();
			let x = (vein * 61) % 512;
			let y = 0;
			context.moveTo(x, y);
			while (y < 512) {
				x += Math.sin(y * 0.03 + vein) * 14;
				y += 24;
				context.lineTo(x, y);
			}
			context.stroke();
		}
		context.fillStyle = "rgba(210, 205, 195, 0.35)";
		context.fillRect(0, 0, 512, 2);
		context.fillRect(0, 255, 512, 2);
		context.fillRect(0, 0, 2, 512);
		context.fillRect(255, 0, 2, 512);
	}, true);
	const pavingMap = texture(256, 256, (context) => {
		context.fillStyle = "#d8d2c4";
		context.fillRect(0, 0, 256, 256);
		context.fillStyle = "#b9b2a3";
		context.fillRect(0, 0, 256, 3);
		context.fillRect(0, 0, 3, 256);
		context.fillRect(0, 127, 256, 2);
		context.fillRect(127, 0, 2, 256);
	}, true);
	const slatMap = texture(256, 64, (context) => {
		context.fillStyle = "#4a2c1a";
		context.fillRect(0, 0, 256, 64);
		context.fillStyle = "#2a170d";
		for (let x = 0; x < 256; x += 32) context.fillRect(x, 0, 4, 64);
	}, true);
	const signMap = texture(2048, 512, (context) => drawSign(context, 2048, 512, false));
	const totemMap = texture(256, 1024, (context) => drawSign(context, 256, 1024, true));

	const floor = finish("show-floor", "#ffffff", { gloss: 0.93, map: marbleMap, tiling: [(2 * hall.side) / 2.4, (hall.front - hall.back) / 2.4] });
	const paving = finish("show-paving", "#ffffff", { gloss: 0.45, map: pavingMap, tiling: [site.width / 2.4, (site.depth / 2 - hall.front) / 2.4] });
	const stone = finish("show-stone", "#e7dfd0", { gloss: 0.35 });
	const ceiling = finish("show-ceiling", "#f3f1ec", { gloss: 0.2, fill: 0.45 });
	const walnut = finish("show-walnut", "#ffffff", { gloss: 0.55, map: slatMap, tiling: [9, 1], fill: 0.35 });
	const black = finish("show-black", "#121214", { gloss: 0.8, metalness: 0.5 });
	const bronze = finish("show-bronze", "#8a6a3e", { gloss: 0.75, metalness: 0.85 });
	const glass = finish("show-glass", "#6f8792", { gloss: 0.96, opacity: 0.1 });
	const light = finish("show-light", "#fff4dc", { fill: 1.6 });
	const glow = finish("show-glow", "#d8ecff", { fill: 1.4 });
	const plinthTop = finish("show-plinth", "#f4f4f2", { gloss: 0.9, fill: 0.12 });
	const deskTop = finish("show-desk-top", "#efece6", { gloss: 0.85, fill: 0.2 });
	const leaf = finish("show-leaf", "#2f5326", { gloss: 0.25 });
	const sign = finish("show-sign", "#ffffff", { gloss: 0.4, map: signMap, sign: 0.9 });
	const totemSign = finish("show-totem", "#ffffff", { gloss: 0.4, map: totemMap, sign: 0.9 });

	const width = 2 * (hall.side + hall.wall);
	const backZ = hall.back - hall.wall / 2;
	const depth = hall.front - hall.back;
	const midZ = (hall.front + hall.back) / 2;

	// The plot: stone paving, solid, the hall's marble laid on it.
	box(entity, "paving", [0, LOT_THICKNESS / 2, 0], [site.width, LOT_THICKNESS, site.depth], paving, { outside: true, solid: true });
	box(entity, "marble", [0, floorY + 0.005, midZ], [2 * hall.side, 0.01, depth], floor);

	// Walls: stone at the sides, the back carrying the walnut feature wall inside.
	box(entity, "wall-back", [0, floorY + hall.height / 2, backZ], [width, hall.height, hall.wall], stone, { outside: true, solid: true });
	for (const side of [-1, 1]) {
		box(entity, `wall-${side}`, [side * (hall.side + hall.wall / 2), floorY + hall.height / 2, midZ - hall.wall / 2], [hall.wall, hall.height, depth + hall.wall], stone, { outside: true, solid: true });
	}
	box(entity, "feature-wall", [0, floorY + 2.4, hall.back + 0.04], [9.4, 4.4, 0.06], walnut);
	box(entity, "feature-sign", [0, floorY + 3.1, hall.back + 0.08], [4.6, 1.15, 0.03], sign);
	for (const side of [-1, 1]) box(entity, `feature-light-${side}`, [side * 4.75, floorY + 2.4, hall.back + 0.08], [0.06, 4.4, 0.04], light);

	// The glass front: panes either side of the open doorway, a pane over it, black mullions.
	const paneWidth = hall.side - hall.door.halfWidth;
	for (const side of [-1, 1]) {
		box(entity, `glass-${side}`, [side * (hall.door.halfWidth + paneWidth / 2), floorY + hall.height / 2, hall.front], [paneWidth, hall.height, 0.04], glass, { solid: true });
	}
	box(entity, "glass-transom", [0, floorY + (hall.door.height + hall.height) / 2, hall.front], [2 * hall.door.halfWidth, hall.height - hall.door.height, 0.04], glass);
	for (const x of [-hall.side, -4.85, -3.1, -hall.door.halfWidth, hall.door.halfWidth, 3.1, 4.85, hall.side]) {
		box(entity, `mullion-${x}`, [x, floorY + hall.height / 2, hall.front], [0.08, hall.height, 0.12], black, outside);
	}
	box(entity, "transom", [0, floorY + hall.door.height, hall.front], [2 * hall.door.halfWidth, 0.1, 0.12], black, outside);

	// The roof and the canopy over the forecourt (no shadow: see above), edged in bronze, the name on the front.
	const canopyFront = site.depth / 2 - 0.6;
	const roofDepth = canopyFront - backZ + hall.wall / 2;
	const roofZ = (canopyFront + backZ - hall.wall / 2) / 2;
	box(entity, "roof", [0, top + 0.18, roofZ], [width + 0.2, 0.36, roofDepth], ceiling);
	box(entity, "fascia-front", [0, top + 0.18, canopyFront + 0.03], [width + 0.26, 0.5, 0.06], bronze, outside);
	for (const side of [-1, 1]) box(entity, `fascia-${side}`, [side * (width / 2 + 0.13), top + 0.18, roofZ], [0.06, 0.5, roofDepth + 0.06], bronze, outside);
	box(entity, "sign", [0, top + 0.95, canopyFront - 0.25], [7.2, 1.0, 0.08], sign, outside);
	box(entity, "sign-base", [0, top + 0.42, canopyFront - 0.25], [7.4, 0.08, 0.3], black, outside);
	// Lines of light across the ceiling, and a light over the doorway.
	for (const z of [-5.2, -2.6, 0, 2.6]) box(entity, `ceiling-light-${z}`, [0, top - 0.02, z], [2 * hall.side - 0.6, 0.04, 0.16], light);
	box(entity, "canopy-light", [0, top - 0.02, (hall.front + canopyFront) / 2], [2 * hall.door.halfWidth + 1.4, 0.04, 0.2], light);

	// The cars' plinths: white, lit underneath; the big round one for the car at the back.
	for (const item of KASPER_SHOWROOM.items) {
		const bay = KASPER_LOT_BAYS[item.id];
		if (item.kind !== "vehicle" || !bay) continue;
		const holder = new PlayCanvasEntity(`plinth-${item.id}`);
		entity.addChild(holder);
		holder.setLocalPosition(bay.x, floorY, bay.z);
		holder.setLocalEulerAngles(0, bay.yaw, 0);
		const height = bay.plinth;
		if (item.id === "halcyon") {
			cylinder(holder, "plinth", [0, height / 2 + 0.02, 0], [5.0, height - 0.02, 5.0], plinthTop);
			cylinder(holder, "plinth-glow", [0, 0.012, 0], [4.86, 0.024, 4.86], glow);
			cylinder(holder, "plinth-ring", [0, height + 0.001, 0], [5.04, 0.004, 5.04], bronze);
		} else {
			box(holder, "plinth", [0, height / 2 + 0.02, 0], [2.6, height - 0.02, 5.7], plinthTop);
			box(holder, "plinth-glow", [0, 0.012, 0], [2.5, 0.024, 5.6], glow);
		}
		// A spot of light in the ceiling over it.
		cylinder(holder, "downlight", [0, hall.height - 0.03, 0], [0.5, 0.03, 0.5], light);
	}

	// The reception desk: walnut under a marble top, a bronze line along its front, a screen.
	const desk = hall.desk;
	box(entity, "desk", [desk.x, floorY + (desk.height - 0.05) / 2, desk.z], [desk.width, desk.height - 0.05, desk.depth], walnut, { solid: true });
	box(entity, "desk-top", [desk.x, floorY + desk.height - 0.025, desk.z], [desk.width + 0.2, 0.05, desk.depth + 0.16], deskTop);
	box(entity, "desk-line", [desk.x, floorY + desk.height - 0.2, desk.z + desk.depth / 2 + 0.005], [desk.width, 0.03, 0.01], bronze);
	box(entity, "desk-screen", [desk.x - 0.5, floorY + desk.height + 0.2, desk.z - 0.12], [0.55, 0.34, 0.03], black);

	// Clipped bay balls in black pots: a pair either side of the door outside, one in each back corner.
	for (const side of [-1, 1]) {
		for (const [x, z, part] of [[side * (hall.door.halfWidth + 1.0), hall.front + 0.9, outside], [side * (hall.side - 0.6), hall.back + 0.6, {}]] as const) {
			cylinder(entity, `pot-${side}-${z}`, [x, floorY + 0.35, z], [0.75, 0.7, 0.75], black, part === outside);
			cylinder(entity, `stem-${side}-${z}`, [x, floorY + 0.95, z], [0.06, 0.5, 0.06], walnut, part === outside);
			sphere(entity, `bay-ball-${side}-${z}`, [x, floorY + 1.45, z], 0.85, leaf, part === outside);
		}
	}

	// The totem at the forecourt's corner by the pavement, lit gold on black both ways.
	const totemX = -site.width / 2 + 0.7;
	const totemZ = site.depth / 2 - 0.7;
	box(entity, "totem", [totemX, floorY + 2.2, totemZ], [0.95, 4.4, 0.32], black, { outside: true, solid: true });
	for (const face of [-1, 1]) box(entity, `totem-sign-${face}`, [totemX, floorY + 2.4, totemZ + face * 0.17], [0.8, 3.4, 0.02], totemSign, outside);
	box(entity, "totem-cap", [totemX, floorY + 4.44, totemZ], [1.0, 0.08, 0.36], bronze, outside);

	return entity;
}
