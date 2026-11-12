# Coherence and polish round — plan (2026-11-11)

## Status — 2026-11-11, first implementation pass

Written without running anything, at the user's instruction: no unit tests, no
captures, no performance runs. A later pass does all acceptance. Edited files
were syntax-checked with `node --check` and the YAML files were parsed; that is
the only verification.

### Landed

| Commit | What |
| --- | --- |
| `7aa756ce` | Stage 0: `docs/look-bible.md`; `look-metrics.mjs` gains `sat` and `hue` per region, a `horizon` region, `satP95` and `mudShare`. |
| `afadbcfb` | Stage 1: coherence phase 2 §5.1 (town bounce level), phase 3 §6.1 and §6.2 (autumn confined, taiga canopy 0.3), phase 4 (config values), phase 5 (storm deck). |
| `3b7fc3c1` | Stage 2: one haze colour for tree, rock, plant and building in-scatter and for the far backdrop; `sky/lookGrade.js`; cloud core `#8e9db0`. |
| `824dfa4b` | Stage 3 and 4.1: soils for tiles 4–8, default meadow base `#62883c`, duff half from the tile's soil, ragged contact-shade discs. |
| `a34eb72c` | Stage 4.2: grass stands to snow 0.75 and meets the drift, `DRIFT_EDGE` 0.12, thaw `tintMix` 0.55, rock snow ramp 0.08–0.3. Coverage recipe revision 5. |
| `9b607b4d` | Stage 4.4, 5.1, 5.3 and the stage 6 switch: narrower calm shore line; understory row for tile 4; rock rows for tiles 4, 5, 6, 9; `crownShadows` (off). |

### Changed from the plan, with the reason

- **No second cloud-noise sample** (stage 2.4). `StylizedSkyView.js` records
  that it was tried and cost 0.4 ms a frame. The darker core works through the
  existing body term. `cloudSharpness` stays 0.24: the config records 0.16 as
  reading cartoon.
- **The grade is derived, not authored** (stage 2.5). `resolveLookGrade` reads
  `nightness`, `overcastAmount`, a new `stormAmount` and `sunElevation` from
  the finished look. No preset gained a field.
- **Tree air keeps its energy** (stage 2.1). It takes the fog's hue at the sky
  fill's luminance; the fog colour itself is over twice as bright and would
  have paled far crowns further.
- **Bushes use the existing per-instance biome look** (stage 5.1). A tile 4
  `understory` row was enough; no code change in `StylizedBushView.js`.
- **Crown shadows are a switch, default off** (stage 6). Enabling them blind
  risks both the frame budget and noisy self-shadowing on crowns that were
  tuned without it. Trial with `?crownShadows=1`.
- **`swamp-thatch` and `timber-thatch` are not undefined** (stage 9.4).
  `SettlementProfile.js:109` maps both to the goblin style. Item dropped.
- **Coherence phase 3 §6.3 skipped by its own rule**: the baseline's
  `legacy-rainforest-off-12` reads `elevationWeight` 1.

### Not done

Each of these needs a capture to judge, an asset build, or another session's
work to land first.

