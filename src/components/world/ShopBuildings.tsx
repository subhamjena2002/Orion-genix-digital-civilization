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
import { WeaponModels } from "@/engine/orion/combat/WeaponModels";
import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { KASPER_SHOWROOM } from "@/engine/orion/shops/ShopCatalog";
import {
	KASPER_LOT_BAYS,
	KASPER_LOT_PLACES,
	KASPER_LOT_SITE,
	ORION_ARMS_CASE,
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

/** The car lot's asphalt (its top is the site's ground): solid, so the cars on it stand on it. */
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
 * - **Kasper Motors' lot**, beside Benny's: asphalt, a pylon sign, the cars for sale parked with
 *   their prices in front of them, and the sales kiosk at the corner.
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
 * The cars for sale, parked in their bays. Apart from the places' entities, so nothing those do
 * re-renders them: a re-render puts a car's entity back to how it was first given, turning a
 * parked car away from its bay.
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
						home={{ x, z, yaw: yawToWorld(KASPER_LOT_SITE, bay.yaw), ground: KASPER_LOT_SITE.ground }}
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
	const vestCloth = finish("arms-vest", "#1d2738", { gloss: 0.2, fill: ROOM_FILL * 0.7 });
	const vestPlate = finish("arms-vest-plate", "#3c4c68", { gloss: 0.3, fill: ROOM_FILL * 0.7 });
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

	// A vest on a torso stand by the right-hand window, facing into the room: a dummy's grey chest
	// and neck, the vest over it with its shoulder straps, front plate and a row of pouches.
	const [vx, , vz] = room.vest;
	const vest = new PlayCanvasEntity("vest-stand");
	entity.addChild(vest);
	vest.setLocalPosition(vx, 0, vz);
	vest.setLocalEulerAngles(0, -90, 0);
	const dummy = finish("arms-dummy", "#8d9096", { gloss: 0.35, fill: ROOM_FILL * 0.6 });
	cylinder(vest, "vest-base", [0, 0.03, 0], [0.55, 0.06, 0.55], steel);
	cylinder(vest, "vest-pole", [0, 0.5, 0], [0.06, 0.95, 0.06], steel);
	box(vest, "dummy-waist", [0, 1.02, 0], [0.34, 0.16, 0.22], dummy);
	box(vest, "dummy-chest", [0, 1.42, 0], [0.42, 0.5, 0.26], dummy);
	cylinder(vest, "dummy-neck", [0, 1.74, 0], [0.12, 0.14, 0.12], dummy);
	box(vest, "vest-body", [0, 1.36, 0], [0.48, 0.56, 0.31], vestCloth);
	box(vest, "vest-plate", [0, 1.42, 0.165], [0.36, 0.36, 0.03], vestPlate);
	for (const side of [-1, 1]) box(vest, `vest-strap-${side}`, [side * 0.14, 1.66, 0], [0.09, 0.06, 0.3], vestCloth);
	for (const x of [-0.15, 0, 0.15]) box(vest, `vest-pouch-${x}`, [x, 1.15, 0.18], [0.12, 0.14, 0.06], vestPlate);
	box(vest, "vest-belt", [0, 1.07, 0], [0.5, 0.05, 0.33], trim);

	return { entity, displays, models };
}

// ---- Kasper Motors' lot ------------------------------------------------------------------------

