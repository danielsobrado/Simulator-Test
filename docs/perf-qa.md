# Player movement performance QA

Deterministic harness for reproducing and measuring player-mode stutter while moving across the streamed world.

> The 2026-07-25 collapse to 3 FPS and its fixes are written up in
> [perf-investigation-2026-07-25.md](perf-investigation-2026-07-25.md), including
> the two harness defects that made earlier numbers untrustworthy. Read that before
> comparing against any report captured before that date.
>
> The 2026-07-28 collapse to ~20 FPS is written up in
> [perf-investigation-2026-07-28.md](perf-investigation-2026-07-28.md). Short
> version: any material sampling `viewportDepthTexture` or
> `viewportOpaqueMipTexture` costs a full colour copy, depth copy and mip chain
> **per frame for the whole scene**. The cost is binary — one such mesh costs the
> same as forty, and hiding or frustum-culling them saves nothing; the nodes have
> to not be compiled in. Check `waterChunksRefractive` before blaming geometry
> for a whole-scene collapse. That document also records a residual `stylized`
> phase regression from the same day that has **not** been bisected yet.
>
> The 2026-07-29 critical-path review, harness fixes, density/construction/water
> matrix, and remaining cold-streaming costs are documented in
> [perf-investigation-2026-07-29.md](perf-investigation-2026-07-29.md).

## Quick start

```bash
# Terminal 1 — app must already be serving
npm run dev

# Terminal 2 — headed Chromium is required for authoritative WebGPU numbers
npm run qa:perf -- --headed

# Optional: print a short parse summary
npm run qa:perf:parse

# Vegetation density + construction wall + water acceptance matrix
npm run qa:perf:matrix -- --headed
```

Or open the app with query params (overlay + optional JSON download):

```text
http://localhost:5173/?qa=chunk-cross&warmup=2&duration=12&speed=run&download=0
```

When a run finishes, the report is available as:

- `tmp/perf-qa-latest.json` (CLI runner)
- `window.__perfQa.getReport()` / `window.__perfQaReport` (browser)
- automatic download when `download=1` (default in the browser)

## Query parameters

| Param | Default | Meaning |
|-------|---------|---------|
| `qa` | — | Scenario id, or `1` / `true` → `move` |
| `x`, `z` | `0` | Spawn pose (render-space) |
| `yaw`, `pitch` | `0` | Look angles in degrees |
| `warmup` | `2` | Seconds to settle streaming before measuring |
| `duration` | `12` (`20` for `chunk-cross`) | Measured motion seconds |
| `speed` | `run` | `walk` or `run` |
| `hitchMs` | `~33.3` | Frame-dt threshold that counts as a hitch |
| `autostart` | `1` | Start as soon as stylized assets are ready |
| `download` | `1` | Auto-download the JSON report when done |
| `density` | `standard` | `standard`, `dense-forest`, `high-grass`, or `dense-mixed` QA load envelope |

### Scenarios

| Id | Behavior |
|----|----------|
| `move` | Hold forward (`W`, +Shift when running) |
| `strafe` | Hold right (`D`) |
| `diagonal` | Hold `W`+`D` |
| `chunk-cross` | Long forward run intended to cross chunk boundaries |
| `object-town` | Deterministic 64/256-building masonry town; set `buildings=64` or `256` |
| `construction-ring` | Twelve deterministic 96 m wall constructions around a clear movement corridor |
| `water-acceptance` | External phase driver: dry → swim → dive → surface → dry |

Density profiles are QA-only multipliers applied before worker and stylized
systems are created. `dense-forest` doubles tree placement/candidate budgets,
`high-grass` doubles `bladesPerCell`, and `dense-mixed` does both. They do not
change Azgaar biome IDs, tile persistence, or production configuration.

The harness enters walk mode at a fixed pose, bypasses pointer lock, and injects keys so runs are repeatable without mouse capture.

## What the report contains

Report kind: `simcity-dnd-perf-qa` (version `2`).

- **Scenario + config snapshot** — spawn, keys, density profile, hitch threshold, and player/world/stylized knobs used for the run
- **Summary** — frame count, duration, avg FPS, dt min/p50/p95/p99/max/mean, hitch count/rate
- **Phase timings** — CPU time inside the animation loop for:
  - `terrainCommit` (budgeted memcpy commits from the worker page queue)
  - `player`
  - `floatingOrigin`
  - `streaming` (sync kickoff of `updateStreaming` only)
  - `stylized`
  - `voxel`
  - `render`
