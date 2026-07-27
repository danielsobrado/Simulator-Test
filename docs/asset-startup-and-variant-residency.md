# Asset startup and variant residency

**Status:** Implemented
**Date:** 2026-07-26
**Decision:** Load only the trees at boot; stream authored prop variants per
biome as the camera approaches them; encode scatter textures at half the hero
dimension.

## The regression

Startup had grown slow enough to be reported as "loading a map takes a very
long time". The map load itself was not the cause. Measured against the Eldara
Azgaar export (7.3 MB) in the running editor:

| phase | ms |
| --- | --- |
| fetch + `JSON.parse` | 75 |
| Azgaar worker convert | ~410 |
| `controller.loadDocument` | 212 |
| **total** | **~620** |

Nothing streamed afterwards either: every scatter build queue stayed at zero for
twelve seconds after the load, and the window contained one long task (245 ms,
inside the load itself). The scatter layers were not generating props or
impostors for distant parts of the map.

The cost was in the *asset* phase, and it was paid on every page load — which
includes loading a world look, because `activateSceneSettings` reloads the page.
`assetStartupTelemetry` reported:

- **48 GLBs**, ~35 MB, all awaited before the first frame;
- **110 KTX2 textures**, every one 1024×1024, median **270 ms** to transcode,
  **29.3 s** cumulative across the transcoder workers.

`StylizedSurfaceView.bootstrapLayers` was `Promise.all`-ing every variant in
`stylizedSurface.assets` — the complete library for every biome — and
`main.js` awaits `stylizedSurface.ready` before pipeline pre-warm and the first
frame. A world with three biomes paid for all of them.

## What changed

### 1. Only trees block the first frame

`bootstrapLayers` now awaits the shared pine scene, the tree variants, and the
flower textures. Nothing else.

Trees stay on the critical path deliberately. The forest field the tree
prototypes build is what grass, bushes and ground details read to decide where a
wood's interior is; deferring it would make every other layer re-scatter the
moment it landed. Rocks, bushes, ground details and aquatic plants have no such
dependants, and their `update()` already no-ops at zero prototypes, so they
simply draw nothing until their variants arrive. Wildlife also left the critical
await.

### 2. Variants stream per biome, with a prefetch buffer

`StylizedVariantResidency` samples tile IDs on a sparse grid over a circular
window around the focus chunk — each layer's `residentRadius` plus
`streaming.variantPrefetchChunks` — and pulls in any variant whose `tileIds`
claims a biome inside that window, plus anything the biome asset palette pins
there. The window is deliberately wider than residency so a variant is fetched
and installed well before its biome is close enough to scatter anything.

Two throttles keep the work off the frame budget:

- at most two GLB fetches in flight, whose decode and KTX2 transcode run
  off-thread; and
- **one install per frame** (`streaming.variantAppliesPerFrame`), because
  turning a loaded scene into prototypes and instanced renderers is main-thread
  work and is what would otherwise land as a hitch.

Scanning is throttled to a focus-chunk change, a palette change, or
`streaming.variantRescanIntervalMs`, and per-chunk tile sets are cached against
the chunk's `StylizedChunkRevisionTracker` signature.

A variant that fails to load is recorded as failed rather than retried; a
missing or malformed path fails identically every time, and retrying each rescan
would turn one bad entry into a permanent fetch loop.

### 3. Installs are additive, not rebuilds

`StylizedRockView`, `StylizedBushView` and `StylizedGroundDetailView` gained
`appendVariants`, replacing `buildFromScenes`. Existing prototypes keep the
indices they were registered under and keep their instances; only the new
prototypes get renderers. Rebuilding the layer from scratch would re-extract
every geometry already on screen and drop its instances for a frame.

Two consequences worth knowing when touching these views:

- Each carries a `prototypeRevision`, folded into its resident-window update
  key. Without it a variant arriving while the camera stands still would never
  schedule the rebuild that shows it — the window key is otherwise blind to the
  prototype set.
- The bush key also watches the rock view's `prototypeRevision`, because
  boulders are hard blockers for bush placement. A stationary camera would
  otherwise keep bushes that were scattered before the boulders existed.

Terrain-derived fields (`ScatterClusterField`, the path clearance field) are
built on the first variant and reused, since they describe the ground rather
than the prop set.

### 4. Scatter textures are half size

See [glTF asset optimization decision](gltf-asset-optimization-decision.md) —
"Texture tiers". Scatter props encode colour and normal maps at 512 instead of
1024; trees and the shared scene keep the full dimension.

## Result

| measure | before | after |
| --- | --- | --- |
| GLBs loaded at boot | 48 | 8 |
| KTX2 transcodes at boot | 110 | 37 |
| cumulative transcode | 29.3 s | 3.7 s |
| median transcode | 270 ms | 94 ms |
| published GLB payload | ~35 MiB | ~26.5 MiB |

The remaining 1024² transcodes are the tree and shared-scene textures, which is
the intended split.

## Authoring consequence: tag variants with `tileIds`

A variant that declares no `tileIds` is eligible in every biome the layer is,
which is the pre-existing semantics and is preserved. Residency therefore cannot
withhold it — it is always required.

At the time of writing all twelve `rockVariants` and all five `bushVariants`
declare no `tileIds`, so seventeen of the forty prop variants still load on
every world regardless of its biomes. They no longer block the first frame, and
they arrive one per frame, but the per-biome saving does not apply to them.
Tagging them is the remaining win and is an art-direction decision: it decides
which stones and undergrowth belong to which biome, the same way
`groundDetailVariants` already does (17 of 17 tagged).

## Configuration

Under `stylizedSurface.streaming` in `editor.config.yaml`:

| key | shipped | meaning |
| --- | --- | --- |
| `variantPrefetchChunks` | 5 | chunks beyond each layer's residency to prefetch into |
| `variantAppliesPerFrame` | 1 | variant installs per frame |
| `variantRescanIntervalMs` | 500 | maximum age of a residency scan |

All three are optional; omitting them falls back to 4, 1 and 500 in
`StylizedSurfaceViewBase.createVariantResidency`.

Every layer scans the widest window any layer asks for, so a layer with a
tighter residency prefetches slightly earlier than it strictly needs to. That is
the harmless direction to be wrong in.

## Counters

- `stylizedVariantsPendingLoad` — variants queued but not yet fetched.
- `stylizedVariantsApplied` — variants installed this session.
- `stylizedVariantApplyMs` — cumulative main-thread install cost.

## Verifying

`tests/StylizedVariantResidency.test.js` covers the pure residency rules
(everywhere-eligible variants, biome intersection, palette pinning) and the
runtime behaviour (approach pulls a variant in, installs are capped per frame, a
failed variant is not retried).

For the asset phase, `npm run qa:assets:startup` reports the telemetry above.
Note that a backgrounded browser tab throttles timers and `requestAnimationFrame`,
so wall-clock startup measured from a hidden preview pane is not
representative — compare GLB counts, transcode counts and cumulative transcode
time instead, which are machine- and visibility-independent.

## Known unrelated cost

With eight GLBs left, `assetsReadyAt` on the dev server still sits near 7 s, and
`grass-scene.glb` reports ~6 s at boot against 75 ms when loaded in isolation.
That gap is main-thread starvation, not asset cost: the GLB loads overlap the
renderer, voxel-world and pipeline-warm initialisation that runs between
constructing `StylizedSurfaceView` and awaiting its `ready`. Startup wall clock
is therefore dominated by that initialisation, not by assets, and wants its own
investigation against a production build rather than the dev server.
