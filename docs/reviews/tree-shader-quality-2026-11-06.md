# Tree shader quality fixes and next effects

This pass fixes the five findings from the tree shader review. Work is limited
to source code and automated checks at the user's request; visual approval,
atlas generation, and hardware performance measurements are deferred.

## Changes

- Tree extraction preserves authored normals through world transforms and
  grounding, generating normals only when absent. The old unconditional rebuild
  changed every meadow tree7 leaf normal by more than 30 degrees (median 84.4).
- Authored crowns and trunks retain their source lighting model, normal maps,
  roughness maps, normal scale, texture transforms, and other material channels.
  Vertex colour participates once in the graded colour and its fill. Generated
  roots receive neutral vertex colours instead of black and valid tangent frames
  for normal mapping. Source materials stay
  unchanged; existing asset-cache texture ownership is retained.
- Procedural bark projects from `positionGeometry` and `normalGeometry`, keeping
  both coordinates and blend weights in the undeformed prototype frame. Instance
  translation, rebasing and wind no longer move the texture through the surface.
- Primary and generated stylized trunks share the authored bark's grading,
  weathering, sky fill and ground bounce. Their existing height map also supplies
  bump relief. Bark material construction is isolated in `TreeBarkMaterial.js`.
- Impostors receive bark fill on trunk pixels using the existing foliage mask.
  Billboard height is converted back to prototype metres for the bounce band.
  `barkLighting` metadata survives baking, export, validation and asset loading.
- The baker evaluates normal/bump detail even though its output is unlit, and
  uses the live crown opacity for its normal pass. This keeps normal and albedo
  coverage aligned after crown-edge thinning. Source signature v9 rejects old
  atlases; provenance now includes the extracted material modules.

Density, geometry counts, texture resolution and LOD distances are unchanged.
Restored PBR channels and bark relief add shader work; no frame-time claim is made.

## Validation and deferred work

Regression checks cover transformed authored normals, absent-normal fallback,
root colours, source material and LOD channel retention, colour/alpha arithmetic,
undeformed bark projection in generated WGSL, primary bark shader generation,
normal-map baking, atlas metadata, and live/impostor bark-fill equivalence.
These run without a browser or GPU device.

ESLint and the production build pass. The final full unit run passes 4,149 of
4,150 tests, including the new tree regressions; its one failure is the missing
asset below. Build output retains the existing large-chunk warning.

The broad test run has an unrelated local asset failure:
`test/stylized-environment.test.js` cannot open
`public/assets/bushes/bush-arid-ocotillo-01.glb`. This checkout also lacks some
configured swamp/savanna tree assets. Restore the configured assets before the
browser checks and bake; do not remove them from configuration to pass QA.

Before visual acceptance, run `npm run bake:impostors` on the complete asset
checkout. Existing atlases intentionally fail the updated source signature;
until rebuilt, the runtime may use its proxy fallback. No atlas binaries were
generated in this code-only pass.

Then run the tree fixture with day, low sun, overcast and night lighting:

```sh
node scripts/run-world-visual-trees-qa.mjs --lights all
```

Its gallery now includes primary spruce and meadow tree7 as well as procedural
bark, forest-pack and alpine representatives. Check nearby leaf cards, trunk
relief, wind, snow, and both CPU/GPU impostor hand-offs. Run the deterministic
dense-forest A/B from [the performance guide](../perf-qa.md) with identical poses,
warmup and density after the atlas rebuild. Both runs need hardware WebGPU and
valid settling/focus evidence.

## Community Shaders ideas

These are proposed adaptations, not effects enabled by this change. The source
review uses the Community Shaders `dev` branch as inspected on 2026-11-06;
upstream implementation details can change. No upstream shader code was copied.

| Priority | Proposed effect | Expected visual improvement | Integration and cost considerations |
| --- | --- | --- | --- |
| 1 | Thickness-aware, two-sided leaf transmission | Thin leaves glow against the sun while stems, veins and thick clusters remain darker. Front/back response gives cards more depth. | Extend `FoliageNodeMaterial` with a thickness/transmission mask and balance reflected and transmitted energy. Continue using shadowed direct radiance and snow masking; store a compatible far-LOD response. Mostly local shader work, plus a mask sample if it cannot share an existing texture. |
| 2 | Canopy occlusion and directional sky visibility | Denser crown interiors, softer cluster volume, clearer separation of trees from their shaded understory. | Start with authored/derived per-vertex canopy visibility and a restrained clump-normal blend, preserving the restored donor normals. A later directional probe solution needs streaming, origin and memory design; uniform sky emission alone cannot express shelter. |
| 3 | Wet bark and leaf highlights | Rain produces broken bark streaks and small leaf highlights, with drying gradually restoring the dry surface. | Use the existing wetness accumulator, exposed-face masks and authored roughness. Add a water-film specular response and normal filtering; preserve dry values at zero wetness. Shelter should eventually modulate exposure. Avoid per-tree reflection captures. |
| 4 | Close-range bark parallax with self-shadowing | Bark fissures gain apparent depth and occlude their own interiors when viewed obliquely. | Use existing height data on selected near trunks, with bounded steps and a smooth transition to bump mapping. Keep UV transforms consistent across albedo, normal and roughness. Extra texture fetches make this a measured quality option, especially for triplanar bark. |

The highest-value first experiment is transmission plus canopy occlusion: it
affects the dominant visible surface of a forest. Wetness and bark parallax
provide stronger close-up and weather-specific improvements. These priorities
are project-specific judgments, not measured comparisons.

Sources supporting the inspiration:

- [Community Shaders Grass Lighting](https://github.com/community-shaders/skyrim-community-shaders/blob/dev/features/Grass%20Lighting/Shaders/GrassLighting/GrassLighting.hlsli)
  separates reflected/front-transmitted/back-transmitted albedo and implements
  canopy visibility and clump shading.
- [Community Shaders Skylighting](https://github.com/community-shaders/skyrim-community-shaders/blob/dev/features/Skylighting/Shaders/Skylighting/Skylighting.hlsli)
  evaluates directional diffuse/specular visibility from a spatial probe volume.
- [Community Shaders Wetness Effects](https://github.com/community-shaders/skyrim-community-shaders/blob/dev/features/Wetness%20Effects/Shaders/WetnessEffects/WetnessEffects.hlsli)
  contains a wet-surface GGX response, precipitation-occlusion input and rain detail.
- [Community Shaders Extended Materials parallax](https://github.com/community-shaders/skyrim-community-shaders/blob/dev/features/Extended%20Materials/Shaders/ExtendedMaterials/ExtendedMaterialsParallaxCore.hlsli)
  uses bounded height traversal, distance transitions and parallax soft shadows.
