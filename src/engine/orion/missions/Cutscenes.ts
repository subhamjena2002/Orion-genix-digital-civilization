import type { Line } from "./MissionDirector";

/**
 * Cutscenes: the camera taken off the player for a few shots while people talk. A giver's
 * briefing, a crew looking over the target, the moment the alarm goes. They're written as data in
 * the catalog (a mission's `opening`, an objective's or a trigger's `scene`), and every giver who
 * stands in person gets one for their briefing (`briefingScene`). The director plays them, holding
 * each shot until its lines have been said, and the game's camera follows the shot (MissionRuntime
 * works out where from `shotView`; the player controller puts the camera there).
 */

/** Who or what a shot is on: "player", "giver", a mission car or person by id, or a spot. */
export type ShotSubject = string | { x: number; z: number };

export interface Shot {
	on: ShotSubject;
	/** Over this one's shoulder, onto `on`: a conversation. Otherwise the camera stands by `angle`. */
	over?: ShotSubject;
	/**
	 * Where the camera stands, in degrees round the subject from the player's side of it (0:
	 * between the two, looking at the subject; 180: beyond it, looking back at the player). On the
	 * player themselves, from where the game's camera was.
	 */
	angle?: number;
	/** How far from the subject, metres. */
	distance?: number;
	/** How high above the ground, metres. */
	height?: number;
	/** Turns this many degrees further round over the shot: a slow orbit. */
	orbit?: number;
	/** Ends this much closer (a push-in); negative pulls out. */
	push?: number;
	/** On screen at least this long, seconds; a shot with lines stays until they've been said. */
	seconds?: number;
	say?: readonly Line[];
}

export interface Cutscene {
	shots: readonly Shot[];
	/**
	 * The last shot stays up until something else ends the scene: a briefing waiting on an
	 * answer. Such a scene can't be skipped either.
	 */
	hold?: boolean;
}

/** A subject in the world: where it is and how high to look (a person's head, a car's roof). */
export interface ShotPlace {
	x: number;
	z: number;
	height: number;
}

export interface ShotContext {
	/** Where a subject is now, or null if it isn't in the world. */
	locate(subject: ShotSubject): ShotPlace | null;
	player: { x: number; z: number };
	/** Where the game's camera was when the scene began. */
	camera: { x: number; z: number };
}

/** Points above the ground: the camera, and what it looks at. */
export interface ShotView {
	fromX: number;
	fromZ: number;
	fromHeight: number;
	atX: number;
	atZ: number;
	atHeight: number;
}

/** Behind the shoulder of the one in the foreground, and off to their right. */
const SHOULDER_BACK = 1.7;
const SHOULDER_SIDE = 0.55;
/** Shots without a distance stand this far off, by how tall the subject is (a person, a car, a spot). */
const PERSON_DISTANCE = 4;
const VEHICLE_DISTANCE = 7;
const SPOT_DISTANCE = 10;
/** Never closer than this to what it's looking at. */
const MIN_DISTANCE = 1.2;

/** Eases in and out, so a move starts and settles gently. */
function smooth(progress: number): number {
	const p = Math.min(1, Math.max(0, progress));
	return p * p * (3 - 2 * p);
}

function defaultDistance(place: ShotPlace): number {
	if (place.height > 1.3 && place.height < 2) return PERSON_DISTANCE;
	return place.height <= 1.3 ? VEHICLE_DISTANCE : SPOT_DISTANCE;
}

/**
 * Where the camera stands for a shot, `progress` (0..1) of the way through it. Null when what it's
 * on isn't in the world (a car not placed yet), so the game's own camera carries on.
 */
export function shotView(shot: Shot, progress: number, context: ShotContext): ShotView | null {
	const subject = context.locate(shot.on);
	if (!subject) return null;
	const move = smooth(progress);
	const over = shot.over !== undefined ? context.locate(shot.over) : null;
	if (over) {
		const dx = subject.x - over.x;
		const dz = subject.z - over.z;
		const apart = Math.hypot(dx, dz);
		if (apart > 0.3) {
			const ux = dx / apart;
			const uz = dz / apart;
			// Behind the near one, a little to their right, leaning in over the shot.
			const back = SHOULDER_BACK - (shot.push ?? 0.25) * move;
			return {
				fromX: over.x - ux * back - uz * SHOULDER_SIDE,
				fromZ: over.z - uz * back + ux * SHOULDER_SIDE,
				fromHeight: shot.height ?? over.height + 0.15,
				atX: subject.x,
				atZ: subject.z,
				atHeight: subject.height - 0.05,
			};
		}
	}
	// Round from the player's side: from the subject towards the player, or for the player, towards the camera.
	let rx = context.player.x - subject.x;
	let rz = context.player.z - subject.z;
	if (Math.hypot(rx, rz) < 0.5) {
		rx = context.camera.x - subject.x;
		rz = context.camera.z - subject.z;
	}
	const reach = Math.hypot(rx, rz);
	if (reach < 1e-3) {
		rx = 0;
		rz = -1;
	} else {
		rx /= reach;
		rz /= reach;
	}
	const turn = (((shot.angle ?? 0) + (shot.orbit ?? 0) * move) * Math.PI) / 180;
	const cos = Math.cos(turn);
	const sin = Math.sin(turn);
	const dirX = rx * cos - rz * sin;
	const dirZ = rx * sin + rz * cos;
	const distance = Math.max(MIN_DISTANCE, (shot.distance ?? defaultDistance(subject)) - (shot.push ?? 0) * move);
	return {
		fromX: subject.x + dirX * distance,
		fromZ: subject.z + dirZ * distance,
		fromHeight: shot.height ?? subject.height + 0.4,
		atX: subject.x,
		atZ: subject.z,
		atHeight: subject.height * 0.85,
	};
}

/** Lines no longer than about this many characters: a sentence or two each. */
const BRIEFING_LINE_CHARACTERS = 150;

/** A briefing broken into lines the giver says one at a time. */
export function briefingLines(who: string, briefing: string): Line[] {
	const sentences = briefing.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [briefing];
	const lines: Line[] = [];
	let text = "";
	for (const sentence of sentences) {
		const next = sentence.trim();
		if (!next) continue;
		if (text && text.length + next.length + 1 > BRIEFING_LINE_CHARACTERS) {
			lines.push({ who, text });
			text = next;
		} else {
			text = text ? `${text} ${next}` : next;
		}
	}
	if (text) lines.push({ who, text });
	return lines;
}

/**
 * A giver's briefing, played as a conversation: a wide shot of them as they start, then over the
 * player's shoulder and from the side in turn, a line or so each, and held over the shoulder
 * until the player answers.
 */
export function briefingScene(who: string, briefing: string): Cutscene {
	const lines = briefingLines(who, briefing);
	const shots: Shot[] = [{ on: "giver", angle: 32, distance: 5.6, height: 2.1, orbit: 10, push: 1.4, say: lines.slice(0, 1), seconds: 2.5 }];
	for (let index = 1; index < lines.length; index++) {
		shots.push(index % 2 === 1
			? { on: "giver", over: "player", say: [lines[index]] }
			: { on: "giver", angle: -72, distance: 3.1, height: 1.65, orbit: -8, say: [lines[index]] });
	}
	// The answer's awaited over the shoulder.
	const last = shots[shots.length - 1];
	if (!last.over) shots.push({ on: "giver", over: "player", push: 0.4, seconds: 1 });
	return { shots, hold: true };
}
