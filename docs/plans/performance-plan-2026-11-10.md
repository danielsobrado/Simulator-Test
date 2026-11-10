# Performance plan — 2026-11-10

This is a work order for an implementing agent. Every phase names the files, the
change, what must stay untouched, and the numbers that decide pass or fail. Do
the phases in order, one commit per phase, on `main`. Do not add anything this
document does not ask for. Where a phase says "revert", run `git revert` on that
phase's commit and move to the next phase.

Read `CLAUDE.md` and [perf-qa.md](../perf-qa.md) first. Their rules apply to
every phase: no `viewport*Texture` nodes, no scene lights, no new terrain
samplers, no reduced densities, distances, texture sizes or shader effects.

## 1. What was measured

Working tree of `main` at `f0e62293` plus another session's uncommitted rain and
water shader edits, 2026-11-10, NVIDIA Lovelace, headed WebGPU, 1280×720 unless
stated. Flags: `--warmup 8 --duration 12 --settle --gpuTimings 1`. All runs
settled with no browser errors. Only the first run kept native foreground focus,
so the FPS and hitch columns of the others are void as frame-pacing evidence.
CPU phase time and GPU timestamps do not depend on focus and are the baseline.

| Run | Render CPU avg ms | CPU p50 / p95 ms | GPU avg ms | Draws | Triangles | FPS |
| --- | --- | --- | --- | --- | --- | --- |
| `chunk-cross` (spawn) | 5.10 | 6.9 / 10.5 | 2.22 | 203 | 5.1 M | 119.7 (valid) |
| `chunk-cross --x 2005 --z 2941` (forest) | 5.67 | 7.2 / 10.7 | 3.15 | 251 | 8.1 M | 115 (void) |
| forest at 2560×1440 | 5.69 | 7.3 / 11.0 | 7.26 | 251 | 8.1 M | 114 (void) |
| forest, `storm=1&stormSnap=1&stormKind=rain` | 5.68 | 7.3 / 11.1 | 3.17 | 252 | 8.1 M | 114 (void) |
| `settlement-approach` | 8.85 | 12.6 / 15.4 | 4.11 | 549 | 16.0 M | 74 (void) |

Conclusions the plan is built on:

1. **The frame is CPU-bound, and the CPU cost is render submission.** `render`
   is 74–78% of the frame's CPU. Every other phase together is under 2 ms.
   Quadrupling the pixel count changed GPU time from 3.2 to 7.3 ms and left the
   frame rate where it was.
2. **Submission cost follows draw count:** about 20–25 µs per draw (5.67 ms for
   251 draws, 8.85 ms for 549). In the whole-capture CPU profile, `render` is
   55.9% of main-thread time; inside it, binding checks (`Bindings._update`)
   are 34%, per-draw node updates (`Nodes.updateForRender`) 16%, the shadow
   pass 10%, the WebGPU draw call itself 10%.
3. **All hitches over 33 ms are render-phase spikes of 9–25 ms**, not scenery
   work. Scenery building stays inside its 3 ms budget (p95 3.0 ms).
4. **Storm rain costs nothing measurable** over clear weather.

Main-pass draws per frame, standing at the forest pose (296 total with shadow
and post passes):

| Object | Draws | Triangles | Note |
| --- | --- | --- | --- |
| `StylizedGroundDetailView` layers (groundDetail 38, tropicalPlant 21, forestDebris 5, aquaticPlant 4, shoreLife 4) | 72 | 730 k | one draw per prototype part |
| `stylized-pine-near` (all tree species) | 34 | 3.5 M | |
| `stylized-water` | 34 | 279 k | never frustum culled |
| `terrain-slot` | 24 | 197 k | 49 object uniforms, 25 textures, 114 update nodes per draw |
| impostors (`fallback` 14, compacted 12) | 26 | 19 k | |
| meadow | 14 | 409 k | 29 object uniforms per draw |
| `stylized-flowers` | 14 | 10 k | one mesh per terrain slot |
| bushes (near 9, proxy 8) | 17 | 741 k | |
| `stylized-rock-near` | 11 | 768 k | |
| shadow pass | 25 | 2.26 M | trees 13, rocks 11 |

