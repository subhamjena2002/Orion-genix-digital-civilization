import { GraphNode, Quat, Vec3, type Entity } from "playcanvas";
import { describe, expect, it } from "vitest";

import { HOLD_STYLES } from "../combat/HoldStyles";
import { basis, WeaponPose, type HoldRequest } from "./WeaponPose";

/** The player model's real proportions, in a T-pose at rest (metres). */
function humanoid() {
	const frame = new GraphNode("frame");
	const bones = new Map<string, GraphNode>();
	const add = (name: string, parent: string | null, x: number, y: number, z: number) => {
		const node = new GraphNode(name);
		(parent ? bones.get(parent)! : frame).addChild(node);
		node.setLocalPosition(x, y, z);
		bones.set(name, node);
	};
	add("CC_Base_Hip", null, 0, 0.957, 0);
	add("CC_Base_Waist", "CC_Base_Hip", 0, 0.075, 0.01);
	add("CC_Base_Spine01", "CC_Base_Waist", 0, 0.037, 0.009);
	add("CC_Base_Spine02", "CC_Base_Spine01", 0, 0.123, -0.008);
	add("CC_Base_NeckTwist01", "CC_Base_Spine02", 0, 0.269, -0.052);
	add("CC_Base_Head", "CC_Base_NeckTwist01", 0, 0.072, 0.017);
	for (const [side, s] of [["R", -1], ["L", 1]] as const) {
		add(`CC_Base_${side}_Clavicle`, "CC_Base_Spine02", s * 0.058, 0.215, -0.042);
		add(`CC_Base_${side}_Upperarm`, `CC_Base_${side}_Clavicle`, s * 0.134, -0.003, -0.032);
		add(`CC_Base_${side}_Forearm`, `CC_Base_${side}_Upperarm`, s * 0.251, 0, 0);
		add(`CC_Base_${side}_Hand`, `CC_Base_${side}_Forearm`, s * 0.235, 0, 0);
		for (const finger of ["Index", "Mid", "Ring", "Pinky", "Thumb"]) {
			let parent = `CC_Base_${side}_Hand`;
			for (let joint = 1; joint <= 3; joint++) {
				const name = `CC_Base_${side}_${finger}${joint}`;
				add(name, parent, s * (joint === 1 ? 0.084 : 0.03), 0, joint === 1 && finger === "Thumb" ? 0.03 : 0.005);
				parent = name;
			}
		}
	}
	return { frame, bones };
}

function request(style: keyof typeof HOLD_STYLES, aim: Vec3, extra: Partial<HoldRequest> = {}): { request: HoldRequest; root: GraphNode } {
	const root = new GraphNode("weapon");
	// A node outside a scene reports itself disabled; the weapon in the game is in the scene.
	Object.defineProperty(root, "enabled", { value: true });
	return {
		root,
		request: {
			style: HOLD_STYLES[style],
			// Long guns have a handguard to hold; a pistol's off hand cups the grip the style gives it.
			weapon: {
				root: root as unknown as Entity,
				hands: { main: null, off: style === "pistol" || style === "blade" ? null : new Vec3(0, 0.04, -0.36) },
				// A long gun's stock reaches back past the grip; a pistol and a blade end at the hand.
				stock: style === "pistol" || style === "blade" ? 0.02 : 0.32,
			},
			aim: aim.clone().normalize(),
			raise: 1, weight: 1, equip: 0, reload: -1, attached: null,
			...extra,
		},
	};
}

/**
 * Runs the pose for a third of a second. In the game the retarget puts the bones it drives back
 * to the clip's pose each frame before this runs — all but the upper spine, which it doesn't
 * drive — so the same is done here.
 */
const settle = (pose: WeaponPose, hold: HoldRequest, frames = 20) => {
	const rest = restPose.get(pose);
	for (let i = 0; i < frames; i++) {
		for (const { bone, position, rotation } of rest ?? []) {
			if (bone.name === "CC_Base_Spine02") continue;
			bone.setLocalPosition(position);
			bone.setLocalRotation(rotation);
		}
		pose.apply(hold, 1 / 60);
	}
};
const restPose = new WeakMap<WeaponPose, { bone: GraphNode; position: Vec3; rotation: Quat }[]>();

