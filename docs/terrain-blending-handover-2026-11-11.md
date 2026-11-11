# Handover: rock soil foot (terrain blending) — QA wanted

Date: 2026-11-11. Code is written and unit-tested; **nothing below has been run
in a browser.** This file is the brief for whoever runs the long jobs
(screenshots, perf, tuning) and reports back.

## What changed

Scattered rocks now carry the ground's duff up their foot, so a boulder grows
out of the floor instead of sitting on it. The terrain already paints the same
duff *under* each stone (`terrainMaterial.js`, contact shade); the stone now
meets it in the same colour.

- `src/editor/stylized/rockWeathering.js` — the soil band, inside
  `applyRockWeathering`, between the dust and the waterline. It uses the
  per-prototype ground line the snow skirt already had. No scene depth, no new
  vertex buffer, no new texture.
- `editor.config.yaml` → `stylizedSurface.rocks.weathering`: `soil` (strength,
  0..1), `soilHeight` (share of the stone's height above the ground line),
  `soilColor`.
- `tests/rockWeathering.test.js` — validation and graph assembly.

**A/B control:** set `soil: 0` in `editor.config.yaml`. That compiles the old
shader exactly (the band's nodes are not built).

Known approximation, marked `shortcut:` in the code: the earth colour leans to
each biome through the rock's own biome tint, not through the tile's real soil
colour. The rock instance has no free channel for a per-instance colour.

## Jobs to run

Follow `docs/perf-qa.md`. App must be serving (`npm run dev`), headed Chromium,
hardware WebGPU.

### 1. It compiles and nothing vanished

Load the world. Report any console error or WGSL compile error, and confirm
rocks are still drawn at every LOD band (a failed pipeline makes the mesh
disappear entirely, it does not degrade).

### 2. Before/after screenshots

Same pose, `soil: 0` then `soil: 0.7`, camera low and 3–8 m from the stones:

| Place | What to look for |
|---|---|
| Temperate forest floor | Foot colour matches the duff patch under the stone |
| Open grassland | A dirt band, not a brown ring that reads as painted |
| Hot desert / sand | Foot must not go dark brown against pale sand |
| Tundra / snow biome | Snow skirt still covers the soil; no brown line above the snow |
| Coast and river stones | Wet band and algae still read; soil does not fight them |
| A tor (formation, 4.5–8.5× stones) | Band height is sane on big stones, not a metre of brown |

`npm run qa:world:visual` captures the standard poses; its rock swatches build
materials without a ground line, so they will **not** show the band — use
in-world poses.

### 3. Performance A/B

```bash
npm run qa:perf -- --headed --qa chunk-cross --warmup 8 --duration 12 --settle
```

Run with `soil: 0` and `soil: 0.7` at the same `--warmup`, twice each. Expected:
neutral (one 2-octave noise and one varying more in the rock fragment shader).
Report p50/p95 frame time and hitch count for all four runs, and discard any
run whose `scenario.settle.settled` is false.

### 4. Tuning, if the screenshots ask for it

| Symptom | Change |
|---|---|
| Band too tall on tors | lower `soilHeight` (try 0.10) |
| Reads as a painted ring | lower `soil` (try 0.45) |
| Foot brighter than the ground beside it | darken `soilColor` |
| Wrong hue in one biome only | report it — that needs the per-instance soil colour, not a config change |

Report the values that looked right; do not commit tuning without screenshots.

### 5. Skylighting — investigate only, no code yet

Suspected gap: canopy shade (`forestFloorTexture` R) darkens the **terrain**
only. Rocks, shrubs and understory under a dense canopy still take the full sky
fill (`foliageLight.js`: `rockShadeEmission`, `understoryShadeEmission`;
`ROCK_FILL` is 3.5), so they may glow against a dark floor.

Capture a boulder and a shrub under dense canopy at noon and at dusk, next to
the same assets in the open. Report whether they read brighter than the floor
they stand on. If they do, the fix is a per-instance canopy term on the sky
fill, which needs a free instance channel (see the note in
`biomes/BiomeLooks.js` on the eight-buffer limit) — a separate task.

## Reviewed and not done

- **Terrain Variation** — already there: `TerrainMaterialStochasticNodes.js` is
  a hex-tiled stochastic sampler with contrast preservation.
- **Grass Optimizations** — already instanced with LOD bands and a far volume;
  nothing to port.
- **Buildings** — workshop stone already has a grade tint
  (`RoundedStoneShading.js`, `groundTint`). Left alone.
- **Depth-based blending** (how Community Shaders does it) — rejected: it needs
  `viewportDepthTexture`, a whole-frame copy (`CLAUDE.md`).

Community Shaders is GPL-3.0. Nothing was copied from it; the archive in
`docs/reference/` was not opened and is not committed.

## Report back with

1. Compile result (errors, missing rocks).
2. The before/after pairs from job 2, one line of verdict each.
3. The four perf runs from job 3.
4. Final `soil` / `soilHeight` / `soilColor` you would ship.
5. The skylighting captures and a yes/no on the gap.
