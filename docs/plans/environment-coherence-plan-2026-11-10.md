# Environment coherence plan — 2026-11-10

This is a work order for an implementing agent. Every phase names the files, the
change, the values, the test and the numbers that decide pass or fail. Do the
phases in order, one commit per phase, on `main`. Do not add anything this
document does not ask for. Where a phase says "revert", run `git revert` on that
phase's commit and move to the next phase.

Read `CLAUDE.md`, [perf-qa.md](../perf-qa.md) and
[aaa-look-round-2026-11-09.md](aaa-look-round-2026-11-09.md) first. Their rules
apply to every phase: no `viewport*Texture` nodes, no scene lights, no new
terrain samplers, no authored GLB added to startup, no `wip` commit messages.

## 1. Where this comes from

An external review of the 23-capture contact sheet
(`docs/qa/aaa-look-2026-11-09/contact-sheet.jpg`) asked for a rework of
lighting, weather, biome identity, ground, vegetation, town dressing and a new
"environment resolver" architecture. That sheet was captured at `b1c8f90f`. It
predates the time-of-day capture fix (`f0e62293`), the water round (`86e7e569`)
and the uncommitted wet-ground, blizzard and snow-cover work in the tree today.
Half of what the review saw is already fixed or was never a renderer fault.

### 1.1 Verdict on each claim

| Review claim | What the code says | Verdict |
| --- | --- | --- |
| Time of day is broken (21:00 looks like noon) | A capture bug: `WorldVisualQa.setLighting` forced the `highfield` preset. Fixed in `f0e62293`; `tmp/aaa-look-d/sheet.jpg` shows dusk and night. | **Done.** Left over: the town night look (phase 2). |
| Extreme weather erases the scene | True at `b1c8f90f`. The tree holds uncommitted fixes: `SNOW_STORM_VISIBILITY` 50 → 140, wet albedo floor 0.6, puddle sky reflection, storm snow on grass and far terrain. | **Accept.** Land and gate it (phase 1). |
| Build an environment resolver so weather, light and ground share one state | It exists. One eased storm value (`StormState`) drives rain, snow, sky, sea, wetness and audio. A sky look is resolved through one chain: preset → `regionalSkyLook` → `snowCountryLook` → `overcastSkyLook` → `bogMurkLook` → `stormAirLook`. Per-biome columns live in `config/biome-looks.yaml`. | **Reject.** No new layer. |
| Rainforest looks like sparse woodland | The profile is `closed_forest`, density 0.94, with a tropical kit of nine ground prototypes. The capture pose stood on a hill at the biome's edge with tundra conifers behind it. Forest biomes 5–8 also stop growing trees above 42–48 m (`elevationMax`). | **Partly.** Fix the pose and the height limit (phases 0 and 3). No new vegetation system. |
| Taiga looks like an autumn wood | The taiga palette is conifers only. The red trees are an autumn grove; autumn is not confined to any biome, so it can also turn a rainforest or savanna stand orange. Taiga crowns carry `snow.canopy: 0.7` over ground at `0.1`, so white trees stand on green grass. | **Accept.** Confine autumn, lower canopy snow (phase 3). |
| Wetland water reads as a black hole in rain | True at `b1c8f90f`; the uncommitted puddle reflection and albedo floor address it. | **Accept.** Phase 1. |
| Forest floor is a manicured lawn; grass is uniform | True. Core grass density in a temperate wood is 0.45 and the meadow's patch and dry-sward tints are mild. | **Accept.** Config tuning (phase 4). |
| Snow is too smooth; add drifts, wind erosion, blue ice, crevasses | `SnowDriftShading.js`, `GlacierIceShading.js`, crags and rock snow caps exist; the review's own list of what reads well includes the glacier. | **Reject.** Only blizzard visibility is open (phase 1). |
| Desert needs sand ripples, rock strata, dry plants | `AridSubstrateNodes.js` dunes, `formations`, the arid ground kit and `CanyonRelief` exist. | **Reject.** |
| Town needs barrels, carts, stalls, lanterns, planters | `SettlementDecor.js` already places lanterns, planters, barrels, stalls, benches, wells, fountains, signposts and fences. | **Reject.** Wet paving is in phase 1; night is phase 2. |
| Triplanar on steep slopes, macro colour variation | `TerrainRockDetail.js`, `FarAlpineSurface.js` and the bake's macro tint exist. | **Reject.** |
| Storm sky is a flat grey card | True. `overcastSkyLook` flattens cloud detail and `stormAirLook` fogs the dome by 0.7. | **Accept.** Phase 5. |
| Seasons | There is no season state. Not adding one. | **Reject.** |
| Skip SSR, extra shadow passes and volumetrics | Agreed. | **Accept.** |
| Screenshot regression tests per biome, hour and weather, with perf | The capture script is an untracked file in `tmp/` with hand-picked poses and no checks. | **Accept, first** (phase 0). |

### 1.2 What was checked and what was not

Checked by reading the code on 2026-11-10: every file and value named in the
phases below. Measured from the existing captures: the luminance numbers in the
gate tables (480×270 downscale, the same method phase 0 specifies).