- **Counters** — totals for grass/flower/tree/rock rebuilds, terrain slot assigns/uploads, floating-origin snaps
- **Backend gauges** — `rendererWebGPUBackend` / `rendererWebGLBackend` make an unexpected fallback visible in every report
- **Hitch frames** — every frame with `dt > hitchMs`, including phase breakdown, counter deltas, streaming/voxel/player snapshots
- **Samples** — downsampled frames, plus any hitch, expensive phase (≥8 ms), or non-empty counter-delta frame

## CLI scripts

| Script | Role |
|--------|------|
| `npm run qa:perf` | `scripts/run-perf-qa.mjs` — Playwright Chromium, waits for `window.__perfQa.status === 'done'`, writes `tmp/perf-qa-latest.json` |
| `npm run qa:perf:matrix` | Runs standard/dense-forest/high-grass/dense-mixed plus the construction corridor, then the deterministic water acceptance route; writes `tmp/perf-matrix-latest.json` |
| `npm run qa:perf:parse` | `scripts/parse-perf-qa.mjs` — prints a short summary from a report or CDP extract JSON |

Extra CLI flags for `qa:perf`:

```bash
npm run qa:perf -- --qa move --duration 8 --warmup 1 --speed walk --url http://localhost:5173
npm run qa:perf -- --headed --qa object-town --buildings 256 --warmup 8 --duration 14
npm run qa:perf -- --headed --qa diagonal --density dense-mixed --warmup 8 --duration 14
npm run qa:perf -- --headed --qa construction-ring --warmup 10 --duration 14
npm run qa:perf -- --headed --cpu-profile tmp/diagonal.cpuprofile
npm run qa:perf:matrix -- --headed --warmup 8 --duration 8
npm run qa:perf:matrix -- --headed --water-only
npm run qa:perf -- --headed
```

The runner rejects software/fallback adapters. Headless Chromium commonly fails
that gate on Windows, so use `--headed` for comparisons. `--cpu-profile` writes
a Chrome sampled CPU profile alongside the JSON without making profiling the
default measurement path.

## Code map

| Path | Role |
|------|------|
| `src/editor/world/ChunkRenderPixels.js` | Worker/main tilePixels + halo chamfer surface-mask pixels |
| `src/editor/world/TerrainCommitQueue.js` | Frame-budgeted memcpy commits (max 1/frame, ~2 ms) |
| `src/editor/world/generateWorldChunk.js` | Worker page generation including render pixels |
| `src/editor/stylized/chunkRockSignature.js` | Per-chunk rock influence signatures for grass |
| `src/editor/stylized/StylizedBuildQueue.js` | Frame-budgeted grass/flower heavy builds |
| `src/editor/performance/qa/PerfQaHarness.js` | Orchestration, overlay, `window.__perfQa` |
| `src/editor/performance/qa/FrameProfiler.js` | Per-frame dt + phase marks |
| `src/editor/performance/qa/PerfCounters.js` | Global rebuild/upload counters |
| `src/editor/performance/qa/parseQaParams.js` | URL scenario parsing |
| `src/editor/performance/qa/buildPerfReport.js` | JSON report assembly |
| `src/main.js` | Phase marks around the live animation loop |
| `src/editor/player/PlayerController.js` | Harness input bypass (`setHarnessActive` / `setHarnessKeys` / `setPose`) |

Counters are incremented from stylized rebuild paths and terrain `assignSlot` / `uploadPage` commit.

## Close other tabs rendering the app

A second browser tab running the app renders continuously against the same GPU and
silently ruins a run. Measured on 2026-07-26, identical code and scenario:

| | With an app tab open elsewhere | Tab closed |
|--|--|--|
| Avg FPS | 141, 148, 158 | 202, 205, 208 |
| Hitches | 10, 11, 11 | 5, 7, 8, 9 |

That is a ~30% swing — far larger than most changes worth measuring, and it points
the wrong way (it looks exactly like a regression in whatever you just changed).
The harness cannot detect it. **Close every other tab serving the app before an A/B,
and be suspicious of any run whose absolute FPS is well below the usual band.**

## Attribution caveat

Frame `dt` comes from `requestAnimationFrame` timestamps. Long **async** main-thread work that finishes *between* frames (for example `assignSlot` after a worker fetch) shows up as a large `dt` on the *next* callback, while that hitch frame’s phase timers can look cheap.

