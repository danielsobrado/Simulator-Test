# Arbitrary-Footprint Roofs (Straight Skeleton)

Status: **implemented.** Written and implemented 2026-07-25.

## Implementation outcome

The implementation keeps the plan's geometry contract but deliberately replaces
its two riskiest bespoke algorithms:

- `polygon-clipping` performs rotated-rectangle Boolean unions, including
  coincident edges, containment, and multi-component output. The proposed
  midpoint-classification/chaining algorithm was removed because coincident
  edges and partial shared edges make its keep/discard rule ambiguous.
- `straight-skeleton` v1 supplies the synchronous wavefront kernel. The local
  `ProceduralStraightSkeleton.js` adapter canonicalises input, strips collinear
  vertices, converts third-party objects to frozen plain data, and rejects any
  result whose projected face area does not equal the footprint area.
- Roof faces use ear-clipping through `THREE.ShapeUtils.triangulateShape`; the
  proposed fan triangulation was unsafe for concave or tower-clipped faces.
- Ultra detail now tiles arbitrary skeleton faces with eave-parallel scanlines.
  The same even/odd scan handles concavity and tower holes, and the existing
  `MAX_SHINGLES` budget remains the hard ceiling.
- A true gable is implemented for a single rectangular component. A connected
  multi-rectangle group with authored `gable` edges resolves to one coherent hip
  roof and increments `roofGableDowngrades`; defining a useful weighted gable for
  an arbitrary L/T footprint needs authored ridge intent, not a guess based on
  "shortest opposite edges."
- Corner-touching rectangles remain separate roof components before overhang is
  applied, so eaves cannot bridge a real gap. Free-standing wall polylines stay
  unroofed; rectangle volumes are the roof-group authority.
- Recipe format 6 adds `roofPitch`. Versions 1–5 receive the former nominal
  40-degree pitch; new recipes default to 38 degrees.

The implementation is in `ProceduralWorkshopFootprint.js`,
`ProceduralStraightSkeleton.js`, `ProceduralWorkshopSkeletonRoof.js`, and the
arbitrary-face path in `ProceduralWorkshopShingles.js`.

### Code-review corrections, 2026-07-26

- **A failure part-way through a roof component produced two roofs.** The main
  roof was pushed into `parts` before tiles were generated, and tile generation
  can throw on the budget guard; the catch then appended fallback cones *beside*
  the roof already emitted, and never disposed it — contrary to 15-…md's "failed
  generation releases all partially created geometry". Components are now staged
  and pushed only once complete, and the catch disposes the staged geometry.
  (Latent rather than active: probed L and cross footprints at maximum legal
  dimensions, with and without tower clipping, and adaptive tile sizing never let
  the budget guard fire.)
- **Pyramid shingles were rotated a half facet off their deck.** A tile is built
  facing local +Z, so tile facets sat at theta 0/90/180/270 while `ConeGeometry`
  centres its facets between vertices at 45/135/225/315 — on a square tower, a
  full 45°. The roof's measured horizontal extent was 1.27 m wider than the deck
  it covers. Fixed with a half-facet offset; the extent now matches the deck
  exactly.
- **`depthScale` was applied in the wrong frame.** It was passed through
  `transformGeometry`, which composes `T · R · S`, so the depth squash of a
  non-square tower applied *before* the yaw and landed on world X for the facets
  facing ±X. It is now applied in world space after the yaw, exactly as the deck
  does with `roof.scale(1, 1, depth / width)`.
- **The eaves oversail is now bounded** to 0.18 m. It was 35% of tile length, and
  tile length grows adaptively to hold the tile budget, so large roofs oversailed
  by over a metre. An eaves overhang is an architectural dimension and does not
  scale with how coarsely a roof is tiled.
- A connected group that cannot honour an authored `flat` alongside a pitched
  neighbour now increments `roofFlatDowngrades`; only the gable downgrade was
  reported before.

Together the first three corrections took the square tower's near→coarse roof
envelope error from 1.266 m to 0.154 m — the residual being the legitimate eaves
oversail — which is also what unblocked the LOD ladder for shingled archetypes.

## 1. Objective

