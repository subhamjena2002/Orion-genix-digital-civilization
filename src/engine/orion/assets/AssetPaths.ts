export const ORION_ASSET_PATHS = {
  // Pure-sky HDRI (Poly Haven "Kloofendal 48d Partly Cloudy", CC0). A sky-only capture is
  // needed here: the previous street-level HDRI showed photographed buildings as the backdrop.
  environments: "/environments/hdr/sky_partly_cloudy_2k.hdr",
  buildings: "/models/buildings/",
  apartment: "/models/buildings/modern/modular_urban_apartments_facade/orion-apartment.glb",
  intersection: "/models/buildings/modern/Main_Intersection_v2.glb",
  props: "/models/props/",
  vegetation: "/models/vegetation/",
  materials: "/textures/materials/",
  character: "/models/characters/orion-citizen/orion-citizen.glb",
  // The player's own body ("Casual Male Char (Rigged)" by ijiklvn, CC-BY-4.0 — credit required:
  // https://sketchfab.com/3d-models/casual-male-char-rigged-9034a1acc95e494592441a057d319953).
  // It has no animations of its own; the citizen rig's are retargeted onto it (player/Retarget).
  playerCharacter: "/models/characters/player-casual.glb",
} as const;

/**
 * Real CC0 PBR ground textures from Poly Haven (polyhaven.com — no attribution required),
 * used in place of flat-color materials for roads/sidewalks/terrain.
 */
export const ORION_GROUND_TEXTURES = {
  asphalt: {
    diffuse: "/textures/polyhaven/asphalt_04/asphalt_04_diff_1k.jpg",
    normal: "/textures/polyhaven/asphalt_04/asphalt_04_nor_gl_1k.jpg",
  },
  pavement: {
    diffuse: "/textures/polyhaven/pavement_02/pavement_02_diff_1k.jpg",
    normal: "/textures/polyhaven/pavement_02/pavement_02_nor_gl_1k.jpg",
  },
  grass: {
    diffuse: "/textures/polyhaven/aerial_grass_rock/aerial_grass_rock_diff_1k.jpg",
    normal: "/textures/polyhaven/aerial_grass_rock/aerial_grass_rock_nor_gl_1k.jpg",
  },
} as const;