So:

- Large `dt` + `terrainUploadPages` / `loading > 0` → treat as streaming/commit hitch
- Large `phases.stylized` (or other phase) on a sample → sync CPU cost inside that named section
- Expensive sync work on frame N can inflate `dt` on frame N+1

## Baseline finding (chunk-cross)

Captured against local Vite (`?qa=chunk-cross&warmup=2&duration=12&speed=run&hitchMs=33.3`) in the Cursor/Electron WebGPU host.

| Metric | Value |
|--------|-------|
| Avg FPS | ~100.9 |
| dt p50 / p95 / p99 | ~6.9 / 7.0 / 14 ms |
| Max dt | ~1048 ms |
| Hitches (`>33.3` ms) | 11 (~0.91% of frames) |

**Counters (one run):** 9 grass, 6 flower, 1 tree, 1 rock rebuilds; 7 terrain assigns; 7 terrain uploads; 0 floating-origin snaps.

### Interpretation

1. Steady-state walking is smooth (p95 ≈ 7 ms).
2. The stutter reproduces as a **chunk-boundary streaming spike**, not continuous grass/player CPU.
3. Strongest hitch cluster (~frames 1107–1113): focus moved `0:0 → 0:1`, `loading` counted down `6 → 0`, and each hitch coincided with `terrainUploadPages` increments. Spike train roughly **1049 → 340 → ~290 ms**.
4. Early hitches (~150–250 ms) appeared right after the measure phase began (post-warmup settle).
5. Phase timers on those hitch frames stayed small (~2–14 ms), which matches async upload work completing outside the marked loop body.
6. `stylized` phase max reached ~948 ms once (rebuild spike); keep samples that include counter deltas / expensive phases when diagnosing rebuild cost.

### Measured: grass `residentRadius` 1 → 2 is a regression (2026-07-26)

A cheap far blade band was added (`nearRadius` rings keep the tapered five-triangle
blade, rings beyond it drop to a single triangle) so that grass geometry could reach
past the near ring. The draw-side saving is real — 40 triangles per clump down to 8 —
but the extra ring is **not** affordable on it.

`--qa chunk-cross --warmup 2 --duration 12 --speed run`, two runs each:

| Metric | `residentRadius: 2` | `residentRadius: 1` |
|--------|--------------------|---------------------|
| Hitches (>33.3 ms) | 11, 10 | 5, 8 |
| dt p95 | 6.3, 8.77 ms | 6.19, 6.6 ms |
| dt p99 | 11.8, 15.1 ms | 10.7, 13.6 ms |
| Avg FPS | 195, 174 | 201, 191 |
| `grassBuildSlices` | 36 | 12 |
| `grassScatterMs` | 58.2 | 21.6 |
| `attributeBytesUploaded` | 33.3 MB | 27.0 MB |

**Why:** the cost is in *building* the ring, not drawing it. A far-ring chunk still
runs full per-chunk scatter generation — `outerRingDensity` halves its clump count
but `buildCells` still walks every cell — so 16 extra chunks tripled the grass build
slices. Cheaper blades cannot pay that back.

**Before raising `residentRadius` again,** make far-ring scatter coarser (skip cells
rather than only thinning clumps per cell). The band machinery itself stays in place
and costs nothing while `nearRadius === residentRadius`: `farGeometry` is not even
allocated in that case.

### Measured: grass density 4× is free, `bladesPerClump` is the lever (2026-07-26)

Counterpart to the finding above. Blades are baked into the clump's **shared**
vertex buffer, so an instance is a clump, not a blade:

```
clumpsPerCell = ceil(bladesPerCell / bladesPerClump)
```

Only `clumpsPerCell` drives instance memory, per-chunk build work and buffer
uploads. `bladesPerClump` is paid once in a buffer shared by every instance, and
after that only in raster. Raising **both together** multiplies visible density
while holding `clumpsPerCell` fixed.

`48/8` → `192/32` (4× blades, `clumpsPerCell` 6 either way):

