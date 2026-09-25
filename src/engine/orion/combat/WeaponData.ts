import type { DamageType } from "./Damage";
import type { HoldStyleId } from "./HoldStyles";
import type { MeleeTiming } from "./MeleeAttack";

/**
 * Every weapon, as data. Behaviour comes from the weapon's `type`, not its identity: a new
 * pistol-like gun is a new entry here, not new code. Models, sounds and effects are referenced
 * by name and resolved by their own systems (WeaponModels, CombatAudio, CombatEffects), so art
 * can be swapped without touching the combat logic.
 *
 * Adding a weapon: add an id to WeaponId, an entry to WEAPONS with a free slot, and (optionally)
 * a model file in public/models/weapons/.
 */

export type WeaponId = "fists" | "sword" | "pistol" | "ar" | "shotgun" | "rocketLauncher";

/**
 * How the weapon works:
 * - unarmed / melee: a swing with a hit window (MeleeAttack), hits whatever is in its arc.
 * - hitscan: bullets resolve instantly along a ray (with spread and pellets).
 * - projectile: a real moving object (rocket) that hits something and explodes.
 */
export type WeaponType = "unarmed" | "melee" | "hitscan" | "projectile";

export type SoundId = "punch" | "swing" | "slash" | "pistol" | "rifle" | "shotgun" | "rocket" | "explosion" | "empty" | "reload" | "equip" | "impact" | "crash";
export type MuzzleEffect = "none" | "pistol" | "rifle" | "shotgun" | "rocket";
export type ImpactEffect = "punch" | "blade" | "bullet" | "explosion";
/** Player animation clips (see OrionSkinnedCharacterAnimation). */
export type AnimationRef = "Punch" | "SwordSlash" | "";

export interface WeaponModelSpec {
	/** File name under /models/weapons/. A missing file falls back to a placeholder shape. */
	file: string;
	/** Real overall length in metres; the model is scaled so its longest side matches. */
	length: number;
	/**
	 * Which way the business end points in the model's own axes. Left out, it's found from a
	 * node named like a muzzle, barrel or blade tip.
	 */
	muzzleAxis?: "+x" | "-x" | "+y" | "-y" | "+z" | "-z";
	/** Nodes that aren't part of the weapon itself (display stands, spare magazines, loose rounds). */
	hideNodes?: RegExp;
	/**
	 * Where the hand holds it, as a fraction along its length from the back (0) to the muzzle (1),
	 * and below the centre line (fraction of its height). Guns are held at the grip; blades at the hilt.
	 */
	grip: { along: number; below: number };
	/**
	 * Where the hands actually take hold, in metres in the fitted model's own space (grip at the
	 * origin, +x right, +y up, muzzle towards -z). Left out, the firing hand holds at the origin and
	 * the off hand where the hold style puts it. Real models have grips and handguards wherever
	 * their artist drew them, so the hands are told rather than guessed.
	 */
	hands?: { main?: readonly [number, number, number]; off?: readonly [number, number, number] };
	credit?: { author: string; licence: string; source: string };
}

export interface WeaponDefinition {
	id: WeaponId;
	name: string;
	type: WeaponType;
	/** How the player carries and aims it (see HoldStyles). */
	hold: HoldStyleId;
	/** Number key that selects it (1–7). */
	slot: number;
	/** Per hit, or per pellet. Explosions use `projectile.explosionDamage`. */
	damage: number;
	damageType: DamageType;
	/** Attacks per second. */
	fireRate: number;
	/** Keeps firing while held (automatic) or needs a press per shot. */
	automatic: boolean;
	/** Rounds per magazine; 0 for weapons that don't use ammunition. */
	magazineSize: number;
	/** Spare rounds carried at the start. */
	startingAmmo: number;
	reloadTime: number;
	/** How far it can hit, in metres. */
	range: number;
	/** Half-angle of the cone shots scatter in, in degrees. */
	spread: number;
	/** Pellets per shot (shotgun). */
	pellets: number;
	/** Camera kick per shot, in degrees. */
	recoil: { pitch: number; yaw: number };
	/** Knockback given to what's hit, in m/s. */
	impulse: number;
	/** Seconds to bring it up after switching; it can't attack meanwhile. */
	equipTime: number;
	melee?: MeleeTiming & { reach: number; arcDegrees: number };
	projectile?: { speed: number; gravity: number; lifetime: number; explosionRadius: number; explosionDamage: number };
	/** The player clip for an attack, and its playback rate (swings are timed to match it). */
	animations: { attack: AnimationRef; speed: number };
	sounds: { fire: SoundId; empty?: SoundId; reload?: SoundId; equip?: SoundId };
	effects: { muzzle: MuzzleEffect; impact: ImpactEffect; tracer: boolean };
	model: WeaponModelSpec | null;
	/** Model shown lying in the world as a pickup; null uses `model`. */
	pickupModel: string | null;
}

