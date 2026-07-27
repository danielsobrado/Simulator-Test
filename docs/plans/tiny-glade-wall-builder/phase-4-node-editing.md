# Phase 4 — Node editing: handles, snapping, loops, insert/delete

Status: **landed 2026-07-27**. Depends on Phase 1 only.

## What shipped, where it differs from this plan

1. **`intersectCubicBezierPaths` needed its own inclusive crossing test.**
   `lineIntersection` excludes its endpoints, which is right for the
   self-intersection sweep — it stops two adjacent segments reporting their
   shared vertex — but across two paths that exclusion **silently drops any
   crossing that lands on a sample point**. That is exactly what happens when a
   stroke crosses a wall through one of its own anchors, so Phase 6's cut
   gesture would have missed the most natural case. The function now uses an
   inclusive test plus a merge radius to collapse the duplicate reports from
   adjacent segments.
2. **Deleting an anchor or closing a loop has to reconcile the record.** Both
   remove segment ids, and `top.profile` and `features` are anchored per
   segment — an orphaned reference makes `normalizeConstructionRecord` throw, so
   the edit would have failed outright rather than degraded. `reconcileToPath`
   drops orphans and the command reports a `dropped` count so the user gets a
   notice instead of silence.
3. **Handle re-solve is the default, with `'preserve'` kept as an option.**
   Nothing needs `'preserve'` yet; it exists so the live drag preview can opt
   out if per-move re-solving ever measures as too jumpy.

Verified in the app, running the reference workflow end to end: a 12-anchor
closed loop (12 segments, 12 modules, zero self-intersections) → delete one
anchor → opens to 11 anchors / 10 segments with a 4.66 m gap → the snap reports
`kind: 'anchor', closesLoop: true` → closing drops the dragged anchor and yields
10 anchors / 10 segments, seamless, with masonry rebuilt on all 10 modules.
Insert moved the curve by 0.0009 (below the sampler's own chord error; the unit
test proves exactness analytically to 1e-12). Ctrl suppression returns
`'straight'` without and `null` with.

## Goal

The reference game's control-node workflow: right-click a wall to enter advanced
edit mode, grab individual nodes and pull them, snap them together to close a
circle, delete a node to open one, and pull a node to straighten a run. Snapping
is on by default; **Left Ctrl suppresses it**.

## The bug this phase must fix first

`moveCubicBezierAnchor` (`CubicBezierPath.js:274`) moves the anchor's position
and **leaves the old handle offsets untouched**. Handles are offsets from their
anchor, so dragging a node carries its old tangent with it and the curve kinks —
progressively worse the further you drag. Every other node operation in this
phase inherits the problem.

```js
export function moveCubicBezierAnchor(input, anchorId, position, {
  resolveHandles = 'catmull-rom',
} = {})
```

`'catmull-rom'` re-derives handles with the exact formula
`createCubicBezierPathFromStroke` uses (`CubicBezierPath.js:248-255`):

```
startHandle_i = (P_{i+1} − P_{i−1}) / 6
endHandle_i   = −(P_{i+2} − P_i) / 6
```

`'preserve'` keeps today's behaviour, for the one caller that may want it (the
live drag preview, if re-solving per pointer-move proves too jumpy — measure
before assuming).

### The dirty set widens to four segments

Because those formulas read `P_{i−1}` and `P_{i+2}`, moving anchor *i* changes
the handles of segments *i−2 … i+1* — **four, not two**.

Phase 1 already widened `dirtySegmentsForAnchor` in `ConstructionCommands.js`
and handles wrap-around for closed paths. Keep the existing test green: it
asserts that after moving anchor 0, only the first two segments' module hashes
change and everything else is byte-identical. Under-reporting here shows up as
stale geometry beside an edit, which is exactly the class of bug the content
hash was built to catch — so if the hash test starts failing after this change,
the dirty set is the first suspect, not the hash.

## Curve operations

All in `src/editor/construction/curve/CubicBezierPath.js`, all pure, all
returning a normalized path.

### `insertCubicBezierAnchor(path, segmentId, t)`

**De Casteljau split** at `t`, so the shape is *exactly* unchanged:

```
P0' = P0
P1' = lerp(P0, P1, t)
M   = lerp(P1, P2, t)
P2' = lerp(P1', M, t)
P3' = lerp(P2', lerp(M, lerp(P2, P3, t), t), t)   // the new anchor
```

and symmetrically for the second half. Convert the resulting control points back
to anchor-relative handles. Test agreement with the pre-split sampled curve to
1e-9 — a naive "insert an anchor at the midpoint and re-solve handles" changes
the shape and is the wrong answer.

