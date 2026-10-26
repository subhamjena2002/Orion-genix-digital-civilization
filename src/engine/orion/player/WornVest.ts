import type { AppBase, Entity, GraphNode, RenderComponent } from "playcanvas";

import { loadContainer } from "../combat/WeaponModels";
import { lightAsPlayer } from "./CharacterLight";
import { playerRig } from "./PlayerRig";

/** The vest, modelled on the player's own body in its chest bone's space (blender/build_weapons.py). */
const VEST_URL = "/models/props/armour-vest.glb";
/** The node the vest's parts hang from: the chest bone's frame, as exported. */
const VEST_FRAME = "armour_vest";

/**
 * Body armour the player can see: while there's armour left, the plate carrier is worn, hung on
 * the chest bone so it moves with the body. Loads once the loading screen's gone, and follows the
 * body if it's re-mounted (a respawn builds a fresh one).
 */
export class WornVest {
	private frame: Entity | null = null;
	private wornOn: GraphNode | null = null;
	private loading = false;
	private destroyed = false;

	public constructor(private readonly app: AppBase) {}

	/** Called each frame with whether the player has any armour. */
	public update(worn: boolean): void {
		if (!worn && !this.frame?.enabled) return;
		if (!this.frame) {
			if (worn) this.load();
			return;
		}
		const chest = playerRig()?.chest ?? null;
		if (chest !== this.wornOn) {
			this.wornOn = chest;
			if (chest) {
				chest.addChild(this.frame);
				this.frame.setLocalPosition(0, 0, 0);
				this.frame.setLocalEulerAngles(0, 0, 0);
				this.frame.setLocalScale(1, 1, 1);
			} else {
				this.frame.parent?.removeChild(this.frame);
			}
		}
		this.frame.enabled = worn && chest !== null;
	}

	public destroy(): void {
		this.destroyed = true;
		this.frame?.destroy();
		this.frame = null;
	}

	private load(): void {
		if (this.loading) return;
		this.loading = true;
		loadContainer(this.app, VEST_URL).then((asset) => {
			if (!asset || this.destroyed) return;
			// A file with one root node instantiates as that node; otherwise it's under a wrapper.
			const model = (asset.resource as { instantiateRenderEntity: () => Entity }).instantiateRenderEntity();
			const frame = model.findByName(VEST_FRAME) as Entity | null;
			if (!frame) {
				model.destroy();
				return;
			}
			if (frame !== model) {
				model.removeChild(frame);
				model.destroy();
			}
			const renders = frame.findComponents("render") as RenderComponent[];
			for (const render of renders) render.castShadows = true;
			lightAsPlayer(renders);
			frame.enabled = false;
			this.frame = frame;
		}).catch(() => {
			// No vest to show; the armour still works.
		});
	}
}