Not checked: a fresh capture of today's tree. A capture run was started and
abandoned because another session took `tmp/perf-browser-win32.lock` for a
performance run. So the phase 1 gates are targets for the uncommitted work, not
measurements of it, and two causes below are stated as the code-supported
hypothesis with a rule for what to do when the capture disagrees.

## 2. Rules for every phase

1. `git pull` first. Other sessions share this checkout. Do not touch files a
   phase does not list.
2. Before any browser run, wait for `tmp/perf-browser-<platform>.lock` with
   `waitForPerfRunLock` (`scripts/perf-run-lock.mjs`). Never start a capture
   while another session holds it.
3. Serve with the `dev` entry of `.claude/launch.json` (port 5174).
4. `npm test` passes before every commit.
5. A phase that changes only uniform values or YAML numbers needs no
   performance run. Phase 3 step 3 changes how many trees are drawn and needs
   the A/B in §6.4.
6. After each phase, run `npm run qa:look` (phase 0) and paste the gate table
   from its `report.json` into the commit body.

## 3. Phase 0 — a tracked look harness with honest poses

**Why.** The review judged two biomes from poses that were not inside them, and
nothing fails when a look regresses. Every later phase is gated on this.

### 3.1 Files

| File | Action |
| --- | --- |
| `scripts/run-environment-look-qa.mjs` | New. Start from `tmp/aaa-look2.mjs`. |
| `scripts/fixtures/environment-look-shots.json` | New. Poses, shots and gates. |
| `scripts/lib/look-metrics.mjs` | New. Pure functions, no I/O. |
| `test/look-metrics.test.js` | New. |
| `src/editor/performance/qa/WorldVisualCanopyPose.js` | New. |
| `src/editor/performance/qa/WorldVisualQa.js` | Two one-line delegating methods. |
| `package.json` | Add `"qa:look": "node scripts/run-environment-look-qa.mjs"` after `qa:world:visual`. |

### 3.2 `WorldVisualCanopyPose.js`

```js
/** The forest habitat at a canonical point, or null before the tree manifests exist. */
export function habitatAt(editor, x, z) {
  const sample = editor.stylizedSurface.treeView?.manifestStore?.forestField?.sample(x, z);
  if (!sample) return null;
  const { tileId, profileKey, patchCoverage, patchEdge, elevationWeight } = sample;
  return { tileId, profileKey, patchCoverage, patchEdge, elevationWeight };
}

/** Nearest point within `radius` of (x, z) that is inside `tileId` under closed canopy. */
export function findCanopyPose(editor, { x, z, tileId, coverage = 0.75, step = 16, radius = 480 }) {
  const field = editor.stylizedSurface.treeView?.manifestStore?.forestField;
  if (!field) return null;
  const store = editor.terrainView.worldStore;
  const cell = store.tileSize;
  const rings = Math.floor(radius / step);
  for (let ring = 0; ring <= rings; ring += 1) {
    for (let i = -ring; i <= ring; i += 1) {
      for (let j = -ring; j <= ring; j += 1) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const px = x + i * step;
        const pz = z + j * step;
        if (store.getTile(Math.floor(px / cell), Math.floor(-pz / cell)) !== tileId) continue;
        const patchCoverage = field.sample(px, pz)?.patchCoverage ?? 0;
        if (patchCoverage >= coverage) return { x: px, z: pz, patchCoverage };
      }
    }
  }
  return null;
}
```

The tile lookup is the one `WorldVisualQa.diagnostics()` already uses for
`actualBiomeId`. In `WorldVisualQa`, add next to `findBiomeSurfacePose`:

```js
findCanopyPose(options) { return findCanopyPose(this.editor, options); }
habitatAt(x, z) { return habitatAt(this.editor, x, z); }
```

The forest field exists only after tree manifests are built, so the script
calls these after a `cut` and `settle` at the anchor.

### 3.3 `look-metrics.mjs`

All metrics run on the capture downscaled to **480×270** with
`sharp(file).removeAlpha().resize(480, 270, { fit: 'fill' }).raw()`. Luma is
`0.2126 R + 0.7152 G + 0.0722 B` on the 8-bit sRGB values, not linearised.

| Export | Definition |
| --- | --- |
| `regionStats(data, width, y0, y1)` | `{ mean, p05, p95, sd }` of luma over rows `y0 ≤ y < y1`. Percentiles from the sorted values at `floor(n × 0.05)` and `floor(n × 0.95)`. |
| `lookMetrics(data, width, height)` | `{ full, sky, ground, band, groundContrast, maxRowStep, warmth, redShare, chromaSd }` as below. |
| `full`, `sky`, `ground`, `band` | `regionStats` over rows 0–270, 0–81, 162–270 and 108–216. |
| `groundContrast` | `ground.p95 − ground.p05`. |
| `maxRowStep` | Mean luma per row over rows 162–270; the largest absolute difference between two consecutive rows. Detects a hard horizontal seam. |
| `warmth` | Mean R ÷ mean B over rows 108–216. |
| `redShare` | Share of all pixels with `R > 90` and `R > 1.25 × G`. |
| `chromaSd` | Standard deviation of `G − R` over rows 162–270. |
| `checkGates(metrics, gates, baseline)` | Returns `[{ gate, value, limit, passed }]`. Gate keys are dotted metric paths with a `Min` or `Max` suffix, for example `ground.meanMin`, `sky.sdMin`, `groundContrastMin`, `redShareMax`. A key ending in `RatioMax` or `RatioMin` compares against the same metric of the shot named in the gate's `against` field of this run, for example `{ "full.meanRatioMax": 0.5, "against": "town-off-12" }`. |

