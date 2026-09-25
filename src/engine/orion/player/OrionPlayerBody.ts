import { BLEND_NONE, Script, StandardMaterial, type Asset, type Entity, type GraphNode, type RenderComponent } from "playcanvas";

import { fixSkinnedBounds } from "../rendering/SkinnedBounds";
import { FootPlant } from "./FootPlant";
import { readPlayerPose } from "./PlayerPose";
import { playerRig, setPlayerRig, type PlayerRig } from "./PlayerRig";
import { CHARACTER_CREATOR_STANCE, PlayerStance } from "./PlayerStance";
import { CITIZEN_TO_CHARACTER_CREATOR, findBone, rigFacing, SkeletonRetarget } from "./Retarget";
import { WeaponPose, type HoldRequest } from "./WeaponPose";

/** Name of the entity holding the animated (hidden) citizen rig inside the player visual. */
const SOURCE_HOLDER = "character-scale";
/** How quickly the standing correction fades in and out (per second) around the idle clip. */
const STANCE_RATE = 8;

/**
 * The player's visible body: a detailed character model driven by the citizen rig's animations
 * (see Retarget). Attached to the model's `<Container>` entity.
 *
 * Until both rigs are ready the citizen stays visible, so there's never a frame without a player.
 */
export class OrionPlayerBody extends Script {
	public static scriptName = "orionPlayerBody";

	/** The citizen asset, for a rest-pose copy of its skeleton. */
	public sourceAsset: Asset | null = null;

	private ready = false;
	private rig: PlayerRig | null = null;
	/** The citizen's render components and the layers they drew on before being hidden. */
	private hiddenSource: { render: RenderComponent; layers: number[] }[] = [];
	private source: Entity | null = null;
	private stanceWeight = 0;
	private hold: HoldRequest | null = null;
	/** Frames left before the restarted animation is put back on the idle clip (see restartClips). */
	private restarting = 0;

	public initialize() {
		this.on("destroy", () => {
			// A re-mounted body sets itself up before the old one is torn down: only undo what's
			// still ours, or the citizen would reappear on top of the new body.
			if (!this.rig || playerRig() !== this.rig) return;
			setPlayerRig(null);
			for (const { render, layers } of this.hiddenSource) render.layers = layers;
		});
	}

	public update(dt: number) {
		if (!this.ready) {
			this.trySetup();
			return;
		}
		// Only the idle clip gets straightened (see PlayerStance); walking, running and attacks
		// keep their own pose.
		const layer = this.source?.anim?.baseLayer;
		const idle = layer?.activeState === "Idle" ? 1 : 0;
		this.stanceWeight += (idle - this.stanceWeight) * (1 - Math.exp(-STANCE_RATE * dt));
		if (this.restarting > 0) this.stepRestart(--this.restarting);
	}

	/**
	 * One frame of the restart, in order: let the clips settle on whatever comes after the death
	 * (OrionSkinnedCharacterAnimation picks that itself), then reset, then put it back on idle. A
	 * reset in the same frame as a change of clip has no effect, which is why these are spread out.
	 */
	private stepRestart(step: number): void {
		const anim = this.source?.anim;
		if (!anim) return;
		if (step === 1) {
			anim.reset();
			anim.playing = true;
		} else if (step === 0) {
			anim.baseLayer?.transition("Idle", 0);
		}
	}

	/**
	 * Drops what the animation is holding onto the skeleton and starts it again from the idle clip.
	 *
	 * A clip that plays once holds its last frame, and the next clip only writes the bones it has
	 * curves for — so the death clip's fold stayed on the bones the idle clip doesn't animate, and
	 * a respawned player stood up still bent double. The component keeps re-applying those values
	 * every frame, so setting the bones back by hand doesn't last and neither does re-entering the
	 * state or rebinding; only resetting the component lets go of them.
	 */
	private restartClips(): void {
		if (this.source?.anim?.baseLayer) this.restarting = 3;
	}

