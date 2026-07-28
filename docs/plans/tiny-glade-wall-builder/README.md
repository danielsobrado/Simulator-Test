# Tiny Glade-style wall builder

Status: **complete** — all nine phases landed 2026-07-27/28.

This folder is the execution plan for turning the live construction tool into a
Tiny Glade-style procedural wall builder. It extends
[`../procedural-medieval-construction/18-live-spline-editor-and-gpu-construction-renderer.md`](../procedural-medieval-construction/18-live-spline-editor-and-gpu-construction-renderer.md)
and advances that document's phases 4–6 from *started* to complete. It stays on
the CPU reference renderer throughout; doc 18 phases 7–11 (GPU arenas, compute
culling, indirect draws, HZB) remain out of scope.

## Why

`ConstructionView.buildWallGeometry` used to emit a plain extruded ribbon — four
vertices per sample, a `position` attribute only, a flat `#8d8879` material.
`style.key` was validated and saved but no renderer read it. `FEATURE_KINDS`
(door/window/arch/gate/tower/breach) were validated but nothing generated them.
`ConstructionPlanner` emitted `curved-span` modules that landed on
`mesh.userData.structuralPlan` and were never rendered. Walls were not solid.

The target is the reference game's wall workflow:

| Capability | Phase |
| --- | --- |
| Freehand draw | already shipped |
| Coursed stonework that follows a curve | 2 |
| Flat / irregular / crenellated / ruined tops, hover + arrow raise-lower | 3 |
| Control nodes, Ctrl-suppressed snapping, closed loops, insert/delete | 4 |
| Right-click radial palette, albedo materials | 5 |
| Archways carved by drawing a path through a wall, windows, gates | 6 |
| Editing while in player mode after ESC | 7 |
| Walkable ramparts | 8 |
| LOD and performance gates | 9 |

## Phase index

| Doc | Phase | Ships |
| --- | --- | --- |
| [phase-2-curved-masonry.md](phase-2-curved-masonry.md) | 2 | Arc-length course packing, per-stone geometry, stone materials |
| [phase-3-wall-top-profiles.md](phase-3-wall-top-profiles.md) | 3 | Top styles, raise/lower gesture, coping, crenellation, ruin |
| [phase-4-node-editing.md](phase-4-node-editing.md) | 4 | Handle re-solve, insert/delete, close/open, snapping |
| [phase-5-radial-palette-and-materials.md](phase-5-radial-palette-and-materials.md) | 5 | `RadialPalette`, right-click, material store, albedo import |
| [phase-6-openings.md](phase-6-openings.md) | 6 | Openings by omission, dressings, cut gesture, windows |
| [phase-7-player-mode-editing.md](phase-7-player-mode-editing.md) | 7 | Paused player mode, in-world editing, Escape ordering |
| [phase-8-walkable-wall-tops.md](phase-8-walkable-wall-tops.md) | 8 | Construction ground provider, ramparts and ramps |
| [phase-9-lod-and-performance.md](phase-9-lod-and-performance.md) | 9 | Three-band LOD, counters, perf gates |

Each phase is independently shippable and independently verifiable. Phase 7 only
depends on Phase 1, so it can be pulled forward at any time.

## Resolved ambiguity: what Ctrl does

The two source descriptions conflict — "hold Control while dragging for precise
node snapping" versus "hold Left Ctrl to place close without connecting". In the
reference game snapping is **on by default** and Ctrl **suppresses** it;
"precise" describes the default, not a modifier. Every phase here implements
that reading: snapping on, Left Ctrl suppresses, for both anchor snapping
(Phase 4) and window auto-linking (Phase 6).

## Cross-cutting invariants

These hold at every phase boundary. Regression-test them as you go.

1. **Intent is authoritative.** Only curves, features, top profiles, style,
   dimensions and material *ids* are saved. Placements, geometry and hashes are
   always derived. No generated stone ever enters a save.
