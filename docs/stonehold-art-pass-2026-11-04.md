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
- Accepted movement and asset-viewer evidence, including frozen export hashes:
  `runtime-summary.json` in that directory.
- Final runtime screenshots and all 24 near/far checks:
  `tmp/stonehold-aaa/runtime-approved/report.json`.
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
- Hardware WebGPU review passes all twelve final objects at both detail levels,
  with no browser errors, on NVIDIA Lovelace. Native foreground focus is retained;
  the asset viewer records 2.6 ms p95 over five seconds.
- The final frozen movement A/B captures retain native foreground focus, settle
  successfully, pass collision readiness and timing, and have no browser errors.
  Earlier captures interrupted by another Chrome window remain rejected.

## Accepted movement comparison

Both frozen builds run `chunk-cross` from the same default pose with an eight
second warmup, readiness settling, twelve measured seconds and WebGPU timestamp
sampling. Both snapshots were built from the same checkout with the baseline's
town sources restored through a Vite loader. The temporary builds enable the
development QA exports because the movement runner reads `window.__editor`.
Their kit files match the saved baseline and final public exports respectively;
`runtime-summary.json` records their SHA-256 hashes and source report hashes.

| Measurement | Baseline | Upgraded |
| --- | ---: | ---: |
| Average FPS | 78.26 | 87.44 |
| Frame p95 | 21.0 ms | 15.0 ms |
| Frame p99 | 32.13 ms | 33.05 ms |
| Hitches over 33.3 ms | 8 (0.85%) | 10 (0.95%) |
| Sampled GPU average | 3.23 ms | 3.17 ms |
| Terrain commit p95 | 0.1 ms | 0.1 ms |
| Stylized phase p95 | 3.1 ms | 2.5 ms |

This is one paired capture, insufficient to establish a speedup. Occasional
streaming hitches remain in both builds. The route contains zero town instances;
the separate asset viewer covers Stonehold drawing and all 24 LOD variants.
Dense settlement frame pacing and the full performance matrix were not measured.

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
