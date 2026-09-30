/**
 * The gunship's weapons, as rules: what's loaded, how fast each fires, the missile lock and how
 * a guided missile steers. The game script turns what this says into shots, rockets and
 * missiles in the world.
 *
 *  - Cannon: a 30 mm chain gun under the nose, slewed to wherever the gunner looks. Explosive
 *    rounds, 10 a second, 1,200 carried.
 *  - Rockets: two 19-tube pods, fired alternately along the nose. Unguided: aim the aircraft.
 *  - Missiles: eight, on the inner racks. Hold the sight on a target to lock, then fire; the
 *    missile flies itself there. Without a lock it flies straight.
 *
 * Rearming happens on the base's helipad.
 */

export type GunshipWeapon = "cannon" | "rockets" | "missiles";

export const GUNSHIP_WEAPONS: readonly GunshipWeapon[] = ["cannon", "rockets", "missiles"];

export const WEAPON_NAMES: Readonly<Record<GunshipWeapon, string>> = {
	cannon: "30 mm cannon",
	rockets: "Rockets",
	missiles: "Guided missiles",
};

export const CANNON = {
	rounds: 1200,
	/** Rounds a second (625 a minute). */
	rate: 10.4,
	range: 1500,
	/** Scatter, degrees. */
	spread: 0.35,
	damage: 60,
	splashRadius: 2.5,
	splashDamage: 25,
	/** How far the turret can slew: left/right, and up/down from level, degrees. */
	traverse: 86,
	elevation: 11,
	depression: 60,
	/** Degrees a second the turret slews. */
	slewRate: 120,
};

export const ROCKETS = {
	perPod: 19,
	interval: 0.13,
	speed: 240,
	gravity: 9.81,
	lifetime: 6,
	spread: 0.6,
	explosionRadius: 7,
	explosionDamage: 280,
};

/** How a guided missile locks and flies (the gunship's and the jet's differ). */
export interface MissileSpec {
	lockCone: number;
	lockSeconds: number;
	keepCone: number;
	boost: number;
	maxSpeed: number;
	maxTurn: number;
	navigationGain: number;
}

export const MISSILES = {
	count: 8,
	interval: 0.6,
	/** Holding the sight within this cone of a target, for this long, locks it. */
	lockCone: 5,
	lockSeconds: 1.1,
	/** A lock is kept while the target stays within this cone. */
	keepCone: 14,
	range: 1500,
	/** Drops off the rail, then the motor lights. */
	launchSpeed: 25,
	boost: 90,
	maxSpeed: 230,
	/** Turn capability, m/s². */
	maxTurn: 140,
	navigationGain: 4,
	lifetime: 12,
	proximity: 3,
	explosionRadius: 9,
	explosionDamage: 650,
};

export const REARM_SECONDS = 4;

export interface WeaponFire {
	/** Cannon rounds due this frame. */
	rounds: number;
	/** Pods to fire a rocket from this frame (0 left, 1 right). */
	rockets: number[];
	/** Rail index of a missile launched this frame, or -1. */
	missile: number;
	/** Pulled the trigger with nothing left. */
	empty: boolean;
}

export class GunshipArmament {
	public selected: GunshipWeapon = "cannon";
	public rounds = CANNON.rounds;
	public readonly pods = [ROCKETS.perPod, ROCKETS.perPod];
	/** Missiles still on their rails, by index. */
	public readonly rails: boolean[] = Array.from({ length: MISSILES.count }, () => true);
	private cooldown = 0;
	private nextPod = 0;
	private cannonCarry = 0;
	private wasHeld = false;
	private readonly fire: WeaponFire = { rounds: 0, rockets: [], missile: -1, empty: false };

	public get rockets(): number {
		return this.pods[0] + this.pods[1];
	}

	public get missiles(): number {
		return this.rails.filter(Boolean).length;
	}

	/** Rounds left of the selected weapon. */
	public ammo(weapon: GunshipWeapon = this.selected): number {
		return weapon === "cannon" ? this.rounds : weapon === "rockets" ? this.rockets : this.missiles;
	}

	public get full(): boolean {
		return this.rounds === CANNON.rounds && this.rockets === 2 * ROCKETS.perPod && this.missiles === MISSILES.count;
	}

	public select(weapon: GunshipWeapon): void {
		if (weapon === this.selected) return;
		this.selected = weapon;
		this.cannonCarry = 0;
	}

	public cycle(step: number): void {
		const index = GUNSHIP_WEAPONS.indexOf(this.selected);
		const count = GUNSHIP_WEAPONS.length;
		this.select(GUNSHIP_WEAPONS[(((index + step) % count) + count) % count]);
	}

	public rearm(): void {
		this.rounds = CANNON.rounds;
		this.pods[0] = this.pods[1] = ROCKETS.perPod;
		this.rails.fill(true);
		this.cooldown = 0;
	}

	/**
	 * One frame with the trigger `held`: what fires. The cannon keeps its own rate however the
	 * frames fall; rockets ripple from alternate pods while held; missiles go one per pull.
	 */
	public update(dt: number, held: boolean): Readonly<WeaponFire> {
		const fire = this.fire;
		fire.rounds = 0;
		fire.rockets.length = 0;
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
		switch (this.selected) {
			case "cannon": {
				// First round on the pull, then at the gun's rate.
				if (pulled) this.cannonCarry = 1;
				else this.cannonCarry += dt * CANNON.rate;
				const due = Math.min(Math.floor(this.cannonCarry), this.rounds);
				this.cannonCarry -= due;
				this.rounds -= due;
				fire.rounds = due;
				break;
			}
			case "rockets":
				while (this.cooldown <= 0 && this.rockets > 0) {
					const pod = this.pods[this.nextPod] > 0 ? this.nextPod : 1 - this.nextPod;
					this.pods[pod]--;
					fire.rockets.push(pod);
					this.nextPod = 1 - pod;
					this.cooldown += ROCKETS.interval;
				}
				break;
			case "missiles":
				if (pulled && this.cooldown <= 0) {
					// Outer rails first, alternating sides, so the load stays balanced.
					const rail = MISSILE_ORDER.find((index) => this.rails[index]);
					if (rail !== undefined) {
						this.rails[rail] = false;
						fire.missile = rail;
						this.cooldown = MISSILES.interval;
					}
				}
				break;
		}
		return fire;
	}
}

