"use client";

import { usePlayerPose } from "@/components/world/usePlayerPose";

const KMH_PER_MS = 3.6;
/** The dial's full sweep. */
const DIAL_MAX_KMH = 320;

/**
 * Bottom-centre controls strip, which changes with what the player is doing, plus a
 * speedometer while driving.
 */
export function DrivingHud() {
	const { inVehicle, vehicleSpeed, nearCar, vehicleIntegrity, vehicleBurning } = usePlayerPose(80);
	const kmh = Math.round(vehicleSpeed * KMH_PER_MS);
	const condition = Math.max(0, Math.round(vehicleIntegrity));

	return (
		<div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 sm:bottom-8">
			{inVehicle && vehicleBurning ? (
				<div className="orion-control-hint orion-alert" role="alert">
					Engine on fire — press <span className="orion-key">F</span> to get out
				</div>
			) : null}
			{inVehicle ? (
				<div className="orion-speedometer" role="status" aria-label={`${kmh} kilometres per hour, car ${condition}% condition`}>
					<span className="orion-speedometer-value">{kmh}</span>
					<span className="orion-speedometer-unit">km/h</span>
					<div className="orion-speedometer-bar" aria-hidden="true">
						<span style={{ width: `${Math.min(100, (kmh / DIAL_MAX_KMH) * 100)}%` }} />
					</div>
					<div className="orion-condition" aria-hidden="true">
						<span className="orion-condition-label">Condition</span>
						<div className="orion-condition-bar">
							<span
								className={condition < 22 ? "is-critical" : condition < 60 ? "is-warning" : ""}
								style={{ width: `${condition}%` }}
							/>
						</div>
						<span className="orion-condition-value">{condition}%</span>
					</div>
				</div>
			) : null}
			{!inVehicle && nearCar ? (
				<div className="orion-control-hint orion-control-hint-prompt" role="status">
					<HintKey keys={["F"]} label="Take car" />
				</div>
			) : null}
			<div className="hidden sm:block">
				<div className="orion-control-hint">
					{inVehicle ? (
						<>
							<HintKey keys={["W", "S"]} label="Drive" />
							<Separator />
							<HintKey keys={["A", "D"]} label="Steer" />
							<Separator />
							<HintKey keys={["Space"]} label="Handbrake" />
							<Separator />
							<HintKey keys={["F"]} label="Exit" />
						</>
					) : (
						<>
							<HintKey keys={["W", "A", "S", "D"]} label="Move" />
							<Separator />
							<HintKey keys={["Shift"]} label="Run" />
							<Separator />
							<HintKey keys={["Drag"]} label="Look" />
							<Separator />
							<HintKey keys={["Click"]} label="Attack" />
							<Separator />
							<HintKey keys={["1–6"]} label="Weapon" />
							<Separator />
							<HintKey keys={["R"]} label="Reload" />
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function Separator() {
	return <span className="text-[var(--oi-text-tertiary)]">·</span>;
}

function HintKey({ keys, label }: Readonly<{ keys: readonly string[]; label: string }>) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span className="inline-flex items-center gap-0.5">
				{keys.map((key) => <span key={key} className="orion-key">{key}</span>)}
			</span>
			<span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--oi-text-tertiary)]">{label}</span>
		</span>
	);
}
