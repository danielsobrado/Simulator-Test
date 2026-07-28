# Phase 2 — Curved masonry (near LOD)

Status: **landed 2026-07-27**. Depends on Phase 1.

## What shipped, where it differs from this plan

Five corrections came out of implementation. They are folded into the sections
below; this is the summary.

1. **The packer never sees terrain.** Courses are solved relative to grade, so
   `groundHeightAt` is not a packer input — the geometry builder resolves ground
   on the main thread, where `terrainView` already lives. Nothing terrain-shaped
   has to cross into the worker.
2. **The curvature headroom needed a real constant, and a bug fix under it.**
   `packCourse` normalizes its candidate widths to fill the span exactly, so a
   low sample mean inflates the widest stone well past the nominal 1.28x spread.
   `WIDTH_SAFETY = 1.75` covers spread and inflation together. Separately,
   `CurveArcTable.maxCurvatureOver` sampled a fixed 9 points across the whole
   range and **missed the curvature peak on any span longer than a few metres**,
   leaving every caller under-constrained; it now samples every 0.25 m.
3. **Placements carry `packedWidth`** — the solved width before the mortar
   inset. It is what tiles the course exactly, so coverage is checkable.
4. **One module build per frame, not two.** A module cannot be interrupted once
   started, so the worst-case frame is one module's build time. Two put a 200 m
   commit at 18.8 ms/frame; one measures p50 2.3 ms, p95 4.5 ms, max 9.2 ms.
5. **`ProceduralWorkshopPresetTextures.js` was not extracted.** Phase 2 needs
   only the built-in stone palette, so `proceduralNormalTexture`,
   `surfaceBumpTexture` and `surfaceRoughnessTexture` were exported from
   `ProceduralWorkshopMaterials.js` instead. The preset-texture extraction moves
   to Phase 5, where presets are actually applied.

6. **Modules did not tile the wall** (fixed 2026-07-28, from a screenshot).
   Module intervals were taken from each segment's own sampled points, but
   `sampleCubicBezierPath` drops every segment's duplicated first point — so
   segment *n+1* started strictly after segment *n* ended and **every segment
   joint left an unwalled sliver**, visible as a vertical gap up the whole wall.
   This is the same sampler quirk Phase 1 fixed for arc ranges; the module
   interval computation was simply missed. Intervals now come from the
   contiguous `segmentRanges`.
7. **Module boundaries wander per course** (added with the above). Even with the
   gap closed, modules partition the wall, so every course had to terminate on
   the same arc position and the shared joint stacked into a continuous vertical
   line — the one thing coursed masonry never does. The boundary now shifts per
   course by up to 0.42 stone widths, derived from `(seed, course)` **only** so
   both modules at a seam compute the same shift and still meet flush. Scaling
   it by the local `targetWidth` is the trap: that value is curvature-limited
   per module, so two modules either side of a bend would tear open a gap.
   Wall ends stay hard edges, and course height plus `heightRatio` are now
   wall-wide so courses neither step nor weather differently across a seam.

Measured on a 251 m serpentine wall: 45 modules, 2216 stones, 62 048 triangles,
no budget overflow, shell correctly hidden once every module had geometry.

## Goal

Replace the extruded ribbon with real coursed stonework that follows a cubic
Bézier path. This is the phase that makes every later one possible: arches are
cut by *omission of stones* (Phase 6), ruins are *dropped stones* (Phase 3),
and the material palette (Phase 5) has nothing to paint until stones exist.

The ribbon survives as the shell LOD and as the pre-masonry placeholder — it is
never deleted.

## Design decision: pack in arc length, keep `packCourse` scalar

`packCourse({ span, targetWidth, minWidth, random, forbiddenJoints })`
(`src/editor/workshop/ProceduralWorkshopCoursePacker.js:101`) solves a 1-D
interval problem: exact fill, joint staggering against the course below, sliver
dissolution. Arc length *is* a 1-D interval.

**Reuse it unchanged.** Giving it curve awareness would duplicate frame maths
into a module with no business knowing about frames, and would break both
existing consumers (`ProceduralCastleWallGenerator.buildWallBody`,
`ProceduralMedievalGenerator.buildWallCourses`) plus
`tests/ProceduralWorkshopCoursePacker.test.js`.

