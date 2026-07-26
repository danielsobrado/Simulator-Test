# Player-mode performance collapse — investigation, 2026-07-25

Reported symptom: the FPS counter read **3.1** in player mode, down from ~144 the
day before. This records what was actually wrong, what was fixed, how each step
was measured, and precisely what stutter remains.

Companion document: [player movement performance QA](perf-qa.md) holds the
harness reference and the permanent record of the fixes.

## Result

Scenario `diagonal`, `--warmup 8 --duration 14 --speed run`, real WebGPU backend,
RTX 40-series (Lovelace):

| Metric | Start of investigation | Now | Prior in-repo reference[^1] |
|---|---|---|---|
| Avg FPS | 13.5 | **~189** | 146.2 |
| dt p50 | 83.3 ms | **4.9 ms** | 5.8 ms |
| dt p95 | ~150 ms | **7.2 ms** | 13.3 ms |
| dt p99 | — | **13.0 ms** | — |
| Hitches > 33.3 ms | 89 | **6** (0.23% of frames) | 9 |
| Max dt | 675 ms | 68 ms | — |
| `stylized` phase p95 | ~147 ms | **2.9 ms** | — |

Run-to-run spread is now small (186–190 FPS across three consecutive runs), where
mid-investigation builds swung between 116 and 176.

**These absolute figures were captured before the leaf-tint / grove-mix work landed**,
which measures ~148–154 FPS on the same scenario. That is feature cost, not a
regression in anything here. Where a fix below is justified by numbers, prefer the
same-session A/B comparisons — they are the part that stays valid as the scene
changes.

[^1]: The ACES/soft-shadow A/B already recorded in `perf-qa.md`, same protocol and
machine. It is the closest like-for-like reference; the "144 FPS yesterday" figure
was never captured as a report.

Roughly **13×** on average frame rate, and every percentile is now better than the
prior reference.

## The reported cause was not the actual cause

Two hypotheses were tested and **rejected**:

1. **GPU / draw-call cost.** Standing still measured 183 FPS with 3.34 M triangles
   at the user's own resolution and DPR 2. Only *movement* collapsed. `render`
   averaged under 2 ms while `stylized` averaged 69 ms. This was never a GPU-bound
   problem, so nothing needed to be cut from the art.
2. **`powerPreference` on hybrid graphics.** The world renderer omitted
   `powerPreference` while the workshop preview requested `'high-performance'`,
   which looked like it could explain an order of magnitude. The setting was added
   (it is correct and consistent), but Chrome logs:

   > The powerPreference option is currently ignored when calling requestAdapter()
   > on Windows. See https://crbug.com/369219127

   So on Windows today it is **a no-op and does not explain the regression.** It is
   kept for other platforms and for when the bug is fixed.

The real cause was CPU work on the main thread, introduced by commit `ead10ed`
("bush generator").

## Root causes

### 1. Canonical distance fields regenerated terrain on every lookup

**The dominant cost — 55% of all CPU samples were in `fractalNoise`.**

`ead10ed` added `TileDistanceField`, which backs the riparian (water-distance) and
path-clearance fields. It scans a chunk plus a halo through `tileAt`, and
`InfiniteWorldStore.getTile` had **no memoization**, so every cell ran
`sampleTile` → fractal noise + a climate sample.

With `waterRangeMeters: 80` and `tileSize: 2` the halo is 41 cells, so each chunk
field build sampled 146² ≈ **21,000 procedural tiles** — and only 19% of those
cells belong to the chunk itself. Neighbouring chunks re-generated the same 81%
halo over and over.

This is the same class of defect as the `writeSurfaceMaskPixels` storm that
`perf-qa.md` records as already fixed, reintroduced through the new fields.

### 2. A string allocated per tile lookup

`getTile` built a string cell key (`"x:z"`) on every call purely to consult
`tileOverrides` — millions of allocations per frame from the distance-field scans,
in a world that usually has no overrides at all.

### 3. Prebaked tree impostors never loaded, so every session re-baked them

```
Tree impostor assets could not be loaded; runtime bake will be attempted.
TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
    at TreeImpostorAssetLoader.load (TreeImpostorAssets.js:88)
```

`fetchImpl = fetch` captured the bare function, and calling it as
`this.fetchImpl(...)` made the loader the receiver — which browsers reject. The
failure was caught and downgraded to `console.warn`, so it was invisible: all 11
impostor atlases were re-baked on the main thread at every startup, and the
regenerated PNGs in `public/assets/impostors/trees/` were dead weight.

