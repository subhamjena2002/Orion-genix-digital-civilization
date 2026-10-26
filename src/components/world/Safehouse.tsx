"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import {
	ADDRESS_CLAMP_TO_EDGE,
	Color,
	Mat4,
	Quat,
	Entity as PlayCanvasEntity,
	Texture,
	Vec3,
	type ContainerResource,
	type RenderComponent,
	type StandardMaterial,
} from "playcanvas";
import { memo, useEffect, useState } from "react";

import { readCombatHud } from "@/engine/orion/combat/CombatHud";
import { playerSupplies } from "@/engine/orion/combat/PlayerSupplies";
import { missions } from "@/engine/orion/missions/MissionDirector";
import { readWanted } from "@/engine/orion/police/Wanted";
import { setCinematicView, type CinematicView } from "@/engine/orion/player/CinematicCamera";
import { setControlsHeld } from "@/engine/orion/player/ControlHold";
import { readPlayerPose } from "@/engine/orion/player/PlayerPose";
import { sitDown, standUp } from "@/engine/orion/player/Seat";
import { SAFEHOUSE_AREA } from "@/engine/orion/rendering/DeferredModels";
import {
	LIVING_FLOOR,
	SAFEHOUSE_MODEL,
	SAFEHOUSE_RAMPS,
	SAFEHOUSE_SITE,
	SAFEHOUSE_SOFA,
	SAFEHOUSE_SOLIDS,
	toLocal,
	toWorld,
	yawToWorld,
	type Ramp,
} from "@/engine/orion/world/Safehouse";
import { isResting, restOffered, setResting, setRestOffered, takeRestToggle, toggleRest } from "@/engine/orion/world/SafehouseRest";
import { useDeferredModel } from "./useDeferredModel";
import { useDistanceCull } from "./useDistanceCull";

/** Not drawn beyond this: past it the villa is a speck behind the estate's other houses. */
const DRAW_DISTANCE = 420;
/** Thickness of a stair's walking slab. */
const RAMP_THICKNESS = 0.3;
/** Seconds on the sofa before the rest has done its good. */
const REST_HEALS_AFTER = 2.5;
/** How fast the camera settles on the TV (1/s). */
const CAMERA_EASE = 2.2;
/** The TV picture: canvas size and how often it's redrawn. */
const SCREEN_WIDTH = 512;
const SCREEN_HEIGHT = 288;
const SCREEN_FPS = 15;
/**
 * How much of its own colour each indoor material glows with (the model's "_in" materials are the
 * indoor walls and floors; the rest are furnishings and the garage floor).
 */
const ROOM_FILL: Readonly<Record<string, number>> = { indoor: 0.5, sh_stone_in: 0.75, sh_epoxy: 0.3, sh_fabric: 0.3, sh_rug: 0.3, sh_accent: 0.25 };
/** Keys that get the player up off the sofa. */
const GET_UP_KEYS = new Set(["KeyE", "KeyW", "KeyA", "KeyS", "KeyD", "Space", "Escape"]);

/** A static box, child of the (rotated) lot entity: in the scene before its body is made. */
function addSolid(root: PlayCanvasEntity, name: string, centre: Vec3, half: Vec3, rotation?: Quat): PlayCanvasEntity {
	const solid = new PlayCanvasEntity(name);
	root.addChild(solid);
	solid.setLocalPosition(centre);
	if (rotation) solid.setLocalRotation(rotation);
	solid.addComponent("collision", { type: "box", halfExtents: half });
	solid.addComponent("rigidbody", { type: "static", friction: 0.8, restitution: 0 });
	return solid;
}

/** A stair's slope as a tilted slab whose top runs from its foot to its head. */
function rampPose(ramp: Ramp) {
	const foot = new Vec3(...ramp.foot);
	const head = new Vec3(...ramp.head);
	const along = new Vec3().sub2(head, foot);
	const length = along.length();
	along.normalize();
	const across = new Vec3().cross(along, Vec3.UP).normalize();
	const up = new Vec3().cross(across, along).normalize();
	const basis = new Mat4().set([across.x, across.y, across.z, 0, up.x, up.y, up.z, 0, along.x, along.y, along.z, 0, 0, 0, 0, 1]);
	const rotation = new Quat().setFromMat4(basis);
	const centre = new Vec3().add2(foot, head).mulScalar(0.5).sub(up.mulScalar(RAMP_THICKNESS / 2));
	return { centre, rotation, half: new Vec3(ramp.width / 2, RAMP_THICKNESS / 2, length / 2) };
}

