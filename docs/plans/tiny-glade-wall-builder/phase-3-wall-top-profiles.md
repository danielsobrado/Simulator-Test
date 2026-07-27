# Phase 3 — Wall tops: flat, irregular, crenellated, ruined, raise/lower

Status: **landed 2026-07-27**. Depends on Phase 2.

## What shipped, where it differs from this plan

Three corrections came out of implementation.

1. **The falloff needed compact support, not a plain Gaussian.** At sigma =
   radius/2 a Gaussian still carries 13.5% of its peak at the edge, so the
   bracket points were raised along with everything else — and the brackets are
   the entire mechanism confining the edit. `falloffWeight` now subtracts the
   edge value and renormalises, giving exactly 0 at the radius while keeping the
   Gaussian's shape in the middle (~55% at half radius).
2. **Pruning is deferred until the profile nears its cap.** Pruning after every
   edit erodes the shape: one step is 0.25 m tall, so a 0.05 m tolerance
   cheerfully deletes the peak the user just made because its neighbours come
   close enough. It now runs only past 48 of the 64 points, and the tolerance
   dropped to 0.03 m. Ordinary editing is lossless.
3. **The edit kernel is its own module.** `WallTopEdit.js` holds `falloffWeight`,
   `applyTopEdit`, `pruneTopProfile` and `flattenTop` as pure functions, so the
   falloff, bracketing and pruning are testable without a renderer or an input
   event. The controller only owns hover tracking and the debounce.

Verified in the app: 12 rapid presses produce **0** history entries mid-burst
but advance the store 12 revisions (so the edit is visible while the key is
held), then settle into exactly **1** entry; one Ctrl+Z reverses the whole
burst; and a Ctrl+Z *during* a buffered burst flushes it first, undoing only
that burst and leaving the previous one intact.

Per-style stone output on a 24 m wall: flat 208 field + 22 coping, irregular the
same with a lower crown, crenellated 248 field with merlons and no coping,
ruined 98 field only.

## Goal

Make the wall top an authored thing rather than a constant offset. Four styles,
a per-arc-length height curve the user edits by hovering and pressing arrow
keys, coping stones that follow the slope, merlons that follow the curve, and a
ruin mode that reads as collapsed masonry rather than noise.

"Flat Top" is the reference game's own term and it is what makes walkways and
staircases possible (Phase 8) and standalone arches possible (Phase 6).

## Data model — already in the record

Phase 1 shipped the schema. Nothing new is needed:

```js
top: {
  style: 'flat' | 'irregular' | 'crenellated' | 'ruined',   // default 'flat'
  base: number,                                             // default dimensions.height
  profile: [ { segmentId, arcFraction, height } ],          // <= 64, sorted
}
```

**Control points are anchored per segment, exactly like `features`.** Anchoring
to whole-path arc fraction would make every control point slide along the wall
whenever any anchor moved — the failure doc 18 §5 calls out for feature
positions. `normalizeTop` reuses the same `validSegmentIds` check
`normalizeFeatures` uses.

## The height function — already in `WallTopProfile.js`

Phase 1 shipped `createWallTopProfile(record, arcTable, { style })` returning
`heightAt(s)`, `slopeAt(s, delta)`, `ruinFactorAt(s)`, `crenellationsOver(s0, s1)`.
Phase 3 wires it into the packer and the edit gesture. Recap of the decisions
baked in, because they constrain the gesture:

**Monotone cubic (Fritsch–Carlson PCHIP), not Catmull-Rom.** Catmull-Rom
overshoots between control points, which would push a raised section above its
own control points and make raise/lower feel like it is fighting you. PCHIP sets
the slope to zero at any local extremum and uses a weighted harmonic mean
elsewhere, so the interpolant is bounded by its data. `tests/ConstructionArcTable.test.js`
asserts no overshoot above the peak and no undershoot below the floor.

**Outside the outermost control point the profile holds that point's value**, not
`top.base`. Clamping to the point keeps the curve continuous even for a
hand-authored or clipped profile; jumping back to `base` would put a cliff at the
outermost point. The raise gesture makes this moot in practice by writing
bracketing points at base height (below).

**Duplicate arc positions: last write wins.** Two control points at the same `s`
would divide by zero in the slope solve, so `createWallTopProfile` collapses
them, keeping the later height. That matches what a repeated edit at one spot
should do.

## The raise/lower gesture