/** Slot 7 is kept free for a future weapon. */
export const RESERVED_SLOTS: readonly number[] = [7];

export const WEAPONS: readonly WeaponDefinition[] = [
	{
		id: "fists", name: "Fists", type: "unarmed", hold: "unarmed", slot: 1,
		damage: 14, damageType: "melee", fireRate: 2.2, automatic: false,
		magazineSize: 0, startingAmmo: 0, reloadTime: 0, range: 1.1, spread: 0, pellets: 1,
		recoil: { pitch: 0, yaw: 0 }, impulse: 1.6, equipTime: 0.15,
		// Man_Punch is 0.92 s; at 1.6x the fist lands ~0.2 s in, and the swing ends with the clip.
		melee: { windup: 0.2, active: 0.12, recovery: 0.25, cooldown: 0.05, reach: 1.1, arcDegrees: 55 },
		animations: { attack: "Punch", speed: 1.6 },
		sounds: { fire: "swing" },
		effects: { muzzle: "none", impact: "punch", tracer: false },
		model: null, pickupModel: null,
	},
	{
		id: "sword", name: "Sword", type: "melee", hold: "blade", slot: 2,
		damage: 48, damageType: "blade", fireRate: 1.4, automatic: false,
		magazineSize: 0, startingAmmo: 0, reloadTime: 0, range: 1.9, spread: 0, pellets: 1,
		recoil: { pitch: 0, yaw: 0 }, impulse: 2.2, equipTime: 0.35,
		// Man_SwordSlash is 1.04 s; at 1.3x the blade crosses the front ~0.28 s in.
		melee: { windup: 0.28, active: 0.16, recovery: 0.32, cooldown: 0.04, reach: 1.9, arcDegrees: 80 },
		animations: { attack: "SwordSlash", speed: 1.3 },
		sounds: { fire: "slash", equip: "equip" },
		effects: { muzzle: "none", impact: "blade", tracer: false },
		model: { file: "sword.glb", length: 1.0, grip: { along: 0.12, below: 0 }, hands: { main: [0, 0, 0.02] } },
		pickupModel: null,
	},
	{
		id: "pistol", name: "Pistol", type: "hitscan", hold: "pistol", slot: 3,
		damage: 30, damageType: "bullet", fireRate: 4, automatic: false,
		magazineSize: 12, startingAmmo: 72, reloadTime: 1.35, range: 70, spread: 0.9, pellets: 1,
		recoil: { pitch: 1.6, yaw: 0.4 }, impulse: 1.2, equipTime: 0.3,
		animations: { attack: "", speed: 1 },
		sounds: { fire: "pistol", empty: "empty", reload: "reload", equip: "equip" },
		effects: { muzzle: "pistol", impact: "bullet", tracer: false },
		model: { file: "pistol.glb", length: 0.2, grip: { along: 0.25, below: 0.35 }, hands: { main: [0, -0.03, 0.02] } },
		pickupModel: null,
	},
	{
		id: "ar", name: "Assault Rifle", type: "hitscan", hold: "rifle", slot: 4,
		damage: 24, damageType: "rifle", fireRate: 10, automatic: true,
		magazineSize: 30, startingAmmo: 210, reloadTime: 2.1, range: 140, spread: 1.4, pellets: 1,
		recoil: { pitch: 0.75, yaw: 0.35 }, impulse: 1.4, equipTime: 0.45,
		animations: { attack: "", speed: 1 },
		sounds: { fire: "rifle", empty: "empty", reload: "reload", equip: "equip" },
		effects: { muzzle: "rifle", impact: "bullet", tracer: true },
		model: {
			file: "ar.glb", length: 0.92, grip: { along: 0.3, below: 0.35 },
			// The pistol grip hangs below the receiver; the left hand cups the handguard from beneath.
			hands: { main: [0, -0.06, 0.03], off: [0, 0.04, -0.36] },
			// The source file also lays out a spare magazine and two loose rounds beside the rifle.
			hideNodes: /55645|mag empty/i,
			credit: { author: "D_U", licence: "CC-BY-4.0", source: "https://sketchfab.com/3d-models/low-poly-g95-a1-6e66f2cb28234868b06940669c7d388a" },
		},
		pickupModel: null,
	},
	{
		id: "shotgun", name: "Shotgun", type: "hitscan", hold: "shotgun", slot: 5,
		damage: 13, damageType: "buckshot", fireRate: 1.15, automatic: false,
		magazineSize: 6, startingAmmo: 42, reloadTime: 2.6, range: 38, spread: 5, pellets: 9,
		recoil: { pitch: 4.2, yaw: 1 }, impulse: 2.6, equipTime: 0.45,
		animations: { attack: "", speed: 1 },
		sounds: { fire: "shotgun", empty: "empty", reload: "reload", equip: "equip" },
		effects: { muzzle: "shotgun", impact: "bullet", tracer: false },
		model: { file: "shotgun.glb", length: 1.05, grip: { along: 0.3, below: 0.35 }, hands: { main: [0, -0.03, 0.02], off: [0, 0.005, -0.3] } },
		pickupModel: null,
	},
	{
		id: "rocketLauncher", name: "Rocket Launcher", type: "projectile", hold: "launcher", slot: 6,
		damage: 0, damageType: "explosive", fireRate: 0.7, automatic: false,
		magazineSize: 1, startingAmmo: 8, reloadTime: 2.4, range: 300, spread: 0.3, pellets: 1,
		recoil: { pitch: 5, yaw: 0.6 }, impulse: 0, equipTime: 0.7,
		projectile: { speed: 48, gravity: 1.2, lifetime: 6, explosionRadius: 8, explosionDamage: 240 },
		animations: { attack: "", speed: 1 },
		sounds: { fire: "rocket", empty: "empty", reload: "reload", equip: "equip" },
		effects: { muzzle: "rocket", impact: "explosion", tracer: false },
		model: { file: "rocket_launcher.glb", length: 1.2, grip: { along: 0.45, below: 0.4 }, hands: { main: [0, 0.02, 0], off: [0, 0.02, -0.28] } },
		pickupModel: null,
	},
];