| Metric | 48 / 8 | 192 / 32 | 384 / 64 |
|--------|--------|----------|----------|
| Effective blades per chunk | 97,400 | **389,600** | 779,200 |
| Clumps (instances) | 12,175 | 12,175 | 12,175 |
| `grassBuildSlices` | 12 | 12 | 12 |
| `grassInstanceAttributeBytes` | 340,900 | 340,900 | 340,900 |
| Hitches (>33.3 ms) | 7, 5, 8 | 5, 8, 8 | 11 |
| dt p95 | 6.5, 6.19, 6.6 | 6.4, 6.49, 6.8 | 6.5 |
| dt p99 | 13.4, 10.7, 13.6 | 11.3, 12.0, 15.1 | 13.4 |

4× density is indistinguishable from baseline — every streaming counter is byte
identical and the frame metrics sit inside run-to-run spread. **8× (384/64) is
where it starts to cost**: 11 hitches on its single run, at the top of the spread.
Settled on `192/32`; go higher only with more runs than one.

Raising `bladesPerCell` *alone* is the expensive form — it increases
`clumpsPerCell`, which is the streaming-cost term.

**Clump footprint** (`CLUMP_RADIUS` in `StylizedGrassSlot.js`) is separate and also
close to free. The first pass went 3.55 → 7.5 blade-widths, spreading each clump
from 0.24 m to 0.51 m; this measured at 203.8/207.9 FPS before and 201.6/204.7
after, hitches 7/5 → 9/8. The upstream-parity pass then moved to the upstream
0.06 m blade width and a 12.5 blade-width footprint (0.75 m radius), because the
barely-overlapping 7.5 footprint still exposed circular tufts at player height.
The same low-discrepancy clump records now overlap into visually continuous cover;
the follow-up A/B is recorded below. `clumpsFormCarpet` in `grassLodMath.js`
guards the relationship if density changes again.

`chunk-cross --warmup 8 --duration 14 --speed run`, real NVIDIA WebGPU adapter:

| Metric | 7.5 footprint, pre-parity sample | 12.5 footprint + per-blade parity |
|--------|----------------------------------|-----------------------------------|
| Avg FPS | 193.7 | 200.5, 208.7 |
| dt p95 | 7.4 ms | 6.4, 6.9 ms |
| dt p99 | 11.4 ms | 8.4, 8.9 ms |
| Hitches (>33.3 ms) | 3 | 5, 5 |
| Grass build slices | 12 | 12, 12 |
| Last-chunk clumps | 12,173 | 12,173, 12,173 |
| Last-chunk effective blades | 389,536 | 389,536, 389,536 |

The extra footprint and per-blade centre/facing attributes do not increase
streaming work or instance uploads. Frame throughput improved within normal
run-to-run variance; the two extra hitches are in the historical 5–9 spread and
did not move p95/p99 upward.

### Fix landed: worker render pixels + commit queue

**Root hitch cause:** CPU `writeSurfaceMaskPixels` did O(chunkCells × searchArea) `getTile` neighbor scans on the main thread when committing a streamed page (~331k `getTile` calls per 64² page).

**Current path:**

1. Worker generates **render-ready pages**: `tiles`, `heights`, `tilePixels`, `surfaceMaskPixels`, plus optional `grassScatter` / `flowerScatter`.
2. Surface mask uses halo fill + two-pass chamfer distance transform in `ChunkRenderPixels.js` (O(halo²), no nested `getTile` storms).
3. Main-thread commit is typed-array copies + `needsUpdate` only (`TerrainCommitQueue`, default `maxCommitsPerFrame: 1`, `commitBudgetMs: 2`).
4. Concurrent worker requests stay parallel; only commits are serialized.
5. Per-chunk rock signatures (`chunkRockSignature.js`) and grass/flower/tree/rock build queues (`StylizedBuildQueue`) keep stylized rebuilds scoped and budgeted.
6. Grass/flower/instance attribute uploads use Three.js `updateRanges` (WebGPU partial `writeBuffer`) so only used instances are uploaded.
7. Grass geometry no longer rebuilds when rocks stream — rock influence is the trample texture only.

| Path | Role |
|------|------|
| `src/editor/world/ChunkRenderPixels.js` | Halo + chamfer DT mask + tilePixels |
| `src/editor/world/TerrainCommitQueue.js` | Budgeted memcpy commit queue |
| `src/editor/InfiniteTerrainView.js` | Slot wiring, `flushUploadQueue` → commit drain, editor `uploadPage` |
| `src/editor/stylized/StylizedBuildQueue.js` | Grass/flower/tree/rock builds per frame |
| `src/editor/stylized/vegetationScatter.js` | Worker/main grass + flower scatter builders |
| `src/editor/stylized/attributeUpload.js` | Partial attribute upload ranges |

