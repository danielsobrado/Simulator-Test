# Procedural Object Workshop

## Status

Implemented as the first bounded construction-authoring vertical slice. Advanced castle-wall silhouettes, semantic component editing, strict recipe persistence, and the procedural glade preview are implemented.

## Product boundary

The workshop is a separate editor option with a 16 × 16 metre central authoring garden and bounded base dimensions. Procedural generation happens only while authoring or rebuilding an asset. Component edits may extend beyond the central guide; the final transformed geometry is measured and its placement footprint grows conservatively to contain it. The world receives an ordinary game-object definition and never runs per-stone construction generation for every placement.

```text
bounded workshop recipe
  -> strict canonical validation
  -> deterministic structural layout
  -> masonry, openings, trim, roofs, vegetation
  -> per-unit irregularity and baked crevice occlusion   (updated 2026-07-25)
  -> semantic component hierarchy and transforms
  -> procedural or imported semantic albedo
  -> validated material-family remesh
  -> reusable instanced object in the world
```

This complements rather than replaces the proposed live wall-path system. Use the workshop for reusable walls, arcades, gatehouses, towers, and tower houses. Use the future live construction tool when terrain-following paths, gates, damage, navigation, or span editing must remain authoritative.

## Implemented workflow

1. Open **Workshop** from Editor mode.
2. Choose wall, gatehouse, round tower, square keep tower, or a composite tower house.
3. Set bounded dimensions, plaster finish, trim stone, roof family, silhouette, tower wing, roof height/overhang, detail, age, **hand-built irregularity**, and deterministic seed. (updated 2026-07-25)
4. Optionally import PNG, JPEG, or WebP albedo images for **Walls**, **Stone trim**, **Roof**, and **Doors & wood**.
5. For each imported image, choose repeat, mirrored repeat, or single-image mapping; adjust repeat, rotate in 90-degree steps, tint it, or copy the same source and settings to other areas.
6. Preview the result in a deterministic procedural glade with rolling terrain, a curved path, distant hills, mixed tree silhouettes, rocks, wildflowers, cloud clusters, ACES tone mapping, soft shadows, and atmospheric depth.
7. Select semantic components in the grouped area picker or directly in the preview. Architectural handles, smart axis constraints, World/Parent/Local orientation, sibling inference, numeric transforms, mirroring, and keyboard modes adapt to structures, roofs, openings, and attached details. Masonry doors, windows, and advanced castle arches use constrained in-plane edits that regenerate their structural cut-outs and trim.
8. Undo or redo component edits, reset one component or all edits, then use **Center scene** and **Frame** to recover the authored view. Regeneration preserves the current camera unless framing is explicitly requested.
9. Enable remeshing to consolidate each material family into one runtime mesh after component transforms are applied.
10. Leave procedural stone albedo enabled to fill masonry and trim without an imported image.
11. Bake the asset; it appears in the normal Objects palette and is selected for placement.
12. Save/export the world. The authoritative version-five recipe and bounded imported images are persisted and deterministically rebuilt on load; generated vertices and textures are not duplicated in every placement. (updated 2026-07-25)

## Castle-wall authoring modes

The existing **Wall** archetype uses the silhouette control as a structural mode:

- **Classic** keeps the original solid wall with generated recessed openings.
- **Stepped** generates a castle arcade or bridge wall with repeated open arches, dual-face jamb and voussoir trim, keystones, a rolling top profile, tapered buttresses, coping or battlements, and optional ivy.
- **Tapered** generates a defensive or ruined wall profile with a higher centre, lower edges, deterministic missing upper stones, structural arches, buttresses, coping or battlements, and optional ivy.

The opening count is derived from the authored width, so wider spans gain more bays without exposing a fragile low-level control. **Doors and windows** enables or disables the open arches. Width, depth, height, stone family, top family, detail, weathering, seed, imported albedo, ivy, and remeshing continue to apply.

## Structural generation contract

