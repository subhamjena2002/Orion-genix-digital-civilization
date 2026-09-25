import { RESERVED_SLOTS, type WeaponDefinition } from "./WeaponData";

/** What the player carries of one weapon. */
export interface CarriedWeapon {
	readonly definition: WeaponDefinition;
	/** Rounds in the magazine. */
	magazine: number;
	/** Spare rounds. */
	reserve: number;
}

export type FireResult = "fired" | "empty" | "busy";

/**
 * The weapons the player carries, which one is out, and the rules for using it: switching
 * takes the new weapon's equip time, reloading its reload time, shots are spaced by its fire
 * rate, and none of them overlap. Pure logic — input, models and effects live elsewhere.
 */
export class WeaponInventory {
	private readonly carried: CarriedWeapon[];
	private index: number;
	private equipLeft = 0;
	private reloadLeft = 0;
	private cooldownLeft = 0;

	public constructor(definitions: readonly WeaponDefinition[], startWith = definitions[0]?.id) {
		this.carried = [...definitions]
			.sort((a, b) => a.slot - b.slot)
			.map((definition) => ({ definition, magazine: definition.magazineSize, reserve: definition.startingAmmo }));
		this.index = Math.max(0, this.carried.findIndex((weapon) => weapon.definition.id === startWith));
	}

	public get current(): CarriedWeapon {
		return this.carried[this.index];
	}

	public get weapons(): readonly CarriedWeapon[] {
		return this.carried;
	}

	/** Bringing a weapon up. */
	public get switching(): boolean {
		return this.equipLeft > 0;
	}

	public get reloading(): boolean {
		return this.reloadLeft > 0;
	}

	/** 1 as a weapon starts coming up, falling to 0 once it's out. */
	public get equipProgress(): number {
		const time = this.current.definition.equipTime;
		return this.equipLeft > 0 && time > 0 ? Math.min(1, this.equipLeft / time) : 0;
	}

	/** 0..1 through the current reload, for the HUD. */
	public get reloadProgress(): number {
		const time = this.current.definition.reloadTime;
		return this.reloadLeft > 0 && time > 0 ? 1 - this.reloadLeft / time : 0;
	}

	/**
	 * Selects the weapon bound to `slot`. Returns false (and changes nothing) for an empty or
	 * reserved slot, or the slot already out.
	 */
	public selectSlot(slot: number): boolean {
		if (RESERVED_SLOTS.includes(slot)) return false;
		const index = this.carried.findIndex((weapon) => weapon.definition.slot === slot);
		if (index < 0 || index === this.index) return false;
		this.equip(index);
		return true;
	}

	/** The next (+1) or previous (-1) weapon, wrapping around. */
	public cycle(direction: 1 | -1): boolean {
		if (this.carried.length < 2) return false;
		this.equip((this.index + direction + this.carried.length) % this.carried.length);
		return true;
	}

	public update(dt: number): void {
		this.equipLeft = Math.max(0, this.equipLeft - dt);
		this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
		if (this.reloadLeft > 0) {
			this.reloadLeft -= dt;
			if (this.reloadLeft <= 0) {
				this.reloadLeft = 0;
				const weapon = this.current;
				const moved = Math.min(weapon.definition.magazineSize - weapon.magazine, weapon.reserve);
				weapon.magazine += moved;
				weapon.reserve -= moved;
			}
		}
	}

	/**
	 * Tries to attack with the current weapon. "busy" while switching, reloading or between
	 * shots; "empty" when out of rounds (a reload starts if there are spares); otherwise the
	 * round is spent and the next shot is timed.
	 */
	public fire(): FireResult {
		if (this.switching || this.reloading || this.cooldownLeft > 0) return "busy";
		const weapon = this.current;
		const usesAmmo = weapon.definition.magazineSize > 0;
		if (usesAmmo && weapon.magazine <= 0) {
			this.reload();
			// A click, then a pause before the next click.
			this.cooldownLeft = 0.25;
			return "empty";
		}
		if (usesAmmo) weapon.magazine--;
		this.cooldownLeft = 1 / weapon.definition.fireRate;
		return "fired";
	}

	/** Starts a reload if the magazine isn't full and there are spares. */
	public reload(): boolean {
		const weapon = this.current;
		if (this.reloading || this.switching || weapon.definition.magazineSize <= 0) return false;
		if (weapon.magazine >= weapon.definition.magazineSize || weapon.reserve <= 0) return false;
		this.reloadLeft = weapon.definition.reloadTime;
		return true;
	}

	/** Adds spare rounds (a pickup). */
	public addAmmo(id: string, rounds: number): void {
		const weapon = this.carried.find((candidate) => candidate.definition.id === id);
		if (weapon && rounds > 0) weapon.reserve += rounds;
	}

	private equip(index: number) {
		this.index = index;
		// Switching away abandons a reload in progress; the rounds stay where they were.
		this.reloadLeft = 0;
		this.cooldownLeft = 0;
		this.equipLeft = this.carried[index].definition.equipTime;
	}
}