/** A pose for `frame`'s body that remembers how to reset it. */
function poseFor(frame: GraphNode, bones: Map<string, GraphNode>): WeaponPose {
	const pose = WeaponPose.create(frame, frame)!;
	restPose.set(pose, [...bones.values()].map((bone) => ({ bone, position: bone.getLocalPosition().clone(), rotation: bone.getLocalRotation().clone() })));
	return pose;
}

describe("basis", () => {
	it("builds the rotation whose axes are the given ones", () => {
		const q = basis(new Vec3(0, 0, -1), new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Quat());
		const x = q.transformVector(new Vec3(1, 0, 0), new Vec3());
		expect(x.z).toBeCloseTo(-1, 5);
		const z = q.transformVector(new Vec3(0, 0, 1), new Vec3());
		expect(z.x).toBeCloseTo(1, 5);
	});
});

describe("WeaponPose", () => {
	it("needs the bones it poses", () => {
		const frame = new GraphNode("frame");
		expect(WeaponPose.create(frame, frame)).toBeNull();
	});

	it.each(["pistol", "rifle", "shotgun", "launcher"] as const)("puts both hands on a %s aimed level", (style) => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const { request: hold, root } = request(style, new Vec3(0, 0, 1));
		settle(pose, hold);

		const held = HOLD_STYLES[style];
		const world = root.getWorldTransform();
		const right = bones.get("CC_Base_R_Hand")!.getPosition();
		const left = bones.get("CC_Base_L_Hand")!.getPosition();
		const shoulderRight = bones.get("CC_Base_R_Upperarm")!.getPosition();
		const shoulderLeft = bones.get("CC_Base_L_Upperarm")!.getPosition();

		// Each wrist is a hand's width behind the grip it holds — near the weapon, never far off it.
		const gripRight = world.transformPoint(new Vec3(...held.right!.point), new Vec3());
		expect(right.distance(gripRight)).toBeLessThan(0.13);
		const offPoint = style === "pistol" ? new Vec3(...held.left!.point) : new Vec3(0, 0.04, -0.36);
		const gripLeft = world.transformPoint(offPoint, new Vec3());
		// The off hand may slide back along the weapon to stay in reach, so measure to the weapon's line.
		expect(left.distance(gripLeft)).toBeLessThan(style === "pistol" ? 0.13 : 0.45);

		// And nothing is asked of an arm beyond its length.
		expect(right.distance(shoulderRight)).toBeLessThan(0.49);
		expect(left.distance(shoulderLeft)).toBeLessThan(0.49);
		for (const p of [right, left, gripRight, gripLeft]) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
	});

	it("points the weapon where it's aimed", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const aim = new Vec3(0.3, 0.25, 0.9);
		const { request: hold, root } = request("rifle", aim);
		settle(pose, hold);
		const muzzle = root.getRotation().transformVector(new Vec3(0, 0, -1), new Vec3());
		expect(muzzle.dot(hold.aim)).toBeGreaterThan(0.999);
	});

	it("carries a long gun at a shouldered low ready: muzzle down, butt still at the shoulder", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const aimed = request("rifle", new Vec3(0, 0, 1), { raise: 1 });
		settle(pose, aimed.request);
		const heightAimed = aimed.root.getPosition().y;
		const ready = request("rifle", new Vec3(0, 0, 1), { raise: 0 });
		settle(pose, ready.request);
		expect(ready.root.getPosition().y).toBeLessThan(heightAimed - 0.05);
		const muzzle = ready.root.getRotation().transformVector(new Vec3(0, 0, -1), new Vec3());
		expect(muzzle.y).toBeLessThan(-0.3);
		expect(muzzle.z).toBeGreaterThan(0.5);
		// Not on the hip: the butt stays up in the shoulder pocket, aimed or carried.
		const buttOf = (root: GraphNode) => root.getWorldTransform().transformPoint(new Vec3(0, 0, 0.32), new Vec3());
		const shoulder = bones.get("CC_Base_R_Upperarm")!.getPosition();
		expect(buttOf(ready.root).distance(shoulder)).toBeLessThan(0.16);
		expect(buttOf(aimed.root).distance(shoulder)).toBeLessThan(0.16);
	});

	it("keeps a long gun in front of the body instead of burying it in the chest", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		for (const raise of [0, 1]) {
			const { request: hold, root } = request("rifle", new Vec3(0, 0, 1), { raise });
			settle(pose, hold);
			const chest = bones.get("CC_Base_Spine02")!.getPosition();
			const top = bones.get("CC_Base_R_Upperarm")!.getPosition().y;
			const bottom = bones.get("CC_Base_Waist")!.getPosition().y;
			// How far out of the chest's oval a point is: 1 is against it, less is inside it.
			const clear = (p: Vec3) => Math.hypot((p.x - chest.x) / 0.154, (p.z - chest.z) / 0.116);
			const world = root.getWorldTransform();
			for (let t = -0.4; t <= 0.32; t += 0.04) {
				const along = world.transformPoint(new Vec3(0, 0, t), new Vec3());
				if (along.y > top || along.y < bottom) continue;
				const where = `weapon at z=${t.toFixed(2)}, raise ${raise}`;
				// The butt nestles into the shoulder and the stock rests along the chest, so what's
				// asked is that none of it comes out of the character's back, as it used to.
				expect(along.z, where).toBeGreaterThan(chest.z - 0.116);
				// Ahead of the grip there's nothing to rest on: the barrel is out clear of the body.
				if (t <= 0) expect(clear(along), where).toBeGreaterThan(1);
			}
			// The hands hold it out in front, clear of the body.
			for (const side of ["R", "L"] as const) {
				expect(clear(bones.get(`CC_Base_${side}_Hand`)!.getPosition()), `${side} wrist, raise ${raise}`).toBeGreaterThan(1);
			}
		}
	});

	it("tips a long gun's muzzle down and across at the ready, not the butt back", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const { request: hold, root } = request("rifle", new Vec3(0, 0, 1), { raise: 0 });
		settle(pose, hold);
		const muzzle = root.getRotation().transformVector(new Vec3(0, 0, -1), new Vec3());
		// Down, and across the body to the off side, the way a low ready points.
		expect(muzzle.y).toBeLessThan(-0.3);
		expect(muzzle.x).toBeGreaterThan(0.2);
		expect(root.getPosition().z).toBeGreaterThan(bones.get("CC_Base_Spine02")!.getPosition().z + 0.12);
	});

	it("reaches the off hand out along a long gun rather than bunching it against the firing hand", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const stretch = () => bones.get("CC_Base_L_Hand")!.getPosition().distance(bones.get("CC_Base_L_Upperarm")!.getPosition()) / 0.486;
		for (const raise of [0, 1]) {
			const { request: hold, root } = request("rifle", new Vec3(0, 0, 1), { raise });
			settle(pose, hold);
			const hands = bones.get("CC_Base_L_Hand")!.getPosition().distance(bones.get("CC_Base_R_Hand")!.getPosition());
			// Two hands a hand's width apart read as one clumsy grab; they belong apart on the weapon.
			expect(hands, `hands apart, raise ${raise}`).toBeGreaterThan(0.18);
			// The off hand is on the weapon, ahead of the grip, not behind it by the shoulder.
			const inWeapon = root.getWorldTransform().clone().invert().transformPoint(bones.get("CC_Base_L_Hand")!.getPosition(), new Vec3());
			expect(inWeapon.z, `off hand along the weapon, raise ${raise}`).toBeLessThan(-0.1);
			// Reaching, but never locked straight.
			expect(stretch(), `off arm stretch, raise ${raise}`).toBeLessThan(0.96);
		}
	});

	it("blades the chest towards the weapon side while aiming", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const shoulders = () => bones.get("CC_Base_L_Upperarm")!.getPosition().z - bones.get("CC_Base_R_Upperarm")!.getPosition().z;
		const before = shoulders();
		settle(pose, request("rifle", new Vec3(0, 0, 1)).request);
		// The off shoulder comes forward of the firing shoulder.
		expect(shoulders()).toBeGreaterThan(before + 0.1);
	});

	it("doesn't let the chest drift the longer a weapon is held", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const hold = request("rifle", new Vec3(0, 0, 1)).request;
		const shoulder = () => bones.get("CC_Base_L_Upperarm")!.getPosition().clone();
		settle(pose, hold, 30);
		const early = shoulder();
		settle(pose, hold, 300);
		expect(shoulder().distance(early)).toBeLessThan(1e-4);
	});

	it("puts the chest back when the weapon is put away", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const before = bones.get("CC_Base_L_Upperarm")!.getPosition().clone();
		const putAway: HoldRequest | null = null;
		settle(pose, request("rifle", new Vec3(0.4, 0.3, 0.9)).request, 40);
		expect(bones.get("CC_Base_L_Upperarm")!.getPosition().distance(before)).toBeGreaterThan(0.02);
		for (let i = 0; i < 3; i++) {
			for (const { bone, position, rotation } of restPose.get(pose)!) {
				if (bone.name === "CC_Base_Spine02") continue;
				bone.setLocalPosition(position);
				bone.setLocalRotation(rotation);
			}
			pose.apply(putAway, 1 / 60);
		}
		expect(bones.get("CC_Base_L_Upperarm")!.getPosition().distance(before)).toBeLessThan(1e-5);
	});

	it("keeps the weapon in the firing hand while the arms are still coming onto it", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const fromWrist = (weight: number) => {
			const { request: hold, root } = request("rifle", new Vec3(0, 0, 1), { weight });
			settle(pose, hold);
			return root.getPosition().distance(bones.get("CC_Base_R_Hand")!.getPosition());
		};
		// Part-way through the draw the arms are still mostly in the clip's pose; the weapon has to
		// travel with the hand rather than hang at the grip it's heading for.
		const held = fromWrist(1);
		for (const weight of [0.15, 0.4, 0.7]) expect(fromWrist(weight), `weight ${weight}`).toBeCloseTo(held, 4);
	});

	it("turns the head to the aim", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		settle(pose, request("rifle", new Vec3(-0.6, 0, 0.8)).request);
		const forward = bones.get("CC_Base_Head")!.getRotation().transformVector(new Vec3(0, 0, 1), new Vec3());
		// Aiming to the right (-X): the head faces right of straight ahead.
		expect(forward.x).toBeLessThan(-0.2);
	});

	it("leaves the arms to the clip at weight 0", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const wrist = bones.get("CC_Base_R_Hand")!.getPosition().clone();
		settle(pose, request("rifle", new Vec3(0, 0, 1), { weight: 0 }).request);
		expect(bones.get("CC_Base_R_Hand")!.getPosition().distance(wrist)).toBeLessThan(1e-5);
	});

	it("brings the weapon up, muzzle first, when just switched to", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const fresh = request("rifle", new Vec3(0, 0, 1), { raise: 0, equip: 1 });
		settle(pose, fresh.request);
		const settled = request("rifle", new Vec3(0, 0, 1), { raise: 0, equip: 0 });
		settle(pose, settled.request);
		// The hands stay on it, so the weapon can only drop as far as the arms allow: it's the muzzle that dips.
		const muzzleY = (root: GraphNode) => root.getRotation().transformVector(new Vec3(0, 0, -1), new Vec3()).y;
		expect(muzzleY(fresh.root)).toBeLessThan(muzzleY(settled.root) - 0.3);
	});

	it("carries a blade with the hand during a swing", () => {
		const { frame, bones } = humanoid();
		const pose = poseFor(frame, bones);
		const hand = new Vec3(0.4, 1.1, 0.5);
		const { request: hold, root } = request("blade", new Vec3(0, 0, 1), {
			weight: 0,
			attached: (position, rotation) => {
				position.copy(hand);
				rotation.copy(Quat.IDENTITY);
			},
		});
		// The arms belong to the clip (weight 0): the weapon goes where the hand carries it.
		settle(pose, hold);
		expect(root.getPosition().distance(hand)).toBeLessThan(1e-5);
	});
});
