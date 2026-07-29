# Water refraction performance collapse — investigation, 2026-07-28

Reported symptom: the FPS counter read **~20** in player mode, down from ~144
earlier the same day. The reporting screenshot showed grassland, trees and one
construction wall — **no water anywhere in frame**. A later report added that the
frame rate stayed low even far from a shoreline with the camera turned away.

Companion documents: [player movement performance QA](perf-qa.md) holds the
harness reference; [the 2026-07-25 investigation](perf-investigation-2026-07-25.md)
records the previous collapse and the harness defects fixed then.

## Result

Scenario `move`, `--warmup 3 --duration 8 --speed run`, headed Chromium, real
WebGPU backend. The three builds below were measured in one sitting against
servers on separate ports, so they are directly comparable.

| Build | Avg FPS | `render` avg | `stylized` avg |
|---|---|---|---|
| 2026-07-27 tip (`6d9a71f`) | 143–152 | 2.30–2.39 ms | 2.78 ms |
| 2026-07-28 `8f044d2`, before the fix | 72–73 | 7.2–8.0 ms | 3.91 ms |
| After the fix | 95–97 | 2.65–2.81 ms | 6.1 ms |

The fix removes the refraction cost completely when away from water
(`waterChunksRefractive` is 0), and returns the `render` phase to its previous
level. **It does not restore the full frame rate** — see
[What is still missing](#what-is-still-missing).

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
once per frame, for the whole scene.**

The two textures were isolated separately:

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

### The cost is binary, and hiding the mesh does not avoid it

This was measured directly, and it is the part that makes the problem
counter-intuitive. A temporary probe capped how many water chunks were allowed
to set `visible = true`:

| Water chunks drawn | Avg FPS |
|---|---|
| 0 | 119.3 |
| 1 | 118.4 |
| 4 | 122.9 |
| (branch never compiled) | 164.2 |

Drawing **zero** water chunks performed the same as drawing four, and both were
far below a build with the branch compiled out. So:

1. The cost does not scale with how much water is on screen. One refracting mesh
   costs the same as forty.
2. `mesh.visible = false` does **not** avoid it. Neither does frustum culling.
   Merely having a material that carries those nodes in use is enough.

An earlier iteration of this fix gave each water mesh a per-slot bounding sphere
so it could be frustum-culled. It was reverted: it measured no faster, which
follows directly from the table above, and it added a per-upload half-float scan
worth ~0.6 ms of frame time.

## Fix

Two changes, in
[`StylizedWaterSlot.js`](../src/editor/stylized/StylizedWaterSlot.js) and
[`StylizedWaterMaterial.js`](../src/editor/stylized/StylizedWaterMaterial.js):

**1. Refraction is a build-time branch.** `createStylizedWaterMaterial` takes
`enableRefraction`. Each slot builds the plain variant up front and the
refractive variant **lazily, on first need** — a session that never approaches
water never creates one, so the nodes never enter the frame.

**2. Only chunks near the viewer use the refractive variant.**
`isWithinRefractionRange()` compares the slot's chunk against
`terrainView.focusChunk` with a Chebyshev radius of `REFRACTION_CHUNK_RADIUS`
(2 chunks). Measured in chunks rather than metres so it needs no camera pose.
Away from a shoreline no slot qualifies, nothing refractive is submitted, and the
copies do not happen.

Dry chunks are still culled as well
(`waterFieldHasCoverage` in [`WaterField.js`](../src/editor/water/WaterField.js)):
one water mesh exists per *terrain* chunk, and on a dry chunk every fragment
discarded on alpha while still costing fill and submission. In the reference
scenario that is ~40 meshes a frame withheld. Coverage is channel 0 and never
negative, so the predicate scans for a non-zero magnitude at stride 4 with no
half-float decode, masking the sign bit so an encoded `-0` reads as dry. It is
recomputed **on every upload** so a runtime edit that floods or drains a chunk
re-decides, and visibility is resolved *after* the upload so a chunk that has
just gained water is not hidden for a frame.

Three counters make this observable: `waterChunksWet`, `waterChunksDry` and
`waterChunksRefractive`. The last is the one that matters — while it is 0 the
frame pays no viewport copies at all.

### Known trade-off

Water beyond the radius renders without refraction, so a wide lake can show a
transition between refracting and non-refracting chunks. Refraction is
depth-faded and subtle at that distance, and the radius is set well beyond where
it reads as more than a faint tint, but this is a real art-direction compromise
rather than a free win. If it shows, raise `REFRACTION_CHUNK_RADIUS` and accept
the copies over a wider approach, or promote it to `water-visual.yaml`.

## Correction: the headline numbers came from an asset-less scene

The `181.5 FPS` figure originally recorded here was measured in a probe worktree
created with `git worktree add`. **Authored GLB assets are gitignored, so the
worktree had none of them** — no authored trees, rocks, bushes, grass clumps or
aquatic plants (59 files / 16 MB against the real 108 files / 38.8 MB). It was
rendering a far lighter world than the game does, and its absolute numbers do not
describe the product. Comparisons *between* probe runs remain valid, since they
all shared the same gap.

Re-measured in the real scene, with full assets and alternating A/B over three
rounds to cancel drift:

| | Avg FPS | `render` avg | dt mean |
|---|---|---|---|
| Dry-culling only (`c2a6168`) | 116.6 / 122.0 / 122.7 → **120.4** | 2.31 ms | 8.34 ms |
| Plus the material variant | 115.4 / 112.1 / 119.2 → **115.6** | **2.00 ms** | 8.68 ms |

The variant reliably removes CPU from the render phase (−0.31 ms, well outside
the ±0.08 ms spread) and drives `waterChunksRefractive` to 0, so the viewport
copies genuinely stop. **It does not raise the frame rate in this scene**: the
4.8 FPS difference is ~1.7σ, within noise, and the asset-heavy frame is not bound
by those copies. The dramatic light-scene win does not transfer.

Keep it for the headroom — it is ~30 lines and strictly less work per frame, and
it matters on water-free worlds and weaker CPUs — but do not expect it to show on
the FPS counter today.

An overdraw regression was suspected in the non-refracting variant and ruled out:
both paths multiply alpha by `waterCoverage`, so the plain variant shades exactly
the same pixels.

## What is still missing

The `stylized`-phase regression reported in an earlier revision of this document
**does not exist**. It was an artefact of measuring with three dev servers alive:
re-measured cleanly, `stylized` is 2.18 ms at the 2026-07-27 baseline and 2.19 ms
at `c2a6168` — identical. Today's committed work introduced no CPU regression
outside the water material.

What remains is not a regression but the standing cost of the real scene. In the
asset-heavy world at ~120 FPS the frame breaks down roughly as:

| Phase | ms |
|---|---|
| `stylized` | 4.3–4.6 |
| `render` | 2.0–2.3 |
| everything else measured | ~0.3 |
| unaccounted (GPU wait) | ~1.7–2.0 |

`stylized` is the largest single item, and the instrumented sub-counters inside it
(`grassScatterMs`, `flowerScatterMs`, `stylizedVariantApplyMs`, the collision
refresh timers) sum to only ~0.9 ms. **About 3.5 ms per frame of the stylized
update is uninstrumented**, which is where the next investigation should start —
add marks inside the loop before theorising about which subsystem it is.

`treeRebuilds` was checked and cleared: it runs at ~1.2 per frame in every build
including the 176 FPS baseline, so it is how streaming works here, not a defect.

## Regression coverage

[`test/water-dry-chunk-culling.test.js`](../test/water-dry-chunk-culling.test.js)
covers the coverage predicate (fully dry, single wet vertex, partial shoreline,
encoded `-0`, absent field), and pins the properties that make the fix correct:

- the viewport nodes stay **inside** the `enableRefraction` branch — hoisting
  them out would reintroduce the whole-frame copy regardless of the flag;
- the plain variant is built up front and the refractive one lazily, with the
  range checked *before* it is built;
- coverage is recomputed on upload, and visibility resolved after it;
- both variants are disposed with the slot.

The coverage predicate is deliberately tested against a field whose *other*
channels are non-zero on dry ground — depth, surface height and shore distance
all carry values there, so a predicate that scanned every channel would call a
dry chunk wet.

## Method note

The A/B and the bisect ran against **separate dev servers on separate ports from
detached git worktrees**, so the working tree was never checked out from under
the running session. Put such a worktree *inside* the project directory so it
resolves `node_modules` upward; linking `node_modules` into a worktree outside
the project invites a recursive delete from following the link.

**A fresh worktree is not a runnable copy of the game.** Authored GLB assets and
other generated files are gitignored, so `git worktree add` produces a world with
no trees, rocks, bushes or grass clumps, which measures far faster than the real
thing. Copy `public/` across before quoting any absolute number, and check the
file count and total size match. Every number in this document taken before that
copy describes the lighter world.

`docs/perf-qa.md` warns that a second tab rendering the app costs ~30% on its
own. Late in this investigation, with three dev servers alive, runs of the same
build scattered between 54 and 97 FPS. **Shut down every other server before
taking a number you intend to quote.**
