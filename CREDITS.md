# Credits and asset licences

Third-party art used by Orion Genix, and what each licence asks for. CC-BY requires visible
credit **in the product**, not only in the repository — these entries need to reach an in-game
credits screen before release.

Status is recorded honestly: where a licence has not been verified against its source, it says
so. An unverified licence is not a licence.

## Needs resolving before any public release

| Asset | Author | Licence | Status |
|---|---|---|---|
| `public/models/vehicles/truck.glb` | **unknown** | **unknown** | ⚠️ Supplied as a file with no source page. Nobody has confirmed who made it or on what terms. It must not be redistributed until that is answered — if it can't be, replace the model. |
| `public/models/vehicles/military-wagon.glb` | Axel Roman (DeathCoreBoy1) | CC-BY-4.0 *(unconfirmed)* | ⚠️ Taken from the Sketchfab page below; confirm against the download dialog. Credit required. |
| `public/models/characters/player-casual.glb` | ijiklvn | CC-BY-4.0 | ⚠️ Credit required and not yet shown in game. |
| `public/models/vehicles/phoenix-93-interceptor.glb` ("Phoenix '93 Interceptor – Low poly model") | Daniel Zhabotinsky | CC-BY-4.0 *(from the file's own metadata)* | ⚠️ Credit required and not yet shown in game. Fictional marque; its badge sheet and plates are hidden in game. |
| `public/models/vehicles/civic-*.glb` (taxi, postal van, road-service truck, tow truck, city bus, school bus, garbage truck, ambulance, fire truck, police sedan — split one per file from "Generic civil service vehicles pack", geometry unchanged) | Comrade1280 | CC-BY-4.0 *(from the file's own metadata)* | ⚠️ Credit required and not yet shown in game. The author states the designs are "completely trademark claim proof"; the liveries are generic words and numbers (TAXI, POLICE, 911, FIRE DEPARTMENT), checked by eye — no marques or badges. |
| `public/models/military/military-base-kit.glb` ("modular militry base low poly game ready") | Salah3D | CC-BY-4.0 *(from the file's own metadata)* | ⚠️ Credit required and not yet shown in game. Generic structures and props; no flags or insignia. |
| `public/models/aircraft/gunship.glb` ("Boeing AH-64D Apache Combat Helicopter", re-based to metres and split into body, rotors, chin gun and missiles; geometry and textures unchanged) | Muhamad Mirza Arrafi | CC-BY-4.0 *(from the file's own metadata)* | ⚠️ Credit required and not yet shown in game. ⚠️ **Depicts a real aircraft.** The CC-BY licence covers the modeller's work only, not the manufacturer's trademarks or trade dress; used by the owner's decision, under a made-up name ("OG-1 Gunship") with no maker's name shown. Replace with an original design before release to remove the risk. |

| `public/models/aircraft/jet.glb` ("Fictional Fighter/Bomber Aircraft", prepared by `scripts/prepare-jet.mjs`: merged by material, split into canopy, airbrake, gear and missiles; geometry unchanged; the red-star national insignia painted out of the colour maps) | yoshikawa_Kosuke | CC-BY-4.0 *(from the file's own metadata)* | ⚠️ Credit required and not yet shown in game. The author presents it as a fictional design, and it's shown in game as the made-up "OG-7 Striker". ⚠️ Its lines follow the MiG-29 family closely (its own part names reference the MiG-33, RD-33 engines and R-73 missiles): as with the gunship, the licence covers the modeller's work, not a manufacturer's design; review before a commercial release. |

Sources:

- military-wagon — <https://sketchfab.com/3d-models/dcb-k-133byat-unbranded-1a37570f3bbf4c31b6c8c1f89fdf3724>
- player-casual — <https://sketchfab.com/3d-models/casual-male-char-rigged-9034a1acc95e494592441a057d319953>
- phoenix-93-interceptor — <https://sketchfab.com/3d-models/phoenix-93-interceptor-low-poly-model-ac4a91cb1b184ebd82c598c1bc54ba3d>
- civic-* — <https://sketchfab.com/3d-models/generic-civil-service-vehicles-pack-8ff2a13f30914932a70c7950cfa58465>
- military-base-kit — <https://sketchfab.com/3d-models/modular-militry-base-low-poly-game-ready-cc96aa9f48b547df8844074bf14e63fe>
- gunship — <https://sketchfab.com/3d-models/boeing-ah-64d-apache-combat-helicopter-c3b58008c46b45048fdd7dd283a3c8c8>
- jet — <https://sketchfab.com/3d-models/fictional-fighterbomber-aircraft-f0b9f656b6964cbf83445484be54a237>

## Clear to use

| Asset | Author | Licence |
|---|---|---|
| `public/models/props/kenney-commercial/*`, `kenney-suburban/*` | Kenney | CC0 — no attribution required |
| `public/textures/polyhaven/*` | Poly Haven | CC0 — no attribution required |
| `public/environments/hdr/sky_partly_cloudy_2k.hdr` | Poly Haven ("Kloofendal 48d Partly Cloudy") | CC0 |

## Removed from the build

Two models were taken out because they copy real manufacturers' cars — see
`reference-assets/README.md`. Hiding the badges covers the trademarks but not the body shape,
which is a registered design. `src/engine/orion/traffic/VehicleModels.test.ts` fails if one is
added back.

## Made for this project

Everything else is original to Orion Genix and carries no third-party claim, including:

- All engine, weapon, impact and crash **audio**, synthesised at runtime from oscillators and
  noise (`src/engine/orion/audio`, `src/engine/orion/combat/CombatAudio.ts`). Nothing is sampled
  from any recording — deliberately, because a recording of a real car or firearm belongs to
  whoever made it.
- The **railway** — track bed, sleepers, rails and level-crossing hardware — generated as
  geometry in `src/engine/orion/rail/RailMeshes.ts`.
- The road network, buildings layout, street furniture and traffic signals.
