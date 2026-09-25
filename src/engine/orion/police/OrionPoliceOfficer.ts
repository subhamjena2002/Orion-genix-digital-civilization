import { AnimTrack, Asset, Color, Entity, Script, StandardMaterial, Vec3 } from "playcanvas";

import { damageableMoved, registerDamageable, unregisterDamageable, type Listener } from "../combat/CombatWorld";
import { Health, nextCombatId, type DamageEvent } from "../combat/Damage";
import { mergeCharacterMaterials } from "../rendering/CharacterMerge";
import { fixSkinnedBounds } from "../rendering/SkinnedBounds";
import { applySmoothShading } from "../rendering/SmoothShading";
import { Knockdown } from "../characters/Knockdown";
import { crashEffects } from "../traffic/CrashEffects";
import { registerTrafficAgent, unregisterTrafficAgent, type TrafficAgent } from "../traffic/TrafficAgents";
import { POLICE_UNIFORM } from "./Police";

/** Materials left alone: eyes read wrong recoloured. */
const UNTINTED = ["eye"];
/** Dark footwear and belt read as uniform details against the khaki. */
const DARK_PARTS = ["sock", "shoe", "black", "brown", "belt"];
/** A slow look-around so posted officers don't stand like statues. */
const GLANCE_DEGREES = 25;
const GLANCE_PERIOD = 9;
/** Officers take a little more than a civilian (100) to put down. */
const HEALTH = 150;
const BODY_RADIUS = 0.3;
const BODY_HEIGHT = 1.8;
/** A blow at least this hard throws the officer; anything lighter drops them where they stand. */
const THROW_IMPULSE = 3.5;
/** How long a flinch holds before going back to standing guard. */
const HIT_SECONDS = 0.45;

/**
 * A police officer standing at a post in khaki uniform with a peaked cap.
 *
 * The cap isn't parented to the head bone (bone axes and baked scale differ per model);
 * instead it's a sibling that follows the bone's world position every frame.
 */
export class OrionPoliceOfficer extends Script {
	public static scriptName = "orionPoliceOfficer";

	public asset: Asset | null = null;
	public yaw = 0;
	public seed = 1;
	public cap: Entity | null = null;
	/** Distance from the head bone to where the cap sits, in world units. */
	public capLift = 0.08;

	private ready = false;
	private head: Entity | null = null;
	private agent: TrafficAgent | null = null;
	private time = 0;
	private model: Entity | null = null;
	private knockdown: Knockdown | null = null;
	private post = new Vec3();
	private readonly health = new Health(HEALTH);
	private body: Listener | null = null;
	private hitTimer = 0;

	public initialize() {
		this.time = (this.seed * 1.37) % GLANCE_PERIOD;
		const position = this.entity.getPosition();
		this.agent = registerTrafficAgent("person", 0.3);
		this.agent.x = position.x;
		this.agent.z = position.z;
		this.post.copy(position);
		this.agent.onStruck = (velocityX, velocityZ) => this.struck(velocityX, velocityZ);
		this.knockdown = new Knockdown(this.entity, this.app);
		// Shootable, stabbable and punchable, like anyone else in the street (see CombatWorld).
		const isAlive = () => this.ready && this.health.alive && !this.knockdown?.active;
		this.body = {
			id: nextCombatId(),
			kind: "person",
			x: position.x, y: position.y, z: position.z,
			radius: BODY_RADIUS,
			height: BODY_HEIGHT,
			halfLength: 0, headingX: 0, headingZ: 1,
			get alive() {
				return isAlive();
			},
			takeDamage: (event) => this.takeDamage(event),
		};
		this.on("destroy", () => {
			if (this.agent) unregisterTrafficAgent(this.agent);
			if (this.body) unregisterDamageable(this.body);
			this.knockdown?.destroy();
		});
		this.trySetup();
	}

	public update(dt: number) {
		if (!this.ready) {
			this.trySetup();
			if (!this.ready) return;
		}
		if (this.knockdown?.active) {
			this.updateKnockedDown(dt);
			return;
		}
		if (this.hitTimer > 0) {
			this.hitTimer -= dt;
			if (this.hitTimer <= 0) this.model?.anim?.baseLayer?.transition("Idle", 0.2);
		}
		this.time += dt;
		const glance = Math.sin((this.time / GLANCE_PERIOD) * Math.PI * 2) * GLANCE_DEGREES;
		this.entity.setEulerAngles(0, this.yaw + glance, 0);

		if (this.head && this.cap) {
			const headPosition = this.head.getPosition();
			this.cap.setPosition(headPosition.x, headPosition.y + this.capLift, headPosition.z);
			this.cap.setEulerAngles(0, this.yaw + glance, 0);
		}
	}

