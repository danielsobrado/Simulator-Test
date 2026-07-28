# Phase 6 — Openings: arches, gates, doors, windows

Status: **landed 2026-07-28**. Depends on Phases 2, 3 and 4.

## What shipped, where it differs from this plan

1. **Coping had to learn about voids.** An opening tall enough to break the
   crown otherwise leaves the cap floating over thin air — very visible on a
   standalone arcade, where every stone below is gone. Coping is now suppressed
   wherever the void reaches coping height, and runs unbroken where it does not.
2. **`previousJoints` moved to absolute arc coordinates**, because a pierced
   course packs several spans that all need to break bond against the same
   course below. `packCourse` works in its own span-local frame, so every call
   site converts on the way in. Missing that conversion for the coping course
   silently stopped it staggering — caught by the existing joint-staggering
   test, which is the whole reason that test exists.
3. **Jamb lines become forbidden joints for the course above**, so a vertical
   joint never stacks directly on the edge of an opening.

**Verified live.** A 28 m wall went from 232 field stones to 220 field + 14
ashlar jambs + 32 voussoirs after one Alt-drag across it (`kind: 'arch'`,
2.2 m x 2.73 m, sized under the wall top). A second stroke stopping short of the
wall produced a `door`. The standalone-arcade test lowers the top below the
springing and cuts until `field === 0` with the rings and jambs intact.

## Goal

The reference game has no gate tool: you draw a **path through or against a
wall** and the engine carves an arch. Flatten a top and cut until the field
masonry is gone and only stone arches remain. Place windows, and hold Left Ctrl
to stop them auto-linking into multi-pane surrounds.

## Data model — already in the record

Phase 1 shipped the fields. `FEATURE_KINDS` was already
`door|window|arch|gate|tower|breach`; the additions were:

```js
{
  id, kind, segmentId, arcFraction, width, height,
  sill: 0,             // bottom above local grade, 0..20
  profile: 'round',    // 'round' | 'segmental' | 'pointed' | 'flat'
  dressed: true,       // emit jambs / voussoirs / keystone
  group: null,         // multi-pane window linking; null = standalone
}
```

`tower` and `breach` remain accepted-but-ungenerated. `breach` overlaps almost
entirely with Phase 3's `ruined`; revisit only if a *localised* authored breach
is wanted separately.

## Omission: split the course, do not filter stones

`ProceduralCastleWallGenerator` packs a full span and then drops the stones that
`intersectsCastleOpening` (`:112-118`). That leaves **ragged jamb edges** whose
position depends on how wide the omitted stone happened to be — the opening's
edge wobbles with the seed.

Instead, per course:

1. Convert the segment's features into arc intervals at that course's `y`, using
   an `openingHalfWidthAt(y)` mirroring `getCastleOpeningHalfWidth`
   (`ProceduralCastleWallLayout.js:187`). Below `sill` the opening reserves
   nothing; through the springing it reserves `width/2`; above it, the arch
   profile narrows it to zero at the crown.
2. Subtract those intervals from `[s0, s1]` to get the **surviving
   sub-intervals**.
3. Call `packCourse` **once per sub-interval**, offsetting by the sub-interval's
   midpoint — exactly how `buildWallBody` already offsets by its own centre.

`packCourse` itself is unchanged. Stone edges then land flush on the jamb line,
which is what real masonry does, because **the jamb is the edge**.

**Joint staggering across the split.** Translate the previous course's joints
into each sub-interval's local frame before passing them as `forbiddenJoints`,
or staggering resets at every opening. The jamb positions themselves become
forbidden joints for the course above, so a vertical joint never stacks directly
on a jamb.

> **Determinism note, to document so nobody files it as a bug.** Adding an
> opening changes the number of `packCourse` calls per course, and each call
> consumes a fixed number of `random()` draws — so the stone stream *below* the
> opening shifts. The result stays a deterministic function of the record; it is
> simply not stable across adding an opening. Stabilising it would mean forking
> the random stream per sub-interval by arc position, which is possible
> (`mixSeed(seed, courseIndex, subIntervalIndex)`) and worth doing if the churn
> proves distracting while editing. Ship the simple version first and measure how
> it feels.

