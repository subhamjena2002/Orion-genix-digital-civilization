/**
 * What the combat HUD shows, written by the game each frame and sampled by React on a timer —
 * like PlayerPose, a plain module value rather than React state, so the game never re-renders
 * the UI per frame.
 */
export interface CombatHudState {
	weaponId: string;
	weaponName: string;
	slot: number;
	magazine: number;
	magazineSize: number;
	reserve: number;
	reloading: boolean;
	reloadProgress: number;
	health: number;
	maxHealth: number;
	showCrosshair: boolean;
	slots: readonly { slot: number; name: string }[];
	/** The player is dead and about to respawn. */
	wasted: boolean;
	/** The player has been arrested and is about to be released. */
	busted: boolean;
}

const state: CombatHudState = {
	weaponId: "fists",
	weaponName: "Fists",
	slot: 1,
	magazine: 0,
	magazineSize: 0,
	reserve: 0,
	reloading: false,
	reloadProgress: 0,
	health: 100,
	maxHealth: 100,
	showCrosshair: false,
	slots: [],
	wasted: false,
	busted: false,
};

export function publishCombatHud(update: Omit<CombatHudState, "wasted" | "busted">): void {
	Object.assign(state, update);
}

export function setWasted(wasted: boolean): void {
	state.wasted = wasted;
}

export function setBusted(busted: boolean): void {
	state.busted = busted;
}

export function readCombatHud(): Readonly<CombatHudState> {
	return state;
}