Test (`test/look-metrics.test.js`): a 4×4 synthetic image whose top half is
value 200 and bottom half value 50 gives the expected means and a
`maxRowStep` of 150 when the regions are passed explicitly; a uniform image
gives `sd` 0 and `groundContrast` 0; a pixel `(200, 100, 100)` counts toward
`redShare` and `(200, 180, 100)` does not; `checkGates` fails a `Min` gate one
below the value and passes it at the value.

### 3.4 The fixture

`poses` (canonical metres, as `cut()` takes them). Legacy poses come unchanged
from `tmp/aaa-look2.mjs`.

| id | world | x | z | yaw | pitch | mode | height | fov | tileId | canopy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `forest` | procedural | 3135 | 7229 | 1.782 | −0.08 | player | 1.7 | 68 | — | no |
| `forest-air` | procedural | 3135 | 7229 | 1.782 | −0.4 | fly | 60 | 60 | — | no |
| `grassland` | procedural | −1869 | −4003 | 2.488 | −0.08 | player | 1.7 | 68 | 4 | no |
| `wetland` | procedural | 11495 | 9197 | 1.879 | −0.08 | player | 1.7 | 68 | 12 | no |
| `coast` | procedural | −2077 | 1731 | −1.571 | −0.08 | player | 1.7 | 68 | — | no |
| `desert` | procedural | −5791 | −27 | 5.357 | −0.08 | player | 1.7 | 68 | 1 | no |
| `legacy-rainforest` | procedural | −13937 | −14851 | 5.973 | −0.08 | player | 1.7 | 68 | — | no |
| `legacy-taiga` | procedural | −2847 | −6683 | 0.305 | −0.08 | player | 1.7 | 68 | — | no |
| `core-deciduous` | procedural | 8901 | 15277 | 0 | −0.08 | player | 1.7 | 68 | 6 | yes |
| `core-rainforest` | procedural | 12991 | −1419 | −0.785 | −0.08 | player | 1.7 | 68 | 7 | yes |
| `core-temperate-rainforest` | procedural | 10119 | 5719 | 0.785 | −0.08 | player | 1.7 | 68 | 8 | yes |
| `core-taiga` | procedural | −6951 | 10379 | 0.785 | −0.08 | player | 1.7 | 68 | 9 | yes |
| `core-wetland` | procedural | −5773 | −7687 | 2.356 | −0.08 | player | 1.7 | 68 | 12 | yes |
| `tundra` | eldara | 151523 | −49043 | 0.6 | −0.12 | player | 1.7 | — | — | no |
| `glacier` | eldara | −282505 | −389567 | 1.2 | −0.25 | fly | 25 | — | — | no |
| `snow-eye` | eldara | −3291493 | −210747 | 2.0 | 0.05 | player | 1.7 | — | — | no |
| `town` | eldara | −6724492 | −347232 | 1.32 | 0.14 | player | 1.7 | — | — | no |

The five `core-*` anchors are what `findBiomeSurfacePose(tileId)` returned on
2026-11-10 for tiles 6, 7, 8, 9 and 12 (seed 20261103, procedural world). Each
also has an `-air` twin (`core-rainforest-air` and so on): same resolved x, z
and yaw, `mode: fly`, `height: 45`, `pitch: −0.45`, `fov: 60`.

A pose with a `tileId` fails its shot when `diagnostics().actualBiomeId`
differs. A pose with `canopy: yes` is resolved at run time: cut to the anchor,
settle, call `findCanopyPose({ x, z, tileId })`, then cut to the result. If it
returns `null` the shot fails with `no closed canopy within 480 m`.

`shots` — 38 in all, in this order so each world loads once:

| Group | Shots (`pose-weather-hour`) |
| --- | --- |
| Clear noon, procedural | `forest`, `forest-air`, `grassland`, `wetland`, `coast`, `desert`, `legacy-rainforest`, `legacy-taiga`, the five `core-*` and their five `-air` twins, all `off-12` |
| Hours, procedural | `forest-off-7`, `forest-off-18.6`, `forest-off-21`, `grassland-off-7`, `core-rainforest-off-18.6` |
| Weather, procedural | `forest-storm-12`, `forest-air-storm-12`, `wetland-rain-12`, `coast-storm-12`, `core-taiga-snow-12`, `core-taiga-air-snow-12` |
| Eldara | `tundra-off-12`, `glacier-off-12`, `snow-eye-off-12`, `town-off-12`, `town-off-21`, `tundra-snow-12`, `snow-eye-snow-12`, `town-rain-12`, `town-rain-19` |

Gates in the fixture when phase 0 is committed. "Was" is the value measured on
the `b1c8f90f` capture set.

