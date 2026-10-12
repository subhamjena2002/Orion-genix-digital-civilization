"use client";

import { useEffect, useRef } from "react";

/**
 * The night sky behind the landing page's hero: a drifting star field with the constellation
 * Orion — the game's namesake — drawn in, line by line, then pulsing gently. Canvas, so it costs
 * nothing to download; paused off screen and in a hidden tab; still for anyone who has asked for
 * reduced motion.
 */

interface Star {
	x: number;
	y: number;
	r: number;
	phase: number;
	speed: number;
}

/** Orion as it stands in the sky, in a unit box (x right, y down). */
const ORION = {
	meissa: [0.5, 0.06, 1.6, "#cfe1ff"],
	betelgeuse: [0.27, 0.22, 3.4, "#ffb070"],
	bellatrix: [0.7, 0.25, 2.4, "#d8e6ff"],
	mintaka: [0.59, 0.5, 2.1, "#e6efff"],
	alnilam: [0.5, 0.53, 2.4, "#e6efff"],
	alnitak: [0.41, 0.56, 2.2, "#e6efff"],
	saiph: [0.34, 0.88, 2.2, "#d8e6ff"],
	rigel: [0.74, 0.83, 3.4, "#a9c8ff"],
	sword1: [0.485, 0.66, 1.1, "#f3d8ff"],
	sword2: [0.5, 0.71, 1.5, "#ffc6ec"],
	sword3: [0.515, 0.76, 1.0, "#f3d8ff"],
} as const satisfies Record<string, readonly [number, number, number, string]>;

type StarName = keyof typeof ORION;

const LINES: readonly (readonly [StarName, StarName])[] = [
	["meissa", "betelgeuse"],
	["meissa", "bellatrix"],
	["betelgeuse", "alnitak"],
	["bellatrix", "mintaka"],
	["alnitak", "alnilam"],
	["alnilam", "mintaka"],
	["alnitak", "saiph"],
	["mintaka", "rigel"],
	["sword1", "sword2"],
	["sword2", "sword3"],
];

/** Seconds to draw each line in, one after another. */
const LINE_SECONDS = 0.45;

export function Constellation({ className }: Readonly<{ className?: string }>) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !context) return;
		const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let stars: Star[] = [];
		let width = 0;
		let height = 0;
		let frame = 0;
		let visible = true;
		const start = performance.now();

		const resize = () => {
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			width = canvas.clientWidth;
			height = canvas.clientHeight;
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			// About one star per 2,600 px², fewer on small screens.
			const count = Math.min(420, Math.round((width * height) / 2600));
			let seed = 7;
			const random = () => {
				seed = (seed * 16807) % 2147483647;
				return seed / 2147483647;
			};
			stars = Array.from({ length: count }, () => ({
				x: random() * width,
				y: random() * height,
				r: random() ** 3 * 1.4 + 0.25,
				phase: random() * Math.PI * 2,
				speed: 0.6 + random() * 1.6,
			}));
		};

		const draw = (now: number) => {
			const t = still ? 60 : (now - start) / 1000;
			context.clearRect(0, 0, width, height);

			// The field: faint, slowly drifting, twinkling.
			for (const star of stars) {
				const twinkle = 0.55 + 0.45 * Math.sin(t * star.speed + star.phase);
				const x = (star.x + t * 2.2 * star.r) % width;
				context.globalAlpha = 0.25 + 0.6 * twinkle * Math.min(1, star.r);
				context.fillStyle = "#dfe8ff";
				context.beginPath();
				context.arc(x, star.y, star.r, 0, Math.PI * 2);
				context.fill();
			}

			// Orion, upper right on wide screens; on narrow ones, low down behind the screenshot,
			// clear of the headline and the text.
			const narrow = width < 760;
			const size = Math.min(height * 0.82, narrow ? width * 0.9 : width * 0.42);
			const left = narrow ? (width - size) / 2 : width * 0.56;
			const top = narrow ? height - size * 1.05 : height * 0.08;
			const at = (name: StarName): [number, number] => [left + ORION[name][0] * size, top + ORION[name][1] * size];

			// The Orion Nebula: a soft glow in the sword.
			const [nx, ny] = at("sword2");
			const nebula = context.createRadialGradient(nx, ny, 0, nx, ny, size * 0.16);
			nebula.addColorStop(0, "rgba(255, 64, 160, 0.32)");
			nebula.addColorStop(0.45, "rgba(120, 60, 255, 0.12)");
			nebula.addColorStop(1, "rgba(0, 0, 0, 0)");
			context.globalAlpha = 1;
			context.fillStyle = nebula;
			context.beginPath();
			context.arc(nx, ny, size * 0.16, 0, Math.PI * 2);
			context.fill();

			// The lines, drawn in one by one, then breathing.
			context.lineCap = "round";
			LINES.forEach(([from, to], index) => {
				const progress = Math.max(0, Math.min(1, (t - 0.4 - index * LINE_SECONDS) / LINE_SECONDS));
				if (progress <= 0) return;
				const [ax, ay] = at(from);
				const [bx, by] = at(to);
				const x = ax + (bx - ax) * progress;
				const y = ay + (by - ay) * progress;
				const gradient = context.createLinearGradient(ax, ay, bx, by);
				gradient.addColorStop(0, "rgba(255, 70, 170, 0.75)");
				gradient.addColorStop(1, "rgba(80, 220, 255, 0.75)");
				context.globalAlpha = 0.55 + 0.25 * Math.sin(t * 1.3 + index);
				context.strokeStyle = gradient;
				context.lineWidth = 1.3;
				context.shadowColor = "rgba(255, 80, 190, 0.8)";
				context.shadowBlur = 10;
				context.beginPath();
				context.moveTo(ax, ay);
				context.lineTo(x, y);
				context.stroke();
			});
			context.shadowBlur = 0;

			// The stars themselves, with a glow scaled to their brightness.
			for (const name of Object.keys(ORION) as StarName[]) {
				const [, , radius, colour] = ORION[name];
				const [x, y] = at(name);
				const pulse = 1 + 0.18 * Math.sin(t * 2 + radius * 3);
				const glow = context.createRadialGradient(x, y, 0, x, y, radius * 7 * pulse);
				glow.addColorStop(0, colour);
				glow.addColorStop(0.25, `${colour}55`);
				glow.addColorStop(1, "rgba(0, 0, 0, 0)");
				context.globalAlpha = 1;
				context.fillStyle = glow;
				context.beginPath();
				context.arc(x, y, radius * 7 * pulse, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#ffffff";
				context.beginPath();
				context.arc(x, y, radius * 0.75, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;

			if (!still && visible && !document.hidden) frame = requestAnimationFrame(draw);
		};

		const kick = () => {
			cancelAnimationFrame(frame);
			if (visible && !document.hidden) frame = requestAnimationFrame(draw);
		};

		resize();
		draw(performance.now());
		const observer = new IntersectionObserver((entries) => {
			visible = entries.some((entry) => entry.isIntersecting);
			if (!still) kick();
		});
		observer.observe(canvas);
		const onResize = () => {
			resize();
			if (still) draw(performance.now());
		};
		const onVisibility = () => {
			if (!still) kick();
		};
		window.addEventListener("resize", onResize);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener("resize", onResize);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
