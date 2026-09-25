# Assets kept out of the build

Nothing in this folder is served or deployed — `public/` is what ships. These are here rather
than deleted because they were supplied by hand and are not in version control, so removing them
would mean sourcing them again.

## `lamborghini_revuelto.glb`, `gemballa-mirage-gt.glb`

Recognisably real manufacturers' cars (a Lamborghini Revuelto, and a Gemballa Mirage GT built on
a Porsche Carrera GT). Hiding the badges — which the game does — covers the trademarks but not
the body shape, which is a registered design in its own right. They cannot ship.

Replacing them needs original or properly licensed designs dropped into
`public/models/vehicles/` and listed in `VehicleModels.ts`. `VehicleModels.test.ts` fails if a
model marked `realBrandDerivative` is ever added back, so this decision can't be undone by
accident.

They were also the heaviest things in the build: 70 MB between them, and the Revuelto alone
draws 547,716 triangles as background traffic.

## `track.glb`

Superseded. The railway's track is generated in `RailMeshes.ts` — a bed, sleepers and two rails
built from boxes, following the curves at the corners, at roughly 45k triangles for the whole
1.2 km loop. This model is one straight 35 m section at 655,776 triangles, which would have been
about 24 million triangles to lay the loop with it.

Kept in case the geometry is ever wanted as a reference for the procedural profile.