| Shot | Gate | Was | Owner |
| --- | --- | --- | --- |
| every shot | `full.meanMin: 25`, `full.meanMax: 235` | 51–213 | — |
| `forest-off-18.6` | `full.meanRatioMax: 0.85` against `forest-off-12` | 0.71 after `f0e62293` | done |
| `town-off-21` | `full.meanRatioMax: 0.5` against `town-off-12` | 0.40 after `f0e62293` | done |
| `forest-off-21` | `full.meanRatioMax: 0.5` against `forest-off-12` | not captured | done |

Gates added by later phases are listed in those phases; add each to the
fixture in that phase's commit, not before, so the harness is green at every
commit.

### 3.5 The script

Arguments: `--url` (default `http://localhost:5174`), `--out` (default
`docs/qa/environment-look/<YYYY-MM-DD>`, git-ignored like the rest of
`docs/qa`), `--only <id,id>` (shot names), `--no-gates` (capture and report,
exit 0).

Behaviour, in order:

1. `waitForPerfRunLock(path.resolve('tmp', \`perf-browser-${process.platform}.lock\`))`;
   release it in `finally`.
2. Launch headed Chromium with
   `--enable-unsafe-webgpu --ignore-gpu-blocklist --use-angle=default --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`.
   The last three keep frames running when the desktop app covers the window.
3. One page, viewport 1600×900. `createBrowserErrorMonitor(page)`
   (`scripts/lib/perf-browser-errors.mjs`). Go to `<url>/?qaVisual=1` and wait
   for `window.__worldVisualQa` (timeout 600 s).
4. For each shot, exactly the sequence of `tmp/aaa-look2.mjs`: load the world
   if it changed; `setLighting({ hour, weather })`; resolve a canopy pose if
   asked; `prepareVisualPose(page, pose, { minimumMs: 6000 })`; `setLighting`
   again; `warmWeather(8)` unless the weather is `off`; hide the capture UI and
   the avatar; wait 1500 ms; `captureWorldCanvas` to `<name>.png`.
5. Per shot, record in `report.json`: `name`, the resolved pose,
   `diagnostics().actualBiomeId`, `habitatAt(x, z)`, the camera height above
   sea level (`diagnostics().camera[1]`), `weatherController.storm`, the sky
   look's `fogColor`, `groundLightColor`, `mist`, `nightness`, the metrics and
   the gate results.
6. Write `<name>.jpg` at 960×540 (quality 82) beside each PNG and delete
   nothing. Write `contact-sheet.jpg`: four columns of 400×225 tiles, each with
   its name in a 20 px strip above it, as in the 2026-11-09 sheet.
7. Print one line per shot (`PASS` or `FAIL`, name, failed gates). Exit 1 when
   any gate, tile check or canopy lookup failed or the error monitor counted a
   browser error, unless `--no-gates`.

Delete `tmp/aaa-look2.mjs` is **not** part of this phase: `tmp/` is untracked.

### 3.6 Gate and commit

- `node --test test/look-metrics.test.js` passes.
- `npm run qa:look` completes all 38 shots and exits 0.
- The report shows `actualBiomeId` equal to `tileId` for every pose that names
  one, and `patchCoverage ≥ 0.75` for the five canopy poses.
- Keep this run's folder as `docs/qa/environment-look/baseline/`. Later
  phases compare against it.

**Commit.** `Look QA: tracked capture harness with biome-checked poses, metrics and gates`

## 4. Phase 1 — land the storm ground and blizzard work

**Why.** Review items "weather destroys visibility", "wetland water is black"
and look-round items 1, 2, 3, 7 and 9. The fixes are already written and sit
uncommitted in these files:

`config/weather-effects.yaml`, `src/editor/performance/qa/WorldVisualQa.js`,
`src/editor/stylized/PuddleShading.js`, `src/editor/stylized/RainWetnessShading.js`,
`src/editor/stylized/meadow/meadowGrowthNodes.js`, `src/editor/stylized/meadow/meadowPigment.js`,
`src/editor/stylized/sky/stormAirLook.js`, `src/editor/terrainMaterial.js`,
`src/editor/weather/WeatherEffectsConfig.js`, `src/editor/weather/snowfall/SnowfallField.js`,
`src/editor/weather/snowfall/snowfallFieldMaterial.js`, `src/editor/world/MacroFarTerrainView.js`,
`src/editor/world/settlements/paving/SettlementPavingMaterial.js`, `src/main.js`,
`test/snowfall-field.test.js`, `test/storm-atmosphere.test.js`, `test/rain-wet-ground.test.js`.

**Step 1.** Run `git status`. If those files are clean, another session
committed them: skip to step 3. If they are modified, run `npm test`. Do not
edit them yet.

**Step 2.** Add these gates to the fixture and run
`npm run qa:look -- --only wetland-rain-12,coast-storm-12,town-rain-12,tundra-snow-12,snow-eye-snow-12,core-taiga-snow-12,core-taiga-air-snow-12,wetland-off-12,town-off-12`.