Two entry points. The palette action is Phase 5; the keyboard gesture is here.

### Hover + arrow keys

**Hover tracking.** `EditorController.onPointerMove` already runs for the
construction tool. Add, when `tool === 'construction'` and no gesture is active:

```js
const hit = this.constructionView.pickConstructionPoint(
  event.clientX, event.clientY, this.activeCamera,
);
this.hoveredArc = hit
  ? { constructionId: hit.constructionId, ...closestPointOnCubicBezierPath(record.path, hit) }
  : null;
```

`pickConstructionPoint` was drafted in Phase 1 and removed as unused; re-add it
to `ConstructionView`:

```js
pickConstructionPoint(clientX, clientY, camera) {
  // raycast pickTargets(), map hit point back through floatingOrigin.toCanonical
  // -> { constructionId, x, z, y } | null
}
```

`closestPointOnCubicBezierPath` (`CubicBezierPath.js:307`) then gives
`{ segmentId, t }`. Note **`t` is the Bézier parameter, not arc fraction** — they
differ on a curve with uneven parameterisation. Convert properly: sample the
segment, find the arc distance at `t`, and divide by the segment's arc length.
Add a helper to `CurveArcTable`:

```js
arcFractionForParameter(segmentId, t) -> number
```

Getting this wrong puts the raise slightly away from the cursor on tight curves —
a subtle, annoying bug.

**Keys.** `ArrowUp` / `ArrowDown` apply `±TOP_STEP` (0.25 m) with a
compact-support falloff of radius `R`:

```js
const RADIUS_DEFAULT = 3;      // metres
// Gaussian shape, shifted and renormalised so w(R) is exactly 0. A plain
// Gaussian at sigma = R/2 leaves 13.5% at the edge, which raises the bracket
// points and defeats the confinement they exist to provide.
const sigma = R / 2;
const edge = Math.exp(-(R * R) / (2 * sigma * sigma));
const raw = Math.exp(-((s - centre) ** 2) / (2 * sigma * sigma));
const weight = Math.max(0, (raw - edge) / (1 - edge));
height = clamp(existing + direction * TOP_STEP * weight, 0.5, 30);
```

`[` and `]` adjust `R`. **Scope those to `tool === 'construction'`** — they
currently cycle the terrain brush (`EditorController.onKeyDown`, the `[`/`]`
branch), and silently stealing them in every tool would be a regression.

**Writing control points.** The gesture inserts or updates 9 points across
`[centre − R, centre + R]`, *including the two bracket points at the falloff
edge*. Because the falloff is exactly 0 there, those brackets are written at
their existing height — and they are what confine the edit, since the profile
clamps outside its outermost point and a lone control point would otherwise set
the entire wall.

**Pruning is deferred, not per-edit.** Dropping any point within tolerance of
the curve the others describe is correct in principle, but running it every
keypress erodes the shape: a single step is 0.25 m tall, so a 0.05 m tolerance
deletes the peak just created because its neighbours come close enough. Prune
only past 48 of the 64 points, at a 0.03 m tolerance. Ordinary editing is then
lossless and the cost is paid only when there is genuinely no room left.

If pruning cannot get the list under the cap, **refuse the edit** rather than
truncating — dropping arbitrary points would move parts of the wall the user
never touched.

**Debounced undo.** A held arrow key must not produce 40 history entries. Buffer
into `this.pendingTopEdit` and commit one `set_top_profile` command 250 ms after
the last keypress, or immediately on tool change, selection change, or blur. One
burst = one undo step. The store's revision still increments once per commit, not
once per keypress.

> Debouncing has a failure mode worth guarding: if the user hits Ctrl+Z while a
> burst is still buffered, the buffer must flush first or the undo will pop the
> *previous* edit and then the buffer will land on top of it. Flush
> `pendingTopEdit` at the top of `undo()` and `redo()`.

### Command

```js
{ type: 'set_top_profile', constructionId, top }
```

In `ConstructionCommands.js`, resolve dirty segments from **the union of the
segments named by the changed control points, before and after** — a point that
moved off a segment dirties both. Reuse the `change()` helper Phase 1 added.

## Consuming the profile in the packer

`packCurvedWall` already takes `topHeightAt` and `ruinFactorAt` (Phase 2). Phase 3
adds the emitters:

**Ruin drop.** Reuse the shape of `shouldDropRuinStone`
(`ProceduralCastleWallGenerator.js:77-83`) with `x → s`. Drop probability rises
with `ruinFactorAt(s)` and with height up the wall, so a ruin loses its top
courses first and keeps a footing — that is what makes it read as collapse rather
than as noise. Stones adjacent to a dropped one get a small extra protrusion so
the break edge is ragged, not sheared.

**Coping.** For `flat` and `irregular` tops, emit one coping course at
`topHeightAt(s)`, category `'coping'`, sampling `slopeAt(s)` and emitting
`rotation: [0, yaw, slope]`.

> This is the Euler-order trap from Phase 2. `transformGeometry` uses the default
> `'XYZ'` order, so `R = Rx·Ry·Rz`: the Z roll applies first in the block's own
> frame, then the Y yaw swings it onto the path. `[0, slope, yaw]` tilts every
> coping stone sideways and looks almost right, which is worse than looking
> wrong. Assert it in a test.

Also fix the two existing coping call sites that pass no category and therefore
get shaped as `'field'` masonry at full roughness:
`ProceduralMedievalGenerator.js:413` (battlement coping) and `:1332`
(`addSteppedGableCoping`). `IRREGULARITY_CATEGORY_SCALE.coping` is 0.5 and
CLAUDE.md requires dressings to be scaled down. This is a small visual
improvement to the workshop that falls out of getting constructions right.

**Merlons.** For `crenellated`, `heightAt(s)` is the **merlon base**, not the top.
`crenellationsOver(s0, s1)` returns merlon centres phase-locked to absolute arc
length (so adjacent modules agree at their boundary), each
`{ s, width, base, height }`. Emit each merlon as its own short packed course:
call `packCourse` with `span = merlon.width` and offset by `merlon.s`, so a
merlon is bonded stonework rather than a single box. Then cope the merlon top.

## Tests

Extend `tests/ConstructionArcTable.test.js` (PCHIP and crenellation rhythm are
already covered there) and add to `tests/ConstructionMasonry.test.js`:

1. **Gaussian falloff is symmetric** about the hover point, and reaches
   ≤1% of `TOP_STEP` at `R`.
2. **Pruning is lossless within tolerance.** After 20 successive raises at
   scattered points, `profile.length <= 64` and the pruned curve is within 0.05 m
   of the unpruned one at 200 sample points.
3. **`set_top_profile` dirties only changed segments** — a raise confined to the
   last segment leaves the first module's `contentHash` byte-identical. (Phase 1
   already has this test; keep it green.)
4. **Coping roll** equals `atan2(Δheight, 2·delta)` and is emitted as
   `[0, yaw, slope]`. Assert the composed matrix maps the block's local +Y into
   the vertical plane containing the tangent — that is the assertion that
   actually catches a swapped Euler order.
5. **Ruin keeps a footing.** For `style: 'ruined'`, every arc position retains at
   least one stone in the bottom course.
6. **Merlons are bonded, not boxes.** A crenellated wall emits more than one
   stone per merlon at default style settings.
7. **Debounce.** Simulating 12 arrow presses in 100 ms produces exactly one
   history entry; a Ctrl+Z immediately after flushes the buffer first and leaves
   the profile at its pre-burst state.

## In-app verification

- Hover a wall, hold `Up`: the top rises smoothly with visible falloff either
  side, and **one** Ctrl+Z undoes the whole burst.
- `[` / `]` change the falloff radius, and do **not** change the terrain brush
  while the Build tool is active.
- Flat Top flattens an irregular wall and leaves a clean walkable surface.
- Crenellate: merlons follow the curve, spacing is even, and the rhythm does not
  jump at module boundaries.
- Ruin: reads as a collapsed wall — top courses gone first, ragged break edges,
  a surviving footing — not as vertical noise.
- Raise a section, save, reload: the profile round-trips exactly.

## Deferred

- **Stepped foundations.** The wall currently follows terrain continuously with a
  constant `FOUNDATION_OVERLAP`. Stepping the *base* on slopes is doc 18 phase 5
  work and is independent of the top profile.
- **Per-side top profiles** (different inner and outer heights, for a wall-walk
  with a parapet on one side only). Doubles the profile data for a case that
  crenellation mostly covers.
- **`breach` as a distinct feature kind.** It overlaps almost entirely with
  `ruined`; revisit only if a localised, authored breach is wanted separately
  from a whole-wall ruin state.