Bound to **double-click on the wall in edit mode**.

### `deleteCubicBezierAnchor(path, anchorId)`

- On an **open** path: remove the anchor and merge its two adjacent segments into
  one, preserving the outer endpoints' tangents (take the surviving handles from
  the outer ends of the merged pair). Guard at `anchors.length >= 3` — dropping to
  one anchor is not a path.
- On a **closed** path: remove the anchor and its two segments, and set
  `closed: false`, leaving a C with a gap. **This is the "eraser trick"** — the
  reference workflow spawns a circular building, deletes a sliver to turn it into
  a single wall piece, then drags the two ends back together.

Bound to `Delete` / `Backspace` while an anchor handle is hovered or selected.
Otherwise the existing construction-delete path runs, unchanged.

### `closeCubicBezierPath(path, { dropAnchorId })` / `openCubicBezierPath(path, { atSegmentId })`

Closing drops the dragged anchor, appends the wrap-around segment
(`start = last`, `end = first`), re-solves handles across the seam, and sets
`closed: true`. **No schema change is needed**: `normalizeCubicBezierPath` already
accepts closed paths with `segments.length === anchors.length`
(`ConstructionSchema.js:137`).

### `setCubicBezierHandle(path, segmentId, 'start' | 'end', offset, { mode })`

- `'smooth'` (default): mirror the opposite handle's direction, keeping its
  length. Gives C1 continuity through the anchor.
- `'corner'` (Alt-drag): move this handle alone, allowing a hard corner.

Symmetric mode (mirror direction *and* length) is deferred — a third state for
little gain over smooth plus corner.

### `intersectCubicBezierPaths(a, b, { mergeDistance })`

The same segment-segment sweep as `findCubicBezierSelfIntersections` (`:338`),
but it **cannot** share `lineIntersection` (`:326`) unmodified.

That function excludes its endpoints (`t <= EPSILON || t >= 1 - EPSILON`), which
is correct for the self-intersection case: it stops two adjacent segments
reporting the vertex they share. Across two different paths the same exclusion
silently drops any crossing that lands *on* a sample point — and a stroke drawn
across a wall at right angles through one of the wall's own anchors does exactly
that. Phase 6's cut gesture would have failed on its most natural input.

Use an inclusive test instead, then collapse the duplicate reports that adjacent
segments produce at a shared vertex with a `mergeDistance` (0.05 m). Return the
arc distance along each path so a crossing resolves straight to
`{ segmentId, arcFraction }` for a feature.

### Latent bug to fix while here

`findCubicBezierSelfIntersections` special-cases the closing join with
`input.closed` (`:343`) — reading the **raw argument**, not the normalized `path`
it computed on the line above. It works when callers pass a full path object and
silently mis-reports on a partial one. It becomes load-bearing the moment closed
loops are creatable, which is this phase. Change to `path.closed` and add a
closed-loop test asserting a clean circle reports zero self-intersections.

## Snapping — `src/editor/construction/curve/CurveSnapping.js`

Pure, no renderer.

```js
export function resolveAnchorSnap({
  candidate,      // { x, z } the raw pointer position
  path,           // the path being edited
  anchorId,       // the anchor being dragged
  others,         // [{ constructionId, path }] every other construction
  worldRadius,    // snap radius in metres, scaled from screen px by the caller
  enabled,        // false when Left Ctrl is held
}) {
  // -> { position: [x, z], kind, targetId } | null
}
```

Priority order, first match wins:

| `kind` | Snaps to | Why it ranks here |
| --- | --- | --- |
| `anchor` | Another path's endpoint, or this path's other endpoint | Explicit joins and loop closure must beat everything |
| `curve` | Closest point on another centreline | T-junctions |
| `straight` | The line through the two neighbouring anchors | *"pull a node to stretch into a perfectly straight line"* |
| `grid` | 0.5 m world grid | Regular layouts |
| `angle` | 15° bearing increments from the previous anchor | Regular corners |

**`straight` must also flatten the handles.** Projecting the anchor onto the line
through its neighbours makes the *anchors* collinear, but the curve between them
still bows if the handles have a perpendicular component. Zero that component on
the two adjacent handles, or the wall looks almost-straight and the user cannot
tell why. Test: three anchors collinear to 1e-9 **and** zero perpendicular handle
component **and** the sampled curve deviates from the chord by <1e-9.

**Ctrl semantics.** `enabled: false` when `event.ctrlKey` — snapping on by
default, Ctrl suppresses. See the README for why this reading resolves the two
conflicting source descriptions.