- Structural topology is derived before visual noise.
- Advanced arches reserve real empty space; they are not dark panels placed over a solid wall.
- Each advanced opening has deterministic jamb courses, front and rear voussoirs, and a keystone.
- Edited advanced arches remain inside their bay and below the lowest covered wall-top profile, not only the profile at the opening centre.
- Complete masonry boxes, not only their centre points, are checked against opening volumes.
- Classic walls, gatehouses, and towers pass through a validated generation boundary that removes structural stone obstructing their authored openings while retaining shallow trim.
- Buttresses are placed at ends and between arch bays.
- The top profile is sampled consistently by wall courses, coping, and battlements.
- The ruined mode deletes only bounded upper stones and never changes opening authority.
- Advanced walls use one complete hard stone budget. Classic medieval builds use conservative preflight, generated-part, masonry-part, and source-vertex limits before remeshing.
- Classic generated doors and windows own their movable insert geometry; structural arch stones remain with the parent wall.
- Failed generation and remeshing release all partially created geometry and materials.
- No generation path uses `Math.random()`.

## Semantic component contract

- Structures are hierarchy roots. Their roofs, openings, woodwork, metalwork, and vegetation are children and follow parent transforms.
- Door, window, and advanced arch edits are stored as two-dimensional opening intent. Coursed masonry generators regenerate their structural geometry; plastered manor façades regenerate their inserts and trim against the continuous plaster shell.
- Each component exposes a generator-authored architectural edit policy covering handle type, legal axes, preferred orientation, snap precision, and inference mode.
- Doors, windows, and arches use wall-aware smart snapping: they remain inside their parent façade, magnetize to wall margins and floor lines, align rows and edges with nearby openings, preserve repeated spacing, and match neighboring opening sizes while scaling.
- Generator-authored wall hosts expose stable IDs and planar or radial attachment surfaces. Rehosting an opening persists façade-space position and scale, regenerates the cut-out and insert on the destination host, and survives baking and document round trips.
- The component editor supports hovered-wall placement previews, valid/invalid clearance feedback, duplicate-and-drag workflows, and deterministic three-opening repeat rows. Attachment edits participate in the same undo/redo history as component transforms.
- Component transforms are finite, bounded, type-checked, normalized, and serialized in canonical component-ID order.
- Equivalent positive and negative half-turn rotations serialize identically.
- Transforms for components that no longer exist are removed before a new asset is baked.
- Runtime transforms are applied before material-family remeshing.
- Placement and foundation footprints are derived from final transformed geometry and retain conservative formula fallbacks.
- A failed component remesh releases any already-created intermediate geometry before rollback.

## Semantic albedo contract

- Imported files are decoded locally, centre-cropped, and resized to 512 × 512 before persistence.
- Only PNG, JPEG, and WebP data URLs are accepted. SVG and remote URLs are rejected.
- A recipe stores at most four imported sources, with per-source and per-object encoded-size caps.
- Multiple semantic areas may reference one source without duplicating the encoded image.
- Source IDs and semantic slots are normalized in canonical order so equivalent recipes produce identical object signatures.
- Texture names, IDs, mapping modes, repeats, rotations, and tints are strictly typed. Numeric strings and explicit null values are rejected rather than coerced.
- Tower-house walls use the wall source while masonry structures fall back from **Stone trim** to **Walls** when no explicit stone source is assigned.
- Imported images replace base colour only. Procedural bump response, roughness, weathering, vertex variation, and geometry remain active. Before 2026-07-25 an imported wall or trim image silently disabled vertex colours altogether; the stone material now always reads them and `applyUnitShading` switches to an occlusion-only neutral term, so joints stay dark under an imported texture. (updated 2026-07-25)
- Version-one through version-four workshop records load with compatible omitted-field defaults and are saved as version five. A field added in a later version must not restyle an earlier asset: records at version four or below are pinned to `LEGACY_IRREGULARITY` (0.25) rather than taking the current 0.45 default, and an explicit value in the record always wins. (updated 2026-07-25)

## Persistence and lifecycle contract