Roof a building whose footprint is not a single rectangle or circle — an L, a T,
a cross, a hall with a projecting porch — with one coherent roof whose hips,
ridges and valleys meet correctly and never self-intersect.

## 2. Why now

The workshop already lets a user compose arbitrary footprints. It cannot roof
them.

`ProceduralWorkshopComposition.js` accepts up to 48 primitives of kind
`rectangle` (position, `rotation`, `dimensions`), `circle` (radius) and `wall`
(polyline). Two overlapping rectangles are a legal, authorable L-shape today.

But `ProceduralWorkshopCompositionGenerator.js` roofs **each primitive
independently**:

- `rectangleParts` (`:67-79`) emits `ConeGeometry(hypot(width, depth) * 0.53,
  roofHeight, 4)` rotated 45° — a four-sided pyramid.
- `circleParts` (`:110-113`) emits a 32-segment cone.

Two consequences:

1. An L-shape gets two pyramids that interpenetrate. There is no valley where the
   wings meet, and each pyramid's eaves drive straight through the other wing's
   roof surface.
2. `roofFamily` accepts `'gable' | 'hip' | 'flat' | 'auto'` for rectangles, but
   the generator only branches on `'flat'`. **`gable` and `hip` produce identical
   geometry** — the same pyramid. The schema promises a distinction the generator
   does not make.

A straight skeleton fixes (1) and gives (2) a principled implementation, because
a gable is a straight skeleton with two opposite edges weighted to vertical.

## 3. Scope

In scope:

- Union footprint of `rectangle` and `wall` primitives that overlap or touch.
- Straight skeleton over that footprint, at a single uniform pitch.
- Hip and gable variants.
- Shingling the resulting faces at Ultra detail, reusing the 2026-07-25 tile
  builders.

**Out of scope, deliberately:**

- **Circles stay conical.** A 32-gon tower unioned into a hall would contribute 32
  slivers to the skeleton and produce 32 tiny facets where a cone belongs.
  Architecturally a round tower *has* a conical roof; the reference image confirms
  it. Circle primitives keep `shingledConeGeometries` and are excluded from the
  union. Where a tower abuts a hall, the hall's roof is clipped against the tower
  cylinder (§7.4), not merged with it.
- Dormers, gablets, gambrel/mansard breaks, and roof lights.
- Non-uniform pitch per edge, beyond the gable weighting of §6.5.
- Holes (courtyards). The footprint must be simply connected; see §9.
- The archetype path (`wall`/`tower`/`gatehouse`/`square-tower`/`manor`). Those
  have hand-authored roofs that already work. This is composition-path only.

## 4. Footprint derivation

### 4.1 Per-primitive outlines

Each `rectangle` becomes four corners in world XZ, rotated by `rotation` about
`position`. Each `wall` polyline becomes a rectangle strip per segment, offset by
`thickness / 2` either side, with the segments' strips unioned as ordinary
rectangles. Elevation and height are handled per §6.6.

### 4.2 Union — the riskiest step

We need the outline of a union of rotated convex quads, with no dependency (the
repo has no polygon-clipping library and avoids adding any).

**Recommended approach — edge classification and chaining**, a reduced
Weiler–Atherton specialised to union of convex pieces:

1. Collect every edge of every rectangle.
2. Split every edge at all intersection points with every other rectangle's
   edges. `O(n²)` in edges; with `MAX_PRIMITIVES = 48` that is at most ~192
   edges, so ~37k pair tests. Trivial.
3. Discard any resulting sub-edge whose midpoint lies strictly inside any other
   rectangle. Strictly: a point exactly on another edge is kept, so touching
   rectangles do not lose their shared boundary.
4. Chain surviving sub-edges head-to-tail into closed loops, snapping endpoints
   within `WELD_EPSILON`.
5. Validate: exactly one loop, closed, simple (no self-intersection), positive
   area, ≥ 3 vertices after collinear-vertex removal.
6. Remove collinear vertices — they are harmless to the skeleton but produce
   degenerate zero-length bisector events, so drop them here rather than
   special-case them later.

Failure at step 5 falls back per §9.

