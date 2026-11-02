# Biome looks

`config/biome-looks.yaml` is the per-biome look table: one row per terrain tile
id (Azgaar's standard biomes 0–12, custom biomes 32–254) that every layer
dressing a biome reads its column from. `src/editor/biomes/BiomeLooks.js`
resolves it to dense per-tile tables; `applyBiomeLooks.js` hands the load-time
columns out before the layers' own validators run.

| Column | Read by | How |
|--------|---------|-----|
| `canopy` | trees (`forest/forestLeafTint.js`) | crown hue as a ratio against the species' lit crown |
| `snow.ground` | terrain bake and far terrain `snowBiomeCover`, grass gate | one source for both terrains, so they cannot drift apart |
| `snow.canopy` | tree meshes and impostors (`forest/canopySnow.js`) | per-instance snow, capped on upward-facing foliage |
| `snow.grass` | meadow palette and growth | tips lean to `snow.frost`, stands settle shorter; no extra palette or draw |
| `snow.air` | `SnowCountryWeight.value` | cooler, paler sky and haze (`snowCountryLook.js`), exposure, ambient snow region, frost, breath, soundscape |
| `snow.fall` | `SnowCountryWeight.snowfall` | regional snowfall (`weather/snow_system.js`, one instanced draw) |

Above the terrain's snow line every snow column reaches 1 whatever the biome.

## Canopy snow

Snow per tree is the larger of its biome's `snow.canopy` and the snow band at
its height, drifted ±20 % per grove. The biome term is blurred over the same
±`BIOME_BLUR_CELLS` kernel as the ground snow (`biomeCanopySnowAt`), so a tree
on a biome border carries as much snow as the ground under it; it is cached per
placement record, so the 121-cell kernel runs once per tree, not per rebuild. It costs no vertex buffer: a tree leaf part
is near WebGPU's eight, so it rides `instanceLeafTint.w` (now a vec4) on meshes,
and the integer part of the crown-width channel on impostors
(`TreeAppearance.packImpostorWidth`), whose appearance vec4 was full. The cap
keys on a blend of the card normal and the direction out of the crown's bounds:
card normals alone sprinkled white flecks through conifers. No texture, no
light; snow's shade takes the sky fill (`foliageLight.fill`) instead of the
leaf's transmission.

Crowns painted with snow (the alpine conifers' COLOR_0) keep their paint and
take the cap on top.

Trunks carry the same tree's snow on their upward bark faces
(`canopySnow.trunkSnow`). A trunk reads only z of `instanceMorphology`, so its
x carries the snow. Bark weathering's own snow band now reads the world height:
it compared the trunk-local height with the 700 m line, so trunks never
whitened.

## Snow-country air

`SnowCountryWeight` samples rings at 0, 60 and 180 m, weighted 4 : 1 : 0.5 per
sample, and leaves open water (tile 0) out. With equal votes the far ring
decided: a taiga pose beside a deciduous wood and a lake read 0.09, a tundra
shore 0.29. Weighted, they read 0.20 and 0.56.

`snowCountryLook` leans a daylit sky toward pale winter blues (`WINTER_ZENITH`,
`WINTER_HORIZON`), each scaled to the colour's own lifted luminance so night
and dusk skies keep their darkness. Sky colour follows an ease-out of the
weight (`1 − (1 − w)²`); exposure and haze density keep the plain weight.

## A/B

`?biomeSnow=0` zeroes every snow column (docs/perf-qa.md). Measured on
2026-10-19 at the taiga pose (`chunk-cross`, warmup 25, two pairs, order
swapped): on 106.5 / 114.0 fps, p50 7.9 / 7.5 ms; off 92.7 / 80.7 fps, p50
7.7 / 8.0 ms. The 0.5–2 s stall at the start of motion appears in both.

2026-10-20, after the ring weighting (Snow-country air, above) lifted taiga's snowfall weight past
the field's `regionalMinCoverage`: on 54.3 / 49.0 fps (p50 11.7 / 12.9 ms),
off 68.7 fps (p50 9.3 ms); the extra time was per-frame submission work, not
draws (187 vs 192). Taiga's `fall` dropped to 0.15 so it no longer snows on
its own; that change is not yet re-measured.

## Snow under a low sun

Snow takes none of the ground's pigment: macro tint, family atlas and lichen stop
at the bake's snow weight, and the floor scan stays on bare ground. Most of what
read as marble was those layers, not the snow maps.

`SnowDriftShading.js` adds drifts a few metres across as analytic slopes plus a
three-step march toward the sun. Collision and geometry stay flat. Their shade
loses the sun's colour and takes `DRIFT_SKY_LIGHT` as emission, because a blue
albedo under an orange sun still comes out brown. Below about 20° elevation
snow normals lean to the sun (`lowSunWrap`) so the lit side glows, and the shadow
map keeps working. `snowCountryLook` leaves a low sun's sky warm and stops the
exposure down half as far.

2026-11-01, `chunk-cross` from the glacier at (6929, 8891), `--warmup 8 --settle`,
three alternating pairs, drift branch off → on: 128.3, 141.6, 125.6 → 133.5,
135.4, 150.1 fps; hitches 5, 2, 4 → 0, 3, 1. No cost shows above run-to-run spread.

Crowns carry frost on every needle (`FROST_SHARE`) and snow keeps the sun's
transmission instead of cutting it (`canopySnowTransmission`), so a backlit crown
glows through the same shadowed light as the leaf did. `chunk-cross` from the taiga
at (-11219, 9187), four pairs with the order swapped halfway, off → on: 81.5, 78.1,
77.9, 69.3 → 72.9, 70.3, 82.4, 75.8 fps; GPU 2.21–2.30 → 2.09–2.31 ms. Whichever
arm ran first in a pair was slower, so order, not frost, set the gap.

## Alpine recipe

Everything here keys on height, slope and the biome table, so it applies to any
imported world. Eldara's Shuzanbund (-3350000, -560000) is the acceptance view.

- `import.azgaarRidges` rose from 90 to 280 m so flanks reach rock. A world keeps
  the ridges it was imported with: re-import a saved map to get them.
- The far mesh had no normals, so every triangle lit as a flat facet. It now
  carries smooth ones, and `FarAlpineSurface.js` puts triplanar stone, strata and
  snow on ledges per pixel. Resolution stays at 160 × 256: 240 × 512 cost
  85 → 52 fps on the settlement approach, in a run void for lost focus.
- Near cliffs take the rock scan from the ground-layer array
  (`TerrainRockDetail.js`), three taps behind a rock branch, no new sampler.
- Icebergs (`stylized/ice/`) sit on a jittered 320 m grid over open sea within
  1.8 km of tundra or glacier. Opaque: `IceMaterial` fakes depth along the view
  ray and uses no viewport texture. They have no collision yet.

2026-11-02, HEAD against this change, valid runs: settlement approach 84.5, 85.0 →
84.1 fps, GPU 3.79 → 3.88 ms; `chunk-cross` 137.3 → 136.5 fps, GPU 2.26 → 2.27 ms.

Near ground and props. `ridgedField` warps off its lattice, and `fineMeters` adds
broken faces on near terrain only: the far mesh's spacing would alias them.
`stylized/alpine/` grows crags on steep high ground and boulder clusters on the
flats, from a 32 m grid within 224 m, one instanced draw per shape, no collision.
Rock strata use interpolated `positionWorld.y`: `terrainHeight` comes from a
nearest-filtered texture and turned the bands into quads.

2026-11-02, with crags and fine relief: settlement approach 86.8 fps, GPU 3.79 ms;
`chunk-cross` 144.7 fps, GPU 2.30 ms. Single runs, against 84–85 and 137 fps on the
previous commit, on a busy machine. Neither route reaches alpine ground, so the
crags' own draw cost is unmeasured.