| Shot | Gate | Was |
| --- | --- | --- |
| `wetland-rain-12` | `ground.meanMin: 35` | 15 |
| `wetland-rain-12` | `ground.p95Min: 70` (puddles show sky) | 33 |
| `wetland-rain-12` | `ground.meanRatioMax: 0.8` against `wetland-off-12` (still reads wet) | 0.24 |
| `coast-storm-12` | `ground.meanMin: 40` | 27 |
| `town-rain-12` | `ground.p95Min: 135` (wet sheen on setts) | 120 |
| `tundra-snow-12` | `groundContrastMin: 30` | 7 |
| `snow-eye-snow-12` | `groundContrastMin: 30` | 8 |
| `tundra-snow-12` | `full.sdMin: 12` | about 5 |
| `core-taiga-snow-12` | `ground.meanMin: 150` (snow lies on the ground) | 95 at the old taiga pose |
| `core-taiga-air-snow-12` | `ground.meanMin: 150` | — |

**Step 3.** If a gate fails, change only the one knob named for it, by the
step given, re-run the listed shots, and stop at the bound. Record the final
value in the commit body.

| Failing gate | Knob | Step | Bound |
| --- | --- | --- | --- |
| `wetland-rain-12` `ground.meanMin` or `coast-storm-12` `ground.meanMin` | `WET_ALBEDO_FLOOR` in `RainWetnessShading.js` | +0.05 | 0.75 |
| `wetland-rain-12` `ground.p95Min` | the `0.98` Fresnel gain in `waterFresnel` (`PuddleShading.js`) stays; raise the reflection by multiplying `result` by a new constant `PUDDLE_SKY_GAIN = 1.0` | +0.25 | 2.0 |
| `wetland-rain-12` `ground.meanRatioMax` | `WET_ALBEDO_FLOOR` | −0.05 | 0.55 |
| `town-rain-12` `ground.p95Min` | `roughness` of `TOWN_WET_FAMILIES.stone` (`src/render/materials/townWetness.js`, 0.32 today; it also wets stone walls) | −0.04 | 0.2 |
| either `groundContrastMin` or `full.sdMin` | `SNOW_STORM_VISIBILITY` in `stormAirLook.js`; update the three literals in `test/storm-atmosphere.test.js` to match | +30 | 260 |
| either `core-taiga*` `ground.meanMin` | none. Confirm `e.snowCover.snap(...)` runs in `setLighting` and that `stormSnowCoverUniform` is 1 in the page; if both hold and the gate still fails, stop and report the capture, do not tune. | — | — |

If a knob reaches its bound and the gate still fails, commit what passes,
remove the failing gate from the fixture, and list it under "open" in the
commit body. Do not invent another knob.

**Step 4.** `npm test`, then `npm run qa:weather:browser`; all 14 weather cases
pass.

**Do not** change `StormState`, the rain layers, `SnowCover` timings or any
count in `config/weather-effects.yaml`.

**Commit.** `Storm ground: wet floors keep their albedo, puddles show the sky, a blizzard keeps its near field`

## 5. Phase 2 — the town at night

**Why.** Look-round item 17: at hour 21 the town square shows a warm brown band
with a hard edge. One cause is certain from the code; the rest is found by a
fixed bisection.

### 5.1 The town bounce is an absolute colour

`SettlementGroundBounce` lerps the hemisphere's ground colour 85 % of the way
to `TOWN_BOUNCE` (`#7d6d58`). That colour was tuned against a daylight ground.
The night look's ground is `#151c1b`, so in a town at night the bounce is
over ten times brighter than the look asked for (linear luminance 0.14
against 0.011), and warm. Every material
that reads `foliageLight.groundColor` (`buildingShadeEmission`,
`rockShadeEmission`, `understoryShadeEmission`, bark and crowns) takes it.

**File.** `src/editor/world/settlements/view/SettlementGroundBounce.js`.

**Change.** The town sets the bounce's hue, never its level:

```js
const luminance = (colour) => colour.r * 0.2126 + colour.g * 0.7152 + colour.b * 0.0722;
/** The daylight ground the town colour was tuned against (the highfield look's `#696b53`). */
const DAY_GROUND_LUMINANCE = luminance(new THREE.Color('#696b53'));
```

In the constructor add `this.target = new THREE.Color();`. In `update`, replace
the `this.written.copy(...)` line with:

```js
    // The town changes the bounce's hue, not how much light there is: at the
    // look's own level, or a night street glows brown under a moon.
    const level = Math.min(1, luminance(this.base) / DAY_GROUND_LUMINANCE);
    this.target.copy(TOWN_BOUNCE).multiplyScalar(level);
    this.written.copy(this.base).lerp(this.target, townBounceWeight(town));
```

Daylight looks have a ground at or above the reference, so `level` is 1 and
day captures do not change.

**Test.** In `test/settlement-ground-bounce.test.js`: the `#0000ff` case now
expects `lerp(TOWN_BOUNCE × min(1, 0.0722 / DAY_GROUND_LUMINANCE))`; export
nothing new, compute the reference in the test from `#696b53`. Add one case:
with a ground of `#151c1b` at a town centre, the written colour's luminance is
at most twice the base's.

### 5.2 Bisect the band

Add to the fixture, then run
`npm run qa:look -- --only town-off-12,town-off-21`:

| Shot | Gate |
| --- | --- |
| `town-off-21` | `warmthMax: 1.15` |
| `town-off-21` | `maxRowStepMax` = half the baseline run's `maxRowStep` for this shot, written as a literal |
| `town-off-12` | `ground.meanMin: 95`, `ground.meanMax: 130` (day unchanged; was 112) |