/** Firing order of the rails (see the model: 0–3 upper, 4–7 lower; odd outboard). */
const MISSILE_ORDER = [1, 3, 5, 7, 0, 2, 4, 6];

export type LockState = "none" | "locking" | "locked";

/** The missile sight: hold it on something to lock it. */
export class MissileLock {
	public state: LockState = "none";
	public targetId = -1;
	public progress = 0;

	public constructor(private readonly spec: Readonly<Pick<MissileSpec, "lockCone" | "lockSeconds" | "keepCone">> = MISSILES) {}

	/**
	 * `candidate` is the target nearest the sight's centre and its angle off it (degrees), or
	 * null. A lock holds while its target stays near the sight, and is lost past that.
	 */
	public update(dt: number, candidate: { id: number; angle: number } | null, lockedAngle: number | null): void {
		if (this.state === "locked") {
			const angle = lockedAngle ?? (candidate?.id === this.targetId ? candidate.angle : null);
			if (angle !== null && angle <= this.spec.keepCone) return;
			this.clear();
		}
		if (!candidate || candidate.angle > this.spec.lockCone) {
			this.progress = Math.max(0, this.progress - dt * 2);
			if (this.progress === 0) this.clear();
			return;
		}
		if (candidate.id !== this.targetId) {
			this.targetId = candidate.id;
			this.progress = 0;
		}
		this.progress += dt / this.spec.lockSeconds;
		this.state = "locking";
		if (this.progress >= 1) {
			this.progress = 1;
			this.state = "locked";
		}
	}

	public clear(): void {
		this.state = "none";
		this.targetId = -1;
		this.progress = 0;
	}
}

/** A missile in flight. */
export interface MissileState {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	age: number;
}

/**
 * One step of a guided missile: the motor accelerates it up to speed and proportional
 * navigation turns it — lateral acceleration proportional to how fast the line of sight to the
 * target is turning, so it leads a moving target instead of chasing its tail. `target` null
 * flies it straight.
 */
export function guideMissile(missile: MissileState, target: { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null, dt: number, spec: Readonly<MissileSpec> = MISSILES): void {
	const speed = Math.hypot(missile.vx, missile.vy, missile.vz) || 1;
	const dirX = missile.vx / speed;
	const dirY = missile.vy / speed;
	const dirZ = missile.vz / speed;
	let ax = 0;
	let ay = 0;
	let az = 0;
	// Motor: a moment off the rail, then boost to top speed.
	if (missile.age > 0.25 && speed < spec.maxSpeed) {
		ax += dirX * spec.boost;
		ay += dirY * spec.boost;
		az += dirZ * spec.boost;
	}
	if (missile.age < 0.25) ay -= 9.81;
	if (target && missile.age > 0.25) {
		const rx = target.x - missile.x;
		const ry = target.y - missile.y;
		const rz = target.z - missile.z;
		const range2 = Math.max(rx * rx + ry * ry + rz * rz, 1);
		const wx = target.vx - missile.vx;
		const wy = target.vy - missile.vy;
		const wz = target.vz - missile.vz;
		// Line-of-sight rotation Ω = (r × v_rel) / |r|²; command a = N · V_close · (Ω × r̂)…
		// in its common form: a = N · (v_rel − (v_rel · r̂) r̂) · (closing / |r|) turned into the
		// component across the missile's heading.
		const range = Math.sqrt(range2);
		const lx = rx / range;
		const ly = ry / range;
		const lz = rz / range;
		const closing = -(wx * lx + wy * ly + wz * lz);
		const ox = (ry * wz - rz * wy) / range2;
		const oy = (rz * wx - rx * wz) / range2;
		const oz = (rx * wy - ry * wx) / range2;
		// a = N · Vc · (Ω × r̂)
		let cx = spec.navigationGain * Math.max(closing, speed * 0.5) * (oy * lz - oz * ly);
		let cy = spec.navigationGain * Math.max(closing, speed * 0.5) * (oz * lx - ox * lz);
		let cz = spec.navigationGain * Math.max(closing, speed * 0.5) * (ox * ly - oy * lx);
		// Early on, a pull towards the target too, so it swings round from the rail.
		const along = dirX * lx + dirY * ly + dirZ * lz;
		const pull = (1 - along) * 60;
		cx += (lx - dirX * along) * pull;
		cy += (ly - dirY * along) * pull;
		cz += (lz - dirZ * along) * pull;
		// Only across the heading, and no harder than the airframe can turn.
		const across = cx * dirX + cy * dirY + cz * dirZ;
		cx -= across * dirX;
		cy -= across * dirY;
		cz -= across * dirZ;
		const magnitude = Math.hypot(cx, cy, cz);
		const scale = magnitude > spec.maxTurn ? spec.maxTurn / magnitude : 1;
		ax += cx * scale;
		ay += cy * scale;
		az += cz * scale;
	}
	missile.vx += ax * dt;
	missile.vy += ay * dt;
	missile.vz += az * dt;
	missile.x += missile.vx * dt;
	missile.y += missile.vy * dt;
	missile.z += missile.vz * dt;
	missile.age += dt;
}
