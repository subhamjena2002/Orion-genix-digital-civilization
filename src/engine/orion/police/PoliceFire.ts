import type { AppBase } from "playcanvas";

import { combatAudio } from "../combat/CombatAudio";
import { readCombatHud } from "../combat/CombatHud";
import { applyDamage, damageablesNear } from "../combat/CombatWorld";
import type { DamageEvent, DamageSourceRef } from "../combat/Damage";
import { readPlayerPose } from "../player/PlayerPose";
import { crashEffects } from "../traffic/CrashEffects";

/**
 * Police gunfire at the player, from a patrol car's window or an officer on foot: one set of
 * rules for both.
 *
 * What they carry goes with the wanted level. Pistols up to three stars; from four, assault
 * rifles — faster, harder-hitting and more accurate. Every shot is a real hit or a real miss
 * (a tracer and an impact where it lands), never damage out of nowhere.
 */

export interface PoliceGun {
	weapon: "pistol" | "rifle";
	/** Seconds between shots (each is varied ±20%). */
	interval: number;
	/** Damage to a player on foot, per hit. */
	damage: number;
	/** Damage to the car of a player who's driving, per hit. */
	carDamage: number;
	/** Chance a shot at a standing target hits, at point-blank range. */
	accuracy: number;
	/** Beyond this they don't fire. */
	range: number;
}

/** Officers open fire from this many stars; below it they only try to arrest. */
export const FIRE_FROM_STARS = 2;
/** Assault rifles from this many stars. */
export const RIFLES_FROM_STARS = 4;

export function policeGun(stars: number): PoliceGun {
	if (stars >= RIFLES_FROM_STARS) {
		return { weapon: "rifle", interval: stars >= 5 ? 0.42 : 0.55, damage: 11, carDamage: 5, accuracy: stars >= 5 ? 0.62 : 0.54, range: 55 };
	}
	return { weapon: "pistol", interval: stars >= 3 ? 1.15 : 1.35, damage: 8, carDamage: 3.5, accuracy: stars >= 3 ? 0.38 : 0.3, range: 38 };
}

export interface PlayerCarState {
	velocityX: number;
	velocityZ: number;
	applyDamage(amount: number): void;
}

/**
 * One shot from (x, y, z) at the player: sound, flash, tracer, and a hit or a miss decided by
 * the gun, the range and how fast the target is moving. Returns true if it hit.
 */
export function fireAtPlayer(
	app: AppBase,
	x: number,
	y: number,
	z: number,
	gun: PoliceGun,
	playerCar: PlayerCarState | null,
	shooter: DamageSourceRef,
	event: DamageEvent,
): boolean {
	if (readCombatHud().wasted) return false;
	const player = readPlayerPose();
	const distance = Math.hypot(player.x - x, player.z - z);
	if (distance > gun.range) return false;

	const chestY = player.y + (playerCar ? 0.9 : 1.3);
	const moving = playerCar ? Math.hypot(playerCar.velocityX, playerCar.velocityZ) : player.speed;
	const chance = gun.accuracy * (moving > 6 ? 0.6 : 1) * (playerCar ? 1.3 : 1) * (1 - distance / (gun.range * 1.6));
	const hit = Math.random() < chance;
	// A miss goes past, a metre or two wide.
	const spread = hit ? 0.15 : 1 + Math.random() * 1.5;
	const angle = Math.random() * Math.PI * 2;
	const endX = player.x + Math.cos(angle) * spread;
	const endZ = player.z + Math.sin(angle) * spread;
	const endY = chestY + (hit ? 0 : (Math.random() - 0.3) * 1.2);

	const effects = crashEffects(app);
	const length = Math.hypot(endX - x, endY - y, endZ - z) || 1;
	const dirX = (endX - x) / length;
	const dirY = (endY - y) / length;
	const dirZ = (endZ - z) / length;
	combatAudio().play(gun.weapon, x, y, z, 1);
	effects.muzzleFlash(x, y, z, dirX, dirY, dirZ, gun.weapon);
	effects.tracer(x, y, z, endX, endY, endZ);
	if (!hit) {
		effects.impact(endX, Math.max(endY, player.y + 0.05), endZ, -dirX, -dirY, -dirZ, "hard");
		return false;
	}
	if (playerCar) {
		playerCar.applyDamage(gun.carDamage);
		effects.impact(endX, endY, endZ, -dirX, -dirY, -dirZ, "metal");
		// Now and then a round finds the driver through the glass.
		if (Math.random() > 0.3) return true;
	} else {
		effects.impact(endX, endY, endZ, -dirX, -dirY, -dirZ, "flesh");
	}
	const target = damageablesNear(player.x, player.z, 2).find((candidate) => candidate.kind === "player");
	if (!target) return true;
	event.amount = gun.damage;
	event.type = gun.weapon === "rifle" ? "rifle" : "bullet";
	event.source = shooter;
	event.x = endX;
	event.y = endY;
	event.z = endZ;
	const flat = Math.hypot(dirX, dirZ) || 1;
	event.directionX = dirX / flat;
	event.directionZ = dirZ / flat;
	event.impulse = 0.4;
	applyDamage(target, event);
	return true;
}

/** Seconds to the next shot for this gun, varied so a group doesn't fire in step. */
export function nextShotDelay(gun: PoliceGun): number {
	return gun.interval * (0.8 + Math.random() * 0.4);
}