- Stage 0: the palette lint test and the `round3-baseline` capture run.
- Stage 1: coherence phase 1 (another session's) and the phase 2 band bisection.
- Stage 2: the horizon tuning, the sea's far edge, the `fogColor`/`lowColor`
  preset test, any gate.
- Stage 3: the path tread's lean to soil; soils for tiles 1, 10 and 11.
- Stage 4: taiga snow patch size, the 6 m grass seam, submerged props.
- Stage 5: scanned boulders, rebuilt swamp knees, building contact shade.
- Stage 6: trial B (sun-offset canopy shade), and the measurement of trial A.
- Stages 7, 8, 10 entirely. Stage 9 except the doc correction: the paving and
  defence tints are taste changes that interact with the phase 1 town gates.

### For the acceptance pass

1. `npm test`. Tests edited by hand and never run:
   `test/settlement-ground-bounce.test.js`, `tests/forestLeafTint.test.js`,
   `test/grass-habitat-coverage.test.js`. Tests that may assert values this
   pass changed: anything reading `cloudCore`, the meadow palette base, taiga
   `snow.canopy`, `sky.aerial.horizonColor`, `forestFloor.byTileId`.
2. `npm run qa:look`, then compare with `docs/qa/environment-look/baseline/`.
   Look first at: far crowns and far land (one haze), `forest-off-12` ground
   saturation (was 0.68), the aerial shots (tree discs, snow rims),
   `core-taiga-off-12` boulders, `grassland-off-7` bushes, `coast-off-12`
   shore line, cloud bodies at noon, and the dusk, night and storm shots for
   the grade.
3. Performance A/B per `docs/perf-qa.md` for `3b7fc3c1` and `824dfa4b` (shader
   terms on foliage, the finish and terrain) and for `a34eb72c` (chunk bake).
   None adds a pass, a draw, a light or a sampler.
4. `?crownShadows=1` at the forest and town poses: frame cost, and whether
   crowns darken or flicker from their own shadows.
5. The numbers in `docs/look-bible.md` are drafts. Confirm them, then turn
   them into fixture gates.

## Second pass — 2026-11-11 evening, from the understory QA captures

Source: `tmp/understory-qa-2026-11-11/screenshots/` and `forest.png`. Ranked
review in the session plan; this records what changed. **Nothing was run**: no
tests, captures or perf. Files were syntax-checked only.

### Changed

| What | Where | Confidence |
| --- | --- | --- |
| Near trunks and vines drew as black-and-white speckle (new with the scanned bark). The scan PNGs keep height in alpha and were decoded through premultiplied alpha, so normal and roughness were lost in the crevices. They now load as straight-alpha bitmaps. | `forest/straightAlphaTexture.js`, `StylizedTreeView.js` | Likely cause, unverified |
| Same symptom, second cause: the packed-normal tangent frame and the texture mip were taken from the parallax-shifted UV, whose screen derivatives are noise inside the 4-14 m relief band. Both now use the unshifted projection. | `forest/TreeBarkMaterial.js` | Correct in itself; share of the symptom unknown |
| Crown shadows on by default, and leaves get a `maskShadowNode` without the character-occlusion cut (it is view-space and would punch the shadow). | `config/render-enhancements.yaml`, `lod/StylizedDitheredMaterial.js` | **Cost unmeasured** |
| Groves and gaps: spacing radius times a 48 m value-noise field, 0.55-1.3. Tree scale 0.85-1.15 becomes 0.7-1.35. | `forest/ForestSpeciesRegistry.js`, `editor.config.yaml`, `tests/groveSpacingFactor.test.js` | Stage 8.1 and 8.2 as planned |
| Green discs on the rainforest floor: the calathea and anthurium scans keep their potting-soil mound. Sunk 0.1 m now; `groundCrop: 0.12` set for the next asset build. | `editor.config.yaml`, `scripts/understory-sources.config.mjs` | Plant identified by eye |

### For the QA pass

1. `npm test`. New: `tests/groveSpacingFactor.test.js`. May need new expected
   values: anything asserting tree counts, spacing or scale in a forest
   manifest; `test/tree-impostor-source-inputs.test.js` (one input added).
2. Tree impostors are stale (bark material and loader are bake inputs):
   `npm run bake:impostors`, then `assetIntegrity`.
3. Rebuild the two tropical scans (`tools/blender/understory_scans/`), check
   the mound is gone, then delete their `heightOffset: -0.1` rows.
4. Captures of the same poses. Check first: the trunk nearest the camera in
   `core-rainforest`, `core-taiga`, `core-temperate-rainforest`; dapple and
   crown self-shadowing; whether groves read or the wood just thinned.
5. Perf A/B per `docs/perf-qa.md`: `?crownShadows=0` against default at the
   forest and town poses; the chunk-cross run for the tree scatter change.
   Also A/B the 2026-11-12 density raises in `editor.config.yaml`, each
   revertible on its own: meadow `lod.high/medium.density` 12.6 → 14 (the
   costliest draw; measure at the grassland pose), forest-tile growth density
   (5, 6 → 0.95; 8, 9 → 0.88) and `tufts.gapCut` 0.9 → 0.75,
   `groundDetails.perChunk` 320 → 400, `bushes.perChunk` 180 → 216, and
   `tropicalKit.densityByTile.5` 0.5 → 0.65. Rainforest understory was not
   raised: `tropicalKit.perChunk` sits at the validator's 256 cap.
   The hard limit is 60 FPS: every pose and the chunk-cross run must stay
   above it. Inside that limit, the +0.25 / +0.20 ms budget of the rules below
   may be raised a little for a change whose visual gain is significant (user,
   2026-11-12) — record the new cost next to the change. Turn `crownShadows`
   off again only if it breaks 60 FPS or costs far more than the shade is
   worth, and then try stage 6 trial B.

### Seen in the captures, not changed — needs a live look

**Capture handoff, 2026-11-12:** [52 review images, exact-pose comparisons,
four valid performance samples and the seven failed visual gates](../coherence-capture-handoff-2026-11-12.md).
Crown-shadow OFF/ON samples at 720p cost +0.257 ms render / +0.019 ms GPU in
the forest and +0.233 / +0.167 ms in town. Enabled runs average 113.94 and
100.52 FPS, with frame p95 12.175 and 13.600 ms; individual slower frames
remain in both controls and enabled runs. These are single pairs on the
current stale atlases, not final acceptance. The bark stipple remains in the
new images. No visual setting was tuned by this capture pass.

- **Black mottled patches on near grass blades** (deciduous floor). Already in
  the 2026-11-10 baseline, so not the bark bug. Not found in the pigment, mark
  or fade code. Start with `receiveShadow` off on the blade batch, then the
  publication fade.
- **Pale flat slab in taiga** (left of `core-taiga-eye`) and **two pale teal
  bushes in grassland**. Rock snow already ramps (0.08-0.3) and tile 4 has an
  understory row, so neither earlier fix explains them. Suspects: the bush
  proxy's palette ramp (`BushRenderAssets.js`, tip colour from the variant's
  first tile) and a scanned ground slab (`forest-roots-01`) graded pale.