With the binding fixed, a second, real problem surfaced underneath: the manifest's
`sourceSignature` no longer matched the runtime prototypes, because `ead10ed`
changed tree species geometry without re-baking. So the atlases were *also* stale.

`UrlWorldContentProvider` had the identical unbound-`fetch` bug, latent.

### 4. Boulder manifests were rebuilt every frame for chunks outside their window

`StylizedRockView.rebuild` pruned its manifest cache to the boulder render window
(`proxyRadius` 3 + 1). But tree placement asks for boulder blockers out to the
tree *cluster* radius (8 + 1), plus a 3×3 halo per chunk. Those far manifests were
built on demand, deleted by the next prune as "inactive", and rebuilt on the very
next frame — a permanent rebuild treadmill over several hundred chunks.

### 5. Three separately-budgeted queues stacked into one stall

Rock, tree and bush rebuilds each flush inside one `StylizedSurfaceView.update`,
each with its own 3 ms budget. `StylizedBuildQueue.flush` checks its budget
*before* starting a job, so a single job always runs to completion regardless of
cost. Three "cheap" queues therefore combined into 30–55 ms frames.

### 6. Per-frame work that only needed doing on change

- `StylizedChunkRevisionTracker.windowSignature` built ~11 strings per chunk for
  every chunk in the resident window, for trees, rocks *and* bushes, every frame —
  while an unedited world has every revision at zero.
- `TreeManifestStore.context` ran `JSON.stringify` over the whole forest-edit
  document once per chunk manifest build, to detect a change. The store only ever
  replaces that document wholesale, so identity comparison is sufficient.
- `TreeManifestStore.lodAnchor` recomputed a centroid over a chunk's placements
  once per chunk per frame, for values that change only on rebuild.
- `placementSignature` sorted every placement set with `localeCompare` on each
  call, to make the digest order-independent.
- `ScatterClusterField.sample` took four procedural height lookups (16 noise
  evaluations) per candidate for slope — despite the class docstring stating the
  sample grid exists so that "raising candidate budgets does not multiply noise
  cost". Coverage was interpolated on the grid; slope bypassed it.
- The rebuild paths allocated a `Matrix4`, three `Vector3`s and a `Quaternion` per
  instance, across thousands of instances per rebuild.

### 7. WebGPU compiled render pipelines during gameplay

WebGPU compiles a pipeline the first time a material/geometry pair is actually
drawn, and that compile blocks in the GPU process. It appeared as ~90 ms hitches
on whichever frame a new LOD band first became visible — with every phase timer on
that frame cheap, which is why it was easy to misread as mysterious.

## Fixes, with measured effect

Early measurements were vsync-capped at 60 FPS (see the harness section below), so
they show relative gains only. Later measurements are uncapped on the real WebGPU
backend at `--warmup 8`.

| Fix | Where | Effect |
|---|---|---|
| Per-chunk `Uint8Array` tile memo with a `filled` mask | `InfiniteWorldStore` | 13.5 → 39 FPS |
| Skip the string cell key when there are no overrides | `InfiniteWorldStore` | 39 → 44.6 |
| Shared per-frame ceiling across scatter queues | `StylizedBuildQueue`, `StylizedSurfaceView` | hitches 41 → 16 |
| Zero-signature fast path | `StylizedChunkRevisionTracker` | p50 6.6 → 4.6 ms |
| Memoized LOD anchor | `TreeManifestStore` | (same step) |
| Bound `fetch` + re-bake stale atlases | `TreeImpostorAssets`, `npm run bake:impostors` | removes a full 11-atlas main-thread bake per session |
| Retain boulder manifests consumers still request | `StylizedRockView` | 145 → 150 FPS, hitches 23 → 14 |
| Reuse compose intermediates | `TreeLodAssembler`, rock/bush views | 150 → 171 FPS, p95 15.5 → 11.4 ms |
| Pre-warm pipelines with `compileAsync` | `main.js` | **p95 11.4 → 7.8 ms, hitches 13 → 9** |
| Slope cached on the sample grid | `ScatterClusterField` | no measurable delta; removes real waste, matches documented intent |
| Order-independent digest, no sort | `StableScatterManifest` | no measurable delta; removes an O(n log n) sort per call |
| Forest-edit document compared by identity | `TreeManifestStore` | small |
| `powerPreference: 'high-performance'` | `InfiniteTerrainView` | no-op on Windows today (crbug 369219127) |
| Dropped the duplicate manifest flush | `StylizedTreeView` | takes a manifest build off the rebuild frame |
| Memoized canopy clusters + emergent trees | `TreeManifestStore`, `TreeLodAssembler` | removes 12.7% of the rebuild subtree |
| Memoized heights, deduped corner reads | `InfiniteWorldStore` | with the cache below: 176 → 189 FPS |
| One-entry last-block cache, tiles and heights | `InfiniteWorldStore` | required — without it the height memo *cost* 40 FPS |
| Dirty-subrange instance uploads | `StylizedLodRuntime`, `attributeUpload` | +8% FPS, p95 9.9 → 8.4 ms; did **not** reduce hitches |