/** The TV's picture: the Orion 24 news channel, a skyline at dusk under a headline ticker. */
function drawBroadcast(context: CanvasRenderingContext2D, time: number) {
	const w = SCREEN_WIDTH;
	const h = SCREEN_HEIGHT;
	const sky = context.createLinearGradient(0, 0, 0, h);
	sky.addColorStop(0, "#1d2b5a");
	sky.addColorStop(0.55, "#d9605a");
	sky.addColorStop(0.8, "#f2b46a");
	context.fillStyle = sky;
	context.fillRect(0, 0, w, h);
	// The sun, sinking behind the towers.
	context.fillStyle = "rgba(255, 214, 140, 0.9)";
	context.beginPath();
	context.arc(w * 0.68, h * 0.62 + Math.sin(time * 0.05) * 4, 34, 0, Math.PI * 2);
	context.fill();
	// Towers, drifting slowly as the camera pans.
	const pan = (time * 12) % w;
	context.fillStyle = "#121624";
	for (let i = 0; i < 18; i++) {
		const x = ((i * 47 + 13) % w) - pan;
		const tower = 40 + ((i * 73) % 110);
		for (const shift of [0, w]) context.fillRect(x + shift, h * 0.78 - tower, 30 + (i % 3) * 8, tower);
	}
	context.fillStyle = "rgba(255, 210, 130, 0.85)";
	for (let i = 0; i < 60; i++) {
		const x = ((i * 31 + 7) % w) - pan;
		const y = h * 0.78 - 12 - ((i * 53) % 120);
		if ((i + Math.floor(time * 0.5)) % 7 === 0) continue;
		for (const shift of [0, w]) context.fillRect(x + shift, y, 3, 4);
	}
	// The road along the bay, headlights streaming.
	context.fillStyle = "#0b0d14";
	context.fillRect(0, h * 0.78, w, h * 0.22);
	for (let i = 0; i < 14; i++) {
		const x = (i * 61 + time * 90) % (w + 40) - 20;
		context.fillStyle = i % 2 ? "#ffefc4" : "#ff5a4a";
		context.fillRect(i % 2 ? x : w - x, h * 0.8 + (i % 2) * 8, 6, 3);
	}
	// Channel bug and the ticker.
	context.fillStyle = "rgba(10, 12, 20, 0.85)";
	context.fillRect(0, h - 40, w, 40);
	context.fillStyle = "#e23b3b";
	context.fillRect(0, h - 40, 112, 40);
	context.fillStyle = "#ffffff";
	context.font = "bold 20px sans-serif";
	context.textBaseline = "middle";
	context.fillText("ORION 24", 10, h - 20);
	context.font = "18px sans-serif";
	const headline = "MERIDIAN LOGISTICS DENIES LINKS TO PORT THEFTS  ·  HILLCREST HOMES SET NEW PRICE RECORD  ·  SUNSET PARK DEVELOPMENT ON HOLD  ·  ";
	const tickerWidth = context.measureText(headline).width;
	const offset = (time * 70) % tickerWidth;
	context.save();
	context.beginPath();
	context.rect(118, h - 40, w - 118, 40);
	context.clip();
	context.fillText(headline, 124 - offset, h - 20);
	context.fillText(headline, 124 - offset + tickerWidth, h - 20);
	context.restore();
	context.fillStyle = "rgba(255, 255, 255, 0.85)";
	context.font = "bold 14px sans-serif";
	context.fillText("LIVE", w - 52, 22);
	context.fillStyle = "#e23b3b";
	context.beginPath();
	context.arc(w - 62, 22, 5, 0, Math.PI * 2);
	context.fill();
}