### Harness must run on real hardware

`run-perf-qa.mjs` launches Chromium with `--ignore-gpu-blocklist --use-angle=default
--enable-gpu-rasterization` plus `--disable-gpu-vsync --disable-frame-rate-limit`, and
aborts with exit code 2 if WebGPU resolves to a software adapter.

Both matter:

- With only `--enable-unsafe-webgpu`, headless Chromium quietly falls back to a
  software adapter. Runs then report ~1 FPS regardless of code quality, and a
  scenario can collapse to a single multi-second frame — the report still writes,
  so the numbers look real.
- With vsync on, everything above the refresh rate reads as a flat 60 FPS, so a
  regression stays invisible until it drops under the cap.

The adapter is recorded as `adapter` in the report. Treat any run without it, or
with `fallback: true`, as void.

### Fix landed: canonical distance fields were regenerating terrain per lookup

**Symptom:** player-mode movement fell to ~13 FPS (`diagonal`, p50 dt 83 ms) while
standing still stayed at ~183 FPS. `stylized` averaged 69 ms/frame; `render` stayed
under 2 ms, so this was never a GPU or draw-call problem.

**Root cause:** `TileDistanceField.chunkField` scans a chunk plus a halo through
`tileAt`, and `InfiniteWorldStore.getTile` had no memo, so every cell ran
`sampleTile` → `fractalNoise` + climate sampling. At `waterRangeMeters: 80` and
`tileSize: 2` the halo is 41 cells, making each field build 146² ≈ 21k procedural
samples, of which only 19% are the chunk's own cells — neighbouring chunks
re-generated the same halo. A CPU profile put 55% of all samples in `fractalNoise`.

This is the same class of bug as the original `writeSurfaceMaskPixels` storm,
reintroduced through the water/path clearance fields.

**Current path:**

1. `InfiniteWorldStore` memoizes generated tiles in per-chunk `Uint8Array` blocks
   with a `filled` mask (`generatedTileBlocks`, capped at 512 blocks). A lone
   lookup still costs one sample; contiguous scans reuse their neighbours' work.
   Only `setBaseTerrain` can stale it, since overrides are consulted first.
2. `getTile` skips building the string cell key entirely when there are no tile
   overrides — the distance fields make millions of lookups per frame.
3. `ScatterClusterField` caches slope on its sample grid and interpolates it,
   instead of taking four procedural height lookups per candidate.
4. `placementSignature` is an order-independent sum of per-placement hashes, with
   no sort and no `localeCompare`.
5. `TreeManifestStore.context` compares the forest-edit document by reference
   rather than re-serializing it per chunk build.
6. Tree, rock and bush build queues share a per-frame ceiling
   (`streaming.stylizedFrameBudgetMs`, default 6 ms) so three separately budgeted
   queues cannot stack into one stall.

Measured on the real WebGPU backend (`--headed`), `diagonal`,
`--warmup 8 --duration 14`:

| Scenario | Before | After |
|----------|--------|-------|
| `diagonal` avg FPS | 13.5 | ~174 |
| `diagonal` p50 dt | 83 ms | 5.1 ms |
| `diagonal` p95 dt | ~150 ms | 7.8 ms |
| Hitches (`diagonal`) | 89 | 9 |

**Still open:** a handful of single `stylized` jobs cost ~57 ms because a full tree
LOD rebuild rewrites instances for every visible chunk, and `plan.signature`
changes each frame while LOD bands cross-fade, so the rebuild is re-triggered.
Slicing that rebuild per chunk is the next win. There is also one reproducible
~676 ms hitch whose `stylized` phase is only ~3.6 ms, i.e. async GPU/pipeline work
outside the marked loop.

### Renderer GPU preference

`InfiniteTerrainView` requests `powerPreference: 'high-performance'`
(`renderer.powerPreference`, default `high-performance`). Without it the browser may
place the world view on integrated graphics on hybrid machines, which costs an order
of magnitude for identical scene content. The workshop preview renderer already
asked for it; the world renderer did not.

### Fix landed: ACES tone mapping and soft shadows in the world renderer (2026-07-25)