	private takeDamage(event: DamageEvent) {
		if (!this.ready || !this.knockdown || this.knockdown.active) return;
		const killed = this.health.damage(event.amount);
		if (!killed) {
			// A flinch, where the clip exists; the officer holds the post.
			const anim = this.model?.anim;
			if (anim?.baseLayer?.states.includes("Hit")) {
				anim.baseLayer.transition("Hit", 0.08);
				this.hitTimer = HIT_SECONDS;
			}
			return;
		}
		if (this.agent) this.agent.alive = false;
		const impulse = event.impulse >= THROW_IMPULSE ? event.impulse : event.impulse * 0.4;
		this.knockdown.strike(event.directionX * impulse, event.directionZ * impulse, this.model?.anim, this.entity.getEulerAngles().y);
		crashEffects(this.app).impact(event.x, event.y, event.z, -event.directionX, 0.3, -event.directionZ, "flesh");
	}

	private struck(velocityX: number, velocityZ: number) {
		if (!this.ready || !this.knockdown || this.knockdown.active) return;
		this.health.damage(this.health.current);
		if (this.agent) this.agent.alive = false;
		this.knockdown.strike(velocityX, velocityZ, this.model?.anim, this.yaw);
	}

	private updateKnockedDown(dt: number) {
		const knockdown = this.knockdown!;
		const phase = knockdown.update(dt);
		const position = this.entity.getPosition();
		if (this.agent) {
			this.agent.x = position.x;
			this.agent.z = position.z;
		}
		this.followCap(this.entity.getEulerAngles().y);
		if (this.body) {
			this.body.x = position.x;
			this.body.z = position.z;
			damageableMoved(this.body);
		}
		if (phase !== "gone") return;

		// A replacement officer takes the post.
		knockdown.reset();
		this.health.reset();
		this.hitTimer = 0;
		if (this.body) {
			this.body.x = this.post.x;
			this.body.z = this.post.z;
			damageableMoved(this.body);
		}
		this.entity.setPosition(this.post);
		this.entity.setEulerAngles(0, this.yaw, 0);
		if (this.agent) {
			this.agent.alive = true;
			this.agent.x = this.post.x;
			this.agent.z = this.post.z;
		}
		const anim = this.model?.anim;
		if (anim) {
			anim.speed = 1;
			anim.baseLayer?.transition("Idle", 0);
		}
	}

	private followCap(yaw: number) {
		if (!this.head || !this.cap) return;
		const headPosition = this.head.getPosition();
		this.cap.setPosition(headPosition.x, headPosition.y + this.capLift, headPosition.z);
		this.cap.setEulerAngles(0, yaw, 0);
	}

	private trySetup() {
		const resource = this.asset?.resource as { animations?: readonly Asset[] } | undefined;
		// officer-model (scaled) -> <Container> entity -> glTF root, which the anim must sit on.
		const scaled = this.entity.findByName("officer-model") as Entity | null;
		const model = scaled?.children[0]?.children[0] as Entity | undefined;
		if (!resource || !model) return;

		applySmoothShading(model);
		fixSkinnedBounds(model);
		this.applyUniform(model);
		mergeCharacterMaterials(model, this.app.graphicsDevice);
		this.playIdle(model, resource.animations);
		this.model = model;
		this.head = (model.findByName("Head_end") ?? model.findByName("Head")) as Entity | null;
		this.ready = true;
		if (this.body) registerDamageable(this.body);
	}

	private applyUniform(model: Entity) {
		const skin = POLICE_UNIFORM.skin[this.seed % POLICE_UNIFORM.skin.length];
		const renders = model.findComponents("render") as unknown as { meshInstances: { material: StandardMaterial }[] }[];
		for (const render of renders) {
			for (const meshInstance of render.meshInstances) {
				const name = (meshInstance.material.name ?? "").toLowerCase();
				if (UNTINTED.some((skip) => name.includes(skip))) continue;
				let colour: string = POLICE_UNIFORM.khaki;
				if (name.includes("skin")) colour = skin;
				else if (name.includes("hair")) colour = POLICE_UNIFORM.hair;
				else if (DARK_PARTS.some((part) => name.includes(part))) colour = POLICE_UNIFORM.belt;

				const tinted = meshInstance.material.clone();
				tinted.diffuse = new Color().fromString(colour);
				tinted.update();
				meshInstance.material = tinted;
			}
		}
	}

	private playIdle(model: Entity, animations: readonly Asset[] | undefined) {
		const idle = animations?.find((clip) => (clip.resource as AnimTrack | undefined)?.name?.toLowerCase().endsWith("idle"));
		if (!idle) return;
		model.addComponent("anim", { activate: true });
		// Offset each officer's cycle so posted officers don't breathe in unison.
		model.anim?.assignAnimation("Idle", idle.resource as AnimTrack, undefined, 0.85 + (this.seed % 5) * 0.06, true);
		const death = animations?.find((clip) => (clip.resource as AnimTrack | undefined)?.name?.toLowerCase().endsWith("death"));
		if (death) model.anim?.assignAnimation("Death", death.resource as AnimTrack, undefined, 1, false);
		const hit = animations?.find((clip) => /hitrecieve$|hitreact$|hit_?receive$/i.test((clip.resource as AnimTrack | undefined)?.name ?? ""));
		if (hit) model.anim?.assignAnimation("Hit", hit.resource as AnimTrack, undefined, 1.3, false);
		model.anim?.baseLayer?.transition("Idle", 0);
	}
}
