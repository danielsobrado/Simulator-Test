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
- Geometry and repeatability evidence: `metrics-lod0.json` and `metrics-lod1.json`
  in that directory.
- Runtime screenshots and all 24 near/far checks:
  `tmp/stonehold-aaa/runtime-final/report.json`.
- Original review previews and unrelated checkout changes were preserved.

## Validation

- Full Node test suite: all 4,087 passed with `--test-concurrency=4`, including
  the exported-footprint/collision test.
- Changed JavaScript passes ESLint; `git diff --check` passes.
- All twelve models at both detail levels repeat identical positions, UVs and
  vertex shading. Far models remain under 12k triangles; near models remain
  under 48k. The Cavern Maw's opening passes its ray test at both detail levels.
- Both public kit GLBs validate with zero glTF errors. Near-kit warnings concern
  generated tangent space; `TownKitGeometry` computes those tangents when repacking
  modules. The far kit has zero validation warnings.
- Hardware WebGPU review loads all twelve objects at both detail levels, with
  no browser errors, on NVIDIA Lovelace. A prior asset-viewer revision retained
  native foreground focus at 2.4 ms p95; the final aperture export lost focus,
  so its timing is not accepted. Neither is a whole-world performance claim.
- Frozen movement A/B runs completed on hardware WebGPU with no browser errors,
  but their native foreground checks failed when another Chrome window took
  focus. They are not accepted frame-pacing evidence. Valid movement comparison
  remains outstanding. The temporary frozen builds enable the development QA
  exports because the movement runner reads `window.__editor`.

## Generator corrections

Smooth vertices are welded in stable index order, avoiding address-dependent
float rounding. Rock AO baking hides unrelated catalog meshes; catalog objects
share the origin before layout and otherwise contaminate one another's shading.
Both corrections are covered by the repeated-build check.

The final visual sweep also caught a material-slot defect: voxel remesh writes
slot zero, which made the cavern vault's rock inherit dressed basalt. Sculpted
rock now owns one explicit material slot, so recipe insertion order cannot change
its geology. The Cavern Maw's custom triangular entrance also uses a recessed
shadowed forge instead of a flat luminous panel.

Its triangular aperture is an authored cutout volume. Rock remeshing subtracts
that volume before LOD reduction, and the geometry review ray-tests the opening
at both detail levels so a decorative entrance cannot conceal solid rock.

Authoring recipes remain source data. Meshes, textures, collision export and
rendered previews are derived. Recipe families and shared builders are split by
responsibility; no new workshop core archetype or mesh-to-component inference
was introduced.
