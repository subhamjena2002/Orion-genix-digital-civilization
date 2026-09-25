import type { GraphicsDevice, Mesh } from "playcanvas";

import { MeshBuilder } from "../rendering/MeshBuilder";
import { ROAD_TOP_Y } from "../traffic/TrafficSignals";
import { RAIL_BED_WIDTH, RAIL_GAUGE, RAIL_LENGTH, RAIL_TOP_Y, railPoseAt } from "./RailLine";

/**
 * The track and the level-crossing hardware, built from boxes rather than loaded.
 *
 * The supplied track model is 656k triangles for a 35 m section; the loop is 1.2 km, so laying
 * it would be roughly 24 million triangles of gravel. A rail is an extruded profile and a
 * sleeper is a block, so the whole loop — bed, sleepers and both rails — comes to about 45k
 * triangles built here, and follows the curves at the corners instead of being cut into
 * straight sections.
 */

/** Ground levels. The terrain plane is -0.65 and the top of the asphalt is ROAD_TOP_Y. */
const BED_TOP = -0.6;
const BED_BOTTOM = -0.92;
const SLEEPER_TOP = -0.58;
const SLEEPER_LENGTH = 2.6;
const SLEEPER_HEIGHT = 0.16;
const SLEEPER_WIDTH = 0.26;
const SLEEPER_SPACING = 0.65;
const RAIL_FOOT = -0.58;
const RAIL_WIDTH = 0.09;

/**
 * Everything below the railhead sits under the surface of the road, so at a crossing the
 * asphalt covers the bed and the sleepers and only the rails show — which is what a level
 * crossing looks like, with no special case for the crossings themselves.
 */
const BALLAST_COLOUR = "#4a4742";
const SLEEPER_COLOUR = "#3a342e";

/** How the track is divided up for drawing, so the far side of the city can be culled away. */
const CHUNK_LENGTH = 60;
/** Boxes this long are laid end to end along the route; short enough to follow the curves. */
const PIECE_LENGTH = 2;
/** Pieces overlap slightly so no seam opens up on the outside of a curve. */
const PIECE_OVERLAP = 1.08;

export interface TrackChunk {
	/** Ballast and sleepers — matte, vertex-coloured. */
	bed: Mesh;
	/** The two running rails — steel. */
	rails: Mesh;
	/** Centre of the chunk, for reference when placing it. */
	centre: { x: number; z: number };
}

/**
 * The whole loop as a handful of chunks. Positions are already in world space, so each chunk's
 * entity sits at the origin; splitting it up is only so the renderer can cull what is behind
 * the player.
 */
export function buildTrack(device: GraphicsDevice): TrackChunk[] {
	const chunks: TrackChunk[] = [];
	const chunkCount = Math.max(1, Math.round(RAIL_LENGTH / CHUNK_LENGTH));
	const chunkLength = RAIL_LENGTH / chunkCount;
	const railOffset = RAIL_GAUGE / 2;

	for (let index = 0; index < chunkCount; index++) {
		const from = index * chunkLength;
		const to = from + chunkLength;
		const bed = new MeshBuilder();
		const rails = new MeshBuilder();

		bed.withColour(BALLAST_COLOUR);
		for (let along = from; along < to; along += PIECE_LENGTH) {
			const pose = railPoseAt(along + PIECE_LENGTH / 2);
			bed.addBox([pose.x, (BED_TOP + BED_BOTTOM) / 2, pose.z], [RAIL_BED_WIDTH, BED_TOP - BED_BOTTOM, PIECE_LENGTH * PIECE_OVERLAP], pose.heading);
		}

		bed.withColour(SLEEPER_COLOUR);
		// Sleepers are laid on their own spacing, independent of how the bed is chopped up.
		const firstSleeper = Math.ceil(from / SLEEPER_SPACING) * SLEEPER_SPACING;
		for (let along = firstSleeper; along < to; along += SLEEPER_SPACING) {
			const pose = railPoseAt(along);
			bed.addBox([pose.x, SLEEPER_TOP - SLEEPER_HEIGHT / 2, pose.z], [SLEEPER_LENGTH, SLEEPER_HEIGHT, SLEEPER_WIDTH], pose.heading);
		}

		for (let along = from; along < to; along += PIECE_LENGTH) {
			const pose = railPoseAt(along + PIECE_LENGTH / 2);
			// Square to the track, so the pair stays a gauge apart all the way round a curve.
			const acrossX = Math.cos((pose.heading * Math.PI) / 180);
			const acrossZ = -Math.sin((pose.heading * Math.PI) / 180);
			for (const side of [-1, 1]) {
				rails.addBox(
					[pose.x + acrossX * railOffset * side, (RAIL_TOP_Y + RAIL_FOOT) / 2, pose.z + acrossZ * railOffset * side],
					[RAIL_WIDTH, RAIL_TOP_Y - RAIL_FOOT, PIECE_LENGTH * PIECE_OVERLAP],
					pose.heading,
				);
			}
		}

		const centre = railPoseAt((from + to) / 2);
		chunks.push({ bed: bed.build(device), rails: rails.build(device), centre: { x: centre.x, z: centre.z } });
	}
	return chunks;
}

