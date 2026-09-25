import { Asset, AnimTrack, Entity, Script } from "playcanvas";

import { mergeCharacterMaterials } from "../rendering/CharacterMerge";
import { fixSkinnedBounds } from "../rendering/SkinnedBounds";
import { applySmoothShading } from "../rendering/SmoothShading";
import { readPlayerPose } from "./PlayerPose";

type MovementState = "Idle" | "Walk" | "Run";
/** One-off clips that override the movement states (carjacking, sitting in a car). */
export type ActionState = "Sitting" | "Punch" | "Death" | "Standing" | "SwordSlash";
/** Every clip the rig can be asked for. Drivers are forced onto one of these directly. */
export type ClipState = MovementState | ActionState;

/**
 * Speed bands for each state, with a gap between "enter" and "exit". Switching on a single
 * threshold made the state flip back and forth whenever speed hovered near it, restarting the
 * blend each time — that's what produced the broken mid-stride leg poses.
 */
const WALK_ENTER = 0.5;
const WALK_EXIT = 0.25;
const RUN_ENTER = 3.8;
const RUN_EXIT = 3.2;

/**
 * Ground speed (units/s, at human scale) each clip looks natural at. Playback is scaled from
 * these so the feet keep pace with the ground instead of sliding. Estimated by eye from the
 * clips, so tune here if strides still look off.
 */
const CLIP_SPEED: Readonly<Record<Exclude<MovementState, "Idle">, number>> = { Walk: 1.5, Run: 4 };
const MIN_RATE = 0.75;
const MAX_RATE = 1.6;
const BLEND_SECONDS = 0.25;
const RATE_SMOOTHING = 8;
/**
 * A held pose (a seated driver) stops being evaluated once it has blended in: dozens of
 * drivers re-sampling a still pose every frame was wasted work.
 */
const FREEZE_AFTER_SECONDS = 0.6;
/**
 * The sitting clip starts standing and lowers onto the seat over its first ~0.7 s, then holds.
 * A driver is already seated, so it starts past that point: played from the top, every driver
 * coming into view (they only animate while seen) rose up through the roof and sat back down.
 */
const SEATED_CLIP_TIME = 1;

/**
 * Drives idle/walk/run playback on a real skinned character GLB (as opposed to
 * OrionCharacterAnimation, which procedurally swings primitive-shape limbs).
 *
 * The GLB's own baked animation clips are assigned to named anim states matching
 * their clip name suffix (e.g. "HumanArmature|Man_Walk" -> "Walk"), then swapped
 * based on the ancestor "player" entity's rigidbody speed.
 */
export class OrionSkinnedCharacterAnimation extends Script {
	public static scriptName = "orionSkinnedCharacterAnimation";
	public asset: Asset | null = null;
	/** Plays this clip instead of the speed-driven ones. Drivers set it; the player reads PlayerPose. */
	public forcedState: ClipState | "" = "";
	/** Take the forced state from the shared player pose (only the player's own model). */
	public followPlayerAction = true;

	private animRoot: Entity | null = null;
	private currentState: ClipState = "Idle";
	private movementState: MovementState = "Idle";
	private playbackRate = 1;
	private ready = false;
	private heldFor = 0;

	public initialize() {
		this.trySetup();
	}