## Dressings — `src/editor/construction/masonry/OpeningLayout.js`

Pure, no Three.js.

```js
export function layoutOpening(opening, { style, thickness, arcTable, topHeightAt }) {
  // -> { jambs, voussoirs, keystone, reservedIntervalAt(y) }
}
```

Ports `buildArchFace` (`ProceduralCastleWallGenerator.js:149-197`) into arc
coordinates:

- **Jambs** — courses of `ARCH_BLOCK_HEIGHT` (0.27) at
  `s = centre ± (width/2 + trimWidth × 0.46)`, category `'ashlar'`, from `sill`
  up to the springing.
- **Voussoirs** — `blockCount = max(9, ceil(π × R / 0.28))` where
  `R = width/2 + trimThickness/2`. Block *k* at `θ = (k + 0.5)/n × π`:

  ```
  s = centre + cos(θ) × R
  y = sill + springHeight + sin(θ) × R
  roll = θ − π/2
  ```

  category `'voussoir'`.
- **Keystone** — one `'ashlar'` block at the crown, pushed
  `faceSign × 0.012` proud.
- Both faces at `offsetNormal = ±(thickness/2 + 0.075)`.

**Categories are not cosmetic.** `IRREGULARITY_CATEGORY_SCALE`
(`ProceduralWorkshopIrregularity.js:49`) gives `voussoir` 0.3 and `ashlar` 0.45
against `field`'s 1.0, so dressings come out crisp against rough field masonry.
CLAUDE.md requires exactly this. Passing `'field'` by omission — which is the
existing coping bug Phase 3 fixes — makes an arch ring look like rubble.

**Profiles.** `round` is a semicircle (`springHeight = 0`, `R = width/2`).
`segmental` is a shallower arc (`R > width/2`, springing above the jamb top).
`pointed` is two arcs struck from opposite thirds. `flat` is a lintel: no
voussoirs, one long `'ashlar'` block. Ship `round` and `flat` first; the other
two are parameter changes to the same code path.

## Standalone arches fall out for free

If `topHeightAt(s)` drops below a course's `y` across a span, no field stones
survive there and only the voussoir rings and jambs remain — **free-standing
stone arches, with no special-case code**. That is exactly the reference
workflow: flatten the wall top, then draw paths underneath until the wall
disappears and only the arches are left.

Pin it with a test so a future refactor cannot quietly break it: a 12 m wall,
`top.base = 2.2`, three `height: 2.4` arches → `field === 0`, `voussoir > 0`.

## The cut gesture — "draw a path through a wall"

**There is no road or path system in this codebase.** Grep for path-like features
hits only `tileCatalog.js`, `WorldMapUi.js` and `sim/geography` — nothing draws a
spatial path. Building one to satisfy this interaction would be a project in
itself.

**Use a modifier on the existing freehand gesture instead.** Hold **Alt** while
drag-drawing to produce a *cut stroke* rather than a wall. On pointer-up:

1. Fit with the existing `createCubicBezierPathFromStroke`.
2. Intersect against every construction centreline with
   `intersectCubicBezierPaths` (Phase 4).
3. Resolve each hit to `{ constructionId, segmentId, arcFraction }` via
   `closestPointOnCubicBezierPath`.
4. Emit `add_feature` with `kind: 'arch'`, width from the tool, and
   `height = min(topHeightAt(s)) − 0.3` across the opening's span.
5. **If the stroke *ends* against a wall** — its endpoint is within
   `thickness/2 + 0.3` of the centreline rather than crossing it — emit
   `kind: 'door'` instead. That covers "through **or against**".

Roughly 80 lines plus one curve function. The preview during an Alt-drag shows
the stroke and highlights the reserved interval on each wall it will cut, so the
result is not a surprise.

Repeated Alt strokes stack arches until the field masonry between them is
consumed, which is the standalone-arch workflow.

## Windows and Ctrl

