# Phase 8 — Walkable wall tops

Status: **landed 2026-07-28**. Depends on Phase 3.

## What shipped, where it differs from this plan

1. **Changing "Wall height" has to carry `top.base` with it.** `top.base`
   defaults to the wall height but is authoritative once set, so raising the
   height moved the stones and left the walkable surface behind. `set_dimensions`
   now brings the base along **only while the user has not authored a top** — an
   explicit base or any profile point means they have, and it is left alone.
2. **The provider carries query counters.** The grid rejection rate is what
   makes this affordable at physics-step frequency, so it is measured rather
   than assumed.

**Verified live.** On the centreline of a 3.5 m wall the surface reads 10.52
against a terrain height of 7.02 — exactly `terrain + 3.5`. Off the wall it
returns `null`. 500 off-wall queries produced **0** closest-point searches: the
occupancy grid rejected every one.

## Goal

Make flat tops mean something. The reference material describes flat-topped walls
as making "clean walkways, staircases, or structural elements" — none of which
work if you walk straight through the wall.

Today `stepPlayerPhysics` receives:

```js
getGroundHeight: (x, z) => terrainView.getWorldHeight(x, z)
```

(`PlayerController.js:184`), so walls are decoration. This phase composes the
construction surface into that one function.

## Design: a ground provider, not a collider

No rigid bodies, no per-stone colliders, no physics engine. Doc 18 invariant 7 is
explicit: *simulation stays semantic — collision and navigation use structural
modules and portals, never render stones.* A wall top is a height field over a
narrow ribbon, and the player controller already consumes a height field.

### `src/editor/construction/simulation/ConstructionGroundProvider.js`

```js
new ConstructionGroundProvider({ store, spatialIndex, terrainView })

provider.heightAt(canonicalX, canonicalZ) -> number | null
```

Composed at the call site:

```js
getGroundHeight: (x, z) => {
  const wall = constructionGround.heightAt(x, z);
  const terrain = terrainView.getWorldHeight(x, z);
  return wall === null ? terrain : Math.max(terrain, wall);
}
```

`Math.max` rather than "wall wins" so a wall that dips below grade on a slope
never drops the player into the ground.

### The query

1. `ConstructionSpatialIndex.list(chunkX, chunkZ)` narrows to the constructions
   whose bounds touch this chunk. Without this the query is O(all walls) per
   physics step.
2. For each candidate, `closestPointOnCubicBezierPath(record.path, { x, z })`
   gives the nearest point, its `segmentId` and `t`, and the lateral distance.
3. `|lateral| <= thickness/2` means the point is over the wall. Otherwise skip.
4. Convert `t` to arc length (the same `arcFractionForParameter` helper Phase 3
   needs — `t` is the Bézier parameter, not arc fraction) and evaluate
   `WallTopProfile.heightAt(s)`.
5. Return `groundHeightUnderPath(s) + heightAt(s)`.

### Caching

`closestPointOnCubicBezierPath` is a 64-step brute force **per segment**
(`CubicBezierPath.js:312-321`). On a 40-segment wall that is 2560 evaluations,
run every physics step — far too slow.

Cache per `(constructionId, revision)`:

- the sampled path points,
- the arc table,
- the wall-top profile,
- a coarse uniform grid over the record's bounds marking which cells the wall
  ribbon touches, so a point clearly off the wall is rejected by one array
  lookup.

Invalidate on revision change, which the store already provides. Cap the cache
at a handful of records — the player can only be near a few walls at once.

Then the per-step cost is: one chunk lookup, a grid test, and a narrow search
over only the segments whose bounds contain the point.

## Deliberate limitations

**Crenellations are not collided against.** `heightAt(s)` for a crenellated top
returns the *merlon base*, so the player walks the wall-walk between the merlons
rather than being blocked by them or walking on top of them. That is the right
gameplay answer and it is also much cheaper than a per-merlon test.

**Ruined sections sag.** `heightAt` already folds in the ruin factor, so a
collapsed stretch is genuinely lower and can be walked down into. That falls out
for free and is the correct behaviour.

**No side collision.** Walking into the side of a wall does not stop you; you
step up onto it if the step is within the controller's existing step-up
tolerance, otherwise you pass through. Adding lateral blocking means real
collision response and is a larger piece of work — see Deferred.

**Openings are not holes in the floor.** An arch's void is below the wall top,
so it does not affect the walkable surface. A player walking the rampart passes
over an arch without noticing, which is correct.

## Ramps and stairs

The reference workflow makes a staircase by raising a section of flat top
gradually. That works here with no extra code: `heightAt` is continuous, so a
ramped profile is a ramp you can walk up, and the player controller's existing
step-up logic handles the discretisation. Whether a *stepped* profile (discrete
risers) is walkable depends on the controller's step-up tolerance — check it
against `WallTopProfile` output and note the maximum riser that works.

## Tests — `tests/ConstructionGround.test.js`

Pure, no renderer — stub `terrainView.getWorldHeight` as a constant or a plane.

1. The centreline of a 3.5 m wall on flat ground returns `terrain + 3.5`.
2. A point `thickness` away laterally returns `null`.
3. A point exactly at `thickness/2` returns the wall height (inclusive edge).
4. A raised profile section returns the raised height; a lowered one the lowered
   height.
5. A ruined section returns the sagged height, below `top.base`.
6. A crenellated wall returns the merlon **base**, not base + merlon height.
7. Off-wall points anywhere in the bounding box return `null` (the grid
   rejection path).
8. The cache invalidates on revision change: raising the profile and re-querying
   the same point returns the new height.
9. Two overlapping walls return the higher surface.
10. Query cost: a synthetic 40-segment wall answers 10 000 off-wall queries
    without evaluating `closestPointOnCubicBezierPath` (assert on a spy count) —
    this is the test that keeps the grid rejection from being refactored away.

## In-app verification

- Build a flat-topped wall with a section ramped down to ground level; walk up it
  and along the top.
- Walk off the end and fall to terrain height without a jolt.
- Crenellate the wall: you still walk the same surface, between the merlons.
- Ruin a section: you can walk down into the collapse.
- Walk along a 200 m wall and watch the frame time — the ground query must not
  show up.
- Edit the wall's top while standing on it (Phase 7 paused editing): the surface
  updates on the next revision and you are lifted or lowered accordingly.

## Deferred

- **Lateral collision.** Walking into a wall's side should stop you. That needs
  collision *response*, not just a height query, and it belongs with a general
  solution for buildings and objects rather than being special-cased for walls.
- **Navigation mesh output** for AI. Doc 18 §7 lists a
  `ConstructionNavigationCompiler`; the ground provider is the input it would
  need, but the consumer does not exist yet.
- **Portals through openings** — walking *through* a gate at ground level, as a
  semantic connection rather than an absence of collision. Needs lateral
  collision first to be meaningful.
- **Stair generation** as an authored feature kind, rather than a ramped profile.