- Saved records require a valid string key, string label, object recipe, finite numeric dimensions, integer seed/detail, and real booleans.
- Omitted legacy fields receive documented defaults; explicit nulls, numeric strings, and malformed nested objects fail closed.
- Recipe identity uses canonical property ordering and normalized rotations before hashing.
- Targeted installation rollback removes only the failed procedural definition. Full rebuild teardown removes all workshop-owned procedural definitions.
- WebGPU preview initialization is single-flight and retryable. Closing or disposing the workshop during initialization cannot start a stale render loop.
- `npm run qa:workshop` starts an isolated Vite server and drives the real WebGPU workshop UI in Chromium. It verifies planar and radial pointer placement, duplicate/repeat/delete, undo/redo, regeneration, bake persistence, and red/green placement feedback.
- Run `npm run qa:workshop:install` once on a new machine to install the pinned Chromium runtime used by the screenshot harness.
- Workshop browser QA writes deterministic 1600 × 1000 screenshots and a machine-readable report to `tmp/workshop-qa/`. Behavioral and canonical-state assertions are the gate; screenshots are retained for visual inspection without relying on fragile exact-pixel equality.
- The procedural stage restores prior scene background/fog state and disposes transactionally, including failed construction.

## Runtime contract

- Every placement uses the existing `ObjectMap`, terrain-foundation validation, selection, undo, and instanced `ObjectView` rendering.
- Geometry and materials are shared per baked object definition.
- Remeshed assets use one draw part per populated material family, capped at seven parts for the current generator.
- The advanced castle-wall generator normally emits one stone part plus optional roof-cap and foliage parts.
- Semantic top generation supports coping and battlements, circular and hipped tiled roofs, adjustable pitched roofs, stepped gables, machicolation corbels, finials, and flags.
- Tower houses combine a plastered gabled wing, selectable attached tower, stone foundation and opening trim, flower boxes, window recesses, ivy, and independently scalable main/tower roofs.
- Stone tint, plaster mottling, wood grain, dampness, roof-tile relief, and optional attached ivy are deterministic and controlled by the recipe.
- Roof-tile relief is geometric at Ultra detail and textural below it: detail 3 lays individual overlapping tile solids over the roof deck, while detail 1 and 2 keep the smooth deck plus `roofTexture`/`roofBumpTexture` seams. Both share the roof colour ramp, so the palette does not shift between detail levels. (updated 2026-07-25)
- Base dimensions are capped and asset count is capped at 32.
- The save contains versioned procedural recipes under `proceduralAssets`.

## Current limits

- Assets live inside the world document rather than an external cross-world library.
- The workshop produces reusable bounded assets, not editable world-space wall paths.
- Plastered manor façades still use a continuous wall shell behind regenerated door and window inserts rather than boolean-cut plaster openings.
- Curved plan paths, intersections, terrain-stepped foundations, live gates, breaches, collision portals, and navigation updates remain work for the authoritative construction system.
- Imported textures currently affect albedo only. Authored normal, roughness, height, and LOD texture baking remain follow-up work. Ambient occlusion is now baked per unit into vertex colours (2026-07-25); a screen-space AO pass is deliberately still out of scope and needs its own performance evidence.
- Runtime collision still uses the existing object footprint/foundation contract.
- Individual tile solids are Ultra-only. Detail 1 and 2 still read as a textured roof rather than stacked tiles.
- Quoins, bond stones, forbidden-joint bands and the two-face-plus-rubble-core split of `04-masonry-and-stone-generation.md` §5/§9/§10 remain unimplemented. The `category` argument threaded through `stoneJitter` is the intended hook for them.

## Changelog

### 2026-07-25 — hand-built irregularity, shingled roofs, clustered foliage

Goal: make workshop buildings read as hand-built rather than as clean boxes with
tiled textures.

