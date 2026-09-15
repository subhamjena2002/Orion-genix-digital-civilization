import { Entity, Script } from "playcanvas";

export class OrionCharacterAnimation extends Script {
	public static scriptName = "orionCharacterAnimation";

	private elapsed = 0;
	private leftArm: Entity | null = null;
	private rightArm: Entity | null = null;
	private leftLeg: Entity | null = null;
	private rightLeg: Entity | null = null;
	private torso: Entity | null = null;

	public initialize() {
		this.leftArm = this.entity.findByName("left-arm") as Entity | null;
		this.rightArm = this.entity.findByName("right-arm") as Entity | null;
		this.leftLeg = this.entity.findByName("left-leg") as Entity | null;
		this.rightLeg = this.entity.findByName("right-leg") as Entity | null;
		this.torso = this.entity.findByName("torso") as Entity | null;
	}

	public update(dt: number) {
		const parent = this.entity.parent as Entity | null;
		const velocity = parent?.rigidbody?.linearVelocity;
		const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;
		const activity = Math.min(1, speed / 8.5);
		this.elapsed += dt * (speed > 0.15 ? 7 + speed * 0.7 : 2);
		const stride = Math.sin(this.elapsed) * 34 * activity;
		const counterStride = -stride;

		this.leftArm?.setLocalEulerAngles(stride, 0, -5);
		this.rightArm?.setLocalEulerAngles(counterStride, 0, 5);
		this.leftLeg?.setLocalEulerAngles(counterStride, 0, 0);
		this.rightLeg?.setLocalEulerAngles(stride, 0, 0);
		this.torso?.setLocalPosition(0, 1.02 + Math.abs(Math.sin(this.elapsed)) * 0.035 * activity, 0);
	}
}