At the town (533 total, 497 in the main pass): `settlement-interior-*` is
**249 draws for 2.0 M triangles** — 32 spatial cells times seven materials, plus
capacity splits. Building shells are 72 draws for 6.9 M triangles.

## 2. Tools

Two probes were added with this plan. Both need `npm run dev` serving and open
their own headed Chromium. They are diagnostics, not frame-pacing evidence.

```bash
node scripts/probe-render-census.mjs chunk-cross "&x=2005&z=2941" tmp/census-forest.json
```

```bash
node scripts/probe-render-census.mjs settlement-approach "" tmp/census-town.json
```

```bash
node scripts/probe-render-uniforms.mjs chunk-cross "&x=2005&z=2941" tmp/uniforms-forest.json
```

The census prints draws and triangles per render pass and object name. The
uniform probe prints, per material: draws, object-group uniforms per draw
(`groups.object.uniformsPerCheck`), textures per draw and update nodes per draw
(`updNodes/draw`). Its JSON lists each object-group uniform as
`name::type:updateType:class`; `updateType` is `object` for a per-mesh value and
`none` for a plain `uniform()`.

A fourth argument sets the base URL when the server is not on port 5173.

### Acceptance run for every phase

Serve a frozen export of the commit before the phase (baseline) and of the
phase's commit (change), each on its own port, as
`scripts/serve-world-visual-snapshot.mjs` already does for the entries in
`.claude/launch.json`. Close every other tab that renders the app. Alternate
the arms A, B, A, B:

```bash
npm run qa:perf -- --headed --qa chunk-cross --x 2005 --z 2941 --warmup 8 --duration 12 --settle --gpuTimings 1 --url <arm url> --out tmp/<phase>-<arm><n>.json
```

```bash
npm run qa:perf -- --headed --qa settlement-approach --warmup 8 --duration 12 --settle --gpuTimings 1 --url <arm url> --out tmp/<phase>-town-<arm><n>.json
```

Read `summary.phases.render.avgMs`, `gpuRender.total.avgMs` and
`counters.rendererDrawCalls` from each report. A phase passes when its own gate
below holds **and** in both runs of the change arm:

- `summary.phases.render.avgMs` is not higher than the baseline arm's mean;
- `gpuRender.total.avgMs` is within +0.10 ms of the baseline arm's mean, unless
  the phase states a GPU allowance;
- `capture.browserErrors.count` is 0 and `scenario.settle.settled` is true.

Quote FPS and hitch counts only from runs where
`capture.focus.native.passed` is true. Then run `npm test` and
`npm run qa:water:acceptance -- --headed`; both must pass. Append a section to
`docs/perf-qa.md` with the table of both arms, in the style of the existing
sections.

## 3. Phase 1 — cull water chunks

**Why.** Every wet chunk is submitted every frame, including those behind the
camera: 34 draws at the forest pose, each carrying 53 object uniforms and 17
textures. Terrain slots at the same pose are culled to 24 of 49.

**Files.** `src/editor/stylized/StylizedWaterSlot.js`,
`src/editor/water/WaterField.js`, `src/editor/world/TerrainSlotBounds.js`.

**Change.**

1. In `WaterField.js`, export `waterFieldSurfaceRange(pixels)`. It walks the
   field in steps of `WATER_FIELD_CHANNELS`, skips texels whose coverage
   (channel 0, `(value & 0x7fff) === 0`) is dry, decodes the surface-height
   channel with `halfToFloat`, and returns `{ min, max }`, or `null` when no
   texel is wet. The surface-height channel is the one the field encoder in
   this file writes the surface height into with `floatToHalf`; use the same
   channel index.
2. In `TerrainSlotBounds.js`, export
   `fitSlotBoundsToRange(geometry, minimum, maximum, chunkWorldSize, pad)`. It
   holds the body of `fitSlotBounds` after its scan. Make `fitSlotBounds` call
   it with `pad = 2` so terrain behaviour is byte-identical.
