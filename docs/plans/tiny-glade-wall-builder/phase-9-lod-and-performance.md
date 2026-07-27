# Phase 9 — LOD, budgets, and performance gates

Status: **planned**. Depends on Phase 2 (there must be masonry to simplify).

## Goal

Make a castle perimeter affordable, and prove it with measurements rather than
assertion. Ship three LOD bands, wire the counters, and run the doc 18 §13
performance scenarios as a same-session A/B.

This phase is deliberately last. Doc 18's own framing applies: *do not call it
optimised until the evidence gate has passed*, and the CPU reference path has to
exist and be measured before anything more aggressive is justified.

## LOD bands

Reuse `selectProjectedLod` and `updateLodTransition` from
`src/editor/stylized/lod/projectedLod.js` — the same projected-pixel selection
with hysteresis and dithered cross-fade that `ObjectLodController` already uses
for buildings (`ObjectLodController.js:40`). A second, differently-tuned LOD
implementation in the same renderer is how popping becomes inconsistent between
object types.

| Band | Content | Rough switch |
| --- | --- | --- |
| `near` | Full masonry: jittered, bevelled, per-stone shaded, dressings | default |
| `coarse` | `detail: 1`, halved jitter, two courses merged per row, dressings kept | ~140 px projected height |
| `shell` | The existing extruded ribbon from `buildWallGeometry` | ~35 px |

Starting thresholds mirror `ObjectLodController`'s `nearPixels 140` /
`coarsePixels 35` / `hysteresisRatio 0.15` / `transitionMs 240`; tune from
measurement, not from taste.

**Dressings survive into `coarse`.** An arch ring is the readable feature of a
wall at middle distance; dropping it to save triangles removes the thing that
makes the wall legible. Halve the field masonry instead.

**Pin edited and selected modules to `near`.** A module being dragged must never
change LOD mid-gesture — that reads as the geometry glitching.

The `shell` band already exists and is already the pre-masonry placeholder, so
the third band costs nothing new.

## Per-LOD hashes

`ConstructionPlanner` currently emits one `contentHash` per module. Extend to one
per module **per LOD**, so a band that is not resident is not rebuilt when its
inputs change, and a band that is resident is rebuilt only when *its own* inputs
change. `coarse` ignores jitter amplitude, for instance, so an irregularity
change should not dirty it.

## Counters

Through `PerfCounters`, alongside the existing terrain and grass counters:

| Counter | Why |
| --- | --- |
| `constructionModulesResident` | memory and draw-call pressure |
| `constructionModulesRebuilt` | is "local edits stay local" actually holding |
| `constructionModulesSkippedByHash` | the hash gate's hit rate |
| `constructionStones` | budget headroom |
| `constructionPlanMs` | worker cost |
| `constructionBuildMs` | main-thread geometry cost |
| `constructionQueueDepth` | backpressure |
| `constructionLodTransitions` | popping |
| `constructionGeometryBytes` | GPU memory |

Phase 1 already tracks the first four on `view.stats`; this phase promotes them
to `PerfCounters` so the perf QA harness picks them up, and adds the rest.

The `modulesRebuilt` / `modulesSkippedByHash` ratio is the single most useful
number here: if an anchor drag on a 200 m wall rebuilds more than a handful of
modules, invariant 4 has regressed and no amount of LOD will save it.

## Budgets

Confirm the Phase 2 caps hold under LOD:

```js
MAX_MODULE_STONES = 280
MAX_CONSTRUCTION_STONES = 6000
```

and add a residency cap — total resident modules across all constructions —
beyond which the furthest constructions drop to `shell` regardless of projected
size. A town of 40 walls should degrade gracefully rather than each wall
independently deciding it deserves `near`.

## Performance scenarios

Per `docs/perf-qa.md` and doc 18 §13. **Real headed WebGPU, two runs per
candidate in the same session, compared against a same-session A/B of the
unmodified code** — not against a recorded baseline from another machine.

The CLAUDE.md note applies: `qa:perf` needs the app already serving
(`npm run dev`), and its hitch count tracks how much chunk streaming is still in
flight, so always compare runs at the same `--warmup`.

| Scenario | Watching for |
| --- | --- |
| One 20 m curved wall | baseline cost of the feature at all |
| One 200 m wall | module count scaling, queue drain, LOD distribution |
| Closed castle perimeter | the target case; residency and draw calls |
| Rapid anchor-drag stress | rebuild locality; `modulesRebuilt` must stay small |
| Fly-through across LOD crossings | popping, transition smoothness |
| Rebase mid-edit | Phase 1's zero-rebuild rebase holding under masonry |
| Dense town: walls plus workshop buildings | interaction with `ObjectLodController` |

**Gates.** Each must pass before the phase is called done:

1. No frame over 16 ms while committing a 200 m wall.
2. Preview during a drag stays under doc 18's 1 ms CPU p95 — masonry is built on
   commit, so this should be untouched, and if it is not, something is calling
   the packer from a pointer handler.
3. An anchor drag rebuilds ≤4 modules on a 200 m wall.
4. A rebase rebuilds **zero** modules.
5. LOD transitions show no visible pop at the tuned thresholds.
6. Closed castle perimeter holds target frame rate with the backdrop active.

## Tests — `tests/ConstructionLod.test.js`

Pure where possible; band selection and hysteresis are arithmetic.

1. Band selection at, above, and below each threshold.
2. Hysteresis: a projected size oscillating by less than `hysteresisRatio` around
   a threshold does not change band.
3. Edited and selected modules stay pinned to `near` regardless of projected
   size.
4. The coarse silhouette stays within the envelope tolerance used by
   `createProceduralObjectLodParts` (`ProceduralAssetManager.js:225`) —
   `max(0.08 m, 2% of the largest dimension)`.
5. Coarse saves a meaningful triangle fraction; if it saves under 5%, fall back
   to `near` rather than paying for a second geometry (the same refusal
   `createProceduralObjectLodParts` applies at `:259`).
6. Per-LOD hashes: changing irregularity dirties `near` but not `coarse`.
7. The residency cap drops the furthest constructions first.

## Deferred — and why

| Item | Why |
| --- | --- |
| GPU arenas, compute culling, indirect draws, HZB (doc 18 phases 7–11) | The CPU reference path must be measured as the bottleneck first. Doc 18 is explicit that the GPU path must beat the reference by more than run-to-run variance before it ships. |
| LOD 3 construction proxy (skyline ribbons, impostor atlas) | Doc 18 §11 gates this behind LOD 0–2 shipping and being measured. |
| Analytical shader bevel (six-triangle brick proxy in TSL) | Doc 18 §11 accepts it only if LOD 1 vertex cost is a *measured* bottleneck, and it must not change the silhouette or open mortar gaps. |
| Worker-side geometry emission | Forks the geometry path away from the workshop's; only if main-thread build time is measured as dominant. See Phase 2. |
| Shadow-cost tuning per band | Worth doing, but only once the bands themselves are tuned — otherwise two variables move at once. |

## A note on ordering

If measurement shows the CPU reference path is comfortably fast enough for the
intended scenes, **stop here**. The GPU-driven renderer in doc 18 phases 7–11 is
a large amount of machinery whose justification is an A/B result that may never
materialise for wall counts a player actually builds. Shipping LOD 0–2 with
honest numbers is a complete outcome.