One change was **reverted** rather than kept: coalescing the tree LOD rebuild until
the manifest queue drained measured flat (113.1 vs 113.9 FPS) and would have
delayed trees appearing, so it did not earn its complexity.

## The harness was reporting fiction

Two defects in `scripts/run-perf-qa.mjs` made its numbers untrustworthy, and both
are fixed:

1. **It launched with only `--enable-unsafe-webgpu`.** Headless Chromium then
   quietly hands WebGPU a *software* adapter. Runs reported ~1 FPS regardless of
   code quality; the run that started this investigation collapsed to a single
   3.2-second frame and still wrote a report that looked real. The harness now
   passes `--ignore-gpu-blocklist --use-angle=default --enable-gpu-rasterization`,
   records the adapter in the report, and **exits 2 rather than report timings
   from a software adapter.**
2. **vsync was on.** Everything above the refresh rate read as a flat 60 FPS, so a
   regression stayed invisible until it dropped under the cap. Now disabled.

A third trap, not a code defect but worth knowing: **`three.WebGPURenderer` falls
back to `WebGLBackend` in headless Chromium**, and `renderer.isWebGPURenderer`
stays `true` when it does. Check `renderer.backend.constructor.name`. Headless
measures WebGL; `--headed` gets the real WebGPU backend. The two differ
substantially — the WebGL backend showed a 675 ms hitch that does not exist on
WebGPU, and spends far more CPU in node-material graph building.

Treat `tmp/perf-qa-baseline.json` (139 FPS) as unverified: it predates all of this.

## The planned refactor was aimed at the wrong target

The first write-up named "slice `rebuildTreeLod` per chunk so a band change rewrites
only the affected chunk's instance range" as the last structural item. Profiling the
subtree under `applyPendingRebuild` before starting that refactor showed it was
**1.6% of all CPU**, and within it the instance-writing machinery
(`compose`, `computeBoundingSphere`, `writeInstances`) accounted for only ~5%. The
buffer slicing would have been a large, risky change for almost nothing.

What the same profile did show, and what was fixed instead:

### 8. The manifest queue was flushed twice per frame

`StylizedTreeView.update` flushes the manifest queue, and `applyPendingRebuild`
flushed it *again*. That put a full chunk manifest build — fractal noise, habitat
sampling, boulder blockers — inside the same frame as the instance rebuild, and
doubled the per-frame manifest budget. Removed; chunks scheduled during a rebuild
are picked up by the next frame's flush.

### 9. Canopy clustering recomputed every rebuild

The distant `cluster` band ran a connected-components pass over a chunk's
placements, plus a full sort of them to keep the tallest 4%, **every time the LOD
rebuild ran** — 12.7% of the rebuild subtree. Both derive only from the placements,
so they are now memoized on the manifest cache entry (`canopyAggregate`), which is
replaced wholesale on rebuild and so cannot go stale.

### 10. Heights were never memoized — only tiles were

The original tile memo left `getHeight` untouched, and it is the hotter of the two:
slope sampling asks for four heights around every candidate, each bilinearly
interpolating four vertices, so **one scatter candidate can drive sixteen
`sampleHeight` calls**, with heavy overlap between neighbours. `sampleHeight` also
asked for two of its four corners twice.