If `town-off-21` passes after §5.1, the phase is done. If not, test these in
order, one at a time, each as a temporary local edit that is undone before the
next. The first one that makes both `town-off-21` gates pass names the owner.

| # | Temporary edit | Owner if it passes | Permanent fix |
| --- | --- | --- | --- |
| 1 | `stylizedSurface.sky.valleyFog.enabled: false` in `editor.config.yaml` | valley mist | In `src/main.js`, where `updateValleyFog` is called, multiply `weight` by `1 - 0.8 * (skyLooks?.current?.nightness ?? 0)` and pass `sunColor` scaled by the same factor. |
| 2 | In `SettlementPavingMaterial.js`, comment out the `material.emissiveNode = buildingShadeEmission(...)` line | paving fill | Pass `{ fill: 1.35, bounce: 0.8 }` unchanged but multiply the result by a new exported `foliageLight.dayShare` frame uniform, written in `syncFoliageLight` as `1 - 0.7 * nightness` (give `syncFoliageLight` the look as a second argument at its one call site). |
| 3 | In `terrainMaterial.js`, comment out `applyJungleMist(material, surfaceEffects?.ambientEffects)` | ambient ground mist | In `JungleMist.js`, scale the returned `amount` by the region weight uniform times `1 - 0.8 * nightness`, read from the same look. |

If none of the three passes, undo all edits, keep §5.1, remove the two
`town-off-21` gates from the fixture and report the capture and the
`report.json` sky values in the commit body. Do not guess a fourth cause.

**Gate.** `npm test`; the three shots above; `town-rain-19` shows lit windows
and no brown band (`warmthMax: 1.3`, added to the fixture).

**Commit.** `Town bounce follows the look's light level, so night streets stay dark`

## 6. Phase 3 — biome identity

Three small changes. None adds a mesh, a draw or a texture.

### 6.1 Autumn stays in the temperate biomes

**Why.** `tintFor` turns a grove orange when `groveSeed < autumnShare` (0.1)
for any broadleaf species in any biome. `broadleaf_round` and `broadleaf_tall`
are in the savanna, tropical and both rainforest palettes, so one grove in ten
there is autumn red, and a red wall stands behind the taiga.

**File.** `src/editor/stylized/forest/forestLeafTint.js`.

**Change.** Add and export:

```js
/** Biomes whose broadleaf groves turn: grassland and temperate deciduous forest. */
export const AUTUMN_TILE_IDS = Object.freeze(new Set([4, 6]));
```

In `tintFor`, the autumn branch becomes:

```js
      if (autumnShare > 0 && groveSeed < autumnShare && (tileId === null || AUTUMN_TILE_IDS.has(tileId))) {
```

A `null` tile keeps today's behaviour for callers that do not know the biome.
The tint is a per-instance attribute on meshes and impostors, so no impostor
rebake is needed.

**Test.** In `tests/forestLeafTint.test.js`: with `autumnGroves: 1`,
`tintFor('broadleaf_round', 0, 6)` is an autumn ratio; the same call with tile
7 returns the tile 7 biome ratio; with tile `null` it is the autumn ratio.

### 6.2 Taiga crowns are dusted, not white

**Why.** `snow.canopy: 0.7` over `snow.ground: 0.1` gives white trees on green
grass in clear weather (visible in `taiga-off-12`).

**File.** `config/biome-looks.yaml`, tile 9.

**Change.** `snow: { ground: 0.1, canopy: 0.3, grass: 0.35, air: 0.4, fall: 0.15 }`.
Extend the comment above it with: `Canopy 0.7 capped every crown white over
green ground (2026-11-10).` Change nothing else in the row. If a test asserts
the old literal, update the literal.

### 6.3 Forest biomes keep their trees on hills

**Why.** `ForestBiomeProfiles.js` stops trees above `elevationMax` 48, 46, 42
and 45 m for tiles 5, 6, 7 and 8, fading over 6–8 m. Tiles 9, 10 and 12 were
already raised for imported worlds. A rainforest hill is bare grass.

**Rule.** Read the phase 0 baseline `report.json`. Apply this step only if
`legacy-rainforest-off-12` shows `actualBiomeId` 5, 6, 7 or 8 **and**
`habitat.elevationWeight < 0.5`. Otherwise skip §6.3 and say so in the commit
body: the pose was outside the biome and the height limit was not the cause.

**File.** `editor.config.yaml`, `stylizedSurface.trees.habitat.profiles` (the
block that today reads `5: { regionalForestFloor: 0.8 }`). The habitat sample
reports the height term as `elevationWeight`.

**Change.**

```yaml
        5: { elevationMax: 300, elevationFade: 80, regionalForestFloor: 0.8 }
        6: { elevationMax: 300, elevationFade: 80, regionalForestFloor: 0.85 }
        7: { elevationMax: 300, elevationFade: 80, regionalForestFloor: 0.9 }
        8: { elevationMax: 300, elevationFade: 80, regionalForestFloor: 0.9 }
```

300 m stays below the 450 m foot of the snow band (`snowLine` 700,
`snowFade` 250). Do not edit the defaults in `ForestBiomeProfiles.js`.

### 6.4 Gate

Add to the fixture:

| Shot | Gate | Was |
| --- | --- | --- |
| `core-taiga-off-12` | `redShareMax: 0.005` | not captured; about 0.08 at the old taiga pose |
| `core-rainforest-off-12` | `redShareMax: 0.005` | — |
| `core-rainforest-off-18.6` | `full.meanRatioMax: 0.9` against `core-rainforest-off-12` | — |
| `core-rainforest-air-off-12` | `distinctFrom: core-taiga-air-off-12`, `meanColorErrorMin: 18` (`compareRenderedImages` in `scripts/lib/rendered-image-metrics.mjs`) | — |
| `core-deciduous-air-off-12` | `distinctFrom: core-rainforest-air-off-12`, `meanColorErrorMin: 10` | — |

`npm run qa:look` exits 0 and `npm test` passes. If §6.3 was applied, run the
A/B of [performance-plan-2026-11-10.md](performance-plan-2026-11-10.md) §2
("Acceptance run for every phase") at the forest pose only, baseline = the
commit before this phase. Pass: `summary.phases.render.avgMs` within +0.25 ms
and `gpuRender.total.avgMs` within +0.20 ms of the baseline mean. If it fails,
set the four `elevationMax` values to 150 and re-run once; if it fails again,
remove §6.3 from the commit.

Update `docs/biome-looks.md`: one paragraph under "Canopy snow" for §6.2 and
one line naming `AUTUMN_TILE_IDS`.

**Commit.** `Biome identity: autumn stays temperate, taiga crowns are dusted, forests climb their hills`

## 7. Phase 4 — ground variety

**Why.** Look-round item 13 and the review's "manicured field". The grass is
one lime sheet and a wood's floor carries almost as much grass as a meadow.
The levers exist; they are set low. The meadow has no free palette slot (eight
distinct pairs are in use), so this phase adds **no** `palette.byTileId` entry.

**File.** `editor.config.yaml` only.

**Change 1** — `stylizedSurface.grass.meadow.appearance`:

| Key | From | To |
| --- | --- | --- |
| `patchCool` | `[0.8, 0.98, 0.86]` | `[0.74, 0.95, 0.84]` |
| `patchWarm` | `[1.12, 1.02, 0.74]` | `[1.16, 1.04, 0.68]` |
| `dryStart` | `0.56` | `0.5` |
| `dryStrength` | `0.22` | `0.34` |

Leave `patchScale`, `dryPatchScale`, `dryEnd` and `dryColor` as they are.

**Change 2** — `stylizedSurface.trees.forestFloor.byTileId`:

| Tile | Key | From | To |
| --- | --- | --- | --- |
| 6 | `grassCoreDensity` | `0.45` | `0.28` |
| 8 | `grassCoreDensity` | `0.5` | `0.32` |
| 9 | `grassCoreDensity` | `0.4` | `0.28` |

Tiles 5, 7 and 12 are already at or below 0.24. Leave every
`flowerCoreDensity` and edge density alone. The forest debris layer
(`forestDebris`, 256 candidates a chunk under canopy) fills what the grass
gives up; do not change it.

**Gate.** Add to the fixture, with each limit written as a literal computed
from the baseline run:

| Shot | Gate |
| --- | --- |
| `grassland-off-12` | `chromaSdMin` = 1.25 × baseline |
| `forest-off-12` | `chromaSdMin` = 1.2 × baseline |
| `core-deciduous-off-12` | `chromaSdMin` = 1.2 × baseline |
| `grassland-off-12` | `ground.meanMin` = 0.9 × baseline, `ground.meanMax` = 1.1 × baseline (variety, not a darker field) |

If a `chromaSdMin` gate fails, raise `dryStrength` by 0.04 and widen both patch
tints by a further 0.02 per channel away from 1, once. If it still fails,
commit the values above and lower that gate to the measured value × 0.95.

Send the before and after of `grassland-off-12`, `forest-off-12` and
`core-deciduous-off-12` to the user with the commit. This phase is the one
whose result is a matter of taste; the numbers only prove something changed.

No performance run: blade counts only fall.

**Commit.** `Ground variety: stronger meadow patches and dry sward, thinner grass under closed canopy`

## 8. Phase 5 — a storm sky with structure

**Why.** Look-round item 8. In `coast-storm-12` the sky's luma deviation is 9.6
against 28.5 in clear weather. Two lines flatten it: overcast removes 40 % of
the cloud detail and softens its edges whatever the storm does, and storm air
fogs the dome by 0.7.

**Files.** `src/editor/stylized/sky/SkyLook.js` (`overcastSkyLook`),
`src/editor/stylized/sky/stormAirLook.js`, `test/sky-look.test.js`,
`test/storm-atmosphere.test.js`.

**Change 1** — in `overcastSkyLook`, after `const t = …`, add
`const s = Math.max(0, Math.min(1, storm));` and replace two lines:

```js
  // A grey lid is smooth stratus; a storm deck is not: its detail and edges come back.
  result.cloudSharpness = look.cloudSharpness + 0.2 * t * (1 - 0.6 * s);
  result.cloudDetail = look.cloudDetail * (1 - 0.4 * t * (1 - 0.75 * s));
```

and after the `for (const key of SKY_LOOK_COLORS)` loop add:

```js
  // Dark bases under a storm: the cloud's core falls further than its lit edge.
  if (s > 0) result.cloudCore = `#${mixA.set(result.cloudCore).multiplyScalar(1 - 0.35 * s).getHexString()}`;
```

`mixA` is the module's existing scratch colour.

**Change 2** — in `stormAirLook`, the `skyFog` line becomes:

```js
  // Rain keeps its cloud deck in view (0.45); only snow sinks the dome into the air.
  result.skyFog = Math.max(look.skyFog ?? 0, (0.45 + 0.25 * share) * smoothstep(0.4, 1, s), whiteout);
```

**Tests.** Update the literals the two test files assert for `cloudDetail`,
`cloudSharpness` and `skyFog` at full storm. Add: at `storm = 1`,
`snowShare = 0`, `skyFog` is 0.45; at `snowShare = 1` it is at least 0.7; at
`storm = 0` and `amount = 1` (dry overcast) `cloudDetail` and `cloudSharpness`
are exactly what they were before this phase.

**Gate.** Add to the fixture:

| Shot | Gate | Was |
| --- | --- | --- |
| `coast-storm-12` | `sky.sdMin: 16` | 9.6 |
| `forest-air-storm-12` | `sky.sdMin: 18` | 13.2 |
| `tundra-snow-12` | `sky.sdMax: 9` (a whiteout stays white) | 2.5 |
| `coast-storm-12` | `sky.meanMax: 150` (darker than the old flat grey) | 163 |

If a `sdMin` gate fails, raise the `0.35` core darkening to `0.5`, once. Then
`npm test`, `npm run qa:weather:browser` and the dry-overcast three-view
capture of [lighting-atmosphere.md](../lighting-atmosphere.md)
(`node scripts/run-world-visual-lighting-qa.mjs --highfield --out tmp/lighting-atmosphere/visual`);
all pass. No performance run: values only.

**Commit.** `Storm sky: the deck keeps its detail and dark bases, and rain no longer fogs the dome flat`

## 9. Phase 6 — record

1. Run `npm run qa:look` once more on the final tree. It exits 0.
2. Append a section "Round 2 results (2026-11-…)" to
   [aaa-look-round-2026-11-09.md](aaa-look-round-2026-11-09.md): the gate table
   from `report.json`, with baseline and final values per gate, and which
   look-round items (1–17) each phase closed.
3. In the same file, in the workstream table, mark A, B, C and the storm-deck
   part of F with the commits that landed them.
4. In `docs/perf-qa.md`, add `qa:look` to the list of visual harnesses with
   its one-line purpose and the lock rule.

**Commit.** `Look round 2 recorded: gates, before and after, what is still open`

## 10. Not in this plan

Each of these was considered and left out. Do not start them as part of this
work.

- **A new environment or biome "resolver" layer.** The chain in §1.1 is the
  resolver. A new one would duplicate it.
- **New vegetation meshes, vines, buttress roots, new understory species.**
  Asset work. The rainforest already has nine tropical ground prototypes and a
  kit layer; judge it from `core-rainforest-*` first.
- **Biome border blending (look-round item 12).** Borders are already blurred
  ±10 m with ecotone jitter (`BiomeFieldBlur.js`, `MeadowGroundSample.js`).
  What the review saw is the snow sheet's edge in `forest-air`. It needs its
  own investigation with the bake open, not a blind tune.
- **Crown lighting (item 14).** Baked canopy occlusion, transmission and
  thickness already exist (`TreeFoliageSurface.js`, `treeSurfaceSettings.js`),
  and the forest at eye level is on the "reads well" list.
- **Fog dither speckle (item 16) and lit cumulus (item 10).** Both need a live
  look at the dithered LOD and the cloud nodes. `cloudLighting.js` already
  shades billows toward the sun.
- **Aerial perspective (item 11).** `sunHaze.js` has an exponential aerial
  term (`aerialDistance: 2200`). Tune it only with `forest-air` and `desert`
  captures side by side, in a round of its own.
- **Town props and street dressing.** Already placed by `SettlementDecor.js`.
- **Snow micro-relief, crevasses, desert strata, triplanar cliffs.** Exist.
- **Seasons, SSR, extra shadow passes, volumetric fog.** Not wanted here.
- **Anything in [performance-plan-2026-11-10.md](performance-plan-2026-11-10.md).**
  Another session owns it. `4524c8c7` is its phase 1.

## 11. Expected result

| Review priority | After this plan |
| --- | --- |
| P0 time of day | Already fixed; now gated, and the town at night is dark and cool. |
| P0 weather erases the scene | Blizzard, wet ground and puddles pass numeric visibility gates. |
| P1 biome identity | Each forest biome is captured from inside its own closed canopy; no autumn outside temperate biomes; taiga reads as green conifers with a dusting. |
| P1 uniform ground | Stronger patch and dry-sward variation; less lawn under trees. |
| P2 sky | The storm deck has dark bases and visible structure. |
| Regression tests | 38 tracked shots with gates, run by `npm run qa:look`. |

Still open afterwards, by design: biome border blending, lit cumulus, aerial
perspective tuning, fog dither speckle, crown lighting, and any new vegetation
assets.