Two properties of the existing packer that the caller must respect:

- **Stone centres are returned in `[−span/2, +span/2]`**, centred on zero — not
  `[0, span]`. Map with `s = arcMid + stone.center`, exactly as `buildWallBody`
  already offsets by its own midpoint.
- **It consumes a fixed number of `random()` draws per call** (one per candidate
  width). Determinism therefore depends on the *number of calls* being a
  deterministic function of the record — which it is, but Phase 6 changes that
  count when an opening splits a course. Document it there.

## Curvature and stone width

A rectangular block of width `w` chorded across radius `R = 1/κ` leaves a wedge
between the chord and the arc, of sagitta:

```
sagitta = R − √(R² − (w/2)²)  ≈  κ·w² / 8   for small κ·w
```

`beveledBox`'s `skew` offsets the top and bottom edges in local X, not the inner
and outer faces in local Z, so it **cannot express a radial taper**. Rather than
add a new primitive, cap the stone width so the wedge fits inside the mortar
joint. Real curved masonry uses narrower stones on tight curves, so this is
physically correct rather than a workaround:

```js
const JOINT_TOLERANCE = 0.02;                     // metres of joint to hide in
const kappa = arcTable.maxCurvatureOver(s0, s1);
const curvatureLimit = kappa > 1e-6
  ? 2 * Math.sqrt((2 * JOINT_TOLERANCE) / kappa)
  : Infinity;
const targetWidth = Math.max(
  style.minWidth * 1.35,
  Math.min(style.targetWidth, curvatureLimit / WIDTH_SAFETY),
);
```

**`WIDTH_SAFETY = 1.75`, not 1.28.** `packCourse` draws candidate widths in
[0.72, 1.28] × targetWidth but then **normalizes them to fill the span exactly**.
When the sample mean of those draws falls below 1, every width scales up, so the
widest emitted stone exceeds 1.28 × targetWidth — by more the fewer stones the
course has. With *n* draws the sample mean has standard deviation ~0.162/√n, so a
ten-stone course can inflate by roughly 1.28 / (1 − 3 × 0.051) ≈ 1.5. At 1.6 the
worst case lands exactly *on* the tolerance and finite-difference noise in the
curvature estimate tips it over; 1.75 leaves ~9%. It is a bound taken from the
packer's actual distribution, so the test sweeps five radii × five seeds
(>2000 stones) rather than asserting it once.

Then straddle the arc — `offsetNormal = −sign(κ)·sagitta/2` — so the chord's
error is split between the inner and outer faces instead of all landing on one.
The sign matters: positive curvature turns toward +normal, so the chord bulges
that way and the block must shift against it.

> **`maxCurvatureOver` had to be fixed first.** It sampled a fixed 9 points
> across the requested range, which on a 9 m arc simply misses the curvature
> peak — a fitted Bézier's curvature is not constant even where it approximates
> a circle. Every caller sizing something against curvature was therefore
> under-constrained. It now scales the sample count with the range length
> (every 0.25 m, capped at 512).

## Files

### Created

**`src/editor/construction/masonry/CurvedCoursePacker.js`** — pure, no Three.js,
Node-testable.

```js
export function packCurvedWall({
  arcTable,
  arcRange,          // [s0, s1] — the module's slice of the path
  style,             // from ConstructionStyleCatalog
  thickness,
  seed,
  seedOffset,        // module index, so each module forks the stream
  topHeightAt,       // (s) => number, from WallTopProfile
  ruinFactorAt,      // (s) => 0..1, from WallTopProfile
  budget = MAX_MODULE_STONES,
}) {
  // -> { stones: Placement[],
  //      stats: { courses, stones, dropped, overBudget, targetWidth } }
}
```

**No terrain input.** Courses are solved relative to grade, so the packer never
needs a ground height — which means nothing terrain-shaped has to be sampled and
shipped into the worker. The geometry builder resolves ground on the main
thread, where `terrainView` already is.

`Placement` is deliberately **module-local and Three.js-free**:

```js
{
  category,        // 'field' | 'coping' | 'ashlar' | 'voussoir' | 'quoin'
  s,               // arc coordinate along the path
  y,               // height above local grade
  offsetNormal,    // radial offset from the centreline
  packedWidth,     // solved width before the mortar inset — tiles exactly
  width, height, depth,
  yaw,             // arcTable.frameAt(s).yaw
  roll,            // rotation about the block's own local Z (coping slope)
  stableIndex,     // seed-local identity, drives stoneJitter
  heightRatio,     // 0..1 up the wall, drives weathering
}
```

`packedWidth` exists so course coverage is checkable: `width` has a per-stone
mortar inset subtracted, so the emitted widths deliberately do *not* tile.

World placement is deferred to the geometry builder so the packer stays testable
in Node with no renderer.

**Course loop.**

```js
const [s0, s1] = arcRange;
const span = s1 - s0;
const random = createRandom(mixSeed(seed, seedOffset));
const maxTop = maximum of topHeightAt over the range;
const courses = Math.max(1, Math.ceil(maxTop / style.courseHeight));
const courseHeight = maxTop / courses;
let previousJoints = [];
let stableIndex = seedOffset * 10000;   // matches buildWallCourses' convention

for (let course = 0; course < courses; course += 1) {
  const y = (course + 0.5) * courseHeight;
  const { stones, joints } = packCourse({
    span,
    targetWidth: curvatureLimitedTargetWidth,
    minWidth: style.minWidth,
    random,
    forbiddenJoints: previousJoints,
  });
  previousJoints = joints;
  for (const stone of stones) {
    const s = s0 + span / 2 + stone.center;   // centres are ±span/2
    if (y > topHeightAt(s)) { stableIndex += 1; continue; }   // above the profile
    if (dropForRuin(ruinFactorAt(s), stableIndex)) { stableIndex += 1; continue; }
    emit(...);
    stableIndex += 1;
  }
}
```

Three things that matter for determinism and must not be "optimised":

- **Per-stone shaping is hashed on `stableIndex`, never drawn from the
  sequential PRNG.** This is the one place the implementation deliberately
  departs from `buildWallCourses` and `buildWallBody`, which call `random()` for
  inset, depth and position wobble *inside* the survival branch. That makes a
  stone's shape depend on how many stones happened to survive before it — fine
  for a one-shot generator, wrong for a live editor, where it would mean raising
  one end of a wall re-rolls the masonry at the other. `random()` is used only
  for `packCourse`, which genuinely needs a sequential stream.
- `stableIndex` increments for **every** stone the packer produced, including
  ones dropped above the profile or for ruin. Skipping the increment would
  reintroduce exactly the coupling the previous point removes.
- `previousJoints` is assigned before the drop filter, so joint staggering is a
  property of the course solve, not of what survived — an opening or a ruin
  cannot unbond the wall.

**Module seam continuity.** Adjacent modules must not both place a stone across
their shared boundary, and must not leave a gap. Because each module packs its
own span exactly, its end stones land flush on `s0` and `s1` — the boundary is a
vertical joint shared by both modules. That reads as a real joint, not a seam.
The one visible artefact would be *every course* aligning its joint at the
boundary, so offset the course phase per module: seed `seedOffset` with the
module index and let the packer's own width draw break the alignment. Verify by
eye at a module boundary on a 200 m wall.

**`src/editor/construction/compile/ConstructionMasonryBuilder.js`** — main
thread, owns Three.js.

```js
export function buildModuleMasonry(placements, {
  style, materials, recipe, moduleOrigin, arcTable,
}) {
  // -> { meshes: [{ slot, geometry, material }], stats }
}
```

Per placement:

```js
const frame = arcTable.frameAt(placement.s);
const params = {
  width: placement.width,
  height: placement.height,
  depth: placement.depth,
  position: [
    frame.x + frame.normalX * placement.offsetNormal - moduleOrigin.x,
    placement.y,
    frame.z + frame.normalZ * placement.offsetNormal - moduleOrigin.z,
  ],
  rotation: [0, frame.yaw, placement.roll],
};
const shaped = stoneJitter(recipe, params, placement.stableIndex, placement.category);
const geometry = applyUnitShading(
  beveledBox({ ...params, ...shaped, detail: style.detail }),
  recipe,
  {
    stableIndex: placement.stableIndex,
    heightRatio: placement.heightRatio,
    protrusion: shaped.protrusion,
    depth: shaped.depth,
  },
);
```

