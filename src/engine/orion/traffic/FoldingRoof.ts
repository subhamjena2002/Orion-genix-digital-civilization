import { Quat, Vec3, type Entity, type GraphNode } from "playcanvas";

import type { FoldingRoofSpec } from "./VehicleModels";

/**
 * A convertible's soft top (VehicleModelSpec.foldingRoof), opened and closed at the wheel with O.
 *
 * The model is built with the roof closed. Opening runs as one sequence on a single progress value
 * (0 closed, 1 stowed): the side windows drop into the doors, the rear panel swings back about its
 * hinge on the deck while the front panel folds back over it about their joint, and the folded
 * stack sinks under the rear deck. Closing plays the same sequence backwards. A roof starts stowed:
 * the city is sunny and the cabin's the thing to see.
 */

/** Seconds for a full open or close. */
export const ROOF_SECONDS = 3.2;
export const REAR_NODE = "roof-rear";
export const FRONT_NODE = "roof-front";
export const PANE_NODE = /^roof-pane-(left|right)$/;
/** The roof's nodes keep their own transforms (not merged into the body): they move. */
export const ROOF_NODE = /^roof-(rear|front|pane-(left|right))$/;

export interface RoofPose {
	/** Metres the side windows have dropped. */
	paneDrop: number;
	/** Degrees the rear panel has turned about its hinge. */
	rearTurn: number;
	/** Degrees the front panel has turned about its joint, relative to the rear one. */
	frontTurn: number;
	/** Metres the folded stack has sunk under the deck. */
	stow: number;
}

function ease(from: number, to: number, t: number): number {
	const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
	return x * x * (3 - 2 * x);
}

/** Where each part is at `progress` (0 closed, 1 stowed): the phases overlap a little, as a real top's do. */
export function roofPose(progress: number, spec: FoldingRoofSpec): RoofPose {
	return {
		paneDrop: spec.paneDrop * ease(0, 0.28, progress),
		rearTurn: spec.rearTurn * ease(0.2, 0.8, progress),
		frontTurn: spec.frontTurn * ease(0.26, 0.86, progress),
		stow: spec.stow * ease(0.8, 1, progress),
	};
}

interface Rest {
	node: GraphNode;
	position: Vec3;
	rotation: Quat;
}

function rest(node: GraphNode): Rest {
	return { node, position: node.getLocalPosition().clone(), rotation: node.getLocalRotation().clone() };
}

export class FoldingRoof {
	/** Where it's heading: true to stowed. */
	public open = true;
	/** 0 closed, 1 stowed. */
	public progress = 1;
	private readonly turn = new Quat();
	private readonly rotation = new Quat();

	private constructor(
		private readonly spec: FoldingRoofSpec,
		private readonly rear: Rest,
		private readonly front: Rest,
		private readonly panes: Rest[],
	) {}

	/** The roof of a model built for one, or null if its nodes aren't there. */
	public static find(model: Entity, spec: FoldingRoofSpec): FoldingRoof | null {
		const rear = model.findByName(REAR_NODE);
		const front = model.findByName(FRONT_NODE);
		if (!rear || !front) return null;
		const panes = model.find((node) => PANE_NODE.test(node.name));
		const roof = new FoldingRoof(spec, rest(rear), rest(front), panes.map(rest));
		roof.apply();
		return roof;
	}

	public toggle(): void {
		this.open = !this.open;
	}

	/** Still moving. */
	public get moving(): boolean {
		return this.progress !== (this.open ? 1 : 0);
	}

	/** Moves it on by `dt` seconds; true if anything changed. */
	public update(dt: number): boolean {
		if (!this.moving) return false;
		const step = dt / ROOF_SECONDS;
		this.progress = this.open ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
		this.apply();
		return true;
	}

	private apply(): void {
		const pose = roofPose(this.progress, this.spec);
		this.place(this.rear, pose.rearTurn, -pose.stow);
		this.place(this.front, pose.frontTurn, 0);
		for (const pane of this.panes) this.place(pane, 0, -pose.paneDrop);
	}

	/** A part turned `degrees` about its own X axis and dropped `dy` from where it was built. */
	private place(part: Rest, degrees: number, dy: number): void {
		part.node.setLocalPosition(part.position.x, part.position.y + dy, part.position.z);
		this.turn.setFromEulerAngles(degrees, 0, 0);
		part.node.setLocalRotation(this.rotation.mul2(part.rotation, this.turn));
	}
}
