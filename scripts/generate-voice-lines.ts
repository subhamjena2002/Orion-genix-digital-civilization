/**
 * Records the mission dialogue with ElevenLabs, so the characters sound like people:
 *
 *     npx vite-node scripts/generate-voice-lines.ts            record what's new or changed
 *     npx vite-node scripts/generate-voice-lines.ts -- --dry   list it and count characters, record nothing
 *     npx vite-node scripts/generate-voice-lines.ts -- --only=Benny,Dez
 *
 * Needs ELEVENLABS_API_KEY, in the environment or in .env.local (never committed). Every line the
 * game can say is gathered from the catalog (objectives, triggers, cutscenes, endings, and each
 * giver's briefing as the director splits it), cast and directed from scripts/voice-direction.ts,
 * and recorded with the expressive eleven_v4 model. Writes public/audio/voice/*.mp3 and
 * src/engine/orion/audio/VoiceManifest.ts, which MissionVoice plays from.
 *
 * A recording is named after its speaker, words, voice and direction, so a run only pays for
 * lines that are new or changed, and drops recordings nothing says any more.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_MISSIONS } from "../src/engine/orion/missions/MissionCatalog";
import { briefingLines } from "../src/engine/orion/missions/Cutscenes";
import { voiceLineKey } from "../src/engine/orion/audio/VoiceLines";
import { CAST, DIRECTION } from "./voice-direction";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "public", "audio", "voice");
const MANIFEST = join(ROOT, "src", "engine", "orion", "audio", "VoiceManifest.ts");
const API = "https://api.elevenlabs.io/v1";
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_v4";
const FORMAT = "mp3_44100_128";
/** Requests at once: within the lower plans' concurrency limits. */
const PARALLEL = 2;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.find((arg) => arg.startsWith("--only="))?.slice(7).split(",").map((name) => name.trim());

interface Take {
	key: string;
	who: string;
	text: string;
	performance: string;
	voice: string;
	stability: number;
	file: string;
}

function apiKey(): string {
	if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
	const env = join(ROOT, ".env.local");
	if (existsSync(env)) {
		const match = /^\s*ELEVENLABS_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(readFileSync(env, "utf8"));
		if (match) return match[1].trim();
	}
	throw new Error("No ELEVENLABS_API_KEY: set it in the environment or add ELEVENLABS_API_KEY=... to .env.local");
}

/** Every line the game can say, once each. */
function gatherLines(): { who: string; text: string }[] {
	const lines = new Map<string, { who: string; text: string }>();
	const add = (who: string, text: string) => lines.set(voiceLineKey(who, text), { who, text });
	const walk = (value: unknown) => {
		if (Array.isArray(value)) return value.forEach(walk);
		if (!value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		if (typeof record.who === "string" && typeof record.text === "string") add(record.who, record.text);
		for (const field in record) walk(record[field]);
	};
	for (const mission of ALL_MISSIONS) {
		walk(mission);
		// The director only stages a briefing for a giver who stands in person.
		if (mission.giver.look && mission.briefing) {
			for (const line of briefingLines(mission.giver.speaker ?? mission.giver.name, mission.briefing)) add(line.who, line.text);
		}
	}
	return [...lines.values()];
}

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function plan(): Take[] {
	const takes: Take[] = [];
	const keys = new Map<string, string>();
	const missing = new Set<string>();
	for (const { who, text } of gatherLines()) {
		const casting = CAST[who];
		if (!casting) {
			missing.add(who);
			continue;
		}
		const key = voiceLineKey(who, text);
		const clash = keys.get(key);
		if (clash && clash !== `${who}|${text}`) throw new Error(`Two lines share key ${key}: "${clash}" and "${who}|${text}"`);
		keys.set(key, `${who}|${text}`);
		const performance = DIRECTION[text] ?? text;
		const stability = casting.stability ?? 0.5;
		const version = createHash("sha1").update([MODEL, casting.voice, stability, performance].join("\u0000")).digest("hex").slice(0, 8);
		takes.push({ key, who, text, performance, voice: casting.voice, stability, file: `${slug(who)}-${key}-${version}.mp3` });
	}
	if (missing.size > 0) throw new Error(`No voice cast for: ${[...missing].join(", ")} — add them to CAST in scripts/voice-direction.ts`);
	const spoken = new Set(takes.map((take) => take.text));
	for (const text of Object.keys(DIRECTION)) if (!spoken.has(text)) console.warn(`Direction for a line nothing says any more: "${text}"`);
	for (const take of takes) if (!(take.text in DIRECTION)) console.warn(`No direction, read plainly: ${take.who}: "${take.text}"`);
	return takes;
}

async function record(take: Take, key: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(`${API}/text-to-speech/${take.voice}?output_format=${FORMAT}`, {
			method: "POST",
			headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
			body: JSON.stringify({
				text: take.performance,
				model_id: MODEL,
				voice_settings: { stability: take.stability, similarity_boost: 0.8 },
			}),
		});
		if (response.ok) {
			writeFileSync(join(OUT, take.file), Buffer.from(await response.arrayBuffer()));
			return;
		}
		const detail = await response.text();
		if ((response.status === 429 || response.status >= 500) && attempt < 4) {
			await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
			continue;
		}
		throw new Error(`${take.who}: "${take.text}" — ElevenLabs ${response.status}: ${detail}`);
	}
}

