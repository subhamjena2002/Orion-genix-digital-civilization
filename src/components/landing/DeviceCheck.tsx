"use client";

import { useState } from "react";

import { PlayLink } from "./PlayLink";
import { ShareButton } from "./ShareButton";

/**
 * "Can your device run it?" — reads what the browser will tell us (WebGL 2, the graphics chip's
 * name, memory and CPU threads, the screen) and says which quality the game will most likely
 * settle on. Browsers hide some of it (Safari and Firefox don't report memory; some mask the
 * GPU), so the verdict leans on what's known and says so. The game tunes itself live anyway.
 */

type Tier = "ultra" | "high" | "medium" | "low" | "unsupported";

interface Scan {
	tier: Tier;
	gpu: string;
	gpuScore: number;
	memory: number | null;
	threads: number | null;
	screen: string;
	webgl2: boolean;
}

const TIERS: Readonly<Record<Tier, { label: string; line: string; colour: string }>> = {
	ultra: { label: "ULTRA READY", line: "Max settings: ambient occlusion, 4K shadows, 4× anti-aliasing. Go.", colour: "#4ade80" },
	high: { label: "HIGH", line: "Bloom, sharp shadows and smooth driving. You're set.", colour: "#22d3ee" },
	medium: { label: "MEDIUM", line: "Plays smoothly on balanced settings — the game tunes itself as you go.", colour: "#facc15" },
	low: { label: "PLAYABLE", line: "It'll run on lighter settings. Close other tabs for the smoothest ride.", colour: "#fb923c" },
	unsupported: { label: "NOT SUPPORTED", line: "This browser has no WebGL 2. Try the latest Chrome, Edge, Firefox or Safari.", colour: "#f87171" },
};

/**
 * The chip's own name out of what the browser reports:
 * "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "Intel Iris Xe Graphics",
 * "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)" → "Apple M1".
 */
export function gpuName(raw: string): string {
	let name = raw;
	const angle = /^ANGLE \((.*)\)$/i.exec(raw.trim());
	if (angle) {
		const parts = angle[1].split(", ");
		name = parts[1] ?? parts[0];
	}
	return name
		.replace(/^ANGLE Metal Renderer:\s*/i, "")
		.replace(/\s*\(0x[0-9a-f]+\)/gi, "")
		.replace(/\s+(Direct3D|OpenGL|Vulkan|Metal)\S*.*$/i, "")
		.replace(/\((R|TM)\)/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** The graphics chip's name, and a 0–3 rating of it. */
function readGpu(gl: WebGL2RenderingContext): { name: string; score: number } {
	const info = gl.getExtension("WEBGL_debug_renderer_info");
	const raw = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
	const name = gpuName(raw);
	const n = name.toLowerCase();
	if (/swiftshader|llvmpipe|software|basic render/.test(n)) return { name, score: 0 };
	if (/rtx|rx\s?[67]\d{3}|radeon pro|apple m\d (pro|max|ultra)|gtx\s?1[06][6-8]0|arc a7/.test(n)) return { name, score: 3 };
	if (/gtx|rx\s?[45]\d{2}|rx\s?5\d{3}|apple m\d|apple gpu|iris xe|radeon\(tm\) graphics|radeon graphics|vega|adreno.?7|arc/.test(n)) return { name, score: 2 };
	if (/uhd|hd graphics|iris|mali|adreno|powervr|apple/.test(n)) return { name, score: 1 };
	return { name, score: 1.5 };
}

function scanDevice(): Scan {
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl2");
	const nav = navigator as Navigator & { deviceMemory?: number };
	const memory = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
	const threads = typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null;
	const ratio = window.devicePixelRatio || 1;
	const screen = `${Math.round(window.screen.width * ratio)} × ${Math.round(window.screen.height * ratio)}`;
	if (!gl) return { tier: "unsupported", gpu: "No WebGL 2", gpuScore: 0, memory, threads, screen, webgl2: false };
	const gpu = readGpu(gl);
	gl.getExtension("WEBGL_lose_context")?.loseContext();
	if (gpu.score === 0) return { tier: "low", gpu: `${gpu.name} (software)`, gpuScore: 0, memory, threads, screen, webgl2: true };
	// Memory and threads only pull the verdict down; unknown counts as fine.
	let points = gpu.score;
	if (memory !== null && memory < 4) points -= 1;
	else if (memory !== null && memory < 8) points -= 0.5;
	if (threads !== null && threads < 4) points -= 1;
	else if (threads !== null && threads < 8) points -= 0.25;
	const tier: Tier = points >= 2.75 ? "ultra" : points >= 1.9 ? "high" : points >= 1.1 ? "medium" : "low";
	return { tier, gpu: gpu.name, gpuScore: gpu.score, memory, threads, screen, webgl2: true };
}

const STEPS = ["Graphics chip", "WebGL 2", "Memory", "CPU threads", "Display"];

export function DeviceCheck() {
	const [scan, setScan] = useState<Scan | null>(null);
	const [step, setStep] = useState(-1);

	const run = () => {
		setScan(null);
		setStep(0);
		// A beat per check: reading five values is instant, but a scan that looks like one lands better.
		STEPS.forEach((_, index) => window.setTimeout(() => setStep(index + 1), 260 * (index + 1)));
		window.setTimeout(() => {
			const result = scanDevice();
			setScan(result);
			setStep(-1);
			(window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.("event", "device_check", { tier: result.tier });
		}, 260 * (STEPS.length + 1));
	};

	const verdict = scan ? TIERS[scan.tier] : null;

	return (
		<div className="lp-check">
			<div className="lp-check-head">
				<div>
					<p className="lp-kicker">Live system check</p>
					<p className="lp-check-title">Will it run on <em>your</em> machine?</p>
				</div>
				<button type="button" className="lp-button lp-button-ghost" onClick={run} disabled={step >= 0}>
					{step >= 0 ? "Scanning…" : scan ? "Scan again" : "Scan my device"}
				</button>
			</div>

			{step >= 0 ? (
				<ol className="lp-check-steps" aria-live="polite">
					{STEPS.map((label, index) => (
						<li key={label} className={index < step ? "is-done" : index === step ? "is-active" : ""}>
							<span aria-hidden="true">{index < step ? "✓" : index === step ? "◌" : "·"}</span> {label}
						</li>
					))}
				</ol>
			) : null}

			{scan && verdict ? (
				<div className="lp-check-result" aria-live="polite">
					<p className="lp-check-verdict" style={{ color: verdict.colour, textShadow: `0 0 24px ${verdict.colour}66` }}>
						{verdict.label}
					</p>
					<p className="lp-check-line">{verdict.line}</p>
					<dl className="lp-check-specs">
						<div><dt>GPU</dt><dd>{scan.gpu}</dd></div>
						<div><dt>WebGL 2</dt><dd>{scan.webgl2 ? "Yes" : "No"}</dd></div>
						<div><dt>Memory</dt><dd>{scan.memory !== null ? `${scan.memory} GB${scan.memory >= 8 ? "+" : ""}` : "Not reported by this browser"}</dd></div>
						<div><dt>CPU threads</dt><dd>{scan.threads ?? "Not reported"}</dd></div>
						<div><dt>Screen</dt><dd>{scan.screen}</dd></div>
					</dl>
					<div className="lp-check-actions">
						{scan.tier !== "unsupported" ? (
							<PlayLink from="device-check">▶ Play now</PlayLink>
						) : null}
						<ShareButton
							label="Challenge a friend"
							text={`My device scored ${verdict.label} on OrionGenix — a free open-world game that runs in the browser. Can yours handle it?`}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}