3. In the `StylizedWaterSlot` constructor, build the mesh on
   `createSlotGeometry(terrainView.geometry)` instead of `terrainView.geometry`,
   and delete the `frustumCulled = false` line and its comment.
4. At the end of `uploadField(page)`, when `hasWaterCoverage` is true, take
   `waterFieldSurfaceRange(this.waterFieldPixels)`, add
   `page.waterFieldSurfaceOrigin ?? 0` to both ends, and call
   `fitSlotBoundsToRange(this.mesh.geometry, min, max, this.terrainView.chunkWorldSize, 6)`.
   The 6 m pad covers swell, surf and storm displacement.

**Do not** change `mesh.visible` logic, `resolveMaterial`, or any material.

**Test.** Add `test/water-slot-bounds.test.js`: a field with two wet texels at
known heights and an origin yields a bounding box whose local Z spans
`min + origin − 6` to `max + origin + 6`; an all-dry field leaves the bounds
unchanged; `fitSlotBounds` output is unchanged for a fixed height array.

**Gate.** Forest census: `stylized-water` main-pass draws ≤ 20 (was 34).
Visual: `npm run qa:world:visual` coast and river captures show no missing
water at screen edges while turning; `qa:water:acceptance` passes.

**Commit.** `Water chunks are frustum culled against their own surface bounds`

## 4. Phase 2 — fewer, larger settlement interior batches

**Why.** Interiors are 249 of the town's 497 main-pass draws for 2.0 M
triangles. The 128 m cell and 65,535-vertex cap of
`settlement-interior-performance-fixes-2026-11-07.md` were never measured; that
document says so. GPU time is not the limit, draw count is.

**Files.** `src/editor/world/settlements/view/interior/InteriorBatchStore.js`,
`test/settlement-interior-batches.test.js`.

**Change.**

1. `INTERIOR_BATCH_CELL_METRES = 256`.
2. `INTERIOR_BATCH_MAX_VERTICES = 262140`. Update the constructor's range check
   and its error text to the new constant.
3. Index buffers become `Uint32Array` in `acquire`. The page size stays
   `INTERIOR_BUFFER_PAGE_ELEMENTS`, so the 48 KiB copy bound is unchanged.
4. Update the constant's comment: WebGL primitive restart no longer applies to
   32-bit indices; the cap now bounds one float3 allocation to about 3 MiB.

**Do not** change `InteriorMeshes.js`, materials, the room planner or culling.

**Test.** Update the existing batch tests for the new cell size, cap and index
type. Keep the assertions on winding, exact attributes, bounds from emitted
vertices and `settlementInteriorBufferMaxCopyBytes ≤ 49152`.

**Gate.** Town census: the sum of `settlement-interior-*` main-pass draws
≤ 90 (was 249). Town run: `summary.phases.render.avgMs` at least 1.5 ms below
the baseline mean (was 8.85). GPU allowance for this phase: +0.30 ms.
Visual: open doors, furnished rooms, window daylight and dusk flicker look the
same in `npm run qa:world:visual` town captures at hours 12 and 21.

**Commit.** `Settlement interiors batch per 256 m cell with 32-bit indices`

## 5. Phase 3 — plain world uniforms move to the frame group

**Why.** A plain `uniform()` lands in the object group and is re-checked for
every draw. The 2026-11-01 pass moved seventeen modules and measured −4% render
CPU. The probe still shows, per draw, 21 plain uniforms on terrain, 29 on meadow
blades, 16 on leaves, 13 on water and 10 on flowers.

**Files.** List them with:

```bash
grep -rlE "[^a-zA-Z]uniform\(" src/editor/terrainMaterial.js src/editor/materials src/editor/stylized src/editor/water src/editor/weather
```

**Rule, applied to every `uniform(` call in those files.** Replace it with
`frameUniform(` (import from `src/render/FrameUniforms.js`) unless one of these
is true, in which case leave it exactly as it is:

1. The call is chained with `.onObjectUpdate(` or `.onRenderUpdate(`.
2. The file is one of: `TerrainSlotBindings.js`, `TerrainMaterialBakeGpu.js`,
   `TerrainOceanMask.js`, `PatternOrigins.js`, `SharedWaterMaterials.js`,
   `StylizedWaterSlot.js`, `InfiniteTerrainView.js`,
   `VfxLightingUniforms.js`, any file whose name contains `Reflection`,
   `Underwater`, `GodRays`, `PostProcess`, `Fixture` or `Pass`, or anything
   under `src/render/postprocessing`.
3. The uniform is `TreeWindTime` or is written from camera state (its value is
   assigned from `camera.`, a view matrix or a projection matrix).
4. The uniform's `.value` is assigned inside a function that the planar or cube
   reflection capture calls between the capture render and the main render.
   Find them with `grep -rn "reflection" src/editor/water src/editor/stylized
   -il` and read each capture function's body.

Change nothing else on the line. Do not rename, regroup or merge uniforms.

**Gate.** Uniform probe at the forest pose, count of entries whose
`updateType` is `none` in `objectUniforms`:

| Material | Before | Must be at most |
| --- | --- | --- |
| `terrain-slot` | 21 | 6 |
| `meadow-grass-blades` | 29 | 5 |
| `Meadow leaves` | 16 | 6 |
| `stylized-flowers` | 10 | 4 |
| `stylized-water` | 13 | 6 |

The remainder are three.js built-ins (`mat4`, `float` entries) and excluded
uniforms. Visual: `npm run qa:world:visual` at forest, coast and town, hours 12
and 21, plus `npm run qa:weather:browser`; all 14 weather cases pass and water
reflections show the same trees and sky as before the change. If a reflection
shows main-view state, the uniform that carries it falls under exclusion 4:
restore that one call and re-run.

**Commit.** `World-state uniforms on terrain, meadow, foliage and water join the frame group`

## 6. Phase 4 — one fewer texture node per bilinear slot read

**Why.** Terrain runs 114 update nodes per draw. `bilinearLoad` in
`TerrainSlotBindings.js` builds five per-object texture nodes per read: four
texel loads and one more only to ask `textureSize`. Every slot's texture has
the template's dimensions, which are known when the material is built.

**File.** `src/editor/materials/TerrainSlotBindings.js`.

**Change.** In `bilinearLoad`, replace

```js
const size = vec2(textureSize(node(null)));
```

with

```js
const size = vec2(template.image.width, template.image.height);
```

and drop the `textureSize` import and the comment above the line. Nothing else.

**Test.** Extend `test/terrain-slot-bindings.test.js` with one case: the
node graph returned by `bilinearLoad` for a 64×32 template contains no
`textureSize` node and exactly four texture nodes.

**Gate.** Uniform probe: `terrain-slot` `updNodes/draw` ≤ 104 (was 114) and
`groups.object.texturesPerCheck` ≤ 23 (was 25). Visual: terrain captures at the
forest and glacier poses are pixel-stable against the baseline arm except for
cloud position. If either number does not move, revert.

**Commit.** `Bilinear slot reads take their size from the template, not a fifth texture node`

## 7. Phase 5 — scatter spacing index without strings or generators

**Why.** `StableScatterManifest` is 18% of main-thread time over a capture, and
its `neighbours` generator alone is 3.2% self time, building nine string keys
per candidate. This work is budgeted, so the gain is scenery that is ready
sooner after a chunk crossing, not a shorter frame.

**File.** `src/editor/stylized/StableScatterManifest.js`.

**Change, inside `createSpacingIndex` only.**

1. Bucket keys become numbers:
   `(cellX + 1048576) * 2097152 + (cellZ + 1048576)`, in both the fill loop and
   the lookup. Throw a `RangeError` if `Math.abs(cellX)` or `Math.abs(cellZ)`
   is 1048576 or more.
2. Replace the `*neighbours(candidate)` generator with
   `collectNeighbours(candidate, out)`: it clears `out` (`out.length = 0`),
   pushes the candidates of the same nine buckets in the same order (offsetZ
   outer, offsetX inner, bucket order inner-most) and returns `out`.
