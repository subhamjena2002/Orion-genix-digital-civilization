"use client";

import { useEffect, useState } from "react";

import { releasePointer } from "./pause";

import {
	applyAudioSettings,
	DEFAULT_AUDIO_SETTINGS,
	loadAudioSettings,
	saveAudioSettings,
	type AudioSettings,
} from "@/engine/orion/audio/AudioSettings";
import type { VehiclePart } from "@/engine/orion/audio/AudioBus";

/** The saved sound settings, and a way to change them: applied to the mix and saved at once. */
export function useAudioSettings(): [AudioSettings, (change: Partial<AudioSettings>) => void] {
	const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);

	useEffect(() => {
		const saved = loadAudioSettings();
		applyAudioSettings(saved);
		// Read on the client only: storage isn't there while rendering on the server.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setSettings(saved);
	}, []);

	const update = (change: Partial<AudioSettings>) => {
		const next = { ...settings, ...change };
		setSettings(next);
		applyAudioSettings(next);
		saveAudioSettings(next);
	};
	return [settings, update];
}

/** The vehicle mix, in the order the sliders are shown, with the label each one has. */
const VEHICLE_LEVELS: readonly (readonly [VehiclePart, string])[] = [
	["engines", "Engines"],
	["tyres", "Tyres"],
	["transmission", "Gearbox"],
	["sirens", "Sirens"],
	["collisions", "Crashes"],
];

function LevelRow({ label, value, onChange }: Readonly<{ label: string; value: number; onChange: (value: number) => void }>) {
	const percent = Math.round(value * 100);
	return (
		<label className="orion-sound-row">
			<span>{label}</span>
			<input
				type="range" min={0} max={100} step={1}
				value={percent}
				aria-valuetext={`${percent}%`}
				onChange={(event) => onChange(Number(event.target.value) / 100)}
			/>
			<output>{percent}</output>
		</label>
	);
}

/**
 * Master and effects volume, mute, and the vehicle mix: in the header's sound panel and the pause
 * menu's settings.
 */
export function SoundControls({ settings, update }: Readonly<{ settings: AudioSettings; update: (change: Partial<AudioSettings>) => void }>) {
	return (
		<>
			<LevelRow label="Master" value={settings.master} onChange={(master) => update({ master })} />
			<LevelRow label="Effects" value={settings.effects} onChange={(effects) => update({ effects })} />
			<label className="orion-sound-mute">
				<input type="checkbox" checked={settings.muted} onChange={(event) => update({ muted: event.target.checked })} />
				<span>Mute all sound</span>
			</label>
			<p className="orion-sound-group">Vehicles</p>
			{VEHICLE_LEVELS.map(([part, label]) => (
				<LevelRow
					key={part}
					label={label}
					value={settings.vehicles[part]}
					onChange={(value) => update({ vehicles: { ...settings.vehicles, [part]: value } })}
				/>
			))}
		</>
	);
}

/**
 * The sound button in the header: master and effects volume, mute, and the vehicle mix. Saved between visits
 * (AudioSettings), and put into the mix as soon as the page loads, before the first sound plays.
 */
export function SoundSettings() {
	const [open, setOpen] = useState(false);
	const [settings, update] = useAudioSettings();

	useEffect(() => {
		if (!open) return;
		// The cursor is needed on the sliders: let go of mouse-look.
		releasePointer();
		function handleKeyDown(event: KeyboardEvent) {
			if (event.code === "Escape") setOpen(false);
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [open]);

	const silent = settings.muted || settings.master === 0;

	return (
		<div className="relative">
			<button
				type="button"
				className="orion-icon-button orion-focus"
				aria-label="Sound settings"
				aria-expanded={open}
				title="Sound"
				onClick={() => setOpen((value) => !value)}
			>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
					{silent
						? <path d="m16 9.5 5 5M21 9.5l-5 5" />
						: <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
				</svg>
			</button>
			{open ? (
				<section className="orion-sound-panel" role="dialog" aria-label="Sound">
					<p className="orion-kicker">Sound</p>
					<SoundControls settings={settings} update={update} />
				</section>
			) : null}
		</div>
	);
}
