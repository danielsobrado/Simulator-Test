# Player movement performance QA

Deterministic harness for reproducing and measuring player-mode stutter while moving across the streamed world.

> The 2026-07-25 collapse to 3 FPS and its fixes are written up in
> [perf-investigation-2026-07-25.md](perf-investigation-2026-07-25.md), including
> the two harness defects that made earlier numbers untrustworthy. Read that before
> comparing against any report captured before that date.

## Quick start

```bash
# Terminal 1 — app must already be serving
npm run dev

# Terminal 2 — headless Chromium run (writes tmp/perf-qa-latest.json)
npm run qa:perf

# Optional: print a short parse summary
npm run qa:perf:parse
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

### Scenarios

| Id | Behavior |
|----|----------|
| `move` | Hold forward (`W`, +Shift when running) |
| `strafe` | Hold right (`D`) |
| `diagonal` | Hold `W`+`D` |
| `chunk-cross` | Long forward run intended to cross chunk boundaries |

The harness enters walk mode at a fixed pose, bypasses pointer lock, and injects keys so runs are repeatable without mouse capture.

## What the report contains

Report kind: `simcity-dnd-perf-qa` (version `1`).

- **Scenario + config snapshot** — spawn, keys, hitch threshold, player/world/stylized knobs used for the run
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
- **Hitch frames** — every frame with `dt > hitchMs`, including phase breakdown, counter deltas, streaming/voxel/player snapshots
- **Samples** — downsampled frames, plus any hitch, expensive phase (≥8 ms), or non-empty counter-delta frame

## CLI scripts

| Script | Role |
|--------|------|
| `npm run qa:perf` | `scripts/run-perf-qa.mjs` — Playwright Chromium, waits for `window.__perfQa.status === 'done'`, writes `tmp/perf-qa-latest.json` |
| `npm run qa:perf:parse` | `scripts/parse-perf-qa.mjs` — prints a short summary from a report or CDP extract JSON |

Extra CLI flags for `qa:perf`:

```bash
npm run qa:perf -- --qa move --duration 8 --warmup 1 --speed walk --url http://localhost:5173
npm run qa:perf -- --headed
```

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