**Feedback.** `rebuildHandles` gains a `snapKind` tint so the user can tell a
junction snap from a grid snap before releasing: gold for none, green for
`anchor`, cyan for `curve`, dim for `grid`/`angle`. Cheap and it is the
difference between snapping feeling helpful and feeling possessed.

## Tangent handle gizmos

For the **selected anchor only**, `rebuildHandles` also emits two small spheres
at `anchor.position + handle` with thin connector lines to the anchor. Emitting
them for every anchor turns a 40-anchor wall into 120 always-on-top spheres.

They reuse the existing handle picking path (`pickHandle`), with
`userData.handleKind = 'tangent'` and `userData.segmentId` / `'start' | 'end'`
so `onConstructionPointerDown` can route to `move_handle` instead of
`move_anchor`.

## Commands

New in `ConstructionCommands.js`, all using Phase 1's `change()` helper and all
passing a `hint`:

| Command | Dirty segments |
| --- | --- |
| `insert_anchor` | the split segment and its two neighbours |
| `delete_anchor` | **all** — segments are relinked, so ids shift meaning |
| `move_handle` | the owning segment plus its neighbour across the shared anchor |
| `close_path` / `open_path` | **all** — same reason |

> **Reconcile the record whenever segment ids disappear.** `delete_anchor` and
> `close_path` both remove segments, and `top.profile` and `features` are
> anchored *per segment* — that anchoring is what stops them sliding when an
> unrelated anchor moves, but it means an orphaned reference makes
> `normalizeConstructionRecord` throw, so the edit fails instead of degrading.
> `reconcileToPath(record, path)` drops orphans and returns a `dropped` count;
> the command surfaces it on the change so the controller can emit a notice.
> Dropping is the honest outcome — the stretch of wall those points described is
> genuinely gone — but doing it silently is not.

## Editor state

New fields on `EditorController`: `selectedAnchorId`, `constructionHandleDrag`.
`hoveredArc` arrives in Phase 3, `constructionCutStroke` in Phase 6.

**Right-click to enter advanced edit mode** is the reference game's entry point,
and the right-button plumbing lands in Phase 5 (it has to be shared with the
radial palette). Until then, node editing is reached through the existing "Edit
anchors" mode button. When Phase 5 lands, a right-click tap on a wall opens the
palette; the *node* editing entry stays on the mode button, because a single
right-click cannot mean both.

## Tests — `tests/ConstructionCurveEditing.test.js`

1. **Insert preserves shape.** Sampled points before and after a `t = 0.37`
   insert agree to 1e-9.
2. **Move produces C1 continuity** at the moved anchor: the incoming and outgoing
   tangents are parallel to 1e-9.
3. **Move dirties four segments** on a long path, two at an endpoint.
4. **Close yields a valid circle**: `segments.length === anchors.length`,
   `closed === true`, and `findCubicBezierSelfIntersections` returns empty.
5. **Delete on a closed loop opens it**: `closed === false` and
   `segments.length === anchors.length − 1`.
6. **Delete on an open path merges**, preserving both outer endpoints exactly.
7. **`straight` snap** — collinearity, zero perpendicular handle component, and
   chord deviation, as above.
8. **Ctrl suppresses every snap kind** — `enabled: false` returns `null` even
   with an anchor 1 cm away.
9. **Anchor snap beats curve snap** when both are in range.
10. **`intersectCubicBezierPaths`** finds a known crossing of two straight paths
    at the analytic point, and returns empty for two parallel paths.
11. **The `input.closed` fix**: passing a partial object (no `closed` key) to
    `findCubicBezierSelfIntersections` on a closed path no longer reports the
    closing join as a self-intersection.

## In-app verification

- Draw a rough circle, delete a sliver (`Delete` on one anchor), drag the two
  ends together — they snap and close seamlessly into a single closed wall.
- Drag a middle node with snapping on → the run goes perfectly straight; hold
  Left Ctrl → it does not.
- Double-click a span → a node appears and **the curve does not move**.
- Alt-drag a tangent handle → a hard corner; drag without Alt → the opposite
  handle mirrors.
- Drag an anchor far from its origin: the curve stays smooth (this is the
  `resolveHandles` fix; before it, the curve kinks).
- Undo/redo each operation and confirm the path round-trips.

## Deferred

- **Symmetric handle mode.**
- **Multi-select and box-select of anchors.** Useful for large layouts, but a
  separate interaction model.
- **Snap to terrain features** (ridge lines, water edges). Interesting, but it
  needs a spatial query the terrain view does not expose yet.
- **Junction ownership** — two walls meeting should resolve a shared corner
  rather than interpenetrate. That is doc 18 §6 "architectural chemistry" and is
  substantial enough to be its own phase; snapping here only positions the
  anchors, it does not merge the masonry.