Known hard cases to cover in tests: rectangles sharing a full edge; sharing a
partial edge; touching at exactly one corner (produces a pinch point — reject and
fall back rather than emit a non-simple polygon); one rectangle fully inside
another (its edges are all discarded, correct); two disjoint groups (two loops →
roof each group separately, which is the one multi-loop case worth supporting).

### 4.3 Orientation

Normalise to counter-clockwise in a right-handed XZ frame, so inward bisectors
are unambiguous. Assert it rather than assume it.

## 5. Straight skeleton

### 5.1 Definition

Offset every edge inward at unit speed along its own normal. Vertices travel
along angular bisectors at speed `1 / sin(θ / 2)` where `θ` is the interior
angle. The traces of the vertices form the skeleton; the offset distance `t` at
which a point is reached is its **time**, and roof height is a function of it
(§6.1).

### 5.2 Events

Only two event types are needed for a simple polygon:

- **Edge event** — an edge shrinks to zero: its two bounding vertices meet.
  Replace the two vertices with one, drop the edge, recompute the neighbours'
  bisectors.
- **Split event** — a reflex vertex reaches a non-adjacent edge, splitting the
  active wavefront into two independent loops. An L-shape has exactly one reflex
  vertex and therefore exactly one split event; this is the case the current
  per-primitive pyramids get wrong, so it must be right.

### 5.3 Algorithm

```text
active loops := [footprint]
queue := min-heap of events by time
seed queue with the edge event of every adjacent vertex pair
     and the split event of every reflex vertex
while queue not empty and guard not exceeded:
    pop earliest event
    if its vertices are stale (already consumed) -> discard
    if edge event  -> collapse, emit skeleton edges, requeue neighbours
    if split event -> split the loop in two, emit skeleton edges, requeue both
    a loop of 2 vertices collapses to a segment; of 1 to a point (apex)
```

Every event consumes at least one vertex, so with a guard of
`4 * initialVertexCount` events the loop provably terminates. Exceeding the guard
is a bug, not a valid outcome: throw, and let §9 catch it.

### 5.4 Numerical robustness

This is where straight-skeleton implementations usually fail. Mitigations, all
mandatory:

- **Parallel adjacent edges** (`θ ≈ π`): the bisector is parallel to both and the
  vertex never collapses. Detect via `|sin(θ / 2)| < ANGLE_EPSILON` and treat the
  edge event as never occurring rather than dividing by ~0.
- **Simultaneous events** — common on symmetric footprints, which is exactly what
  users draw. Process all events within `TIME_EPSILON` of the earliest as a group,
  in a deterministic order (by lowest vertex index), so a symmetric L does not
  depend on floating-point ordering.
- **Stale events**: mark vertices with a monotonically increasing generation;
  discard any popped event referencing a consumed generation. Do not attempt to
  remove events from the heap.
- **Determinism**: no `Math.random()`; all tie-breaks by index. The same footprint
  must yield a byte-identical skeleton, since the recipe hash depends on it.

### 5.5 Reference

`tylermorganwall/raybevel` implements skeleton-plus-bevel over polygon
boundaries and is the closest reference for the offset-to-height mapping.
The algorithm here is the standard Aichholzer–Aurenhammer formulation; the
implementation notes above are what that paper leaves to the implementer.

## 6. Skeleton to roof geometry

### 6.1 Height

`y = baseY + t * tan(pitch)`, `pitch` from the recipe. A uniform pitch over a
straight skeleton is precisely a hip roof, with all faces at the same slope and
all ridges/hips/valleys automatically at their correct heights.

### 6.2 Faces

Each original footprint edge owns exactly one roof face: a polygon bounded below
by the edge and above by the skeleton arcs traced from its endpoints. Collect
these during event processing rather than reconstructing them afterwards — a face
gains a vertex at every event that touches its bounding chain.

Faces are planar by construction (constant slope from a straight base edge), so
they triangulate safely as a fan from the lowest vertex.

### 6.3 Eaves overhang

Offset the footprint **outward** by `recipe.roofOverhang` before running the
skeleton, and run the skeleton on the offset polygon. Offsetting outward can also
self-intersect on a concave footprint; if it does, reduce the overhang for that
build and record it in the generation stats rather than failing.

### 6.4 Shingles

