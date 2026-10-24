import type { Line, LineVoice } from "../missions/MissionDirector";
import { audioBus } from "./AudioBus";

/**
 * Mission dialogue said out loud with the browser's own speech (the Web Speech API): no recorded
 * lines and no files to download, so every line in the catalog is voiced the moment it's written.
 *
 * Each speaker is cast once and keeps their voice: one of the system's English voices (the
 * better-sounding "natural" ones first, where the system has them) and a pitch of their own, so
 * two people talking don't sound like one. The player's volume and mute apply (AudioBus), read
 * fresh for every line.
 *
 * Where speech isn't available, nothing is said and the subtitles carry on as before.
 */

/** Voices that sound like people rather than a reading machine, best first. */
const QUALITY = [/natural/i, /neural/i, /online/i, /google/i, /premium|enhanced/i];

/** Dispatchers and radio voices: brisk, a little flat. */
const RADIO = /dispatch|radio|control/i;

interface Casting {
	voice: SpeechSynthesisVoice | null;
	pitch: number;
	rate: number;
}

function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return h >>> 0;
}

function rank(voice: SpeechSynthesisVoice): number {
	const index = QUALITY.findIndex((pattern) => pattern.test(voice.name));
	return index < 0 ? QUALITY.length : index;
}

/** Turns the director's lines into speech, one at a time. */
export class MissionVoice implements LineVoice {
	private readonly synth: SpeechSynthesis;
	private voices: SpeechSynthesisVoice[] = [];
	private readonly cast = new Map<string, Casting>();
	private current: SpeechSynthesisUtterance | null = null;
	private busy = false;
	private readonly onVoices = () => this.loadVoices();

	public constructor(synth: SpeechSynthesis) {
		this.synth = synth;
		this.loadVoices();
		synth.addEventListener?.("voiceschanged", this.onVoices);
	}

	public speak(line: Line): void {
		const level = audioBus().dialogueLevel();
		this.synth.cancel();
		this.busy = false;
		if (level <= 0) return;
		const casting = this.casting(line.who);
		const utterance = new SpeechSynthesisUtterance(line.text);
		if (casting.voice) {
			utterance.voice = casting.voice;
			utterance.lang = casting.voice.lang;
		} else {
			utterance.lang = "en-GB";
		}
		utterance.pitch = casting.pitch;
		utterance.rate = casting.rate;
		utterance.volume = level;
		const done = () => {
			if (this.current === utterance) this.busy = false;
		};
		utterance.onend = done;
		utterance.onerror = done;
		this.current = utterance;
		this.busy = true;
		this.synth.speak(utterance);
	}

	public speaking(): boolean {
		return this.busy;
	}

	public stop(): void {
		this.busy = false;
		this.current = null;
		this.synth.cancel();
	}

	public dispose(): void {
		this.stop();
		this.synth.removeEventListener?.("voiceschanged", this.onVoices);
	}

	private loadVoices(): void {
		const english = this.synth.getVoices().filter((voice) => /^en(-|_|$)/i.test(voice.lang));
		// Best-sounding first; the same order on every load, so a speaker keeps their voice.
		this.voices = english.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
		this.cast.clear();
	}

	/** A speaker's voice and pitch: chosen once from their name, the same every time they speak. */
	private casting(who: string): Casting {
		let casting = this.cast.get(who);
		if (casting) return casting;
		const h = hash(who);
		const best = this.voices.filter((voice) => rank(voice) === rank(this.voices[0] ?? voice));
		const pool = best.length >= 2 ? best : this.voices;
		const radio = RADIO.test(who);
		casting = {
			voice: pool.length > 0 ? pool[h % pool.length] : null,
			// Spread across a natural range so voices that share an engine still sound like different people.
			pitch: radio ? 0.9 : 0.82 + ((h >>> 8) % 37) / 100,
			rate: radio ? 1.12 : 0.97 + ((h >>> 16) % 9) / 100,
		};
		this.cast.set(who, casting);
		return casting;
	}
}

/** The game's dialogue voice, or null where the browser can't speak. */
export function createMissionVoice(): MissionVoice | null {
	if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return null;
	return new MissionVoice(window.speechSynthesis);
}
