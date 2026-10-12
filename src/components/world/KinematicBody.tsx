"use client";

import { RigidBody } from "@playcanvas/react/components";
import { BODYMASK_NOT_STATIC_KINEMATIC } from "playcanvas";

/**
 * The physics body of something code moves (traffic, parked aircraft). It only needs to meet the
 * player's capsule: against the ground, buildings and other moved bodies there's no response,
 * yet Bullet would still work out every one of those contacts each step (~190 pairs with a city's
 * worth of traffic, against 4 without). Raycasts don't filter by group, so they still hit it.
 */
export function KinematicBody() {
	return <RigidBody type="kinematic" mask={BODYMASK_NOT_STATIC_KINEMATIC} />;
}
