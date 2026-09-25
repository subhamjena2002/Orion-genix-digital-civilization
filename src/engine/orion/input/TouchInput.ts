/**
 * On-screen touch controls for phones and tablets. The controls (components/ui/TouchControls)
 * write here and the player controller reads it every frame, alongside the keyboard and mouse.
 * Like PlayerPose, a plain module value: the game never waits on React, and React never
 * re-renders per frame.
 *
 * Held controls (stick, fire, pedals) are levels. Taps (enter car, reload, weapon) are edges,
 * latched until the controller takes them, so a tap shorter than a frame is never lost.
 */

export interface TouchHeld {
	/** Left stick, -1..1 on each axis; +y is forward. Its length is how far it's pushed. */
	moveX: number;
	moveY: number;
	fire: boolean;
	jump: boolean;
	gas: boolean;
	brake: boolean;
	handbrake: boolean;
	/** Steering arrows, held. */
	steerLeft: boolean;
	steerRight: boolean;
}

export interface TouchEdges {
	fire: boolean;
	interact: boolean;
	reload: boolean;
	/** Weapon steps (+ next, - previous). */
	cycle: number;
	slot: number | null;
}

export type TouchHoldButton = "fire" | "jump" | "gas" | "brake" | "handbrake" | "steerLeft" | "steerRight";

/**
 * Degrees the camera turns for a drag across the screen's short side. Scaled to the screen,
 * so the same swipe turns the view as far on a phone as on a tablet.
 */
const LOOK_DEGREES_PER_SCREEN = 150;

const held: TouchHeld = { moveX: 0, moveY: 0, fire: false, jump: false, gas: false, brake: false, handbrake: false, steerLeft: false, steerRight: false };
const edges: TouchEdges = { fire: false, interact: false, reload: false, cycle: 0, slot: null };
const taken: TouchEdges = { fire: false, interact: false, reload: false, cycle: 0, slot: null };
const look = { x: 0, y: 0 };
const takenLook = { x: 0, y: 0 };

export function setTouchStick(x: number, y: number): void {
	held.moveX = x;
	held.moveY = y;
}

export function setTouchButton(button: TouchHoldButton, down: boolean): void {
	if (down && button === "fire" && !held.fire) edges.fire = true;
	held[button] = down;
}

export function pressTouch(action: "interact" | "reload"): void {
	edges[action] = true;
}

export function cycleTouchWeapon(step: number): void {
	edges.cycle += step;
}

export function selectTouchSlot(slot: number): void {
	edges.slot = slot;
}

/** A drag in CSS pixels, from the look area or from a held fire button. */
export function addTouchLook(dxPixels: number, dyPixels: number): void {
	const side = Math.max(1, Math.min(window.innerWidth, window.innerHeight));
	const scale = LOOK_DEGREES_PER_SCREEN / side;
	look.x += dxPixels * scale;
	// Opposite to the mouse: on a touch screen a swipe up is expected to look up.
	look.y -= dyPixels * scale;
}

export function readTouchHeld(): Readonly<TouchHeld> {
	return held;
}

/** This frame's look, in degrees, and clears it. */
export function takeTouchLook(): Readonly<{ x: number; y: number }> {
	takenLook.x = look.x;
	takenLook.y = look.y;
	look.x = 0;
	look.y = 0;
	return takenLook;
}

/** This frame's taps, and clears them. */
export function takeTouchEdges(): Readonly<TouchEdges> {
	Object.assign(taken, edges);
	edges.fire = false;
	edges.interact = false;
	edges.reload = false;
	edges.cycle = 0;
	edges.slot = null;
	return taken;
}

/**
 * Lets go of everything. Called when the controls go away or the page is hidden: a finger
 * lifted while the browser wasn't listening never sends its "up", and the car would keep
 * accelerating.
 */
export function releaseAllTouch(): void {
	held.moveX = 0;
	held.moveY = 0;
	held.fire = false;
	held.jump = false;
	held.gas = false;
	held.brake = false;
	held.handbrake = false;
	held.steerLeft = false;
	held.steerRight = false;
}
