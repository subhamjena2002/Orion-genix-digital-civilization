import type { RegisteredAsset } from "../assets/AssetRegistry";

export type PropCategory = "bench" | "trash-bin" | "bus-shelter" | "street-light" | "bollard" | "barrier" | "planter" | "sign" | "parking-meter" | "utility-box" | "traffic-signal";

export interface PropDefinition extends RegisteredAsset {
	category: PropCategory;
	scale: [number, number, number];
	collision: "none" | "box" | "compound";
}

const plannedProp = (id: string, category: PropCategory, scale: [number, number, number]): PropDefinition => ({
	id,
	category,
	assetPath: null,
	source: "unassigned local asset",
	license: "unverified",
	originalFilename: null,
	availability: "unavailable",
	scale,
	collision: category === "street-light" || category === "bollard" ? "box" : "none",
});

export const ORION_PROPS: readonly PropDefinition[] = [
	plannedProp("prop-bench-standard", "bench", [1.8, 0.8, 0.5]),
	plannedProp("prop-trash-bin-standard", "trash-bin", [0.5, 1, 0.5]),
	plannedProp("prop-bus-shelter-standard", "bus-shelter", [3, 2.5, 1.5]),
	plannedProp("prop-street-light-standard", "street-light", [0.5, 5, 0.5]),
	plannedProp("prop-bollard-standard", "bollard", [0.25, 0.9, 0.25]),
	plannedProp("prop-barrier-standard", "barrier", [2, 0.8, 0.25]),
	plannedProp("prop-planter-standard", "planter", [1.2, 0.7, 1.2]),
	plannedProp("prop-sign-standard", "sign", [0.5, 2.4, 0.2]),
	plannedProp("prop-parking-meter-standard", "parking-meter", [0.3, 1.2, 0.3]),
	plannedProp("prop-utility-box-standard", "utility-box", [0.8, 1, 0.5]),
	plannedProp("prop-traffic-signal-standard", "traffic-signal", [0.4, 4, 0.4]),
];