	public update(dt: number) {
		// The model under this entity can be swapped (the container re-instantiated, a hot reload):
		// the old root no longer draws and the new one has no animation, so it stood in its bind
		// pose. Set up again on whatever root is there now.
		if (this.ready && this.animRoot !== this.entity.children[0]) {
			this.ready = false;
			this.animRoot = null;
		}
		if (!this.ready) {
			this.trySetup();
			if (!this.ready) return;
		}
		const anim = this.animRoot?.anim;
		if (!anim) return;

		const player = this.findAncestor("player");
		const velocity = player?.rigidbody?.linearVelocity;
		const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;

		this.movementState = resolveState(this.movementState, speed);
		const forced = this.followPlayerAction ? readPlayerPose().action : this.forcedState;
		const nextState: ClipState = forced || this.movementState;
		if (nextState !== this.currentState) {
			anim.playing = true;
			this.heldFor = 0;
			this.enterState(nextState, BLEND_SECONDS);
		}

		if (forced) {
			anim.speed = this.followPlayerAction ? readPlayerPose().actionSpeed : 1;
			if (!this.followPlayerAction && forced === "Sitting") {
				this.heldFor += dt;
				// Only once the pose has really been sampled: stopping before the first evaluation
				// left the driver frozen in the bind pose (a T-pose through the roof).
				const layer = anim.baseLayer;
				const settled = layer && !layer.transitioning && layer.activeState === "Sitting" && layer.activeStateCurrentTime > 0;
				if (this.heldFor > FREEZE_AFTER_SECONDS && settled && anim.playing) anim.playing = false;
			}
			return;
		}
		const movement = this.movementState;
		const targetRate = movement === "Idle"
			? 1
			: Math.min(MAX_RATE, Math.max(MIN_RATE, speed / CLIP_SPEED[movement]));
		this.playbackRate += (targetRate - this.playbackRate) * (1 - Math.exp(-RATE_SMOOTHING * dt));
		anim.speed = this.playbackRate;
	}

	private findAncestor(name: string): Entity | null {
		let node: Entity | null = this.entity;
		while (node && node.name !== name) {
			node = node.parent as Entity | null;
		}
		return node;
	}

	private trySetup() {
		const resource = this.asset?.resource as { animations?: readonly Asset[] } | undefined;
		const modelRoot = this.entity.children[0] as Entity | undefined;
		if (!resource?.animations?.length || !modelRoot) return;

		// A root that's already been prepared (this script re-created on it) keeps its merged mesh.
		if (!modelRoot.anim) {
			applySmoothShading(modelRoot);
			fixSkinnedBounds(modelRoot);
			mergeCharacterMaterials(modelRoot, this.app.graphicsDevice);
			modelRoot.addComponent("anim", { activate: true });
		}
		const anim = modelRoot.anim;
		if (!anim) return;

		for (const animationAsset of resource.animations) {
			const track = animationAsset.resource as AnimTrack | undefined;
			const state = classifyClip(track?.name ?? "");
			if (state && track) {
				// Attacks and Death play once and hold their last frame.
				anim.assignAnimation(state, track, undefined, 1, !ONE_SHOT.includes(state));
			}
		}

		const initial: ClipState = (this.followPlayerAction ? readPlayerPose().action : this.forcedState) || "Idle";
		anim.playing = true;
		this.animRoot = modelRoot;
		this.enterState(initial, 0);
		this.heldFor = 0;
		this.ready = true;
	}

	private enterState(state: ClipState, blend: number) {
		const layer = this.animRoot?.anim?.baseLayer;
		this.currentState = state;
		if (!layer) return;
		if (state === "Sitting" && !this.followPlayerAction) {
			// Straight into the seated pose, no blend from standing (see SEATED_CLIP_TIME).
			layer.transition(state, 0);
			layer.activeStateCurrentTime = SEATED_CLIP_TIME;
			return;
		}
		layer.transition(state, blend);
	}
}

function resolveState(current: MovementState, speed: number): MovementState {
	if (current === "Run") return speed < RUN_EXIT ? (speed < WALK_EXIT ? "Idle" : "Walk") : "Run";
	if (speed > RUN_ENTER) return "Run";
	if (current === "Walk") return speed < WALK_EXIT ? "Idle" : "Walk";
	return speed > WALK_ENTER ? "Walk" : "Idle";
}

const CLIP_STATES: readonly ClipState[] = ["Idle", "Walk", "Run", "Sitting", "Punch", "Death", "Standing", "SwordSlash"];
const ONE_SHOT: readonly ClipState[] = ["Punch", "Death", "SwordSlash"];

function classifyClip(clipName: string): ClipState | null {
	const lastToken = clipName.split(/[|_]/).pop()?.toLowerCase() ?? "";
	return CLIP_STATES.find((state) => state.toLowerCase() === lastToken) ?? null;
}