function buildKasperLot(root: PlayCanvasEntity, finish: MakeFinish, texture: MakeTexture): PlayCanvasEntity {
	const site = KASPER_LOT_SITE;
	const entity = siteRoot(root, "kasper-lot", site, LAND_Y);
	const asphalt = finish("lot-asphalt", "#303337", { gloss: 0.18 });
	const kerb = finish("lot-kerb", "#c9c5bb", { gloss: 0.1 });
	const mat = finish("lot-mat", "#6e1a1a", { gloss: 0.1 });
	const white = finish("lot-white", "#f1f1ee", { gloss: 0.3 });
	const navy = finish("lot-navy", "#1f3a6b", { gloss: 0.4 });
	const orange = finish("lot-orange", "#f2a516", { gloss: 0.4 });
	const steel = finish("lot-steel", "#9aa0a8", { gloss: 0.6, metalness: 0.7 });
	const glass = finish("lot-glass", "#8fa6b2", { gloss: 0.92, opacity: 0.25 });
	const outside: Part = { outside: true };

	const signMap = texture(1024, 384, (context) => {
		context.fillStyle = "#1f3a6b";
		context.fillRect(0, 0, 1024, 384);
		context.fillStyle = "#f2a516";
		context.fillRect(0, 300, 1024, 24);
		context.fillStyle = "#ffffff";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.font = "900 120px Arial, sans-serif";
		context.fillText("KASPER", 512, 110);
		context.font = "900 92px Arial, sans-serif";
		context.fillText("MOTORS", 512, 225);
		context.font = "bold 30px Arial, sans-serif";
		context.fillStyle = "#1f3a6b";
		context.fillRect(0, 324, 1024, 60);
		context.fillStyle = "#f2a516";
		context.fillText("QUALITY CARS · DRIVE AWAY TODAY", 512, 355);
	});
	const sign = finish("lot-sign", "#ffffff", { gloss: 0.3, map: signMap, sign: 0.85 });
	const salesMap = texture(512, 128, (context) => {
		context.fillStyle = "#f2a516";
		context.fillRect(0, 0, 512, 128);
		context.fillStyle = "#1f3a6b";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.font = "900 72px Arial, sans-serif";
		context.fillText("SALES", 256, 66);
	});
	const sales = finish("lot-sales", "#ffffff", { gloss: 0.3, map: salesMap, sign: 0.7 });

	// The lot: asphalt with a kerb round it, solid so the cars stand on it.
	box(entity, "asphalt", [0, LOT_THICKNESS / 2, 0], [site.width, LOT_THICKNESS, site.depth], asphalt, { outside: true, solid: true });
	box(entity, "kerb-back", [0, 0.1, -site.depth / 2 + 0.1], [site.width, 0.16, 0.2], kerb, outside);
	for (const side of [-1, 1]) box(entity, `kerb-${side}`, [side * (site.width / 2 - 0.1), 0.1, 0], [0.2, 0.16, site.depth], kerb, outside);

	// The cars: a red mat under each, the name and price on a board in front.
	for (const item of KASPER_SHOWROOM.items) {
		const bay = KASPER_LOT_BAYS[item.id];
		if (item.kind !== "vehicle" || !bay) continue;
		const holder = new PlayCanvasEntity(`bay-${item.id}`);
		entity.addChild(holder);
		holder.setLocalPosition(bay.x, LOT_THICKNESS, bay.z);
		holder.setLocalEulerAngles(0, bay.yaw, 0);
		box(holder, "mat", [0, 0.004, 0], [2.6, 0.006, 5.4], mat, outside);
		const priceMap = texture(512, 256, (context) => {
			context.fillStyle = "#ffffff";
			context.fillRect(0, 0, 512, 256);
			context.fillStyle = "#1f3a6b";
			context.fillRect(0, 0, 512, 70);
			context.fillStyle = "#ffffff";
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.font = "bold 34px Arial, sans-serif";
			context.fillText(item.vehicle.name ?? "", 256, 36);
			context.fillStyle = "#c4261c";
			context.font = "900 92px Arial, sans-serif";
			context.fillText(`$${item.price.toLocaleString("en-US")}`, 256, 158);
			context.fillStyle = "#1f3a6b";
			context.font = "bold 22px Arial, sans-serif";
			context.fillText("KASPER MOTORS", 256, 228);
		});
		const price = finish(`lot-price-${item.id}`, "#ffffff", { gloss: 0.3, map: priceMap, sign: 0.35 });
		box(holder, "price-post", [1.0, 0.45, 3.1], [0.05, 0.9, 0.05], steel, outside);
		box(holder, "price-board", [1.0, 1.0, 3.12], [0.9, 0.45, 0.03], price, outside);
	}

	// The pylon sign at the road corner, facing the arterial.
	box(entity, "pylon", [-site.width / 2 + 0.6, 2.4, site.depth / 2 - 0.5], [0.3, 4.8, 0.3], navy, { outside: true, solid: true });
	box(entity, "pylon-sign", [-site.width / 2 + 0.6, 4.9, site.depth / 2 - 0.5 + 0.18], [3.2, 1.2, 0.08], sign, outside);
	box(entity, "pylon-cap", [-site.width / 2 + 0.6, 5.55, site.depth / 2 - 0.5], [3.3, 0.1, 0.3], orange, outside);
	// Flags along the back.
	for (const [index, x] of [-5.4, -1.8, 1.8].entries()) {
		cylinder(entity, `flag-pole-${index}`, [x, 2.5, -site.depth / 2 + 0.4], [0.07, 5, 0.07], steel, true);
		box(entity, `flag-${index}`, [x + 0.45, 4.55, -site.depth / 2 + 0.4], [0.9, 0.6, 0.02], index === 1 ? orange : navy, outside);
	}

	// The sales kiosk: white walls, glass on the lot side, a desk at the window, the sign on top.
	const kiosk = KASPER_LOT_PLACES.kiosk;
	const k = new PlayCanvasEntity("kiosk");
	entity.addChild(k);
	k.setLocalPosition(kiosk.x, LOT_THICKNESS, kiosk.z);
	const kx = kiosk.width / 2;
	const kz = kiosk.depth / 2;
	box(k, "kiosk-back", [kx - 0.06, kiosk.height / 2, 0], [0.12, kiosk.height, kiosk.depth], white, outside);
	for (const side of [-1, 1]) box(k, `kiosk-side-${side}`, [0, kiosk.height / 2, side * (kz - 0.06)], [kiosk.width, kiosk.height, 0.12], white, outside);
	box(k, "kiosk-sill", [-kx + 0.06, 0.5, 0], [0.12, 1.0, kiosk.depth], white, outside);
	box(k, "kiosk-glass", [-kx + 0.06, 1.0 + (kiosk.height - 1.3) / 2, 0], [0.04, kiosk.height - 1.3, kiosk.depth - 0.24], glass, outside);
	box(k, "kiosk-head", [-kx + 0.06, kiosk.height - 0.15, 0], [0.12, 0.3, kiosk.depth], navy, outside);
	box(k, "kiosk-desk", [-kx + 0.4, 0.95, 0], [0.5, 0.06, kiosk.depth - 0.4], navy);
	box(k, "kiosk-roof", [0, kiosk.height + 0.06, 0], [kiosk.width + 0.5, 0.12, kiosk.depth + 0.5], navy, outside);
	box(k, "kiosk-sign", [-kx - 0.26, kiosk.height + 0.4, 0], [0.04, 0.5, 2.0], sales, outside);
	box(k, "kiosk-stripe", [0, kiosk.height - 0.02, 0], [kiosk.width + 0.52, 0.06, kiosk.depth + 0.52], orange, outside);
	const kioskCollider = new PlayCanvasEntity("kiosk-collider");
	k.addChild(kioskCollider);
	kioskCollider.setLocalPosition(0, kiosk.height / 2, 0);
	kioskCollider.addComponent("collision", { type: "box", halfExtents: new Vec3(kx, kiosk.height / 2, kz) });
	kioskCollider.addComponent("rigidbody", { type: "static" });

	return entity;
}