`shingledSlopeGeometries` currently assumes a rectangular pitch parameterised by
`width` / `roofDepth` / `side`. It needs generalising to *an arbitrary planar
convex-or-simple face with a designated eaves edge*:

- rows run parallel to the eaves edge, advancing up the face normal-in-plane;
- each row is clipped to the face polygon, so a triangular hip face naturally
  loses tiles toward its apex;
- `fitMetrics` continues to bound the tile count, now over total face area rather
  than a rectangle.

This is a real refactor of that module, not a parameter change, and it is the
largest single piece of downstream work. Keep the existing rectangular path as a
fast case: the archetype generators still use it.

### 6.5 Gable versus hip

A gable is a straight skeleton in which the two end edges do not participate:
weight them to propagate at speed 0 so the ridge runs out to the footprint
boundary and the end walls rise as vertical triangles. Implement `roofFamily`:

- `hip` — all edges propagate (plain skeleton);
- `gable` — the two shortest opposite edges are frozen, and the generator emits a
  gable wall panel (`gablePanel`, already exists) at each;
- `flat` — no skeleton; keep today's slab;
- `auto` — `gable` when the footprint is a single rectangle whose aspect ratio
  exceeds 1.3, else `hip`.

### 6.6 Differing primitive heights

If two unioned rectangles have different `height`, one roof cannot sit on both.
Group primitives into **roof groups** by `elevation + height` within a tolerance
of 0.15 m; union and skeleton each group separately. Wings at genuinely different
heights then get separate roofs that abut, which is architecturally correct.

## 7. Integration

| Concern | Where |
|---|---|
| New module | `src/editor/workshop/ProceduralWorkshopFootprint.js` — outlines, union, orientation, validation |
| New module | `src/editor/workshop/ProceduralStraightSkeleton.js` — pure, no Three.js, no dependency on the workshop; takes a polygon, returns skeleton arcs plus per-edge faces |
| New module | `src/editor/workshop/ProceduralWorkshopSkeletonRoof.js` — faces → geometry, eaves, gable panels, shingle dispatch |
| Changed | `ProceduralWorkshopCompositionGenerator.js` — replace the per-primitive pyramid with roof groups |
| Changed | `ProceduralWorkshopShingles.js` — generalise `shingledSlopeGeometries` to an arbitrary face (§6.4) |
| Changed | `ProceduralWorkshopComposition.js` — see §8 |

### 7.4 Tower intersections

Where a circle primitive overlaps a roof group, subtract the tower's disc from
each affected roof face in 2D before triangulating, so the hall roof stops at the
tower wall instead of passing through it. This is a polygon-minus-disc clip;
approximate the disc as an n-gon at the same tessellation the tower shell uses so
the seam matches.

## 8. Data model

`ProceduralWorkshopComposition.js` needs:

- `roofGroups` is derived, not authored — no schema change.
- `roofFamily` on `rectangle` gains real meaning; no new values.
- New optional per-composition `roofPitch` (degrees, default 38, range 15–60).
  Currently pitch is implied by `Math.min(3, depth * 0.42)`, which cannot express
  a steep reference-style roof.
- Bump `ASSET_VERSION` to 6 and pin version ≤ 5 records to the current implied
  pitch, following the `LEGACY_IRREGULARITY` precedent so existing composed
  assets do not silently re-roof.

## 9. Failure handling

Every stage validates and the whole path is fail-soft, because a user mid-drag
will produce degenerate footprints constantly:

1. Union produced no loop, several loops in one height group, a pinch point, or a
   non-simple polygon → fall back to **today's per-primitive roofs** for that
   group and set a stat flag.
2. Skeleton exceeded its event guard, produced a non-planar face, or produced a
   face with negative area → same fallback.
3. Outward eaves offset self-intersected → retry with a reduced overhang, then
   fall back.

The fallback must be visibly correct-ish, never absent: a building with no roof
is a worse failure than a building with two interpenetrating pyramids.

Record `roofSkeletonFallbacks` in the generation stats so QA can assert it is
zero on the curated footprints.

## 10. Tests

`tests/ProceduralStraightSkeleton.test.js` — pure geometry, no Three.js:

- square → 4 faces, apex at centre, apex height `= halfWidth * tan(pitch)`;
- 3:1 rectangle → 4 faces, a ridge segment not a point, ridge length
  `= long - short`;
- L-shape → exactly one split event, 6 faces, a valley arc present, no face
  overlapping another in plan;
- T and plus shapes → correct face count, all faces planar;
- symmetric footprints produce the same skeleton across runs and are invariant to
  a cyclic rotation of the input vertex list (guards the simultaneous-event
  ordering of §5.4);
- a footprint with collinear vertices matches the same footprint without them;
- every face's plane normal has the same slope, to `1e-9`;
- total face area projected to XZ equals footprint area, to `1e-6` — the strongest
  single correctness check, and it catches both gaps and overlaps;
- the event guard throws rather than looping on a deliberately malformed polygon.

`tests/ProceduralWorkshopFootprint.test.js`:

- union of two overlapping rectangles → the expected 6- or 8-vertex loop;
- shared full edge, shared partial edge, corner-touch (must be rejected),
  containment, disjoint pairs;
- rotated rectangles at 30°/45°;
- orientation normalised to CCW;
- determinism under primitive reordering (the schema already sorts by id).

`tests/ProceduralWorkshopSkeletonRoof.test.js`:

- geometry is finite, bounded, and its footprint matches the union;
- shingle count scales with face area and respects `MAX_SHINGLES`;
- `gable` emits two gable panels and a boundary-to-boundary ridge; `hip` emits
  none;
- differing heights produce separate roof groups;
- each fallback path in §9 triggers on a crafted input and still yields a roof.

Extend `tests/ProceduralAssetStore.test.js` for version 6 and `roofPitch`.

## 11. Acceptance

- An L, T, plus, and stepped footprint each get one roof with correct valleys and
  no interpenetration, at every `roofFamily`.
- Projected face area equals footprint area on all curated footprints.
- `roofSkeletonFallbacks` is 0 across the curated set.
- `npm run qa:workshop` passes; a new composition scenario screenshots an L-shaped
  build.
- Determinism: the existing recipe-hash test still passes, and a composed asset
  rebuilds byte-identically.
- No `Math.random()` on the path (`IMPLEMENTATION-NOTES.md`).

## 12. Phasing

| Phase | Deliverable | Gate |
|---|---|---|
| 1 | `ProceduralStraightSkeleton.js` + its tests, no integration | Square/rect/L/T pass, area identity holds |
| 2 | `ProceduralWorkshopFootprint.js` + its tests | All §4.2 hard cases classified correctly |
| 3 | Roof geometry at flat shading, no shingles, wired into the composition generator behind fallback | An L-shape roofs correctly in the preview |
| 4 | Generalise `shingledSlopeGeometries` to arbitrary faces | Rect path unchanged; hip faces tile correctly |
| 5 | Gable weighting, `roofPitch`, version 6, tower clipping | Full acceptance |

Phase 1 is independently valuable and independently testable; if the union in
phase 2 proves worse than expected, phase 1 still serves the single-rectangle
gable/hip fix, which is a real bug on its own.

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Polygon union robustness — likely the hardest part, harder than the skeleton | High | Restricted to convex quads; exhaustive §4.2 case tests; fail-soft §9 |
| Skeleton degeneracies on the symmetric footprints users actually draw | High | Grouped simultaneous events with index tie-breaks; rotation-invariance test |
| Shingle refactor regressing the archetype roofs | Medium | Keep the rectangular path as a distinct fast case; existing tests guard it |
| Face count explosion on many-primitive compositions | Medium | Roof groups bound each skeleton; cap primitives per group and fall back past it |
| Recipe-hash churn re-rolling existing composed assets | Low | Version 6 with pinned legacy pitch, per `LEGACY_IRREGULARITY` precedent |

## 14. Open questions

- Should a `wall` primitive ever participate in a roof group, or only ever carry a
  `topFamily`? Current assumption: it participates only if a rectangle in the same
  group overlaps it, otherwise it is a free-standing wall and stays unroofed.
- Courtyards (footprint with a hole) are excluded. The skeleton generalises to
  polygons with holes; the union step does not, without more work. Revisit only if
  users ask.
