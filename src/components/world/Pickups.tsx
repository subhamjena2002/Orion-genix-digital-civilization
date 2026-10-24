"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity as PlayCanvasEntity, StandardMaterial } from "playcanvas";
import { memo, useEffect, useState } from "react";

import { MAX_PICKUPS, pickups, pickupsVersion } from "@/engine/orion/combat/Pickups";
import { weaponById, type WeaponId } from "@/engine/orion/combat/WeaponData";
import { WeaponModels } from "@/engine/orion/combat/WeaponModels";

/** The gun turns slowly this high over the ground, over a gold ring, so it reads as something to pick up. */
const HOVER = 0.45;
const BOB = 0.06;
const SPIN_DEGREES_PER_SECOND = 90;
const RING_COLOUR = new Color(1, 0.8, 0.3);
/** Shown this long whatever the gun (a pistol's barely a hand long): big enough to be seen from the road. */
const SHOWN_LENGTH = 0.75;
/** A short column of light over it, seen from down the street. */
const BEAM_HEIGHT = 1.6;

interface Slot {
	holder: PlayCanvasEntity;
	turner: PlayCanvasEntity;
	models: WeaponModels;
	shown: WeaponId | null;
}

/**
 * The weapons lying where people dropped them (see combat/Pickups): a fixed set of slots, each
 * showing whichever pickup it's been given, refilled whenever one's dropped or taken.
 */
export const Pickups = memo(function Pickups() {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		if (!app || !root) return;
		const ring = new StandardMaterial();
		ring.name = "pickup-ring";
		ring.diffuse = new Color(0, 0, 0);
		ring.emissive = RING_COLOUR;
		ring.emissiveIntensity = 1.8;
		ring.opacity = 0.5;
		ring.blendType = BLEND_ADDITIVE;
		ring.depthWrite = false;
		ring.cull = CULLFACE_NONE;
		ring.useLighting = false;
		ring.update();

		const slots: Slot[] = Array.from({ length: MAX_PICKUPS }, (_, index) => {
			const holder = new PlayCanvasEntity(`pickup-${index}`);
			const glow = new PlayCanvasEntity("ring");
			glow.addComponent("render", { type: "torus", material: ring, castShadows: false, receiveShadows: false });
			glow.setLocalScale(1.1, 0.2, 1.1);
			glow.setLocalPosition(0, 0.05, 0);
			const beam = new PlayCanvasEntity("beam");
			beam.addComponent("render", { type: "cylinder", material: ring, castShadows: false, receiveShadows: false });
			beam.setLocalScale(0.24, BEAM_HEIGHT, 0.24);
			beam.setLocalPosition(0, BEAM_HEIGHT / 2, 0);
			const turner = new PlayCanvasEntity("turner");
			holder.addChild(glow);
			holder.addChild(beam);
			holder.addChild(turner);
			holder.enabled = false;
			root.addChild(holder);
			return { holder, turner, models: new WeaponModels(app, turner), shown: null };
		});

		let seen = -1;
		let time = 0;
		const update = (dt: number) => {
			time += dt;
			const lying = pickups();
			if (pickupsVersion() !== seen) {
				seen = pickupsVersion();
				for (let index = 0; index < slots.length; index++) {
					const slot = slots[index];
					const pickup = lying[index];
					if (!pickup) {
						if (slot.holder.enabled) slot.holder.enabled = false;
						continue;
					}
					if (slot.shown !== pickup.weapon) {
						if (slot.shown) {
							const previous = slot.models.visualFor(weaponById(slot.shown));
							if (previous) previous.root.enabled = false;
						}
						const definition = weaponById(pickup.weapon);
						const visual = slot.models.visualFor(definition);
						const length = definition.model?.length ?? SHOWN_LENGTH;
						const scale = SHOWN_LENGTH / length;
						slot.turner.setLocalScale(scale, scale, scale);
						if (visual) {
							visual.root.enabled = true;
							// Turning about its middle: the grip's at the origin, the muzzle out along -Z.
							visual.root.setLocalPosition(0, 0, length / 2);
						}
						slot.shown = pickup.weapon;
					}
					slot.holder.setPosition(pickup.x, pickup.y, pickup.z);
					slot.holder.enabled = true;
				}
			}
			for (let index = 0; index < lying.length && index < slots.length; index++) {
				const slot = slots[index];
				slot.turner.setLocalPosition(0, HOVER + BOB * Math.sin(time * 2 + index), 0);
				slot.turner.setLocalEulerAngles(0, (time * SPIN_DEGREES_PER_SECOND + index * 40) % 360, 0);
			}
		};
		app.on("update", update);
		return () => {
			app.off("update", update);
			for (const slot of slots) {
				slot.models.destroy();
				slot.holder.destroy();
			}
			ring.destroy();
		};
	}, [app, root]);

	return <Entity ref={setRoot} name="pickups" />;
});