> **Euler order gotcha.** `transformGeometry`
> (`ProceduralWorkshopGeometry.js:59-63`) builds `new THREE.Euler(...rotation)`
> with the default `'XYZ'` order, composing `R = Rx·Ry·Rz`. The Z roll therefore
> applies **first**, in the block's own frame, and the Y yaw then swings it onto
> the path. That is exactly right for `[0, yaw, roll]`. Writing `[0, roll, yaw]`
> or changing the order silently tilts every coping stone sideways. Phase 3 adds
> an assertion for this.

Then group by material slot and merge:

```js
harmonizeVertexColors(geometries, { required: true });   // stone declares vertexColors
const merged = mergeGeometries(geometries);
```

`required: true` is mandatory, not defensive: `createWorkshopMaterials` sets
`vertexColors: true` on the stone slot unconditionally
(`ProceduralWorkshopMaterials.js:523`), and a material that reads vertex colours
from a geometry that has none renders **black**. A module containing only
unshaded coping is the case that catches this — there is a test for it.

**The construction "recipe" adapter.** `stoneJitter` and `applyUnitShading` both
take a workshop `recipe`. Constructions do not have one, so build a minimal
adapter rather than dragging the workshop recipe schema across:

```js
function constructionRecipe(record, style) {
  return {
    seed: record.seed,
    irregularity: style.irregularity,
    detail: style.detail,
    style: style.stonePalette,      // 'granite' | 'limestone' | 'sandstone'
    topStyle: 'slate',
    weathering: 0.25,
    albedo: null,
  };
}
```

Keep it in `ConstructionMasonryBuilder.js` and freeze it. Phase 5 extends it with
the resolved material preset.

**`src/editor/construction/render/ConstructionMaterials.js`**

```js
export function createConstructionMaterials(record, materialDocument) {
  // -> { stone, mortar, roof }   MeshStandardNodeMaterial, cached by key
}
```

Phase 2 only needs the built-in palette path — resolve `style.stonePalette`
through `STONE_PALETTES` and mirror the stone slot of `createWorkshopMaterials`
(`ProceduralWorkshopMaterials.js:510-527`): `bumpMap: surfaceBumpTexture(seed)`,
`bumpScale 0.055`, `roughnessMap: surfaceRoughnessTexture(seed + 101)`,
`roughness: 1`, `normalMap` only at `detail >= 2`, `vertexColors: true`.

Cache by `${styleKey}:${presetId ?? '-'}` in a module-level `Map` — materials
must be shared across modules or a 200 m wall creates 17 identical materials and
17 pipelines. Phase 5 adds preset overrides and imported albedo on top.

**`src/editor/workshop/ProceduralWorkshopPresetTextures.js`** — extract the
module-private `presetTexture`, `configurePresetTexture` and
`PRESET_TEXTURE_CACHE` from `ProceduralWorkshopComponentParts.js:27,113` so both
systems import one implementation. Mechanical; covered by the existing
`ProceduralWorkshopComponentParts.test.js`.

### Modified

**`src/editor/construction/planning/ConstructionPlanner.js`** — each module
gains its stone placements. Add `terrainSamples` per module so the packer can
sit the wall on the ground without a renderer:

```js
groundSamples: Float32Array   // height every 0.5 m across the module's arc range
```

Sampled on the main thread before the worker call (the worker has no terrain),
passed in `options`, and interpolated by `groundHeightAt(s)` inside the packer.

**`src/editor/construction/compile/constructionCompiler.worker.js`** — after
`planConstruction`, run `packCurvedWall` per module and return placements as
plain data. Transfer as typed arrays if the placement count justifies it;
measure first.

**`src/editor/construction/render/ConstructionView.js`** — fill in `buildModule`:

```js
buildModule(entry, module) {
  const meshes = buildModuleMasonry(module.placements, {...});
  for (const stale of entry.modules.get(module.id).meshes) {
    entry.group.remove(stale);
    stale.geometry.dispose();
  }
  for (const mesh of meshes) entry.group.add(mesh);
  entry.modules.get(module.id).meshes = meshes;
  this.updateShellVisibility(entry);
}
```

`updateShellVisibility` hides the shell only once **every** module has geometry,
so a partially built wall never shows holes. Swap per module is atomic (doc 18
§6): the module's old meshes are removed in the same tick its new ones are added.

## Budgets — degrade, never throw

```js
const MAX_MODULE_STONES = 280;
const MAX_CONSTRUCTION_STONES = 6000;
```

Past the cap, stop emitting placements for the remaining modules, leave their
shell visible, set `stats.overBudget`, and surface one notice through
`controller.emitNotice`. Contrast `ProceduralCastleWallGenerator`'s
`MAX_STONES = 1800`, which **throws** (`ProceduralCastleWallGenerator.js:24`).
That is correct for a one-shot generator and wrong for a live editor: a user
dragging a wall longer must see it stop detailing, not see an exception.

## Tests — `tests/ConstructionMasonry.test.js`

1. **Determinism.** `packCurvedWall` twice on the same record → `deepEqual`.
2. **Exact arc coverage.** For every course, the emitted stone intervals
   (`s ± width/2`, pre-jitter) tile `[s0, s1]` with no gap and no overlap beyond
   1e-9.
3. **Curvature limit.** On a path with `κ ≈ 0.25` (4 m radius), no stone's
   sagitta `R − √(R² − (w/2)²)` exceeds `JOINT_TOLERANCE`.
4. **Joint staggering survives.** No course's interior joint lands within
   `targetWidth × 0.25` of a joint in the course below.
5. **Budget degrades.** A 400 m wall does not throw; `stats.overBudget` is true
   and `stones <= MAX_CONSTRUCTION_STONES`.
6. **`stableIndex` is stable under a raise.** Raising the top profile over the
   middle of a wall must not change the `stableIndex` of any surviving stone
   after the raised region — this is what proves the drop filter does not re-roll
   the stream.
7. **Vertex colours.** Merged stone geometry has a `color` attribute of
   `position.count` length, in a module whose only content is unshaded coping.
   (Needs Three.js, so this one lives in a `*.dom.test.js` if the suite splits;
   otherwise assert on `harmonizeVertexColors` directly.)
8. **Module seam.** Two adjacent modules' end stones share a boundary
   coordinate to 1e-9 — no gap, no overlap.

## In-app verification

Per the environment note in the README: no screenshots, `document.hidden` is
true so drive `constructionView.update()` manually.

- Draw the doc 18 §13 scenario 1 wall (30 m S-curve). It must read as **coursed
  stonework** — courses visible, joints staggered, bevel highlights on the
  arrises, baked crevice lines in the joints, and **no outlines**.
- No gaps at module boundaries, and no vertical joint running the full height.
- Probe: `entry.modules.size`, total stone count, and that
  `entry.shellMesh.visible === false` once every module has meshes.
- Commit a 200 m wall and confirm no frame exceeds 16 ms while the queue drains
  (`view.stats.queueDepth` falling at 2/frame).
- Rebase mid-build: the queue must survive and the group must move without
  rebuilding.

## Deferred out of this phase

- **Coarse LOD** — Phase 9, after measurement.
- **A Three.js-free bevelled-box triangulator** so the worker could emit final
  typed arrays. Faster in principle, but it forks the geometry path away from the
  workshop's and risks visual divergence between a wall and a workshop building
  made of nominally the same stone. Only if main-thread build time is *measured*
  as the bottleneck.
- **Mortar as separate geometry** — the joint reads from baked occlusion plus the
  bevel gap. A mortar slot exists in the material bundle but stays unused until
  there is evidence it is needed.
- **Quoins** at wall ends and corners. `IRREGULARITY_CATEGORY_SCALE.quoin`
  already exists but nothing generates them, in the workshop either. Worth doing
  once junctions land.