`InfiniteTerrainView` gained ACES tone mapping at exposure 1.12 and
`PCFSoftShadowMap`, and `ObjectView`'s duplicate unshadowed directional light
became a fallback that `StylizedSkyView` evicts. The world previously ran two
suns from different directions and no tone mapping at all, while buildings were
authored in the workshop preview under ACES at 1.12 — so a baked asset never
looked the way it did while authoring.

A/B on the same machine and session, `--headed --qa diagonal --warmup 8
--duration 14 --speed run`, real WebGPU backend:

| Shadow filter | Avg FPS | dt p50 / p95 | Hitches |
|---|---|---|---|
| `PCFSoftShadowMap` (shipped), run 1 | 178.6 | — | 10 |
| `PCFSoftShadowMap` (shipped), run 2 | 163.8 | 5.4 / 8.7 ms | 9 |
| `PCFShadowMap` (previous) | 182.0 | 5.0 / 7.4 ms | 11 |

The concern was that a wider shadow filter kernel would cost frame time. It does
not, but note *why* the conclusion is safe: **run-to-run variance on the shipped
configuration alone (163.8–178.6 FPS, ~9%) is larger than its gap to hard shadows
(3.4 FPS, ~2%), and the hitch counts overlap.** A single pair of runs would not
have supported that claim in either direction. Removing the second directional
light plausibly offsets the wider kernel.

If you re-measure this, run the shipped configuration at least twice before
comparing anything to it.

> An earlier revision of this section reported 146.2 vs 134.3 FPS from a
> **headless** run. Those numbers measured the WebGL backend, not WebGPU — see
> [Harness must run on real hardware](#harness-must-run-on-real-hardware) — and
> have been replaced by the headed figures above.

### Terrain normal and forest-floor/dirt layering (2026-07-26)

Large ground bands were isolated with fixed-pose A/B captures. Disabling
directional shadows left their shape intact; disabling procedural dirt removed
it. Two terrain-material layering defects made those intended dirt patches read
like shadow streaks:

1. The forest-floor tint was applied on top of exposed dirt and path tread,
   shifting warm soil toward `groundCoreColor`.
2. `normalNode` was assigned a literal local +Z even though node-material normals
   are consumed in view space. Leaving the plane's default transformed normal
   correctly rotates its local +Z into world +Y.

The existing `PCFSoftShadowMap`, 2048 map, 120 m half-extent, bias, normal bias,
and radius remain unchanged. A headed `chunk-cross --warmup 8 --duration 14
--speed run` on the real NVIDIA WebGPU adapter after the fix measured 219.1 FPS,
4.3/6.6/8.8 ms p50/p95/p99, and 3 hitches over 33.3 ms.

### Instrumented sub-phases

Counters (last-sample gauges + cumulative `*Ms` / byte totals where noted):

| Name | Meaning |
|------|---------|
| `workerComplete` | Worker generation wall time for a page |
| `queueWait` | Time a generation job waited before a worker picked it up |
| `commitQueueWait` | Time a finished page waited in the commit queue |
| `tilePixels` / `surfaceMask` | Worker render-pixel enrichment cost |
| `textureCommit` | Main-thread memcpy + `needsUpdate` for one page |
| `grassScatter` | Grass instance fill (worker compact or main fallback) |
| `grassTrample` | Influence texture rebuild |
| `grassBufferUpload` | Grass attribute range upload bookkeeping |
| `maxQueuedCommitAgeMs` | Oldest commit still waiting (gauge) |
| `attributeBytesUploaded` / `textureBytesUploaded` | Uploaded byte totals |

### QA gates

Re-run `npm run qa:perf` (`?qa=chunk-cross`) and check:

| Gate | Target |
|------|--------|
| Procedural tile samples during page commit | 0 |
| Terrain commits in one frame | ≤ 1 while moving |
| Grass rebuilds during straight boundary crossing | ≤ 3 |
| Main-thread terrain commit p95 | < 2 ms |
| Main-thread stylized build p95 | < 4 ms |
| Post-warmup hitches over 33.3 ms | 0 |
| Maximum queued commit age | reported |
| Texture and instance bytes uploaded per frame | reported |

Also:

- Chunk-boundary hitch spikes should shrink vs the ~1 s baseline (no main-thread mask storms).
- `terrainCommit` phase should stay small (memcpy only); large `dt` with `terrainUploadPages` should be rare.
- Grass/flower rebuilds should follow per-chunk signatures + build-queue budgets, not full resident rebuilds on every focus step.
