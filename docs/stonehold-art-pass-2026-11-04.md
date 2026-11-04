# Stonehold art pass — 2026-11-04

The Stonehold landmarks now use inhabited world scale, carved basalt and granite,
restrained weathered bronze, deep shadowed portals, supported stair flights,
vaulted slab roofs, folded cloth and functional roof exhausts. Rock displacement
preserves broader fracture planes. Dominant-plane rock UVs avoid the stretched
bands on concave mountain faces.

Water uses an accelerating sheet, broken foam streaks, damp surrounding rock,
small splash detail and sparse spray. Shared emission/alpha flame sheets replace
solid flame blobs. The game animates flow and fire in the existing material;
only spray fragments evaluate dithering. No depth/refraction scene copy is added.

The eight inhabited formations are scaled by five together with their texture
density and collision definitions. Their town placement uses conservative full
footprints outside the street grid. They retain landmark drawing reach rather
than disappearing with small props. Mines and mountain shells retain their
existing metre scale.

## Review artifacts

- Interactive game-material review: `/stonehold-qa.html`.
- Three views of every object and matching before photographs of Twin Outcrop
  and Horned Sanctum:
  `assets-src/medieval-town-kit/previews/stonehold-aaa/`.
- Geometry and repeatability evidence: `metrics-lod0.json` in that directory.
- Runtime screenshots and all 24 near/far checks:
  `tmp/stonehold-aaa/runtime-final/report.json`.
- Original review previews and unrelated checkout changes were preserved.

## Validation

- Full Node test suite: 4,086 passed with `--test-concurrency=4`; the additional
  exported-footprint/collision test also passes.
- Changed JavaScript passes ESLint; `git diff --check` passes.
- All twelve near models repeat identical positions, UVs and vertex shading.
  All twelve far models remain under 12k triangles; near models remain under 48k.
- Both public kit GLBs validate with zero glTF errors. Near-kit warnings concern
  generated tangent space; `TownKitGeometry` computes those tangents when repacking
  modules. The far kit has zero validation warnings.
- Hardware WebGPU review passes all twelve objects at both detail levels, with
  no browser errors, on NVIDIA Lovelace. The final isolated asset review records
  2.6 ms p95 over five seconds with retained native foreground focus. This is an
  asset-viewer measurement, not a whole-world performance claim.
- Frozen movement A/B capture is still being collected under the shared hardware
  QA lock. The temporary frozen builds enable the development QA exports because
  the movement runner reads `window.__editor`.

## Generator corrections

Smooth vertices are welded in stable index order, avoiding address-dependent
float rounding. Rock AO baking hides unrelated catalog meshes; catalog objects
share the origin before layout and otherwise contaminate one another's shading.
Both corrections are covered by the repeated-build check.

Authoring recipes remain source data. Meshes, textures, collision export and
rendered previews are derived. Recipe families and shared builders are split by
responsibility; no new workshop core archetype or mesh-to-component inference
was introduced.
