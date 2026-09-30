import type { MissileSpec } from "./GunshipWeapons";

/**
 * The jet's weapons, as rules (the game script turns them into shots and missiles):
 *
 *  - Cannon: a 30 mm gun in the left wing root, fixed along the nose — aim the aircraft.
 *    22 rounds a second, 450 carried.
 *  - Missiles: four heat-seekers on the wing pylons. Point the nose at a target to lock it, then
 *    fire; the missile flies itself there. Without a lock it flies straight.
 *
 * Rearming happens parked on the airfield's apron.
 */

export type JetWeapon = "cannon" | "missiles";

export const JET_WEAPONS: readonly JetWeapon[] = ["cannon", "missiles"];

export const JET_WEAPON_NAMES: Readonly<Record<JetWeapon, string>> = {
	cannon: "30 mm cannon",
	missiles: "Heat-seekers",
};

export const JET_CANNON = {
	rounds: 450,
	/** Rounds a second. */
	rate: 22,
	range: 1800,
	/** Scatter, degrees. */
	spread: 0.3,
	damage: 55,
	splashRadius: 2.5,
	splashDamage: 22,
};

export const JET_MISSILES: MissileSpec & {
	count: number;
	interval: number;
	range: number;
	lifetime: number;
	proximity: number;
	explosionRadius: number;
	explosionDamage: number;
} = {
	count: 4,
	interval: 0.8,
	/** Hold the nose within this cone of a target, this long, and it locks. */
	lockCone: 7,
	lockSeconds: 1.2,
	/** A lock is kept while the target stays within this cone. */
	keepCone: 25,
	range: 2500,
	/** Drops clear, then the motor lights. */
	boost: 260,
	maxSpeed: 560,
	/** Turn capability, m/s². */
	maxTurn: 320,
	navigationGain: 4,
	lifetime: 9,
	proximity: 6,
	explosionRadius: 11,
	explosionDamage: 800,
};

export const JET_REARM_SECONDS = 5;

/** Pylons in firing order: outboard first, alternating sides, so the load stays balanced. */
const PYLON_ORDER = [0, 1, 2, 3];

export interface JetWeaponFire {
	/** Cannon rounds due this frame. */
	rounds: number;
	/** Pylon of a missile launched this frame, or -1. */
	missile: number;
	/** Pulled the trigger with nothing left. */
	empty: boolean;
}

export class JetArmament {
	public selected: JetWeapon = "cannon";
	public rounds = JET_CANNON.rounds;
	/** Missiles still on their pylons (0 outer left, 1 outer right, 2 inner left, 3 inner right). */
	public readonly pylons: boolean[] = Array.from({ length: JET_MISSILES.count }, () => true);
	private cooldown = 0;
	private cannonCarry = 0;
	private wasHeld = false;
	private readonly fire: JetWeaponFire = { rounds: 0, missile: -1, empty: false };

	public get missiles(): number {
		return this.pylons.filter(Boolean).length;
	}

	public ammo(weapon: JetWeapon = this.selected): number {
		return weapon === "cannon" ? this.rounds : this.missiles;
	}

	public get full(): boolean {
		return this.rounds === JET_CANNON.rounds && this.missiles === JET_MISSILES.count;
	}

	public select(weapon: JetWeapon): void {
		if (weapon === this.selected) return;
		this.selected = weapon;
		this.cannonCarry = 0;
	}

	public cycle(step: number): void {
		const index = JET_WEAPONS.indexOf(this.selected);
		const count = JET_WEAPONS.length;
		this.select(JET_WEAPONS[(((index + step) % count) + count) % count]);
	}

	public rearm(): void {
		this.rounds = JET_CANNON.rounds;
		this.pylons.fill(true);
		this.cooldown = 0;
	}

	/** One frame with the trigger `held`: the cannon at its rate while held, a missile per pull. */
	public update(dt: number, held: boolean): Readonly<JetWeaponFire> {
		const fire = this.fire;
		fire.rounds = 0;
		fire.missile = -1;
		fire.empty = false;
		this.cooldown = Math.max(0, this.cooldown - dt);
		const pulled = held && !this.wasHeld;
		this.wasHeld = held;
		if (!held) {
			this.cannonCarry = 0;
			return fire;
		}
		if (this.ammo() === 0) {
			fire.empty = pulled;
			return fire;
		}
		if (this.selected === "cannon") {
			if (pulled) this.cannonCarry = 1;
			else this.cannonCarry += dt * JET_CANNON.rate;
			const due = Math.min(Math.floor(this.cannonCarry), this.rounds);
			this.cannonCarry -= due;
			this.rounds -= due;
			fire.rounds = due;
		} else if (pulled && this.cooldown <= 0) {
			const pylon = PYLON_ORDER.find((index) => this.pylons[index]);
			if (pylon !== undefined) {
				this.pylons[pylon] = false;
				fire.missile = pylon;
				this.cooldown = JET_MISSILES.interval;
			}
		}
		return fire;
	}
}
