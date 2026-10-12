import { Color, Entity, MASK_AFFECT_DYNAMIC, type AppBase, type MeshInstance, type RenderComponent } from "playcanvas";

/**
 * A light for the player alone, the way third-person games light their hero.
 *
 * The chase camera mostly looks at the player's back, and whenever the sun was ahead of the
 * camera that back was the unlit side: only the sky's blue ambient reached it, and in a building's
 * or tree's shadow not even the sun's bounce — the character read as a black cut-out against a
 * sunlit street. This light shines from the camera, so the side you see is always lit, and only
 * the player's body receives it (its own mask bit), so the street around stays as the sun has it.
 * The body also no longer takes shadows: it's lit as if it stood in the sun wherever it is.
 */

/** Light-mask bit for the player's body; everything else keeps the default mask only. */
export const PLAYER_LIGHT_MASK = 8;

const INTENSITY = 0.75;
const COLOUR = new Color(1, 0.94, 0.86);
/** Tipped down from the camera's own heading, degrees: from above the shoulder, not head-on. */
const DOWN_TILT = 25;

/** Puts the player's body on the character light, and out of the shadows. */
export function lightAsPlayer(renders: readonly RenderComponent[]): void {
	for (const render of renders) {
		render.receiveShadows = false;
		for (const instance of render.meshInstances as MeshInstance[]) instance.mask = MASK_AFFECT_DYNAMIC | PLAYER_LIGHT_MASK;
	}
}

export class CharacterLight {
	private readonly entity: Entity;

	public constructor(app: AppBase) {
		this.entity = new Entity("character-light");
		this.entity.addComponent("light", {
			type: "directional",
			color: COLOUR,
			intensity: INTENSITY,
			castShadows: false,
			mask: PLAYER_LIGHT_MASK,
		});
		app.root.addChild(this.entity);
	}

	/** Aims along the camera's view, tipped down. A directional light shines down its own -Y. */
	public follow(camera: Entity): void {
		const angles = camera.getEulerAngles();
		this.entity.setEulerAngles(angles.x, angles.y, angles.z);
		// Turning +90 about X takes the light's -Y onto the camera's forward (-Z), then tip it down.
		this.entity.rotateLocal(90 - DOWN_TILT, 0, 0);
	}

	public destroy(): void {
		this.entity.destroy();
	}
}
