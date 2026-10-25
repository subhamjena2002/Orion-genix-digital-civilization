import { VOICE_FILES } from "./VoiceManifest";

/**
 * Recorded dialogue: which mission lines have been performed (scripts/generate-voice-lines.ts,
 * with ElevenLabs) and where the recording is. A line is found by who says it and its exact
 * words, so a line rewritten in the catalog falls back to browser speech until it's recorded.
 */

/** The recordings' folder, under the site root. */
export const VOICE_BASE = "/audio/voice/";

/** A line's key: its speaker and words, hashed (FNV-1a, 32 bits, as hex). */
export function voiceLineKey(who: string, text: string): string {
	const source = `${who}\u0000${text}`;
	let h = 2166136261;
	for (let i = 0; i < source.length; i++) h = Math.imul(h ^ source.charCodeAt(i), 16777619);
	return (h >>> 0).toString(16).padStart(8, "0");
}

/** The URL of a line's recording, or null where it has none. */
export function recordedLine(who: string, text: string): string | null {
	const file = VOICE_FILES[voiceLineKey(who, text)];
	return file ? VOICE_BASE + file : null;
}
