import { Entity, Script, Vec3 } from "playcanvas";

const UP = new Vec3(0, 1, 0);

export class OrionThirdPersonController extends Script {
	public static scriptName = "orionThirdPersonController";
	public camera: Entity | null = null;
	public walkSpeed = 4.8;
	public runSpeed = 9.2;
	public acceleration = 16;
	public braking = 22;
	public mouseSensitivity = 0.12;
	public cameraDistance = 5.5;
	public cameraHeight = 1.35;
	public jumpForce = 450;

	private readonly keys = new Set<string>();
	private mouseX = 0;
	private mouseY = 0;
	private yaw = 0;
	private pitch = 22;
	private characterYaw = 0;
	private cameraPosition = new Vec3();
	private readonly cameraTarget = new Vec3();
	private readonly desiredCameraPosition = new Vec3();
	private readonly forward = new Vec3();
	private readonly right = new Vec3();
	private readonly desiredVelocity = new Vec3();
	private readonly currentVelocity = new Vec3();
	private readonly pointerMove = (event: MouseEvent) => {
		if (document.pointerLockElement === this.app.graphicsDevice.canvas) {
			this.mouseX += event.movementX;
			this.mouseY += event.movementY;
		}
	};
	private readonly keyDown = (event: KeyboardEvent) => this.keys.add(event.code);
	private readonly keyUp = (event: KeyboardEvent) => this.keys.delete(event.code);
	private readonly canvasClick = () => {
		void this.app.graphicsDevice.canvas.requestPointerLock();
	};

	public initialize() {
		if (!this.camera) {
			throw new Error("OrionThirdPersonController: Camera entity is required.");
		}

		const canvas = this.app.graphicsDevice.canvas;
		canvas.addEventListener("click", this.canvasClick);
		window.addEventListener("mousemove", this.pointerMove);
		window.addEventListener("keydown", this.keyDown);
		window.addEventListener("keyup", this.keyUp);
		this.yaw = this.camera.getEulerAngles().y;
		this.characterYaw = this.entity.getEulerAngles().y;
		this.cameraPosition.copy(this.camera.getPosition());
		this.on("destroy", this.destroy, this);
	}

	public update(dt: number) {
		if (!this.camera || !this.entity.rigidbody) return;

		this.yaw -= this.mouseX * this.mouseSensitivity;
		this.pitch = Math.max(-12, Math.min(68, this.pitch - this.mouseY * this.mouseSensitivity));
		this.mouseX = 0;
		this.mouseY = 0;

		const axisX = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
		const axisZ = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
		const axisLength = Math.hypot(axisX, axisZ);
		const normalizedX = axisLength > 0 ? axisX / axisLength : 0;
		const normalizedZ = axisLength > 0 ? axisZ / axisLength : 0;
		const radians = this.yaw * Math.PI / 180;
		this.forward.set(Math.sin(radians), 0, Math.cos(radians));
		this.right.set(Math.cos(radians), 0, -Math.sin(radians));
		const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? this.runSpeed : this.walkSpeed;
		this.desiredVelocity.copy(this.forward).mulScalar(normalizedZ * speed).add(this.right.clone().mulScalar(normalizedX * speed));

		const velocity = this.entity.rigidbody.linearVelocity;
		this.currentVelocity.set(velocity.x, velocity.y, velocity.z);
		const response = axisLength > 0 ? this.acceleration : this.braking;
		const blend = Math.min(1, response * dt);
		this.currentVelocity.x += (this.desiredVelocity.x - this.currentVelocity.x) * blend;
		this.currentVelocity.z += (this.desiredVelocity.z - this.currentVelocity.z) * blend;
		if (this.keys.has("Space") && this.isGrounded()) {
			this.currentVelocity.y = this.jumpForce / this.entity.rigidbody.mass;
		}
		this.entity.rigidbody.linearVelocity = this.currentVelocity;

		if (axisLength > 0) {
			const targetFacing = this.yaw;
			const angleDelta = ((targetFacing - this.characterYaw + 540) % 360) - 180;
			this.characterYaw += angleDelta * (1 - Math.exp(-14 * dt));
			this.entity.setEulerAngles(0, this.characterYaw, 0);
		}
		this.updateCamera(dt);
	}

	private isGrounded() {
		const position = this.entity.getPosition();
		const start = new Vec3(position.x, position.y, position.z);
		const end = new Vec3(position.x, position.y - 1.15, position.z);
		const system = this.entity.rigidbody?.system as unknown as { raycastFirst: (from: Vec3, to: Vec3) => unknown } | undefined;
		return Boolean(system?.raycastFirst(start, end));
	}

	private updateCamera(dt: number) {
		if (!this.camera) return;
		const position = this.entity.getPosition();
		this.cameraTarget.set(position.x, position.y + this.cameraHeight, position.z);
		const yawRadians = this.yaw * Math.PI / 180;
		const pitchRadians = this.pitch * Math.PI / 180;
		const horizontalDistance = Math.cos(pitchRadians) * this.cameraDistance;
		this.desiredCameraPosition.set(
			this.cameraTarget.x + Math.sin(yawRadians) * horizontalDistance,
			this.cameraTarget.y + Math.sin(pitchRadians) * this.cameraDistance,
			this.cameraTarget.z + Math.cos(yawRadians) * horizontalDistance,
		);
		const blend = 1 - Math.exp(-12 * dt);
		this.cameraPosition.lerp(this.cameraPosition, this.desiredCameraPosition, blend);
		this.camera.setPosition(this.cameraPosition);
		this.camera.lookAt(this.cameraTarget, UP);
	}

	public destroy() {
		const canvas = this.app.graphicsDevice.canvas;
		canvas.removeEventListener("click", this.canvasClick);
		window.removeEventListener("mousemove", this.pointerMove);
		window.removeEventListener("keydown", this.keyDown);
		window.removeEventListener("keyup", this.keyUp);
		this.keys.clear();
	}
}
