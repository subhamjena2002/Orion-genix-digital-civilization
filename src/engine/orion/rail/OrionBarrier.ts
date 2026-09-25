import { Color, Entity, Script, type StandardMaterial } from "playcanvas";

import { BARRIER } from "./RailMeshes";
import { crossingClosed, BARRIER_SWING_SECONDS } from "./RailTraffic";
import type { LevelCrossing } from "./RailLine";

/**
 * One boom at a level crossing: drops across the road when the train is coming and lifts once
 * it has gone, with the warning lamps flashing the whole time it is down.
 *
 * It decides for itself from the train's position (RailTraffic) rather than being told, so the
 * two booms at a crossing always agree and neither can be left hanging if something else goes
 * wrong.
 */

const LAMP_FLASH_SECONDS = 0.55;
const LAMP_ON = new Color(1, 0.12, 0.08);
const LAMP_OFF = new Color(0.22, 0.03, 0.02);
const LAMP_DARK = new Color(0, 0, 0);
const LAMP_ON_INTENSITY = 5;

export class OrionBarrier extends Script {
	public static scriptName = "orionBarrier";

	public crossing: LevelCrossing | null = null;
	/** This barrier's own lamp material — the two lamps alternate by swapping its colour. */
	public lamp: StandardMaterial | null = null;
	/** The two booms at a crossing flash out of step with each other, as real ones do. */
	public phase = 0;

	private boom: Entity | null = null;
	private angle: number = BARRIER.raisedAngle;
	private flashTimer = 0;
	private lit: boolean | null = null;

	public initialize() {
		this.boom = this.entity.findByName("boom") as Entity | null;
		this.flashTimer = this.phase * LAMP_FLASH_SECONDS;
		this.apply();
	}

	public update(dt: number) {
		const closed = this.crossing ? crossingClosed(this.crossing) : false;
		const target = closed ? 0 : BARRIER.raisedAngle;
		const step = (BARRIER.raisedAngle / BARRIER_SWING_SECONDS) * dt;
		this.angle = this.angle < target ? Math.min(target, this.angle + step) : Math.max(target, this.angle - step);
		this.apply();

		this.flashTimer += dt;
		const on = closed && Math.floor(this.flashTimer / LAMP_FLASH_SECONDS) % 2 === 0;
		if (on === this.lit) return;
		this.lit = on;
		const material = this.lamp;
		if (!material) return;
		material.diffuse = on ? LAMP_ON : LAMP_OFF;
		material.emissive = on ? LAMP_ON : LAMP_DARK;
		material.emissiveIntensity = on ? LAMP_ON_INTENSITY : 0;
		material.update();
	}

	private apply() {
		this.boom?.setLocalEulerAngles(0, 0, this.angle);
	}
}