- **Conifers all leaning downhill** in taiga: `slopeLean` in
  `forest/morphology/constants.js`. Real trunks stay plumb on a slope.
- **Hovering fallen log**, sparse near grass over a smeared ground texture,
  blob clouds, hard horizon outside the rainforest, wide shore smear, and the
  HUD: all need a capture to tune. Stages 2, 3, 4 and 7 cover them.

## Context

The request: plan, from the existing captures, how to bring the look to an AAA
bar, "specially making it more coherent and more polished".

Captures reviewed: the 38-shot baseline in `docs/qa/environment-look/baseline/`
(2026-11-10), the 23 shots in `docs/qa/aaa-look-2026-11-09/`, and the finals in
`tmp/p6-world-visual-p6-final/`. Colour statistics were measured on the
baseline at 480×270, the harness's own method.

Decisions made with the user on 2026-11-11:

- **Art target: painterly naturalism.** Real shapes and scanned detail; hue
  comes from controlled per-biome ramps; bold light, haze and weather.
- **Fold the open plans in** (environment coherence phases 1–5, trees,
  understory) as part of one roadmap.
- **After approval:** save this as a work order in `docs/plans/`, then
  implement it stage by stage.
- New or downloaded GLBs and textures are allowed. Use CC0 sources (Poly
  Haven, ambientCG) and record each in `THIRD_PARTY_NOTICES.md`.

### Why the frame does not read as one image

The renderer already has a grade, bloom, lit clouds, aerial haze, GTAO, biome
looks and a weather chain. The individual systems are good. The incoherence
comes from eight specific causes, each confirmed in code:

| # | What the captures show | Cause found in the code |
| --- | --- | --- |
| 1 | Distant trees fade to pale mint, far land to cyan, the horizon to white. Three different hazes in one view. | Three haze colours on three curves: scene fog uses `look.fogColor` (authored by hand per preset), tree and impostor in-scatter uses the hemisphere sky colour (`foliageLight.js:95-130`), far terrain uses its own `aerial.horizonColor: '#8ecef2'` (`MacroFarTerrainView.js:158-197`). |
| 2 | Neon lime lawn in `forest-off-12` (ground saturation 0.68), blotchy pale and bright-green patches where grass thins. | Tiles 1, 4, 5, 6, 7, 8, 10 and 11 have no `soil` in `config/biome-looks.yaml`, so bare ground falls back to the **Azgaar map colour** (`ChunkRenderPixels.js:156-163`): `#29bc56` for temperate forest, `#c8d68f` for grassland. The default meadow palette base `#5f8f34` is also the most saturated colour in the scene. |
| 3 | Trees and rocks look pasted on. No dappled light anywhere; a wood's floor is evenly lit. | Leaf parts never cast shadows (`StylizedLodRuntime.js:159`: `castShadow && part.kind !== 'leaf'`). Only trunks do. Grounding is a baked 4 m disc per tree. |
| 4 | From the air every tree sits on a brown disc; snow sheets have a dark brown rim; taiga in clear weather shows rivers of white on green. | The contact-shade disc is a smooth quadratic falloff tinted from the *path* colour `#b7a476` (`terrainMaterial.js:311-321`). Grass retreats 20 m from snow by distance, not noise (`GrassHabitatCoverage.js:16`), exposing dark thaw soil. Snow's partial-cover edge is ±0.06 wide (`SnowAccumulation.js`). |
| 5 | Teal-grey bushes in grassland; pale flat boulders; a white ghost boulder in clear taiga; grey cones in the wetland. | Bushes take the palette of their variant's *first* tile (tile 6, leaned 30 % to teal `#1d5a42`), not the tile they stand on (`StylizedBushView.js:217,234`). All boulders come from one painted donor GLB, flat-shaded, with no rock row for tiles 4, 5, 6, 9. Rock snow switches fully on above 0.12 (`snowDeposition.js:99-100`) and taiga sits at 0.1. The cones are `swamp-knees-01.glb`, six-sided with a procedural texture. |
| 6 | Forests are evenly spaced polka dots of one size. | Hard-core thinning with a fixed radius per species (`StableScatterManifest.js:389-430`, `ForestSpeciesRegistry.js:255`); tree scale spans only 0.85–1.15. |
| 7 | Clouds are flat white cotton. The same grade sits on noon, dusk, storm and night. | Cloud core colour `#b8c6d2` is nearly as light as the edge `#f7fbff`, and there is no base shading. The grade uniforms are written once and never change (`StylizedGodRaysPostProcess.js:157`); a look only moves exposure. |
| 8 | Town: wall, tower and paving are one grey-beige. Houses meet the grass in a hard line. | Walls, towers and keeps are always `masonry` grey `[134,132,121]`; all eight dressings share the same two stone sets; paving is tinted near-white per stone. Buildings have no contact shade (trees and rocks do). |