export const WEAPON_MODEL_BASE = "/models/weapons";

export function weaponById(id: WeaponId): WeaponDefinition {
	const weapon = WEAPONS.find((candidate) => candidate.id === id);
	if (!weapon) throw new Error(`Unknown weapon ${id}`);
	return weapon;
}

export function weaponInSlot(slot: number): WeaponDefinition | null {
	return WEAPONS.find((weapon) => weapon.slot === slot) ?? null;
}

/** Checks the table's invariants: unique ids and slots, sane numbers, data for each type. */
export function validateWeapons(weapons: readonly WeaponDefinition[]): string[] {
	const problems: string[] = [];
	const ids = new Set<string>();
	const slots = new Set<number>();
	for (const weapon of weapons) {
		if (ids.has(weapon.id)) problems.push(`duplicate id ${weapon.id}`);
		if (slots.has(weapon.slot)) problems.push(`duplicate slot ${weapon.slot}`);
		if (RESERVED_SLOTS.includes(weapon.slot)) problems.push(`${weapon.id} uses reserved slot ${weapon.slot}`);
		ids.add(weapon.id);
		slots.add(weapon.slot);
		if (!(weapon.fireRate > 0)) problems.push(`${weapon.id} needs a positive fire rate`);
		if ((weapon.type === "melee" || weapon.type === "unarmed") && !weapon.melee) problems.push(`${weapon.id} needs melee timing`);
		if (weapon.type === "projectile" && !weapon.projectile) problems.push(`${weapon.id} needs projectile data`);
		if ((weapon.type === "hitscan" || weapon.type === "projectile") && !(weapon.magazineSize > 0)) problems.push(`${weapon.id} needs a magazine`);
	}
	return problems;
}