2. **Preview never waits for masonry.** Pointer movement touches the ribbon
   shell only; masonry is built on commit. Doc 18's <1 ms CPU p95 preview gate
   must survive every phase.
3. **Workers return plain data.** Three.js objects stay on the main thread.
4. **Local edits stay local.** Every command declares its dirty segments and
   every module carries a content hash; the view rebuilds only hash-changed
   modules.
5. **Masonry geometry is module-local.** Never bake `floatingOrigin.toRender`
   into a vertex again.
6. **`stoneJitter` owns per-unit shaping**, dressings are category-scaled down,
   readability comes from bevel lighting plus baked vertex crevice occlusion and
   **never outlines**, and any material declaring `vertexColors` gets
   `harmonizeVertexColors(..., { required: true })` on every merged geometry
   (CLAUDE.md).
7. **Escape has exactly one owner** (`EscapeStack`) and always backs out one
   level.
8. **Tone mapping is not touched.** World and workshop are both already
   ACESFilmic at exposure 1.12 and must stay in agreement, or a baked asset will
   not look the way it did while authoring.

## Reused kernels — import, do not move

Doc 18 §7 asks for workshop algorithms to be "refactored into Three.js-free
kernels". Several already are, and moving them would churn six passing suites
for zero behaviour change. Import them where they sit:

| Kernel | Path | Used by |
| --- | --- | --- |
| `packCourse` | `src/editor/workshop/ProceduralWorkshopCoursePacker.js:101` | Phase 2, 6 |
| `stoneJitter`, `irregularityAmount` | `src/editor/workshop/ProceduralWorkshopIrregularity.js:142` | Phase 2 |
| `mixSeed`, `createRandom` | `src/editor/workshop/ProceduralRandom.js` | Phase 2, 3 |
| `BUILTIN_WORKSHOP_MATERIAL_PRESETS` | `src/editor/workshop/ProceduralWorkshopMaterialConfig.js:17` | Phase 5 |
| `beveledBox`, `harmonizeVertexColors`, `transformGeometry` | `src/editor/workshop/ProceduralWorkshopGeometry.js` | Phase 2 |
| `applyUnitShading`, `STONE_PALETTES` | `src/editor/workshop/ProceduralWorkshopMaterials.js` | Phase 2 |
| `selectProjectedLod`, `updateLodTransition` | `src/editor/stylized/lod/projectedLod.js` | Phase 9 |

## Phase 1 — landed 2026-07-27

Shipped with zero visual change. What exists now that the later phases build on:

**Record model** (`src/editor/construction/ConstructionSchema.js`)
- `top: { style, base, profile[] }` — `style` is `flat|irregular|crenellated|ruined`,
  `profile` holds ≤64 control points anchored per segment as
  `{ segmentId, arcFraction, height }`.
- Features gained `sill`, `profile` (`round|segmental|pointed|flat`), `dressed`,
  `group`.
- `style.materials: { stone, mortar, roof }` — **preset ids only**; image data is
  rejected by `requireId`, so a 700 KB data URL can never enter a record that the
  store `structuredClone`s on every read.
- `style.key` is now validated against `ConstructionStyleCatalog`.
- `CONSTRUCTION_RECORD_VERSION` stays **1** — every addition is derivable, and
  old saves load unchanged. `constructionPathSegmentIds(path)` is exported for
  both path types.

**Masonry kernels** (`src/editor/construction/masonry/`)
- `ConstructionStyleCatalog.js` — `coursed-rubble`, `ashlar`, `random-rubble`,
  `dry-stone`, each `{ courseHeight, targetWidth, minWidth, irregularity, detail,
  merlonSpacing, stonePalette }`.
- `CurveArcTable.js` — `createCurveArcTable(sampled, { step })` giving
  `frameAt(s)`, `curvatureAt(s)`, `maxCurvatureOver(s0, s1)`, `toArc`, `fromArc`,
  `segmentRange`.