3. Update the one caller (the `for … of spacingIndex.neighbours(candidate)` loop in `step`) to pass one scratch array declared once per
   manifest build and to iterate the returned array with an index loop.

Output order is unchanged, so manifests are identical.

**Test.** Add to `test/stable-scatter-manifest-resume.test.js`: for a fixed seed and
chunk, the manifest's `stableId` list and `placementSignature` equal the values
recorded from the code before this phase (record them first, in the same
commit, as literals).

**Gate.** `npm test` passes with the recorded literals. In a
`--cpu-profile tmp/p5.cpuprofile` forest run, self time of `collectNeighbours`
plus `createSpacingIndex` is at most half of the baseline's
`neighbours` + `createSpacingIndex` self time.

**Commit.** `Scatter spacing index: numeric bucket keys and a scratch neighbour list`

## 8. Phase 6 — spend the headroom on looks

Do this phase only after phases 1–5 are committed and accepted. It raises
quality with settings that already exist, and its cost is charged against what
the earlier phases saved.

**File.** `config/render-enhancements.yaml`.

**Change.**

```yaml
waterReflections:
  resolution: 256
shadowCascades: 2
```

Leave every other key as it is. Mobile keeps one cascade and no reflections
through the existing override in `src/config/RenderEnhancements.js`; do not
touch that file.

**Gate, against the commit before phase 1 (not the previous phase).**

- Forest run: `summary.phases.render.avgMs` ≤ 5.67 and
  `gpuRender.total.avgMs` ≤ 3.75 at 1280×720.
- Town run: `summary.phases.render.avgMs` ≤ 8.85.
- Forest at `--viewportWidth 2560 --viewportHeight 1440`:
  `gpuRender.total.avgMs` ≤ 8.3.
- `npm run qa:perf:matrix -- --headed` exits 0.
- Captures at forest hour 7 and hour 18.6, coast hour 12 and town hour 12 show
  sun shadows continuing past 120 m with no visible seam where the cascades
  meet, and water reflecting tree silhouettes without blocky edges.

If the CPU gates fail with both settings, set `shadowCascades` back to 1, keep
the reflection resolution, and re-run the gates once. Record which settings
shipped in `docs/perf-qa.md`.

**Commit.** `Long-range sun shadows and 256 px water reflections on by default`

## 9. Not in this plan

These were measured and left out. Do not start them as part of this work.

- **Merging ground-detail prototypes** (72 draws). Each part has its own
  material and texture; merging needs a shared atlas, which is an asset task.
- **One flower mesh instead of one per slot** (14 draws for 10 k triangles).
  It changes how slots own and retire their instances.
- **Packing terrain's 28 per-slot uniforms into one array.** Each slot is its
  own render object, so those values upload only when they change; the cost
  left is the check, and phase 4 has to be measured first.
- **Render-phase hitches of 9–25 ms.** They are first draws of newly streamed
  meshes. `StreamedDrawPreparation` already stages them at two meshes a frame;
  changing that budget needs its own A/B with valid native focus.
- **Moving scatter manifests to a worker.** The work is already inside its
  budget; phase 5 covers the cheap part.
- **AAA look workstreams A–H** of
  [aaa-look-round-2026-11-09.md](aaa-look-round-2026-11-09.md). They are shader
  and art work with their own owners. This plan gives them the budget: after
  phase 6 the frame should hold about 1 ms of CPU and, at 1280×720, 13 ms of
  GPU below a 60 FPS frame.

## 10. Expected result

Estimates from the per-draw cost above, to be replaced by the measured tables:

| Scene | Render CPU now | After phases 1–4 | After phase 6 |
| --- | --- | --- | --- |
| Forest | 5.67 ms | about 4.9 ms | about 5.5 ms, with two cascades |
| Town | 8.85 ms | about 5.8 ms | about 6.5 ms, with two cascades |

GPU time is unchanged by phases 1–5 and rises by an estimated 0.3–0.5 ms at
1280×720 in phase 6.