Heights are now memoized in per-chunk `Float64Array` blocks (bit-identical to the
generator's output), the corner reads are deduplicated, and `getHeight` skips the
string key when there are no overrides.

**A first attempt at this made things worse** — 178 → 116-141 FPS. Both block
lookups built a string key per call via `chunkKey`, and at `getHeight` frequency
that key churn cost more than the saved noise. Adding a one-entry
last-block-touched cache to both the tile and height paths (terrain access is
strongly spatially coherent) turned it into the largest single win of the second
round: **176 → 189 FPS, hitches 9 → 6, max dt 94 → 68 ms.**

## Remaining stutter — precisely what it is

6 hitches in 2,615 frames (0.23%), max 68 ms. None is streaming-related
(`loading: 0`, no origin snaps, `terrainCommit` max 0.1 ms). Two kinds remain, and
the balance has shifted decisively to the GPU side:

### GPU resource creation mid-run — the top remaining lead

Four of the six carry `rendererGeometries +2` and `rendererTextures +3/+4` with
`render` spiking to **22–36 ms**, each correlating with `treeManifestBuilds: 1`.
Geometry and textures are being created *during play*, so the `compileAsync`
pre-warm cannot cover them — it only sees what is in the scene at load.

Identifying what allocates those resources when a new chunk's tree manifest lands
is the next investigation. It is worth roughly 4 of the 6 remaining hitches and
would cut max dt further. Note this is a **different problem** from the tree LOD
slicing previously named as next: `stylized` now averages 2.16 ms with a p95 of
2.9 ms, so the CPU rebuild path is no longer a meaningful cost.

### Instance buffer uploads — partially addressed, and the per-chunk-range idea is dead

`writeInstances` re-uploaded `[0, count)` for the instance matrix *and* all three
companion attributes on every rebuild, even though the usual trigger is an LOD
cross-fade that changes only `fade` and leaves every matrix byte-identical. It now
compares before writing and uploads only the dirty subrange
(`markAttributeSubrangeUpdated`), skipping `needsUpdate` entirely when an attribute
is untouched, and skipping `computeBoundingSphere` unless matrices moved or the draw
count changed.

Measured A/B, `diagonal --warmup 8 --duration 14`, two runs each:

| | Full uploads | Dirty subranges |
|---|---|---|
| Avg FPS | 150.3 / 163.0 | **170.7 / 173.5** |
| dt p95 | 10.5 / 9.2 ms | **8.6 / 8.2 ms** |
| dt p99 | 16.9 / 15.4 ms | **14.5 / 14.6 ms** |
| Bytes uploaded | 45.5 / 46.2 MB | 44.5 / 44.7 MB |
| Hitches / max dt | 9 / 6, ~69 ms | 6 / 9, ~69 ms |

Read that carefully: throughput and both tail percentiles improved, but **the hitch
count and max dt did not move.** The change did not fix the hitches it was aimed at.

Bytes fell only ~3%, which explains why: the dirty range is almost always nearly the
whole buffer. Instances are packed contiguously in plan order, so when a chunk
changes band its instances leave one array and enter another, shifting every
instance after it; and the plan is sorted by distance from the focus chunk, so
crossing a chunk boundary permutes the order outright. A third A/B (dirty ranges but
always recomputing the bounding sphere: 167.8 FPS, p95 8.9 ms) shows the sphere skip
is worth only ~3-6 FPS of the gain — most of it comes from not writing and not
flagging unchanged attributes.

**So the "stable per-chunk instance ranges" fix previously recommended here should
not be built.** Making ranges tight requires each chunk to own a fixed slot range,
which means padding every chunk to its worst-case instance count and drawing the
gaps as degenerate instances — tens of thousands of them against ~700 live trees.
That trade is clearly bad. The remaining upload hitches are the price of compaction,
and compaction is the right call.

## Reproducing

```bash
npm run qa:perf -- --headed --qa diagonal --warmup 8 --duration 14 --speed run
```

`--headed` matters: headless measures the WebGL backend. Compare like-for-like
warmup values — hitch count tracks how much streaming is still in flight, so
`--warmup 2` and `--warmup 8` are not comparable.

To confirm the impostor atlases are current (a mismatch silently costs a
main-thread bake every session):

```bash
npm run validate:impostors
```

If tree prototypes or species geometry change, re-bake:

```bash
npm run bake:impostors
```

## Verification

- `npm test` — 412 passing.
- `npm run build` — clean.
- Scene verified visually in player mode: trees, bushes, boulders, grass and sky
  all present, no console errors.