	private trySetup() {
		const target = this.entity.children[0] as Entity | undefined;
		const player = this.findAncestor("player");
		const holder = player?.findByName(SOURCE_HOLDER) as Entity | null;
		// character-scale -> <Container> entity -> glTF root, which carries the anim component.
		const source = holder?.children[0]?.children[0] as Entity | undefined;
		const resource = this.sourceAsset?.resource as { instantiateRenderEntity?: () => Entity } | undefined;
		if (!target || !source?.anim || !resource?.instantiateRenderEntity) return;
		if (!findBone(target, "CC_Base_Hip")) return;

		// A fresh copy of the citizen, never animated, gives its rest pose — at the same scale.
		const rest = resource.instantiateRenderEntity();
		const scale = source.getWorldTransform().getScale();
		rest.setLocalScale(scale.x, scale.y, scale.z);

		// Both rigs are measured in the upright entities holding them: the citizen's scale holder,
		// and the body's parent (this container is turned below to face the citizen's way).
		const sourceFrame = holder!;
		const targetFrame = this.entity.parent;
		const sourceForward = rigFacing(rest, null, "Hips", "Head", "UpperArm.L", "UpperArm.R");
		const targetForward = rigFacing(target, targetFrame, "CC_Base_Hip", "CC_Base_Head", "CC_Base_L_Upperarm", "CC_Base_R_Upperarm");
		if (sourceForward && targetForward) {
			const turn = (Math.atan2(sourceForward.x, sourceForward.z) - Math.atan2(targetForward.x, targetForward.z)) * (180 / Math.PI);
			this.entity.setLocalEulerAngles(0, turn, 0);
		}
		fixSkinnedBounds(target);
		const facing = targetFrame ? rigFacing(target, targetFrame, "CC_Base_Hip", "CC_Base_Head", "CC_Base_L_Upperarm", "CC_Base_R_Upperarm") : null;
		makeOpaque(target);

		const retarget = new SkeletonRetarget(
			{ root: source, frame: sourceFrame },
			{ root: rest, frame: null },
			{ root: target, frame: targetFrame },
			CITIZEN_TO_CHARACTER_CREATOR,
		);
		rest.destroy();
		if (retarget.boneCount < 10) return;

		// The citizen keeps animating unseen; only the new body draws. Taken off every layer rather
		// than hiding its mesh instances, so it stays hidden however those are replaced later
		// (the character merge swaps them) — and off the layers it casts no shadow either.
		source.forEach((node) => {
			const render = (node as Entity).render;
			if (!render) return;
			this.hiddenSource.push({ render, layers: [...render.layers] });
			render.layers = [];
		});
		const stance = facing && targetFrame ? new PlayerStance(target, targetFrame, facing, CHARACTER_CREATOR_STANCE) : null;
		const plant = targetFrame ? new FootPlant(target, targetFrame) : null;
		const pose = targetFrame ? WeaponPose.create(target, targetFrame) : null;
		this.source = source;
		this.rig = {
			apply: (dt) => {
				retarget.apply();
				stance?.apply(this.stanceWeight);
				// Lying down or seated, the feet aren't what holds the body up.
				const action = readPlayerPose().action;
				plant?.apply(action === "Death" || action === "Sitting" ? 0 : 1);
				// Last: the arms and chest reach onto what's held, from wherever the hips ended up.
				pose?.apply(this.hold, dt);
			},
			hand: findBone(target, "CC_Base_R_Hand"),
			palm: findBone(target, "CC_Base_R_Mid1"),
			holds: pose !== null,
			setHold: (request) => {
				this.hold = request;
			},
			resetPose: () => {
				this.restartClips();
			},
		};
		setPlayerRig(this.rig);
		this.ready = true;
	}

	private findAncestor(name: string): Entity | null {
		let node: GraphNode | null = this.entity;
		while (node && node.name !== name) node = node.parent;
		return node as Entity | null;
	}
}

/**
 * The model ships its one material as alpha-blended, but its texture only uses alpha to cut out
 * hair and lash cards. Blended, the double-sided body drew without depth, so the inside of the
 * shirt and far side of the body showed through as a glassy sheen. A cutout keeps the same
 * edges and draws solid.
 */
function makeOpaque(root: Entity): void {
	const seen = new Set<StandardMaterial>();
	for (const render of root.findComponents("render") as RenderComponent[]) {
		for (const instance of render.meshInstances) {
			const material = instance.material;
			if (!(material instanceof StandardMaterial) || seen.has(material)) continue;
			seen.add(material);
			material.blendType = BLEND_NONE;
			material.depthWrite = true;
			if (material.opacityMap) material.alphaTest = 0.5;
			material.update();
		}
	}
}
