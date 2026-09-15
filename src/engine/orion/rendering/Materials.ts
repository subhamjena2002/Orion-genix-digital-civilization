export interface PbrMaterialDefinition {
	id: string;
	baseColor: string;
	roughness: number;
	metalness: number;
	textureScale: number;
	weathering: "none" | "subtle" | "moderate";
}

export const ORION_MATERIALS: Readonly<Record<string, PbrMaterialDefinition>> = {
	terrain: { id: "terrain", baseColor: "#303a36", roughness: 0.92, metalness: 0, textureScale: 2, weathering: "subtle" },
	asphalt: { id: "asphalt", baseColor: "#252b2b", roughness: 0.86, metalness: 0, textureScale: 4, weathering: "moderate" },
	concrete: { id: "concrete", baseColor: "#777875", roughness: 0.78, metalness: 0, textureScale: 1, weathering: "subtle" },
	metal: { id: "metal", baseColor: "#687176", roughness: 0.42, metalness: 0.7, textureScale: 1, weathering: "subtle" },
	glass: { id: "glass", baseColor: "#263c43", roughness: 0.16, metalness: 0.1, textureScale: 1, weathering: "none" },
	wood: { id: "wood", baseColor: "#443a30", roughness: 0.88, metalness: 0, textureScale: 1, weathering: "subtle" },
	grass: { id: "grass", baseColor: "#465047", roughness: 0.95, metalness: 0, textureScale: 3, weathering: "moderate" },
};