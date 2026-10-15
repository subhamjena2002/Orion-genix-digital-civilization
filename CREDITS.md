# Credits and asset licences

Third-party art used by Orion Genix, and what each licence asks for. CC-BY requires visible
credit **in the product**, not only in the repository — these entries need to reach an in-game
credits screen before release.

Status is recorded honestly: where a licence has not been verified against its source, it says
so. An unverified licence is not a licence.

## Needs resolving before any public release

> **Vehicles:** every road vehicle is an original built in code (see "Made for this project").
> The third-party vehicle models used before 2026-10-14 (`truck.glb`, `military-wagon.glb`,
> `phoenix-93-interceptor.glb`, `civic-*.glb`, `civic-sedan-paint.png`) were deleted from
> `public/` on 2026-10-15, so they are no longer published and their credit obligations ended.

| Asset | Author | Licence | Status |
|---|---|---|---|
| `public/models/characters/player-casual.glb` | ijiklvn | CC-BY-4.0 | ⚠️ Credit required and not yet shown in game. |
| `public/models/military/military-base-kit.glb` ("modular militry base low poly game ready") | Salah3D | CC-BY-4.0 *(from the file's own metadata)* | ⚠️ Credit required and not yet shown in game. Generic structures and props; no flags or insignia. |
| `public/models/aircraft/gunship.glb` ("Boeing AH-64D Apache Combat Helicopter", re-based to metres and split into body, rotors, chin gun and missiles; geometry and textures unchanged) | Muhamad Mirza Arrafi | CC-BY-4.0 *(from the file's own metadata)* | ⚠️ Credit required and not yet shown in game. ⚠️ **Depicts a real aircraft.** The CC-BY licence covers the modeller's work only, not the manufacturer's trademarks or trade dress; used by the owner's decision, under a made-up name ("OG-1 Gunship") with no maker's name shown. Replace with an original design before release to remove the risk. |

| `public/models/aircraft/jet.glb` ("Fictional Fighter/Bomber Aircraft", prepared by `scripts/prepare-jet.mjs`: merged by material, split into canopy, airbrake, gear and missiles; geometry unchanged; the red-star national insignia painted out of the colour maps) | yoshikawa_Kosuke | CC-BY-4.0 *(from the file's own metadata)* | ⚠️ Credit required and not yet shown in game. The author presents it as a fictional design, and it's shown in game as the made-up "OG-7 Striker". ⚠️ Its lines follow the MiG-29 family closely (its own part names reference the MiG-33, RD-33 engines and R-73 missiles): as with the gunship, the licence covers the modeller's work, not a manufacturer's design; review before a commercial release. |

Sources:

- player-casual — <https://sketchfab.com/3d-models/casual-male-char-rigged-9034a1acc95e494592441a057d319953>
- military-base-kit — <https://sketchfab.com/3d-models/modular-militry-base-low-poly-game-ready-cc96aa9f48b547df8844074bf14e63fe>
- gunship — <https://sketchfab.com/3d-models/boeing-ah-64d-apache-combat-helicopter-c3b58008c46b45048fdd7dd283a3c8c8>
- jet — <https://sketchfab.com/3d-models/fictional-fighterbomber-aircraft-f0b9f656b6964cbf83445484be54a237>

## Clear to use

| Asset | Author | Licence |
|---|---|---|
| `public/models/props/kenney-commercial/*`, `kenney-suburban/*` | Kenney | CC0 — no attribution required |
| `public/textures/polyhaven/*` | Poly Haven | CC0 — no attribution required |
| `public/environments/hdr/sky_partly_cloudy_2k.hdr` | Poly Haven ("Kloofendal 48d Partly Cloudy") | CC0 |

## Sound effects

`public/audio/*.ogg` are cut, levelled and looped by `scripts/prepare-sounds.py` from studio
recordings in the **Sonniss GameAudioGDC bundles** (2015, 2020, 2023 and 2024 releases), under the Sonniss GDC
bundle licence (<https://sonniss.com/gdc-bundle-license/>): royalty-free, commercial use in
unlimited projects, **no attribution required**. Two conditions bind us: the sounds may not be
redistributed or resold *as sound effects* (shipping them inside the game is allowed), and they
may not be used to train AI models. The source WAVs are therefore not kept in the repository.

| Game sounds | Library (publisher) | Bundle |
|---|---|---|
| Everyday car engine (`engine-car-*`) | Audi Q2 (Dramatic Cat) | 2024 |
| Supercar engine (`engine-sport-*`) | Porsche Carrera GT 2005 (Pole Position Production) | 2024 |
| Diesel engine (`engine-diesel-*`): vans, ambulance, service truck | Magnum 7250 tractor (Dramatic Cat) | 2024 |
| Truck and bus engine (`engine-truck-*`) | Mercedes-Benz Unimog 437 (Dramatic Cat) | 2023 |
| Pistol close and distant | Colt Python .357 Magnum (Pole Position Production); Guns (Coll Anderson) | 2024, 2015 |
| Rifle close, far and distant | AK-74 (FLYSOUND); Guns — M4 shots (Coll Anderson) | 2020, 2015 |
| Very distant gunfire | AK-74 (FLYSOUND); Mosin-Nagant (FLYSOUND) | 2020 |
| Bullet fly-bys and impacts (dirt, glass, flesh) | Bullet Bys & Impacts (PMSFX); Hand Guns Sound Effects Pack (Olivier Girardot) | 2020 |
| Bullets on walls | Shattering Bricks, Rocky Impacts (PMSFX); Debris & Rubble (Eneas Mentzel) | 2020, 2023 |
| Shell casings | Cartridges & Casings Shell (SculpTunes); Detonation (BluezoneCorp) | 2020, 2023 |
| Tyre skids | BMW 520i (FLYSOUND) | 2020 |
| Shotgun, pump | Saiga-12 (Dramatic Cat); Franchi SPAS-12 (Pole Position Production) | 2024 |
| Rocket; distant explosion | The Warfare 2 Library (Pole Position Production) | 2024 |
| Explosions | Explosion SFX Pack (David Dumais); Detonation (BluezoneCorp); Guns — mortar (Coll Anderson) | 2024, 2023, 2015 |
| Crashes, scrapes, glass | Car Destruction (Coll Anderson); Jaws of Life (Secret Source); Glass (Mechanical Wave); Broken Glass (BluezoneCorp) | 2015, 2024, 2023 |
| Bullet impacts | The Metal Hit Sweeteners Library (Pole Position Production) | 2024 |
| Reload, hammer, magazine | Desert Eagle .44, Dan Wesson .445 (Pole Position Production); Guns — AR-15 (Coll Anderson) | 2024, 2015 |
| Punches, whooshes | Hong Kong Action Kit — Hit Kit #1 (NoizBoy); Hits Whoosh (Mechanical Wave) | 2015 |
| Horns | Audi Q7 (Dramatic Cat); Renault R4 (Justsoundeffects); The Vehicle Doors and More Library — coach horn (Pole Position Production) | 2024 |
| Car door | 1967 Corvette Convertible Work-Up (Bryan Gold) | 2024 |
| Sirens | Traditional Sirens (Coll Anderson) | 2015 |
| Gunship rotor | The Aircraft Ambient Library — military helicopter (Pole Position Production) | 2024 |
| City street ambience | The 'hood Audio Playset (UberDuo) | 2024 |
| Surf | Base — waves (Robert Cordova) | 2015 |

## Removed from the build

Two models were taken out because they copy real manufacturers' cars — see
`reference-assets/README.md`. Hiding the badges covers the trademarks but not the body shape,
which is a registered design. `src/engine/orion/traffic/VehicleModels.test.ts` fails if one is
added back.

## Made for this project

Everything else is original to Orion Genix and carries no third-party claim, including:

- The **synthesised fallback audio** (`src/engine/orion/audio/EngineWorklet.ts`, the synths in
  `src/engine/orion/combat/CombatAudio.ts`, `PoliceSirens.ts`, `GunshipAudio.ts`), which plays
  until the recordings below have loaded.
- The **Vesper GT** supercar (`public/models/vehicles/vesper-gt.glb`), an original design built
  in code by `scripts/build-supercar.mjs`.
- **Every other road vehicle** (`public/models/vehicles/orion-*.glb`: sedan, taxi, patrol car,
  utility wagon, panel van, ambulance, service truck, tow truck, box lorry, refuse truck, fire
  engine, city bus, school bus), original generic designs built in code by
  `scripts/build-vehicles.mjs` on the shared kit in `scripts/vehicle-kit.mjs`. No textures beyond
  a generated 4-pixel finish palette; liveries are plain colours and patterns, no lettering or
  marques.
- The **railway** — track bed, sleepers, rails and level-crossing hardware — generated as
  geometry in `src/engine/orion/rail/RailMeshes.ts`.
- The road network, buildings layout, street furniture and traffic signals.
