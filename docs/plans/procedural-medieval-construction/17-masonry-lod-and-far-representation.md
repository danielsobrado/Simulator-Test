# Masonry LOD and Far Representation

Status: **planned, not implemented, and deliberately evidence-gated.** Written
2026-07-25.

## 1. Objective

Give baked workshop buildings the LOD 0–2 ladder that
[08-lod-streaming-and-performance.md](08-lod-streaming-and-performance.md) §5
specifies, so a town of masonry buildings costs draw calls and triangles
proportional to what is actually legible on screen.

## 2. Do not start this without evidence

**This plan opens with a measurement phase, and phase 1 is allowed to conclude
that the rest should not be built.**

Two reasons, both from this repo:

1. The 2026-07-25 performance investigation
   ([perf-investigation-2026-07-25.md](../../perf-investigation-2026-07-25.md))
   traced a 13× frame-rate collapse entirely to **CPU work on the main thread** —
   distance-field regeneration, manifest treadmills, per-frame string building.
   It explicitly rejected the GPU/draw-call hypothesis: standing still measured
   183 FPS with 3.34 M triangles, `render` averaged under 2 ms while `stylized`
   averaged 69 ms. Buildings were nowhere in that profile.
2. `08-…md` §13 and §16 say exactly this: *"Only add compute-driven culling after
   profiling shows CPU/object culling is a real bottleneck"* and *"Do not freeze
   numeric production budgets until the QA scene establishes a measured
   baseline."*

Building a three-tier LOD ladder triples the geometry we keep per definition and
adds a per-frame camera pass that does not exist today. That is a real cost, paid
against an unmeasured benefit. Measure first.

## 3. Current state — verified

| Fact | Where |
|---|---|
| Buildings have **no LOD at all** | `ObjectView.js` |
| `ObjectView` is **event-driven**: `refreshAll()` rebuilds every instance of every definition on any change, and there is no per-frame update | `ObjectView.js:170-208` |
| One `InstancedMesh` per part per definition, capacity grown in powers | `ObjectView.js:210-236` |
| Every building mesh sets `castShadow = true` unconditionally | `ObjectView.js:229` |
| Remeshed assets emit one draw part per populated material family, capped at 7 | `15-…md` runtime contract |
| Geometry is **never saved** — `ProceduralAssetManager.rebuild()` regenerates from the recipe on load | `ProceduralAssetManager.js:214-221` |
| `detail` 1/2/3 already changes course height, target stone width, bevel segments, procedural normal maps, and (since 2026-07-25) whether roof tiles are solids | `ProceduralMedievalGenerator.js`, `ProceduralWorkshopShingles.js` |

### 3.1 What exists to reuse

- `lod/projectedLod.js` — `projectedPixelHeight`, `selectProjectedLod`
  (with hysteresis), `updateLodTransition` (crossfade state), `quantizeFade`.
  All **per-item** and directly reusable.
- `lod/StylizedDitheredMaterial.js` — screen-door crossfade, no transparency
  sorting.
- `impostor/` — a full octahedral impostor baker and a GPU-driven indirect-draw
  batch with CPU fallback. A template if LOD 3 is ever wanted.

### 3.2 What does not fit