/** Level-crossing hardware. Sizes are shared with Railway.tsx, which places it. */
export const BARRIER = {
	/** Distance from the track centreline to the barrier, along the road. */
	setback: RAIL_BED_WIDTH / 2 + 2.5,
	/** Top of the post itself; the mast carrying the lamps goes on above it. */
	postTop: 1.37,
	mastTop: 1.8,
	postWidth: 0.22,
	/** Height of the pivot the boom swings about. */
	pivotHeight: 1.2,
	boomDepth: 0.2,
	boomWidth: 0.14,
	/** Length of each red/white band along the boom. */
	stripe: 1,
	/** How far past the road centreline the boom reaches. */
	overhang: 0.6,
	/** How far outside the kerb the post stands. */
	kerbClearance: 1,
	/** Angle (degrees about Z) the boom stands at when the crossing is open. */
	raisedAngle: 84,
	lampHeight: 1.58,
	lampSize: 0.17,
	lampSpacing: 0.36,
} as const;

const POST_COLOUR = "#d8d5cd";
const POST_BASE_COLOUR = "#2c2f33";
const BOOM_RED = "#c8201c";
const BOOM_WHITE = "#eceae2";

/** The post a boom swings on, standing on the road surface with its base at y = 0. */
export function buildBarrierPost(device: GraphicsDevice): Mesh {
	const post = new MeshBuilder();
	post.withColour(POST_BASE_COLOUR).addBox([0, 0.06, 0], [0.5, 0.12, 0.5]);
	post.withColour(POST_COLOUR).addBox([0, (0.12 + BARRIER.postTop) / 2, 0], [BARRIER.postWidth, BARRIER.postTop - 0.12, BARRIER.postWidth]);
	post.withColour(POST_BASE_COLOUR).addBox([0, (BARRIER.postTop + BARRIER.mastTop) / 2, 0], [0.1, BARRIER.mastTop - BARRIER.postTop, 0.1]);
	return post.build(device);
}

/**
 * A boom pivoting about the origin and reaching out along +X, striped red and white. The entity
 * holding it is turned so +X lies across the carriageway, and rolled about Z to raise it.
 */
export function buildBoom(device: GraphicsDevice, length: number): Mesh {
	const boom = new MeshBuilder();
	for (let along = 0; along < length; along += BARRIER.stripe) {
		const piece = Math.min(BARRIER.stripe, length - along);
		boom.withColour((along / BARRIER.stripe) % 2 === 0 ? BOOM_RED : BOOM_WHITE);
		boom.addBox([along + piece / 2, 0, 0], [piece, BARRIER.boomDepth, BARRIER.boomWidth]);
	}
	// A counterweight behind the pivot, which is what actually swings these things.
	boom.withColour(POST_BASE_COLOUR).addBox([-0.35, 0, 0], [0.7, 0.26, 0.26]);
	return boom.build(device);
}

/** The pair of warning lamps on a post, centred on the lamp head and spread along local X. */
export function buildBarrierLamps(device: GraphicsDevice): Mesh {
	const lamps = new MeshBuilder();
	for (const side of [-1, 1]) {
		lamps.addBox([(side * BARRIER.lampSpacing) / 2, 0, 0], [BARRIER.lampSize, BARRIER.lampSize, BARRIER.lampSize]);
	}
	return lamps.build(device);
}

export const BARRIER_GROUND_Y = ROAD_TOP_Y;