A new `window` placed within `WINDOW_LINK_ARC = 1.6 m` of an existing window on
the same segment adopts its `group` id, and the builder emits a shared
mullion/jamb assembly across the group rather than two separate surrounds.

**Left Ctrl at commit passes `link: false`**, leaving `group: null` and
suppressing the merge — the reference game's "hold Left Ctrl to prevent them
auto-linking into large multi-pane windows". Same modifier, same meaning as
Phase 4's snap suppression, which is why the README settles the Ctrl reading
once for the whole feature.

## Feature manipulation

Beyond the cut gesture, features need direct editing:

| Command | Dirty segments |
| --- | --- |
| `add_feature` | the host segment |
| `move_feature` | host segment, before and after (a feature can move across a segment boundary) |
| `resize_feature` | the host segment |
| `delete_feature` | the host segment |

`ConstructionView` grows feature handles — a small ring at each opening's centre,
scaled to its width — reusing the existing `pickHandle` path with
`userData.featureId`. Dragging along the wall moves `arcFraction`; dragging
vertically moves `sill`; dragging the ring edge resizes.

**Rehosting across a junction.** Doc 18 §6 requires a feature moved past the end
of its segment to either rehost onto the neighbouring segment or be rejected with
visible feedback. Implement rehost: clamp `arcFraction` to `[0, 1]`, and when the
drag pushes past either end, look up the adjacent segment through the anchor and
re-anchor with the remainder. Reject only when there is no adjacent segment.

## Tests — `tests/ConstructionOpenings.test.js`

1. **Jamb flushness.** Every surviving stone's outer edge lands on the jamb line
   to 1e-9 — no ragged edge.
2. **Sub-interval coverage is exact.** Each sub-interval is tiled with no gap or
   overlap, and the union plus the reserved intervals equals `[s0, s1]`.
3. **Voussoir count** matches `max(9, ceil(π × R / 0.28))`, and every voussoir's
   `roll` equals `θ − π/2`.
4. **Categories.** Voussoirs and jambs carry `'voussoir'` / `'ashlar'`, never
   `'field'` — this is the CLAUDE.md dressing rule.
5. **Opening stability under an unrelated edit** (doc 18 §13 scenario 5): moving
   an anchor on a *different* segment leaves the opening's reserved interval and
   its module's dressings byte-identical.
6. **Standalone arches**: the `field === 0`, `voussoir > 0` test above.
7. **Sill is respected**: below `sill`, the course is unbroken.
8. **Cut gesture**: `intersectCubicBezierPaths` finds a crossing and yields
   `kind: 'arch'`; a stroke terminating 0.2 m from the centreline yields
   `kind: 'door'`; a stroke that misses yields nothing.
9. **Window grouping**: two windows 1.2 m apart share a `group`; the same pair
   committed with `link: false` do not; two 2.4 m apart never do.
10. **Rehost**: dragging a feature past the end of its segment re-anchors it to
    the neighbour with the correct remainder, and is rejected at a path end.

## In-app verification

- Alt-drag a stroke across a wall → an arch appears at the crossing, with a
  dressed ring and flush jambs.
- Alt-drag a stroke that stops against a wall → a door.
- Flatten a top (Phase 3 palette action), then cut repeatedly until only the
  stone arches remain standing.
- Place two windows close together → one two-pane surround; hold Left Ctrl → two
  separate surrounds.
- Drag an opening around a curve and across a segment boundary — it rehosts and
  stays put visually.
- Save, reload, undo, redo each operation.

## Deferred

- **`tower` and `breach` generation.**
- **Doors and shutters as objects.** Openings are voids plus dressings; filling
  them with joinery is asset work, not masonry.
- **Gate mechanisms** (portcullis, hinged leaves).
- **Automatic arch proposal on road crossing** — doc 18 §6's "road/path crossing
  wall proposes an arch". The Alt-drag gesture is the manual form of the same
  thing; the automatic version needs the road system that does not exist.
- **Stable stone stream across opening insertion** — see the determinism note
  above.