- `WallTopProfile.js` — `createWallTopProfile(record, arcTable, { style })` giving
  `heightAt(s)`, `slopeAt(s)`, `ruinFactorAt(s)`, `crenellationsOver(s0, s1)`.

**Renderer** (`src/editor/construction/render/ConstructionView.js`)
- One `THREE.Group` per record; geometry is **origin-local**, with the origin
  quantised to a 64 m grid (`ORIGIN_QUANTUM`) so ordinary edits never move it.
- `rebase()` replaced the old `refreshAll()` call at `src/main.js`: a rebase is
  now a transform update with **zero rebuilds**.
- `applyPlan` reconciles modules by content hash; `update()` drains a build queue
  at `min(4 ms, 2 modules)` per frame, called from the frame loop beside
  `terrainView.flushUploadQueue()`.
- `buildModule(entry, module)` is the empty hook Phase 2 fills.
- `view.stats` exposes `modulesResident`, `modulesRebuilt`,
  `modulesSkippedByHash`, `queueDepth`.

**Plumbing**
- `src/editor/ui/EscapeStack.js` — one capture-phase listener, priority registry,
  first handler returning `true` consumes. `ESCAPE_PRIORITY` names the levels.
- `EditorController.cameraProvider` / `activeCamera` — the eight hardcoded
  `this.editorCamera.camera` picker arguments now follow whichever camera is
  rendering. `main.js` wires it to `() => viewModeController.camera`. This is the
  whole of what Phase 7 needs from the picker side.
- `ConstructionStore.update(id, input, hint)` — the store's change event now
  carries an advisory `hint` (`{ dirtySegmentIds, materialOnly }`), because
  `dirtySegmentIds` previously existed only on the command result and never
  reached the renderer.
- `ConstructionPlanner` emits a `contentHash` per module and per plan, over
  quantised (0.1 mm) frames plus dimensions, top-profile slice, overlapping
  features, style, material ids and seed.

### Two corrections made against the original design

Both are load-bearing for later phases.

**The frame yaw formula.** The plan said `yaw = atan2(tangentX, tangentZ)`. That
is wrong. `buildWallCourses` (`ProceduralMedievalGenerator.js:154-159`) places
stones at `[cx + cos(yaw)·s, y, cz − sin(yaw)·s]` with `rotation [0, yaw, 0]`,
so Three.js `Ry(yaw)` maps local +X to `(cos yaw, −sin yaw)`. Matching that to
the tangent gives:

```js
yaw = Math.atan2(-tangentZ, tangentX);
```

Local +Z then lands on `(-tangentZ, tangentX)`, which is the sampler's own
`(normalX, normalZ)` — which is why `stoneJitter`'s default
`protrusionAxis: 'z'` pushes a stone proud of the wall face with no change.
`tests/ConstructionArcTable.test.js` pins this.

**Segment arc ranges must be chained, not derived from sample membership.**
`sampleCubicBezierPath` skips each segment's duplicated first point
(`CubicBezierPath.js:151`), so the surviving samples of segment *n+1* start
strictly *after* segment *n* ends. Ranges built from membership leave an unowned
sliver at every joint, and an arc coordinate landing in one cannot round-trip.
Both `CurveArcTable` and `ConstructionPlanner` now chain ranges:
segment *i* spans `[end of i−1, end of i]`, with the last ending at
`totalDistance`.

### Verified in the running app

- 40 m S-curve → 15 modules, each hashed.
- Anchor move reports 3 dirty segments → **13 of 15 modules skipped by hash, 2
  rebuilt**.
- Rebase to 3 km: group moved by exactly the shift, same geometry object, local
  vertices untouched, **0 rebuilds**.
- Wall's canonical world position bit-identical at 0 / 3 km / 45 km.

> Environment note: `document.hidden` is `true` in the in-app browser pane, so
> `requestAnimationFrame` never fires there. Frame-loop behaviour has to be
> verified by calling `constructionView.update()` directly. Screenshots do not
> work; probe the scene with `javascript_tool` instead.
