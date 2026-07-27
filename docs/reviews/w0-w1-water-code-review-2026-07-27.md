# W0–W1 Water Code Review

Date: 2026-07-27

Reviewed scope:

- W0 water-domain contract from PR #36.
- W1 water geography and streamed fields from PR #39.
- Generator, worker, world-store, rendering, persistence, live-edit, and far-terrain integration paths.

## Verdict

The architecture direction is correct, but the original W1 implementation was not safe to release unchanged. The review found correctness, precision, invalidation, persistence, and performance defects that required contract-level fixes.

## Release-blocking findings fixed

### Live water edits did not upload

`enrichPageWaterField` mutates the existing page object. The render slot compared only page identity and the general page revision, so a sculpt or tile edit could regenerate CPU water data without uploading the changed texture.

Fix:

- Add a monotonically increasing `waterFieldRevision`.
- Track that revision in each water render slot.
- Upload when either the page or field revision changes.

### Absolute half-float heights lost river precision

Storing an absolute 2 km river elevation in `RGBA16F` can quantize height at approximately metre scale.

Fix:

- Store G as a page-relative surface offset.
- Add `page.waterFieldSurfaceOrigin` as a full-precision scalar.
- Reconstruct the absolute surface in the shader.

### Dry shoreline vertices pulled water toward land height

A dry field vertex previously retained its ground height. Linear interpolation could then slope the water surface down into terrain at coastlines and isolated painted-water cells.

Fix:

- Generate the field with a one-cell halo.
- Let dry boundary vertices inherit a weighted neighbouring water surface.
- Infer boundary depth from the inherited surface and local bed.

### Semantic coverage could lose exact water cells

A 65×65 vertex field cannot, by itself, preserve every 64×64 cell classification. Narrow or isolated water cells could be eroded by vertex interpolation.

Fix:

- Keep the exact cell mask as the coverage authority.
- Combine it with analytic river/ocean coverage.
- Keep the semantic field authoritative for local height, depth, and shore distance.

### Coastline vertices could deform adjacent land

Ocean bathymetry was selected from one floored cell. A vertex shared by land and water could therefore be transformed depending on sampling direction.

Fix:

- Transform an integer ocean vertex only when all four adjacent cells are ocean.
- Preserve mixed land/water boundary vertices.

### Fractional terrain queries disagreed with rendered terrain

Direct fractional bathymetry evaluation did not match bilinear interpolation of the authoritative vertex heightfield.

Fix:

- Cache transformed integer vertex heights.
- Bilinearly interpolate fractional samples from those vertices.

### Narrow imported rivers could miss the height lattice

The minimum river radius could be smaller than the maximum distance from a river centreline to the nearest terrain vertex.

Fix:

- Enforce a minimum radius of 0.75 canonical cells.
- Add a regression test proving narrow channels carve the vertex grid.

### Overlapping river semantics were internally inconsistent

The original river query could return body and flow from one segment while using the minimum surface and maximum shore distance from another.

Fix:

- Select one strongest semantic segment for body, flow, surface, coverage, and shore distance.
- Keep the minimum bed across overlapping segments for terrain carving.

### Ocean slope configuration was impossible

The original shelf and maximum-depth settings required a deeper offshore slope than `maximumBedSlope` allowed. The old smooth profile also did not actually reach the configured maximum depth at the configured distance.

Fix:

- Use a 20 m shelf inside the 48 m shore-distance domain.
- Use a piecewise slope-bounded profile that reaches shelf and maximum depths exactly.
- Validate both profile slopes against `maximumBedSlope`.

### W1 changed deterministic terrain without changing its version

W1 altered generated terrain and water meaning while retaining water-domain version 1. Existing saves could silently regenerate into different terrain.

Fix:

- Bump the water-domain contract to version 2.
- Treat missing persisted versions as legacy version 0.
- Reject version 0/1 saves with an explicit migration-required error.
- Compare normalized water settings rather than raw object property order.

### Far terrain bypassed the water transform

The macro backdrop constructed a raw Azgaar generator directly. Near chunks used carved rivers and ocean bathymetry, while the far mesh used the old terrain.

Fix:

- Construct the far generator through `createWorldGenerator`.
- Wrap `sampleMacroColumn` with the same water terrain model.

## Performance fixes

A traced 65×65 procedural field caused approximately 103,000 biome classifications and 22,000 height samples because the same halo data was recomputed repeatedly.

Fixes:

- Add bounded typed-block caches for ocean classification and transformed vertex heights.
- Reuse canonical data across neighbouring fields.
- Remove per-channel typed-array allocations from half-float conversion.
- Avoid duplicate world-store bed sampling when there are no height overrides.
- Record main-thread field regeneration separately without double-counting worker timings.

Focused diagnostics after the fixes showed repeated cached 65×65 field generation around 1–3 ms. Cold generation remains variable and must be checked in the real worker pool; these figures are not release budgets.

## Validation

- JavaScript syntax validation: passed.
- Focused Node tests: 31 passed.
- Covered ocean profile limits, coastline ownership, fractional parity, narrow rivers, river overlap semantics, shared edges, high-elevation precision, dry shoreline handling, field revisions, page dimension validation, live edits, persistence compatibility, macro terrain parity, and negative-coordinate cache behaviour.

## Still required before release

- Full repository test and production build in a complete checkout.
- Headed WebGPU acceptance on procedural and representative Azgaar maps.
- Frame-time and worker-backlog measurement during sustained movement.
- Visual checks at coastlines, river junctions, high-elevation rivers, floating-origin rebases, and live sculpt/paint edits.

W2 optics, underwater rendering, and swimming remain outside this review patch.