async function checkVoices(key: string, takes: Take[]): Promise<void> {
	const response = await fetch(`${API}/voices`, { headers: { "xi-api-key": key } });
	if (!response.ok) throw new Error(`ElevenLabs ${response.status} listing voices: ${await response.text()}`);
	const { voices } = (await response.json()) as { voices: { voice_id: string; name: string }[] };
	const have = new Set(voices.map((voice) => voice.voice_id));
	const absent = [...new Set(takes.filter((take) => !have.has(take.voice)).map((take) => `${take.who} (${take.voice})`))];
	if (absent.length > 0) {
		console.warn(`Not in this account's voice list (recording will be tried anyway): ${absent.join(", ")}`);
		console.warn(`Available: ${voices.map((voice) => `${voice.name} ${voice.voice_id}`).join(", ")}`);
	}
}

function writeManifest(takes: Take[]): void {
	const done = takes.filter((take) => existsSync(join(OUT, take.file))).sort((a, b) => a.key.localeCompare(b.key));
	const entries = done.map((take) => `\t"${take.key}": "${take.file}",`).join("\n");
	writeFileSync(
		MANIFEST,
		[
			"// Written by scripts/generate-voice-lines.ts — do not edit by hand.",
			"// A line's key (VoiceLines.voiceLineKey) → its recording in public/audio/voice/.",
			done.length > 0 ? `export const VOICE_FILES: Readonly<Record<string, string>> = {\n${entries}\n};` : "export const VOICE_FILES: Readonly<Record<string, string>> = {};",
			"",
		].join("\n"),
	);
	console.log(`Manifest: ${done.length} of ${takes.length} lines recorded.`);
}

async function main(): Promise<void> {
	const takes = plan();
	mkdirSync(OUT, { recursive: true });
	const todo = takes.filter((take) => !existsSync(join(OUT, take.file)) && (!only || only.includes(take.who)));
	const characters = todo.reduce((sum, take) => sum + take.performance.length, 0);
	console.log(`${takes.length} lines; ${todo.length} to record (${characters} characters).`);
	if (dry) {
		for (const take of todo) console.log(`  ${take.who}: ${take.performance}`);
		return;
	}
	if (todo.length > 0) {
		const key = apiKey();
		await checkVoices(key, todo);
		let next = 0;
		let finished = 0;
		const failures: string[] = [];
		const worker = async () => {
			while (next < todo.length) {
				const take = todo[next++];
				try {
					await record(take, key);
					console.log(`[${++finished}/${todo.length}] ${take.who}: ${take.text}`);
				} catch (error) {
					failures.push(String(error instanceof Error ? error.message : error));
				}
			}
		};
		await Promise.all(Array.from({ length: PARALLEL }, worker));
		if (failures.length > 0) console.error(`${failures.length} failed:\n${failures.join("\n")}`);
	}
	// Recordings of lines nothing says any more, or of an old performance.
	const keep = new Set(takes.map((take) => take.file));
	for (const file of readdirSync(OUT)) {
		if (file.endsWith(".mp3") && !keep.has(file)) unlinkSync(join(OUT, file));
	}
	writeManifest(takes);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