Measured on the baseline (HSV saturation of the mean colour, clear noon):
ground 0.16–0.68 with hue 47°–112° across temperate biomes; sky zenith
0.23–0.50; horizon band 0.05–0.19.

### Other sessions are working in this checkout now

Checked at 04:28 on 2026-11-11: files of the **trees plan** (`tools/blender/tree_*.py`,
`boreal_trees/`, `scripts/fetch-polyhaven-sources.mjs`) were being written that
minute, and **coherence phase 1** has its gates sitting uncommitted in the look
fixture. So "fold in" cannot mean "take over" for those two. Rule used below:

> **Claim check.** Before starting any folded-in phase, run `git status` and
> `git log -5` on that phase's files. If they carry uncommitted changes this
> session did not make, or a commit landed in the last hour, that phase belongs
> to another session: skip it, note it, and move on.

## Rules for every stage

1. `main` only. `git pull` first. Commit with `git add <own paths>`, never
   `git add -A`: the tree holds other sessions' uncommitted work. No `wip`
   messages.
2. CLAUDE.md limits apply: no `viewport*Texture` nodes, no scene lights, no
   new terrain samplers (extra taps of an existing sampler are allowed), no
   authored GLB on the boot path (register a residency layer with `tileIds`).
3. Captures: `npm run qa:look` (dev server on 5174; it waits for
   `tmp/perf-browser-<platform>.lock`). Each stage adds its gates to
   `scripts/fixtures/environment-look-shots.json` in its own commit.
4. Performance: a stage that changes terrain generation, streaming, shadows,
   tree counts or shaders runs the A/B of `docs/perf-qa.md` against the commit
   before it, same `--warmup`. Budget, as in the coherence plan §6.4:
   `summary.phases.render.avgMs` within +0.25 ms and `gpuRender.total.avgMs`
   within +0.20 ms unless the stage states its own budget. A significant
   visual gain may go a little over, as long as the run stays above 60 FPS
   (user, 2026-11-12); state the measured cost. Config-value-only
   stages need no run.
5. `npm test` passes before every commit.
6. After each stage, send the user the before/after of that stage's shots.
   Taste decides; the gates only prove something changed in the right
   direction.

## Stage 0 — the look bible and palette gates

**Why.** Every biome was tuned alone. Nothing states the target or fails when
a colour leaves it.

- **New `docs/look-bible.md`** (one page): the painterly-naturalism rules with
  numbers. Draft values, to be confirmed on the first capture:
  - Hue comes from the biome ramp; scans give shape, cutout and relief only.
  - Bare soil is a soil colour, never a map colour.
  - One haze colour per view: everything distant fades to the sky's horizon.
  - Clear noon, vegetated ground: mean saturation 0.30–0.55, lit-to-shade
    spread (`groundContrast`) at least 70.
  - Sky zenith saturation 0.35–0.50; horizon band at least 0.15.
  - Props take their tint from the biome they stand in.
