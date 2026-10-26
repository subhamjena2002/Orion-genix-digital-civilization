# Vehicle sound manifest

Which recording each vehicle class and event plays, where it came from, and its licence.
Generated files live in `public/audio/vehicles/` and are listed in
`src/engine/orion/audio/VehicleSoundManifest.ts` (written by `scripts/prepare-vehicle-sounds.py`).
Each class's settings (pitch, level, gearbox, extras) are in
`src/engine/orion/audio/VehicleAudioProfiles.ts`.

Rebuild:

```bash
python scripts/fetch-sounds.py SOURCE_DIR
python scripts/prepare-vehicle-sounds.py SOURCE_DIR
```

## Licence

Every source is from the **Sonniss #GameAudioGDC bundles** under the bundle licence
(<https://sonniss.com/gdc-bundle-license/>, checked 2026-10-26, version 2.0 effective
27 August 2026): royalty-free, commercial use in unlimited projects, **no attribution
required**. Two restrictions bind us: the sounds may not be supplied to anyone *as sound
effects* (shipping them inside the game is allowed — the source WAVs are kept out of the
repository), and they may not be used to train AI. Nothing here is copied from a game, film or
other copyrighted soundtrack.

Not used:

- **ElevenLabs sound effects**: generated effects are only licensed for commercial use on a paid
  plan; the account used for this project is on the free tier.
- **BOOM Library**: commercial libraries, not purchased.

## Engines by vehicle class

| Class (styles) | Engine family | Source recording (library — publisher, bundle) | Idle | Rev model | Start / stop |
|---|---|---|---|---|---|
| Everyday (sedan, taxi), compact (hatchback), SUV (suv, militaryWagon) | `car` | Audi Q2 onboard revs + "Turn On Start Long Idle Stop Shutoff" (Audi Q2 — Dramatic Cat, 2024) | `idle-car`, 38.8 Hz | Granular ramp 41–192 Hz + overrun ramp | `start-car`, `stop-car` |
| Police, executive; sports (luxury, roadster, grandTourer) pitched up | `v8` | Ford Crown Victoria t6 "Steady RPMs" + t11 "Idle, Stall Various" for start/stop (Ford Crown Victoria 2007 — Pole Position Production, 2023) | `idle-v8`, 102.5 Hz (the steady low-speed take; the idle take hunted near a stall) | Five RPM layers, 103/138/178/230/314 Hz (8th crank order) | `start-v8`, `stop-v8` |
| Luxury saloon and SUV (flagship, grandSuv) | `car` | as Everyday, pitched down, darker | | | |

Every engine take is softened on import (high shelf −6 dB from 2.2 kHz, −4 dB more from 6 kHz) and its idle evened over 0.12 s: the close-miked top end and level hunting were what made looped engines grate.
| Van (van, serviceTruck), ambulance | `van` | Renault Master 2.3 dCi "engine diesel rpm ramps" (Renault Master IV — Soundholder, 2020) | `idle-van`, 26.4 Hz | Granular ramp 27–117 Hz + overrun | none recorded |
| Truck (truck, towTruck, garbageTruck), bus (bus, schoolBus), fire engine | `truck` | Unimog onboard "Turn On Start Ramp Rev Up And Down X2 Stop Shutoff" (Mercedes-Benz Unimog 437 — Dramatic Cat, 2023) | `idle-truck`, 29.3 Hz | Granular ramp 31–148 Hz + overrun | `start-truck`, `stop-truck` |
| Three-wheeler (auto) | `ape` | Piaggio Ape t3 "Onbrd Start Fast Drive … Off" (Piaggio Ape P703V — Pole Position Production, 2020) | `idle-ape`, 30.8 Hz | Granular ramp 34–97 Hz + overrun | `start-ape`, `stop-ape` |
| Electric (hypercar) | none | — | — | — | — |

## Other vehicle events

| Event | Sound id | Source (library — publisher, bundle) | Who |
|---|---|---|---|
| Tyres rolling | `tyre-roll` | Seat Ibiza "Car Driving Tires" tyre-only mics (Car Foley Seat Ibiza — Systematic Sound, 2023) | Every vehicle, by speed |
| Tyre squeal, brake scrub | `skid` | BMW 520i skids (FLYSOUND, 2020) — built by `prepare-sounds.py` | Player's car (the only one with a tyre model) |
| Air-brake release | `air-brake` (2 takes) | URAL 4320 "Details Air Exterior" (FLYSOUND, 2020) | Trucks, buses, fire engines coming to a stop |
| Gear lever | `gear-lever` (3 takes) | Audi Ur-Quattro "Gear Stick Dry Movement" (Pole Position Production, 2024) | Player's car, manual classes, on upshift |
| Siren: police | `siren-wail` | Traditional Sirens — police siren (Coll Anderson, 2015) | Police on a chase |
| Siren: ambulance | `siren-hilo` | Traditional Sirens — emergency siren 10 (Coll Anderson, 2015) | Ambulance with lights on |
| Siren: fire engine | `siren-wail` at 0.86× | as police | Fire engine (stand-in, see below) |
| Collisions, glass | `crash-heavy`, `crash-light`, `glass` | see CREDITS.md | Any vehicle, once per collision |
| Horns | `horn-car`, `horn-heavy` | see CREDITS.md | H at the wheel |

## Still needs better recordings

- **Electric hypercar**: no clean motor-whine recording was found (the Polaris Ranger EV take is
  mostly chassis rattle). It is heard by its tyres only; an EV drive recording with a clear
  inverter/motor whine would go in as a ramp family.
- **Van start and stop**: the Renault Master recording has none; vans and ambulances start and
  stop silently.
- **Buses**: the bundles have no bus engine; buses use the Unimog lorry family pitched down.
- **Fire engine siren**: the police wail pitched down stands in for a mechanical siren.
- **Backfires, turbo blow-off, exhaust crackle**: no suitable recordings; not implemented rather
  than faked.
- **Road surfaces**: the game has no surface data for vehicles, so one dry-asphalt tyre loop.
- **Traffic tyre squeal**: AI traffic has no tyre model, so it never squeals.
