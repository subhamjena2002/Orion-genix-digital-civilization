import { Vec3, type AppBase } from "playcanvas";

import { crashEffects } from "../traffic/CrashEffects";
import { combatAudio } from "./CombatAudio";
import { applyDamage, broadcastDisturbance, damageablesNear } from "./CombatWorld";
import { makeDamageEvent, type DamageSourceRef } from "./Damage";
import { explosionFalloff } from "./HitTests";

/** People within this distance of a blast hear it and react. */
const HEARING_RADIUS = 90;

const event = makeDamageEvent();
const from = new Vec3();
const to = new Vec3();

interface PhysicsRaycast {
	raycastFirst(start: Vec3, end: Vec3): { point: Vec3 } | null;
}

/**
 * A blast at (x, y, z): the fireball, smoke, debris and shake (CrashEffects), the bang, damage to
 * everything within `radius` falling off with distance, and every bystander within earshot
 * reacting. The spatial grid means only what's actually nearby is looked at.
 */
export function detonate(app: AppBase, x: number, y: number, z: number, radius: number, damage: number, source: DamageSourceRef | null): void {
	const groundY = groundBelow(app, x, y, z);
	crashEffects(app).explosion(x, Math.max(y, groundY + 0.6), z, groundY);
	combatAudio().play("explosion", x, y, z, 1.4);

	event.type = "explosive";
	event.source = source;
	event.x = x;
	event.y = y;
	event.z = z;
	// Copied: damaging a car can set off another explosion, which reuses the query's array.
	const caught = [...damageablesNear(x, z, radius + 3)];
	for (const target of caught) {
		const closestY = Math.max(target.y, Math.min(y, target.y + target.height));
		const distance = Math.max(0, Math.hypot(target.x - x, closestY - y, target.z - z) - target.radius);
		const falloff = explosionFalloff(distance, radius);
		if (falloff <= 0) continue;
		const away = Math.hypot(target.x - x, target.z - z) || 1;
		event.amount = damage * falloff;
		event.directionX = (target.x - x) / away;
		event.directionZ = (target.z - z) / away;
		event.impulse = 4 + 10 * falloff;
		applyDamage(target, event);
	}
	broadcastDisturbance(x, z, HEARING_RADIUS, { id: source?.id ?? -1, x, z, attackable: false });
}

/** Height of whatever is under (x, z), found by a short physics ray; falls back to y - 0.6. */
export function groundBelow(app: AppBase, x: number, y: number, z: number): number {
	const physics = app.systems.rigidbody as unknown as PhysicsRaycast | undefined;
	from.set(x, y + 0.5, z);
	to.set(x, y - 30, z);
	const hit = physics?.raycastFirst?.(from, to);
	return hit ? hit.point.y : y - 0.6;
}