/**
 * The player's safehouse (see world/Safehouse): the Blender-built villa on its Hillcrest lot,
 * solid where it's drawn — walls, floors, stairs walked as slopes, furniture — so the garage can
 * be driven into and the house walked through. The parked cars are GarageVehicles'.
 *
 * On foot by the sofa the player is offered a rest ("E · Rest", see DrivingHud): they sit, the TV
 * comes on and the camera settles over the sofa's back; a moment later they're back to full
 * health. E (or any move key) gets them up. Trouble — the police, a cutscene, a briefing — gets
 * them up too.
 */
export const Safehouse = memo(function Safehouse() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);
	const [model, setModel] = useState<PlayCanvasEntity | null>(null);
	const [screen, setScreen] = useState<StandardMaterial | null>(null);
	useDistanceCull(model, DRAW_DISTANCE, 20);
	// Loads after the loading screen, or at once if the player heads for Hillcrest (DeferredModels).
	const asset = useDeferredModel(SAFEHOUSE_MODEL, SAFEHOUSE_AREA);

	// Solid from the start: the garage and floors are there before the model has arrived.
	useEffect(() => {
		if (!root) return;
		const solids: PlayCanvasEntity[] = [];
		SAFEHOUSE_SOLIDS.forEach((solid, index) => {
			const [x0, y0, z0] = solid.min;
			const [x1, y1, z1] = solid.max;
			const centre = new Vec3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
			const half = new Vec3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
			solids.push(addSolid(root, `safehouse-solid-${index}`, centre, half));
		});
		SAFEHOUSE_RAMPS.forEach((ramp, index) => {
			const pose = rampPose(ramp);
			solids.push(addSolid(root, `safehouse-stair-${index}`, pose.centre, pose.half, pose.rotation));
		});
		return () => {
			for (const solid of solids) solid.destroy();
		};
	}, [root]);

	useEffect(() => {
		const resource = asset?.resource as ContainerResource | undefined;
		if (!root || !resource?.instantiateRenderEntity) return;
		const house = resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
		house.name = "safehouse-model";
		root.addChild(house);
		// Indoor surfaces glow a little of their own colour, so the rooms read lit under their
		// roofs (as the shops' do). The TV screen is its own material: dark until switched on.
		let tv: StandardMaterial | null = null;
		for (const render of house.findComponents("render") as RenderComponent[]) {
			for (const instance of render.meshInstances) {
				const material = instance.material as StandardMaterial;
				if (material.name === "tv_screen") tv = material;
				const fill = ROOM_FILL[material.name] ?? (material.name.endsWith("_in") ? ROOM_FILL.indoor : 0);
				if (fill <= 0 || material.emissiveMap) continue;
				if (material.diffuseMap) {
					material.emissiveMap = material.diffuseMap;
					material.emissive = new Color(fill, fill, fill);
				} else {
					material.emissive = new Color(material.diffuse.r * fill, material.diffuse.g * fill, material.diffuse.b * fill);
				}
				material.update();
			}
		}
		setModel(house);
		setScreen(tv);
		return () => {
			setModel(null);
			setScreen(null);
			house.destroy();
		};
	}, [root, asset]);

	useEffect(() => {
		if (!app) return;
		const canvas = document.createElement("canvas");
		canvas.width = SCREEN_WIDTH;
		canvas.height = SCREEN_HEIGHT;
		const context = canvas.getContext("2d");
		let picture: Texture | null = null;
		let pictureTime = 0;
		let sinceRedraw = 0;
		let seatedFor = 0;
		let healed = false;
		const view: CinematicView = { fromX: 0, fromY: 0, fromZ: 0, atX: 0, atY: 0, atZ: 0, faceX: Number.NaN, faceZ: Number.NaN };
		const want = { from: [0, 0, 0] as number[], at: [0, 0, 0] as number[] };
		const ground = SAFEHOUSE_SITE.ground;
		const toWorldPoint = (local: readonly [number, number, number], out: number[]) => {
			const [x, y, z] = toWorld(local);
			out[0] = x;
			out[1] = ground + y;
			out[2] = z;
		};
		toWorldPoint(SAFEHOUSE_SOFA.view.from, want.from);
		toWorldPoint(SAFEHOUSE_SOFA.view.at, want.at);
		const [seatX, seatY, seatZ] = toWorld(SAFEHOUSE_SOFA.seat);
		const [standX, standY, standZ] = toWorld(SAFEHOUSE_SOFA.stand);
		const seatYaw = yawToWorld(SAFEHOUSE_SOFA.yaw);

		const switchTv = (on: boolean) => {
			if (!screen) return;
			if (on && !picture && context) {
				picture = new Texture(app.graphicsDevice, {
					width: SCREEN_WIDTH,
					height: SCREEN_HEIGHT,
					addressU: ADDRESS_CLAMP_TO_EDGE,
					addressV: ADDRESS_CLAMP_TO_EDGE,
					mipmaps: false,
				});
				drawBroadcast(context, pictureTime);
				picture.setSource(canvas);
			}
			screen.emissiveMap = on ? picture : null;
			screen.emissive = on ? new Color(1, 1, 1) : new Color(0, 0, 0);
			screen.emissiveIntensity = on ? 1.4 : 0;
			screen.update();
		};
		const getUp = () => {
			if (!isResting()) return;
			setResting(false);
			standUp();
			setCinematicView(null);
			setControlsHeld(false, "rest");
			switchTv(false);
		};
		const sit = () => {
			setResting(true);
			setRestOffered(false);
			sitDown({ x: seatX, y: ground + seatY, z: seatZ, yaw: seatYaw, standX, standY: ground + standY, standZ });
			setControlsHeld(true, "rest");
			seatedFor = 0;
			healed = false;
			[view.fromX, view.fromY, view.fromZ] = [standX, ground + standY + 1.7, standZ];
			[view.atX, view.atY, view.atZ] = want.at;
			switchTv(true);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat) return;
			if (isResting() ? GET_UP_KEYS.has(event.code) : event.code === "KeyE" && restOffered()) toggleRest();
		};
		window.addEventListener("keydown", handleKeyDown);

		const update = (dt: number) => {
			const pose = readPlayerPose();
			const combat = readCombatHud();
			const free = !pose.inVehicle && !combat.wasted && !combat.busted && readWanted().stars === 0 && !missions.inScene && missions.phase !== "briefing";
			const resting = isResting();
			if (resting && !free) getUp();

			// On the living floor, by the sofa.
			const [lx, ly, lz] = toLocal(pose.x, pose.y - ground, pose.z);
			const [sx, , sz] = SAFEHOUSE_SOFA.stand;
			const near = Math.hypot(lx - sx, lz - sz) < SAFEHOUSE_SOFA.reach && Math.abs(ly - LIVING_FLOOR - 0.9) < 0.8;
			setRestOffered(free && near && !isResting());

			if (takeRestToggle()) {
				if (isResting()) getUp();
				else if (restOffered()) sit();
			}
			if (!isResting()) return;

			seatedFor += dt;
			if (!healed && seatedFor >= REST_HEALS_AFTER) {
				healed = true;
				const gained = playerSupplies()?.restoreHealth() ?? 0;
				missions.notice(gained > 0 ? "Rested · health restored" : "Feet up · E to get up");
			}
			const k = 1 - Math.exp(-CAMERA_EASE * dt);
			view.fromX += (want.from[0] - view.fromX) * k;
			view.fromY += (want.from[1] - view.fromY) * k;
			view.fromZ += (want.from[2] - view.fromZ) * k;
			view.atX = want.at[0];
			view.atY = want.at[1];
			view.atZ = want.at[2];
			setCinematicView(view);

			pictureTime += dt;
			sinceRedraw += dt;
			if (picture && context && sinceRedraw >= 1 / SCREEN_FPS) {
				sinceRedraw = 0;
				drawBroadcast(context, pictureTime);
				picture.upload();
			}
		};
		app.on("update", update);
		return () => {
			app.off("update", update);
			window.removeEventListener("keydown", handleKeyDown);
			getUp();
			setRestOffered(false);
			if (screen) screen.emissiveMap = null;
			picture?.destroy();
		};
	}, [app, screen]);

	return (
		<Entity
			ref={setRoot}
			name="safehouse"
			position={[SAFEHOUSE_SITE.x, SAFEHOUSE_SITE.ground, SAFEHOUSE_SITE.z]}
			rotation={[0, SAFEHOUSE_SITE.yaw, 0]}
		/>
	);
});
