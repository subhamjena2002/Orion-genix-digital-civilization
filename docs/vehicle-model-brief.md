# Vehicle model brief

What to buy or commission for ORION GENIX's main road cars, and what each file needs so it drops
into the game. Hand this page to a seller or a 3D artist as it is.

## The cars

Four cars cover most of what the player sees on the road. All four are **original designs**:
modern (2024–2026 design language), believable, and not a copy of any real model.

| # | Car | Size | Notes |
|---|-----|------|-------|
| 1 | Four-door saloon | about 4.8–4.9 m | The base for the taxi and police versions. Slim LED lamps, a wide lower grille. |
| 2 | Compact crossover hatch | about 4.2–4.3 m | City car, slightly raised, black wheel-arch cladding. |
| 3 | Mid-size SUV | about 4.9–5.0 m | Family SUV, 20-inch wheels, floating roof. |
| 4 | Premium off-roader | about 4.6–5.0 m | Boxy and rugged, short overhangs, upright screen, side-hinged spare wheel. Must not look like a Defender, G-Class, Bronco or any other real off-roader: no copy of their grille, lamp shapes, roof windows or bonnet. |

## Licence (most important)

- **The licence must allow use in a commercial game that is sold.** Royalty-free or "Standard" licences are usually fine.
- **Do not buy anything marked "Editorial", "Editorial use only" or "Personal use".** Those exclude games for sale. Sketchfab, TurboSquid and CGTrader all mark editorial models; brand-name cars are nearly always editorial.
- **No real cars.** That includes "inspired by", "generic version of" and any model with a real car's body shape and its badges removed. The shape alone is a protected design.
- **No logos, badges, maker lettering or real number plates**, in the geometry or in the textures. Tyre sidewall text must be invented or blank.
- Keep the receipt, the seller's name and the licence text for every file. CC0 needs nothing more. CC-BY must be credited in the game; the game has a credits page for this.

## File

- **glTF 2.0 binary (`.glb`), uncompressed**: no Draco or meshopt compression. Alternatively, send the `.blend` or `.fbx` source and I convert it.
- **Real-world scale in metres**, Y up. The nose can face either way along the length; I set it.
- **Left-hand drive** (driver on the left).
- **30,000 to 80,000 triangles** for the whole car, interior included; 100,000 at most. The game makes its own lower levels of detail, so none are needed.
- **8 MB at most** per car with textures.
- No rig, no animation, no lights or cameras in the file.

## Materials and textures

- PBR metal/roughness: base colour, normal map, and a combined occlusion/roughness/metal map.
- **2048 × 2048 at most** per map, and four 2048 maps per car at most. One shared atlas is best. The game shows 1024 on most machines and 2048 on high quality.
- **8 materials or fewer**, named as follows (the game finds parts by these names):

| Material name contains | For |
|---|---|
| `paint` | The body colour. **One material for all painted panels**, a plain light-grey base colour with no colour or livery in its texture, so the game can repaint each car. |
| `glass` | Every window: windscreen, side windows and rear glass. |
| `headlight` | Headlamp lenses and the daytime light strip. |
| `taillight` | Tail and brake lamp lenses. |
| `indicator_left` / `indicator_right` | Optional: the turn signals on each side, so they can flash. |
| `rim` | Wheel rims. |
| `tyre` | Tyres. |
| `interior` | The cabin. |

Trim, chrome and black plastic can share one or two more materials, named as you like.

## Separate parts

The game opens doors, spins wheels, smashes glass and knocks panels loose, so these must be
**separate objects, each with its pivot in the right place**:

| Part | Pivot | Name |
|---|---|---|
| Each of the four wheels (tyre, rim and brake disc together) | Centre of the hub | `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR` |
| Brake calipers (optional) | Any | `caliper_…` (they don't spin) |
| Each door, its window as a child of it | On the hinge line | `door_FL`, `door_FR`, `door_RL`, `door_RR` |
| Bonnet | On its hinge | `hood` |
| Boot lid or tailgate | On its hinge | `trunk` |
| Front and rear bumpers | Any | `bumper_front`, `bumper_rear` |
| Windscreen and rear glass | Any | `windscreen`, `rear_glass` |
| Steering wheel | Its centre | `steering_wheel` |

Everything else can be merged into the body.

## Interior

The cabin is seen through the glass and through an open door when the player gets in, so it must
be modelled: seats with headrests, a rear bench, a dashboard with screens, a steering wheel,
a centre console, carpet and a headliner. It can be lower detail than the outside.

## What I do with each car

Once a car is in `public/models/vehicles/`, I:

- rename parts to the game's conventions and register it;
- give it the fleet colours and the taxi and police liveries;
- give it new car paint with a clearcoat, and reflections;
- set up the doors, seat, collision shape, lights, glass breaking, damage and the lower levels of detail;
- check it in traffic and in the driving camera, by day and by night.
