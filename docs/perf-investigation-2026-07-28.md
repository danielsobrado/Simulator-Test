# Water refraction performance collapse — investigation, 2026-07-28

Reported symptom: the FPS counter read **~20** in player mode, down from ~144
earlier the same day. The reporting screenshot showed grassland, trees and one
construction wall — **no water anywhere in frame**.

Companion documents: [player movement performance QA](perf-qa.md) holds the
harness reference; [the 2026-07-25 investigation](perf-investigation-2026-07-25.md)
records the previous collapse and the harness defects fixed then.

## Result

Scenario `move`, `--warmup 3 --duration 8 --speed run`, headed Chromium, real
WebGPU backend. All numbers from the same machine in one sitting.

| Build | Avg FPS | `render` phase avg |
|---|---|---|
| 2026-07-27 tip (`6d9a71f`) | 155.4 | 2.23 ms |
| 2026-07-28 tip (`339cc3c`), before the fix | 75.6 | 9.22 ms |
| After the fix | 114–132 | 2.52–2.67 ms |
| Fix + refraction compiled out entirely | 169.3 | 1.53 ms |

The same ratio held with a construction wall in frame (`collision-p7`): 83.7 FPS
before, 144.8 with refraction compiled out.

## What it was not

Two hypotheses were tested and rejected before the cause was found:

- **The construction work.** The day landed a ruin-shell rebuild, coarse-LOD
  changes and a debug ghost overlay. The overlay is gated behind
  `?constructionRuinDebug=1` and was inert. More decisively, the regression
  reproduces in a scenario with **zero constructions resident**.
- **The collision subsystem.** The day also landed mesh-BVH colliders, walkable
  rock proxies, a placed-object collider library and construction collision
  providers — a plausible suspect for a player-mode collapse. The `player` phase
  measured **0.219 ms average**, and `collisionPrimitiveTests` was 0. Collision
  is not on the hot path.

## Cause

`git bisect run` over the 238 commits since the previous night, scored by
`npm run qa:perf` avg FPS, converged on:

> `d4d8971` — `feat(water): add depth-safe refraction`
>
> 137.3 FPS on the commit before it, 83.9 on it.

That commit added a refraction branch to
[`StylizedWaterMaterial.js`](../src/editor/stylized/StylizedWaterMaterial.js)
which samples `viewportDepthTexture` and `viewportOpaqueMipTexture`.

**Referencing either node makes the three.js WebGPU renderer copy the
full-resolution colour buffer, copy the depth buffer, and build a mip chain —
once per frame, for the whole scene.** The cost is paid when the material is
submitted, not per water pixel. It is not gated on water being visible, or in
frustum, or covering a single fragment.

The two textures were isolated separately at HEAD:

| Variant | Avg FPS |
|---|---|
| Both sampled (shipped) | 75.6 |
| `viewportOpaqueMipTexture` removed, depth kept | 76.0 |
| `viewportDepthTexture` removed, mip kept | 91.4 |
| Whole branch removed | 164.2 |

Removing one is worth little; the renderer stays on the copy path for the other.
**Both must go to escape it.**

The branch reaches every user because `resolveWaterQualityFeatures` defaults
`qualityTier` to `high` ([`WaterQuality.js`](../src/editor/water/WaterQuality.js)),
and `high` sets `refraction: true`.

### Why a dry world paid for it

[`StylizedWaterSlot`](../src/editor/stylized/StylizedWaterSlot.js) creates one
water mesh per **terrain** slot, spanning the whole chunk, and made it visible
whenever the terrain chunk was visible and the page carried water field pixels —
which every page does. Coverage is zero across a dry chunk, so every fragment
discarded on alpha and nothing was drawn. The submission still happened, so the
copy still happened.

In the reference scenario that meant ~50 water meshes submitted per frame for a
world with ~10 genuinely wet chunks.

## Fix

Dry chunks no longer draw. `StylizedWaterSlot.update` resolves visibility from
whether the uploaded field carries any coverage at all:

- [`WaterField.js`](../src/editor/water/WaterField.js) gained
  `waterFieldHasCoverage(pixels)`. Coverage is channel 0 and never negative, so
  the predicate scans for a non-zero magnitude bit pattern with a stride of 4 —
  no half-float decode. The sign bit is masked so an encoded `-0` reads as dry.
- [`StylizedWaterSlot.js`](../src/editor/stylized/StylizedWaterSlot.js)
  recomputes the flag **on every upload**, not from a field baked onto the page,
  so a runtime edit that floods or drains a chunk re-decides whether it draws.
  Visibility is resolved *after* the upload, so a chunk that has just gained
  water is not hidden for a frame.

Two counters were added so this is observable rather than inferred:
`waterChunksDrawn` and `waterChunksDry`, tallied per frame per slot. On the
reference scenario after the fix: **10.3 drawn, 40.3 dry** per frame.

## What the fix does not do

It restores ~114–132 FPS, not the 169 of compiling refraction out. The gap is
real water: those ~10 wet chunks are drawn, and drawing even one puts the frame
back on the copy path. That is the honest cost of the feature as designed — the
fix removes the cost for dry ground, not the cost of water itself.

If refraction proves too expensive near actual water, the remaining levers are:

1. **Frustum-cull the water meshes.** `StylizedWaterSlot` sets
   `mesh.frustumCulled = false`, so wet chunks *behind the camera* are still
   submitted and still trigger the copy. The flag is presumably false because the
   vertex shader displaces Y by water height and the shared plane geometry's
   bounding sphere does not account for it; a correct bound would need to be
   derived from the field's surface range. Not attempted here.
2. **Drop the default tier to `medium`**, making refraction opt-in.
3. **Render the refraction source at reduced resolution and skip the mip chain.**
   Unmeasured.

## Regression coverage

[`test/water-dry-chunk-culling.test.js`](../test/water-dry-chunk-culling.test.js)
covers the predicate (fully dry, single wet vertex, partial shoreline coverage,
encoded `-0`, absent field) and pins the two ordering properties in the slot that
make the fix correct: coverage is recomputed on upload, and visibility is
resolved after the upload.

Note the predicate is deliberately tested against a field where the *other*
channels are non-zero on dry ground — depth, surface height and shore distance
all carry values there, so a predicate that scanned every channel would call a
dry chunk wet.

## Unrelated defect found

`test/water-optics-material-contract.test.js` fails at `8f044d2`, asserting
`/const opticalDistance = min\(/`. Commit `d4d8971` hoisted that variable out of
the `depthOptics` block so the refraction branch could read it, leaving
`opticalDistance = min(` without the `const`. The contract test was not updated.
This is a stale assertion, not a shader defect, and predates this fix.

## Method note

The A/B and the bisect ran against a **separate dev server on a second port from
a detached git worktree**, so the working tree was never checked out from under
the running session. `docs/perf-qa.md` warns that a second tab rendering the app
costs ~30% on its own; every number above was taken with the same tabs open, so
the comparisons hold even though the absolute values sit below a quiet machine's.
