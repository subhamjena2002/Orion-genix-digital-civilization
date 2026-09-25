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

Sources:

- military-wagon — <https://sketchfab.com/3d-models/dcb-k-133byat-unbranded-1a37570f3bbf4c31b6c8c1f89fdf3724>
- player-casual — <https://sketchfab.com/3d-models/casual-male-char-rigged-9034a1acc95e494592441a057d319953>

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