`StylizedLodRuntime.buildChunkLodPlan` selects **one band per terrain chunk**,
which is right for scatter (many trees share a chunk's distance) and wrong for
buildings (each placed building has its own distance and its own screen size). The
per-item primitives in §3.1 are the reusable layer; `buildChunkLodPlan` is not.

## 4. Blocking dependency: node materials

**Verified 2026-07-25:** `THREE.MeshStandardMaterial` in `three/webgpu` reports
`isNodeMaterial: false` and has no `opacityNode` property.
`createDitheredMaterial` assigns `.opacityNode` on a clone — on a plain standard
material that assignment creates a property the renderer ignores, so the
crossfade would **silently do nothing** and LOD changes would pop.

The workshop's seven materials are all plain `MeshStandardMaterial`
(`ProceduralWorkshopMaterials.js:createWorkshopMaterials`).

So this plan depends on migrating them to `MeshStandardNodeMaterial`, which is
what [05-…md](05-geometry-materials-and-stylized-realism.md) §6 has always asked
for. That migration is a prerequisite, it is independently valuable, and it should
be its own change — not smuggled in here.

Migration notes for whoever does it:

- `MeshStandardNodeMaterial` is exported from `three/webgpu` and accepts the same
  constructor options; `map`, `bumpMap`, `roughnessMap`, `normalScale` and
  `vertexColors` continue to work.
- `bumpMap` has no node equivalent in some three versions — check before
  assuming; the workshop leans on `bumpScale` heavily.
- `materialSlot()` (`ProceduralWorkshopComponentParts.js:35-58`) infers a family
  from roughness/bumpScale/colour heuristics when `userData.workshopSlot` is
  missing. Any new material must be tagged via `tagWorkshopMaterial` or it will be
  mis-slotted silently.
- `applyPreset` clones the base material and assigns maps; verify clone semantics
  carry node properties.

## 5. LOD tiers

Mapped onto `08-…md` §5. First release is LOD 0–2, per that section.

| Band | Content | Source |
|---|---|---|
| **LOD 0** near | Individual stones, bevels, shingle solids, full opening dressings | Recipe at `detail: 3` |
| **LOD 1** coarse | Coarser stones, fewer bevel segments, roof tiles back to deck-plus-texture, simplified rear faces | Recipe at `detail: 1`, plus §6.2 |
| **LOD 2** shell | Low-poly wall body; buttresses, openings, top profile and towers preserved as geometry; no individual stones; macro colour only | New generator mode, §6.3 |
| LOD 3 cluster | Deferred. Impostor machinery exists if ever needed. | — |

## 6. Where the lower tiers come from

### 6.1 Regenerate, do not decimate

The strongest simplification available: **`detail` is already an LOD parameter**,
and geometry is already regenerated from recipes rather than stored. LOD 1 is the
same recipe generated at a lower `detail`. No mesh simplifier, no decimation
library, no bake step.

This also keeps every invariant we already test: determinism, budgets, semantic
components, material families.

**The catch — silhouette match.** `08-…md` §7 requires silhouettes to match
closely *before* relying on crossfade. Changing `detail` changes stone count and
layout, so individual stones differ between bands. What must match is the outer
envelope: overall dimensions are recipe-driven and identical, so the envelope
agrees to within one stone's protrusion (~3–7 cm at default irregularity). Verify
this rather than assume it — §10 specifies the test.

### 6.2 LOD 1 additions beyond `detail: 1`

- Drop rear-face masonry where the wall interior is never visible (the mortar
  shell already closes the volume).
- Force `shinglesEnabled` false (already implied by `detail: 1`).
- Reduce `beveledBox` bevel segments to 1 (already implied).
- Skip ivy and small metalwork.

### 6.3 LOD 2 shell

A new generation mode, not a detail level: emit the structural envelope only —
wall boxes, opening voids, top profile, buttresses, tower cylinders, roof planes —
at one material per family, with macro colour taken from the palette mean and no
procedural textures. This is the one tier that needs genuinely new generator code.

Reuse the existing `composition` primitive vocabulary as the shell's target
representation where possible, since it is already a low-poly envelope description.

### 6.4 Memory

Three geometry sets per definition instead of one, `MAX_ASSETS = 32`. LOD 2 is
cheap; LOD 1 is roughly 20–30% of LOD 0 by vertex count. Budget ~1.5× current
worst case, and generate lower tiers **lazily** on first need rather than at bake,
caching by `(definitionKey, band)`. Record the estimate in the counters of §8 and
check it against `08-…md` §15 before shipping.

## 7. Per-object selection

New `src/editor/ObjectLodController.js`, owned by `ObjectView`:

- Per frame, for each placed object: `projectedPixelHeight` from its bounding
  sphere and the active camera, then `selectProjectedLod` with hysteresis, then
  `updateLodTransition` for the crossfade.
- Bucket objects by `(definitionKey, band)` and write one `InstancedMesh` set per
  bucket, with `instanceLodFade` driving the dither.
- **Cost control is mandatory** — this is the first per-frame pass over placed
  objects, and §2's investigation is a warning about exactly this class of work:
  - reuse scratch vectors and matrices; allocate nothing per object per frame;
  - recompute only when the camera has moved more than a threshold, or on a
    coarse tick, not every frame;
  - short-circuit on a signature of `(band, quantised fade)` per bucket, and skip
    the instance rewrite when unchanged — the same fast path
    `StylizedChunkRevisionTracker` gained in the investigation;
  - never rewrite all buckets because one changed band. The investigation's last
    open item is precisely `rebuildTreeLod` rewriting every visible chunk when one
    band changes; do not reproduce that here.
- Editor cameras pin selected objects to LOD 0 (`08-…md` §7).

## 8. Shadows, counters, budgets

Per-LOD shadow policy (`08-…md` §14), config-driven:

```yaml
objects:
  lod:
    near:   { castShadow: true }
    coarse: { castShadow: true }
    shell:  { castShadow: false }
```

New counters, following `08-…md` §17 and the existing `PerfCounters` idiom:
`objectLodNear`, `objectLodCoarse`, `objectLodShell`, `objectLodTransitions`,
`objectLodBucketRewrites`, `objectLodSelectionMs`, `objectGeometryBytes`,
`objectLodCacheHits` / `Misses`.

`objectLodBucketRewrites` is the one that catches the rebuild-everything failure
mode; it should sit near zero when the camera is still.

## 9. Measurement protocol

Follow the corrected guidance in [perf-qa.md](../../perf-qa.md):

- `--headed`. Headless measures the **WebGL** backend, not WebGPU, and the two
  differ substantially.
- Confirm the report's adapter is real and `fallback: false`.
- Compare like-for-like `--warmup`; hitch count tracks in-flight streaming.
- **Run the shipped configuration at least twice before comparing anything to
  it.** Run-to-run variance on this machine measured ~9% on average FPS, larger
  than the effect the ACES/soft-shadow A/B was trying to detect.
- A/B against the unmodified code in the same session, not against a recorded
  baseline from another machine.

### 9.1 The QA scene this needs

`08-…md` §18 lists scenes; none exists yet for buildings. Phase 1 must add one:
a deterministic town of **N placed workshop assets** (target 64 and 256) at mixed
distances, reachable by the existing `qa` scenario harness, with a camera path
that crosses the LOD thresholds. Without this scene there is no way to know
whether any of this is worth building.

## 10. Tests

`tests/ObjectLodSelection.test.js` — pure, no renderer:

- band selection matches `projectedPixelHeight` thresholds, with hysteresis
  preventing oscillation across a threshold sweep;
- a still camera produces zero bucket rewrites across many frames;
- one object changing band rewrites one bucket, not all;
- selected objects pin to LOD 0;
- no allocation in the steady-state path (assert via a counter, not a profiler).

`tests/ObjectLodGeometry.test.js`:

- **Envelope match**: for each archetype, the LOD 0 / 1 / 2 bounding boxes agree
  to within a stated tolerance (propose 0.08 m). This is the §6.1 assumption and
  the test that makes crossfade legitimate.
- LOD 1 vertex count is materially below LOD 0 (assert a ratio, not a constant).
- LOD 2 emits no per-stone geometry and one part per family.
- Lower tiers are deterministic and cached by `(definitionKey, band)`.
- Openings survive at every tier (a doorway must not close up at distance).

Extend the workshop QA with a scenario that places one asset and steps the camera
through all bands, screenshotting each, to catch popping visually.

## 11. Acceptance

From `08-…md` §19, plus:

- No LOD blinking on a slow camera sweep, and none when stationary.
- No visible silhouette pop at any transition.
- `objectLodBucketRewrites` ≈ 0 with a still camera.
- Measured improvement in the §9.1 scene that exceeds run-to-run variance, stated
  with both runs shown.
- Zero new hitches over 33.3 ms attributable to LOD selection or lazy tier
  generation. Lazy generation must be sliced or deferred, never a synchronous
  frame-long build.
- `npm test`, `npm run qa:workshop`, `npm run verify` all clean.

## 12. Phasing

| Phase | Deliverable | Gate |
|---|---|---|
| **1** | QA scene (§9.1) + counters + measurement of the *current* code at 64 and 256 buildings | **Decision point.** If buildings are not a measurable cost, stop and record that. |
| 2 | `MeshStandardNodeMaterial` migration (§4), shipped and verified on its own | Visual parity with today; no perf regression |
| 3 | Per-object selection + LOD 0/1 only, regeneration-based, lazy and cached | Envelope test passes; rewrites ≈ 0 when still |
| 4 | LOD 2 shell generator | Openings and top profile survive; part count per family = 1 |
| 5 | Per-LOD shadow policy | Measured shadow-pass saving |
| 6 | *Optional* shader-bevelled far brick (§13) | Only if phase 3–4 measurement shows LOD 1 vertex cost still dominates |

## 13. Shader-bevelled far bricks — optional, last

The idea from the external write-up: reduce a distant brick to ~6 triangles and
synthesise bevels in the pixel shader by ray-marching an analytical chamfered box,
so distant masonry still catches light without vertex cost.

It is legitimate, and `05-…md` §5 already wants "exaggerated bevel width for
readability". But it is last for three reasons:

1. It only pays off if per-brick vertex cost at LOD 1 is the measured bottleneck.
   Phases 1 and 3 will say whether it is.
2. It needs the node-material migration of §4 as a hard prerequisite, plus
   per-brick attributes (box half-extents, bevel radius) that the merged geometry
   does not currently carry.
3. `05-…md` §5 explicitly warns against shader displacement beyond "very small
   surface relief", because it opens mortar gaps and destabilises LOD. An
   analytical bevel is shading-only and does not violate that — but the boundary
   is worth respecting deliberately rather than by accident.

`h3r2tic/kajiya` is the reference for the technique. Note it is Rust/Vulkan: the
technique transfers, the code does not, and our target is TSL on WebGPU.

## 14. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| The whole plan is unjustified | **High, and the point of phase 1** | Phase 1 is allowed to conclude "stop" |
| Per-frame selection reintroduces the CPU cost the investigation just removed | High | Signature short-circuit, no per-object allocation, camera-move threshold, per-bucket rewrites, explicit counter |
| Node-material migration regresses the look of all seven families | High | Separate change, separate verification, visual parity check first |
| Silhouette pop between regenerated tiers | Medium | Envelope tolerance test (§10); raise `detail` for LOD 1 if it fails |
| Lazy tier generation hitches on first sighting | Medium | Slice it through the existing frame-budgeted queue; pre-warm on placement |
| Memory growth from three tiers × 32 assets | Medium | Lazy + cached + counted against `08-…md` §15 |

## 15. Open questions

- Should LOD 2 shells be shared across definitions with similar dimensions? It
  would cut memory but breaks the one-definition-one-geometry contract.
- Does the ortho editor camera need LOD at all, or should it pin everything to
  LOD 0 and accept the cost for authoring clarity?
- Do foundations (`ObjectView.refreshFoundations`) need their own tier, or do they
  simply follow the parent object's band?