- **Irregularity kernel** (`ProceduralWorkshopIrregularity.js`, new). `addStone`
  was duplicated verbatim in `ProceduralMedievalGenerator` and
  `ProceduralCastleWallGenerator`; both now call one `stoneJitter`. Amplitudes are
  4x the previously hard-coded values and scale with the new `irregularity`
  recipe field, with a per-category scale that keeps voussoirs, quoins, ashlar and
  coping crisp (04-…md §8). Adds an out-of-plane protrusion lane, scaled by the
  unit's smallest face dimension so a tower block cannot be thrown clear of the
  wall. Jitter lanes are drawn from three hashes instead of nine overlapping byte
  lanes of one, so unit size and rotation are no longer correlated.
- **Recipe version 5.** `irregularity` (0–1, default 0.45), exposed as a
  "Hand-built irregularity" slider. Records at version ≤ 4 pin to 0.25.
- **Baked crevice occlusion.** `applyStoneColor` became `applyUnitShading`, adding
  four multiplicative occlusion layers (unit underside, downward faces, sky lift,
  lower-wall gradient, recess) plus curated per-unit colour ramps for stone and
  roof (05-…md §8, §9, §13). The roof and foliage materials gained
  `vertexColors`; `harmonizeVertexColors` keeps merge groups attribute-compatible
  and never lets a vertex-colour material read a geometry that has none.
- **Shingled roofs** (`ProceduralWorkshopShingles.js`, new). Real overlapping tile
  solids over the retained roof deck, for conical, pyramidal and both planar
  pitches. Tile size grows on large roofs so the count stays inside
  `MAX_SHINGLES` (04-…md §15); the preflight estimator shares the same solver, so
  an estimate cannot disagree with what generation emits.
- **Ivy** grows in facade space, so one algorithm serves flat walls and round
  towers; leaves are placed in golden-angle clumps of 3–6 with per-leaf tint and a
  base-to-tip gradient; strands are also seeded at the eaves to trail downward.
- **Preview parity.** The world renderer now uses ACES tone mapping at the same
  exposure as the workshop preview and soft shadow filtering, and `ObjectView`'s
  light pair is a genuine fallback that `StylizedSkyView` evicts — the world was
  running two suns from different directions, which flattened every building.

Verification: unit tests pass; `npm run qa:workshop` passes 17 assertions with no
console or page errors; the ACES/soft-shadow A/B is recorded in
`docs/perf-qa.md` (measured on the real WebGPU backend, with the run-to-run
variance stated).

### 2026-07-25 — spec-compliant course packing and vegetation surface adhesion

Follow-up prompted by reviewing an external write-up on gridless architecture
against this code. Two of our own documented rules were being violated:

- **Constrained interval packing** (`ProceduralWorkshopCoursePacker.js`, new).
  Both wall generators drew an unconstrained random width per stone and then
  clipped it against the remaining span — exactly what `04-…md` §6 forbids — and
  the classic generator faked its running bond by shrinking only the first stone
  of alternate courses, so joints stacked vertically everywhere else. Courses are
  now packed by normalizing candidate widths to fill the span exactly, with
  forbidden joint bands carried from the course below (§5) and slivers dissolved
  rather than emitted (§6.8). The castle generator's `rowOffset` is gone with it:
  it shifted the cursor outside the wall span and produced clipped part-stones at
  both ends.
- **Surface relief for vegetation** (`ProceduralWorkshopSurfaceRelief.js`, new).
  Ivy is generated against the *nominal* surface, so it was blind to individual
  stones; once stones gained protrusion, vines passed through anything laid proud
  of the face. On a flat wall the nominal stand-off is ~1% of wall depth while
  protrusion reaches ~15% of a stone's smallest face, so the clash was routine at
  the default irregularity, not an edge case. The masonry pass now records each
  stone's protrusion in facade space and the vegetation pass stands off by the
  local maximum — the behaviour a ray-cast against real geometry would give, at
  O(1) per query and with no BVH.

Deliberately **not** adopted from that write-up: WaveFunctionCollapse for masonry
(a lattice algorithm, at odds with both the gridless goal and the continuous
interval packing §6 already specifies) and runtime boolean subtraction for
openings (§11 explicitly requires the opposite, and we already do it).