- **`scripts/lib/look-metrics.mjs`**: add per-region mean `sat` and `hue`
  (HSV of the region's mean colour) to `full`, `sky`, `ground`, `band`, a new
  `horizon` region (rows 35–43 % of height), and `satP95`. `checkGates`
  already resolves dotted paths, so `ground.satMax` needs no gate code. Extend
  `test/look-metrics.test.js` with one synthetic case per new field.
- **New `test/palette-coherence.test.js`** (the palette lint): reads
  `config/biome-looks.yaml` and the meadow palette in `editor.config.yaml` and
  fails when a land tile (1–12, 32+) has no `soil`, or when a soil, grass base
  or grass tip falls outside the bible's saturation and value ranges. It is
  committed in stage 3, when the config passes it.
- Run `npm run qa:look -- --no-gates` once and keep the folder as
  `docs/qa/environment-look/round3-baseline/`. Every later gate literal comes
  from this run.

**Commit.** `Look bible: stated palette and haze rules, saturation and horizon metrics`

## Stage 1 — land the open coherence phases

Run `docs/plans/environment-coherence-plan-2026-11-10.md`
phases 2–5 as written (town night bounce, autumn confined to tiles 4 and 6 and
taiga canopy snow 0.3, ground variety, storm sky). None has landed:
`AUTUMN_TILE_IDS` and `DAY_GROUND_LUMINANCE` do not exist yet. Phase 1 (storm
ground, blizzard) is subject to the claim check; today it is in another
session's hands.

The trees plan is in flight in another session and is not touched here. The
understory plan has not started; it is stage 7.

## Stage 2 — one atmosphere

**Why.** Cause 1 and cause 7. This is the largest single coherence gain and it
is almost all uniform wiring.

1. **One haze colour.**
   - `foliageLight.js`: the tree-air in-scatter reads the scene fog colour
     (the `SunHazeFog` colour, so it also warms toward the sun) instead of the
     hemisphere sky colour.
   - `MacroFarTerrainView.js`: the aerial mix reads the same fog colour.
     Delete `sky.aerial.horizonColor` from `editor.config.yaml` and its
     validator entry.
   - `SkyPresets.js`: new test in `test/sky-look.test.js` — for every preset
     and every overlay output (`regionalSkyLook`, `snowCountryLook`,
     `bogMurkLook`, `stormAirLook`), `fogColor` lies within a stated colour
     distance of `lowColor` unless `skyFog` ≥ 0.7. Fix the presets that fail.
   - Impostors bake their foliage settings into the atlas; this change is in
     shared runtime light code, so no rebake is expected. Confirm
     `assetIntegrity.atlasCount` after the change.
2. **The horizon keeps its colour.** Measure the `horizon` region on
   `grassland`, `desert`, `coast`. If saturation is under 0.15, lower
   `cloudLighting.horizonHaze` (0.65) in steps of 0.1 to a floor of 0.35, then
   `sunHaze.broadStrength` (0.22) in steps of 0.04 to 0.1.
3. **The sea's far edge.** `coast-off-12` ends in a navy band under a hard
   line. Bisect, one temporary edit at a time: water `fadeDistance` 275 →
   2000; scene fog off on the water material; far-sea colour. Fix the owner so
   distant water takes the haze like land does.
4. **Clouds with a body** (`StylizedSkyView.js` cloud nodes,
   `cloudLighting.js`, config `stylizedSurface.sky`):
   - Core colour `#b8c6d2` → about `#8e9db0` at noon; edge stays.
   - `cloudSharpness` 0.24 → 0.14 (a lower value is a crisper edge).
   - New base term: sample the existing cloud noise once more, offset toward
     the zenith, and darken where there is cloud above. One extra noise
     evaluation on sky pixels only; the GPU has about 13 ms spare.
   - Fallback if the review still says "cotton": replace the hashed value
     noise with a generated tileable Perlin–Worley texture, loaded after the
     first frame with the procedural noise as the stand-in. Do this only on a
     failed review.
5. **The grade follows the look.**
   - `SkyLook.js`: optional `grade { saturation, contrast, lift, gain }`,
     blended through the existing look chain like every other field.
   - `StylizedSkyView.js:447-451`, where exposure is written: also write the
     resolved grade to the finish uniforms (`createFinishUniforms` already
     makes them live uniforms). Pass the uniforms in from
     `StylizedGodRaysPostProcess.js`.
   - Starting values: golden hour gain `[1.05, 1.0, 0.94]`; night saturation
     0.82 with a blue lift; storm (`stormAirLook`) saturation 0.86 and
     contrast 1.06; snow country contrast 1.06. Noon is today's grade.

**Gates** (literals from the stage 0 run): `horizon.satMin: 0.15` on the three
open poses; `sky.sdMin` on `grassland-off-12` and `coast-off-12` at 1.2× the
baseline; `maxRowStepMax` on the band rows of `coast-off-12` at half the
baseline; `forest-storm-12` `full.satMax` below `forest-off-12`'s.
Performance A/B at the forest pose (shader change).

**Commit per item**, for example `One haze: trees and far terrain fade to the scene's fog colour`.

## Stage 3 — one palette for the ground

**Why.** Cause 2.

1. **`config/biome-looks.yaml`**: add `soil` to tiles 1, 4, 5, 6, 7, 8, 10
   and 11. Pick each from the litter and substrate colours the bake already
   uses for that biome (`terrain-material-bake.yaml` substrate tints,
   `forestFloor.litterColor '#6e5435'`), so soil, litter and duff are one
   earth family. Starting points: 4 `#6b5d3e`, 5 `#5d4a30`, 6 `#4f4230`,
   7 `#3d2f20`, 8 `#3a3324`.
2. **Default meadow palette** (`grass.meadow.palette`, base `#5f8f34`, tip
   `#c4d27a`): lower the base's saturation about 15 % and move it toward
   yellow-green, for example `#62883c`. Grassland and the legacy forest pose
   both use it.
3. **Earth takes the biome's soil.** In `terrainMaterial.js:311-321` the duff
   colour mixes 50 % toward the tile's soil instead of deriving from the path
   colour alone. The path tread (`terrainPathPaint.js`) does the same at
   30 %.
4. Commit `test/palette-coherence.test.js` from stage 0.
5. Re-run coherence phase 4's `chromaSd` gates: variety must survive the
   desaturation.

**Gates.** `forest-off-12` `ground.satMax: 0.55` (was 0.68); `ground.hue`
between 65 and 95 on forest, grassland and `core-deciduous`; `ground.mean`
within ±10 % of baseline on each (calmer, not darker). The bake changes, so
run the terrain A/B.

**Commit.** `Ground palette: every biome has a soil, a calmer default sward, earth tones follow the biome`

## Stage 4 — ground that is not a mask

**Why.** Cause 4, plus the shoreline and the grass seam.

1. **Tree discs** (`terrainMaterial.js:311-321`, `contactShade.js`): multiply
   the contact weight by the existing meso noise before the two smoothsteps so
   the edge is ragged, and scale the *duff* share by canopy coverage so a lone
   meadow tree darkens the grass under it without a dirt patch.
2. **Snow edge.**
   - `GrassHabitatCoverage.js`: the barren threshold for snow 0.5 → 0.8 and
     the fade 20 m → 8 m, jittered by the snow drift noise so grass and snow
     interleave.
   - `SnowAccumulation.js`: `DRIFT_EDGE` 0.06 → 0.14.
   - `terrain-material-bake.yaml`: thaw `tintMix` 0.82 → 0.5.
   - `snowDeposition.js:99-100`: replace the full-on switch at 0.12 with a
     ramp over 0.05–0.5, which removes the white ghost boulders in taiga.
   - Taiga in clear weather should carry patches, not sheets. With the bake
     open, tune `snowPatchScale` (60 m) and `snowPatchStrength` (0.45) for
     low biome cover until `core-taiga-air-off-12` shows patches under about
     15 m across. Stop and report if that cannot be reached with those two.
3. **Grass band seam at 6 m.** Bisect in this order: medium band segments
   3 → 5 (`grass.meadow` LOD table); card pigment melt matched to blade melt
   over 9–14 m; ground-scan fade start. Keep the first that removes the line
   in the `forest-off-12` foreground. Segments cost triangles in the meadow,
   the most expensive draw, so that option needs the A/B.
4. **Shoreline.** `SeaSurfaceShading.js:167-172`: the shore line is a smooth
   0.45-opacity band over 0.06–0.6 m of depth. Narrow it to 0.06–0.25 m,
   break it with the foam pattern the storm sea already uses, and move the
   three numbers to `config/water-visual.yaml`.
5. **Submerged props** read as pale cut-outs through clear water. Find what
   tints them by depth (or does not) and give them the water's depth colour.

**Gates.** A new `mudShare` metric (share of pixels with R > G > B and luma
under 90) with a `Max` at half the baseline on `forest-air-off-12`,
`core-taiga-air-off-12` and `core-deciduous-air-off-12`; `maxRowStepMax` on
`forest-off-12` ground rows; `coast-off-12` visual review. Terrain A/B.

## Stage 5 — props that belong to their biome

**Why.** Cause 5.

1. **Bushes take the tile they stand on.** `StylizedBushView.js:217,234`:
   resolve the palette from the instance's tile through a per-instance tint
   ratio, the pattern `forest/forestLeafTint.js` uses for crowns. If the
   instance has no free attribute, fall back to variants carrying an explicit
   `paletteTileId`. Add an `understory` row for tile 4 in
   `config/biome-looks.yaml`.
2. **Scanned boulders.** Replace the donor pack's two variants one for one
   (draw count unchanged) with CC0 Poly Haven rock scans, reduced in headless
   Blender to about 1.5–3 k triangles with 1 k albedo and normal maps, smooth
   shaded. Reuse `scripts/fetch-polyhaven-sources.mjs` and the headless
   Blender flow of the understory plan §5 once those are committed; register
   them as rock residency variants with `tileIds`. Per the bible, albedo is
   normalised and hue comes from the tint.
3. **Rock rows for tiles 4, 5, 6 and 9** in `config/biome-looks.yaml`, tinted
   toward the terrain's own rock scan mean so a boulder matches the cliff
   behind it.
4. **Swamp knees.** Rebuild `swamp-knees-01` in
   `tools/blender/swamp_trees/build_swamp_understory.py`: 12 sides, irregular
   taper, the swamp bark profile, moss at the waterline.
5. **Buildings meet the ground.** Add building footprints to the contact-shade
   bake (`contactShade.js`) from the derived settlement plan, 0.8 m wide,
   strength 0.6. The plan is deterministic, so the bake does not depend on
   which chunks are resident. Skip this item if the footprints are not
   reachable from the chunk bake without a new dependency; report instead.

**Gates.** `grassland-off-7` and `grassland-off-12`: a colour-distance check
between bush pixels and the ground mean is impractical, so the gate is the
palette lint (tile 4 has an understory row) plus review. Startup: boot asset
count and `assetIntegrity` unchanged. A/B at the forest pose.

## Stage 6 — light under the trees

**Why.** Cause 3. Dappled shade is the strongest missing depth cue.

1. **Trial A, one line.** `StylizedLodRuntime.js:159`: let leaf parts of the
   near band cast shadows. Run the A/B at the forest pose and the town pose.
   Accept within the standard budget.
2. **Trial B, if A fails the budget.** No extra draws: in the terrain and
   meadow shaders, read the forest-floor texture's canopy coverage a second
   time at a position offset along the sun's ground direction by crown height
   ÷ tan(elevation), and multiply sunlight by it, broken by a slow leaf noise
   for dapple. Apply the same term in `foliageLight.js` for bushes and ground
   plants (this is also what understory plan §7.2 asks for).
3. Whichever lands: raise the lit-to-shade separation only if the gate asks,
   by lowering hemisphere intensity 1.25 in steps of 0.1 to a floor of 1.0.

**Gates.** `groundContrastMin: 70` on `core-deciduous-off-12` and
`core-rainforest-off-12`; `ground.mean` no lower than 0.85× baseline.

## Stage 7 — understory

Run `docs/plans/understory-aaa-plan-2026-11-10.md`
as written, after the claim check. Two adjustments: its §7.2 (canopy shade on
plants) is already done if stage 6 trial B landed, and its colour decisions
are checked by the palette lint.

## Stage 8 — forests that mass

**Why.** Cause 6. Wait until the trees plan's rebake has landed, so the
impostors are rebaked once.

1. **Clumps and gaps.** `ForestSpeciesRegistry.js:255`: multiply the spacing
   radius by a low-frequency grove factor, 0.55–1.3, hashed from position.
2. **Size classes.** `trees.minScale`/`maxScale` 0.85/1.15 → 0.7/1.35;
   ancients from patch coverage above 0.8 (today 0.93).
3. **Closed forest is closed.** `maxAcceptedPerChunk` 110 → 160 for tiles 7
   and 8 only if the A/B passes; otherwise keep 110.
4. `npm run bake:impostors`, then check `assetIntegrity.atlasCount`.

**Gates.** New unit test beside `tests/scatterSpacing.test.js`: the
coefficient of variation of nearest-neighbour distance in a forest-core
manifest is at least 0.45. `core-rainforest-air-off-12` must stay distinct
from `core-taiga-air-off-12` (coherence §6.4 gate). Full A/B.

## Stage 9 — the town

**Why.** Cause 8. Night and rain come from coherence phases 1–2.

1. **Paving stands off from walls.** `SettlementPavingMaterial.js:9-14`:
   paving tint value about 0.75 of the wall stone and slightly cooler. Add
   one CC0 cobble set through `scripts/fetch-settlement-textures.mjs` so
   paving is not the wall's stone; keep it neutral, loaded on approach.
2. **Defences take the town's stone.** `SettlementBuildingCatalog.js:128`:
   walls, towers and keeps use the settlement's stone hue through
   `KIT_HUE`, not the fixed grey.
3. **More plaster on the square.** Raise the limewash, ochre and rose share
   in the pooled variants for the granite-slate style, which 13 of 23 realms
   use.
4. **Fix the undefined styles.** `config/visual-identity.yaml` references
   `swamp-thatch` and `timber-thatch`, which no style defines. Map them or
   define them.
5. Correct `docs/settlement-rendering.md:324` (it states 55 %/45 % hue keep;
   the code holds 0.78/0.55/0.72/0.65).

**Gates.** `town-off-12`: `satP95Min` at 1.3× baseline and `chromaSdMin` at
1.25× baseline; `ground.mean` at most 0.9× the `band` mean (paving darker
than the façades). `npm run qa:world:visual` town shots. Town A/B.

## Stage 10 — finish and record

1. **Fog speckle** (look-round item 16, `town-rain-12`): find the dithered
   LOD and fog interaction and fix it.
2. **Dark specks on the sky**: the ambient leaf and pollen particles draw
   dark against the dome. Fade them by distance or lift their sky-facing
   shade.
3. Full `npm run qa:look`, `npm run qa:weather:browser`, and the performance
   matrix. All pass.
4. Record in the work order: the gate table with baseline and final values,
   a before/after contact sheet, and what stays open.
5. Update `docs/lighting-atmosphere.md` (one haze, grade per look),
   `docs/biome-looks.md` (soil is required), `docs/perf-qa.md` (new metrics).

## Files this plan creates

| File | Purpose |
| --- | --- |
| `docs/plans/coherence-polish-plan-2026-11-11.md` | This plan as the repo's work order, first commit after approval. |
| `docs/look-bible.md` | The stated target. |
| `test/palette-coherence.test.js` | Palette lint. |

Everything else edits existing files named in the stages. Reused as they are:
`scripts/run-environment-look-qa.mjs`, `scripts/lib/look-metrics.mjs`
(`regionStats`, `checkGates`), `scripts/perf-run-lock.mjs`
(`waitForPerfRunLock`), `scripts/fetch-polyhaven-sources.mjs`,
`scripts/fetch-settlement-textures.mjs`, `tools/blender/tree_kit.py`,
`forest/forestLeafTint.js` (per-instance tint pattern), `contactShade.js`,
`createFinishUniforms` in `cinematicFinish.js`.

## Not in this plan

- Volumetric clouds or fog, SSR, extra shadow cascades (the cascade trial was
  measured and rejected on 2026-11-10), a season system, a new "environment
  resolver" layer.
- TRAA in the walking view. It runs MSAA plus FXAA today; changing the
  anti-aliasing is its own measured round.
- New tree species (the trees plan) and anything in the performance plan.
- Biome border geometry. Stage 4 only breaks the snow edge and the tree
  discs; the ±10 m border blur stays.

## Verification

- Per stage: `npm test`; `npm run qa:look -- --only <the stage's shots>`;
  the A/B of `docs/perf-qa.md` where the stage says so; before/after images to
  the user.
- End to end (stage 10): `npm run qa:look` exits 0 on all 38 shots with every
  new gate; `npm run qa:weather:browser` passes its 14 cases;
  `npm run qa:world:visual` passes; the performance matrix stays inside the
  ceilings recorded on 2026-11-10.
- Open the app (`npm run dev`, port 5174) and walk forest → coast → town at
  noon, dusk and in rain: one haze colour to the horizon, shade under crowns,
  no map-coloured ground, no brown discs or snow rims, paving darker than
  walls.

## Expected result

| Today | After |
| --- | --- |
| Three hazes per view | One: trees, far land and sea fade to the sky's horizon |
| Neon lawn, map-coloured bare ground | Per-biome soils and a calmer sward, checked by a lint test |
| Evenly lit forest floor | Shade under crowns, with dapple |
| Brown discs, snow rims, shore smear | Ragged litter, interleaved snow and grass, a foam line |
| Teal bushes, painted boulders, cone knees | Props tinted by their biome; scanned boulders |
| Polka-dot forests | Clumps, gaps and three size classes |
| Flat white clouds, one grade for every hour | Clouds with dark bases; grade follows hour and weather |
| One-stone town | Paving, defences and plaster each with their own value |

Unverified until implementation: the cause of the sea's dark far edge, of the
submerged cut-outs, of the 6 m grass seam and of the fog speckle (each has a
bisection, not a known fix), and whether crown shadows fit the frame budget.
