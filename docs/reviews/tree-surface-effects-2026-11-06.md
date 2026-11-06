# Tree transmission, canopy visibility, wet surfaces and bark parallax

This implements the next effects proposed in
[the tree material review](tree-shader-quality-2026-11-06.md), against baseline
`83762407`. The attached Community Shaders research also informed the restrained
needle highlights, clump-normal adjustment and bark PBR consistency. Browser
captures, atlas generation and hardware acceptance remain deferred under the
user's request to implement and check source code before they test it.

## Implemented behavior

- **Leaf transmission:** directional direct lighting uses the leaf normal,
  viewing angle, species optical thickness, a transmission tint and canopy
  visibility. Texture alpha and luminance provide an estimated edge/vein
  thickness variation; this is not a measured thickness texture. A bounded share
  of reflected light is reserved for transmission. The effect reuses the light's
  existing shadow/cloud attenuation. Conifers have thicker, less transmissive
  foliage than broadleaf trees. The existing frost transmission remains available.
- **Canopy depth:** an area-weighted density grid is built once per prototype.
  Five upward rays estimate local sky visibility, interpolated onto the leaf
  vertices. It attenuates ambient/AO and canopy fill, with a configurable floor,
  rather than pretending to replace direct shadow maps. Visibility also reduces
  transmission and rain exposure in sheltered clusters. The temporary grid is
  released after prototype preparation. This estimates the tree's own canopy;
  neighbouring trees and buildings do not contribute to it.
- **Leaf normals and needles:** shader normals blend gently toward the clump
  shape before instancing (10% broadleaf, 5% conifer). Stored donor normals remain
  intact. Conifers gain a small elongated highlight along their card UV direction;
  distant impostors use a broad lobe. Setting `normalBlend` or `needleSpecular`
  to zero disables the corresponding adjustment.
- **Wet surfaces:** the existing wetness accumulator drives leaf film highlights
  and PBR roughness, and bark roughness/normal filtering. Bark retains the existing
  broken rain streaks; height-bearing bark holds more film in fissures. Zero
  wetness preserves dry roughness. Two-sided leaf exposure is independent of
  camera-facing normal flips. Snow masks leaf wet highlights and keeps capped
  leaves and bark rough. Geometric snow exposure avoids normal-filter feedback.
  No reflection captures or screen copies were introduced.
- **Bark PBR:** primary and generated stylized bark now use Standard lighting.
  Authored PBR donors retain their surface channels; Lambert/unlit bark is
  promoted with retained normal/bump/AO/emissive channels and conservative dry
  roughness. Procedural bark now consumes its packed RG normal detail as well as
  roughness, decoding normals in each projection's derivative tangent frame.
- **Nearby bark relief:** bounded parallax traversal and a short sun-relief shadow
  search operate within 14 m, fading from full strength at 4 m. Albedo, normal,
  roughness and height use common displaced coordinates. Prototype-space
  projection keeps procedural bark attached through wind, instancing and rebasing.
  Authored bump maps participate when their UV channel agrees with the other
  surface maps; each texture retains its own transform. Materials using different
  UV channels or a custom UV context retain their ordinary bump/normal mapping.
  Proxies and impostors have no parallax traversal.

## Configuration and cost

All feature controls are in `editor.config.yaml`, under `stylizedSurface.trees`:

| Block | Controls |
| --- | --- |
| `foliageLighting` | Enabled state, transmission/tint, thickness/absorption, clump normal share, occlusion floor/strength, wet film and needle highlights; `species.conifer` overrides |
| `canopyOcclusion` | Prototype grid resolution and extinction density |
| `barkSurface` | PBR enabled state, default dry roughness, wet roughness/strength |
| `barkSurface.parallax` | Enabled state, near/far fade, scale, bounded step count and relief shadow strength |

The default grid is 16 cubed. Visibility adds four bytes per leaf vertex, sharing
the normal buffer to avoid another vertex-buffer stream. No per-instance CPU
work, placement budgets, tree density, triangles or LOD distances were added.
Leaf lighting adds local arithmetic; authored PBR maps retain their sampling
cost. Parallax adds up to eight traversal steps and three shadow steps per
projection, plus setup samples. Triplanar bark can run three such searches, so
its near-camera GPU cost needs measurement. Distances beyond the fade skip the
traversal; disabling parallax removes it from the material graph.

## LOD and atlas contract

Near meshes, fallback proxies, CPU impostors and GPU impostors share the material
settings. Impostors approximate the bark wet-film coverage and roughness; their
small far-distance surfaces do not reproduce every near bark streak or UV needle
direction.

The normal atlas alpha now retains foliage classification and six-bit canopy
visibility. Coverage still belongs to albedo and the existing alpha-preserving
mip pipeline. There is no additional impostor texture or atlas sampler. Material
traits survive bundle export, offline writing, validation and runtime loading.

The manifest is now **v5**, with source signature **v10**. Older atlases must be
rebaked. Baking freezes wetness and parallax to produce dry, view-independent
reflectance, restores the live settings even after failure, and includes the
clump shading normals in its normal pass.

Before visual testing on the complete asset checkout:

```sh
npm run bake:impostors
npm run validate:impostors:required
node scripts/run-world-visual-trees-qa.mjs --phase after --lights all
```

Also inspect dry, half-wet and fully wet trees; thin backlit leaves; sheltered
crown interiors; conifers at low sun; snow; bark within 4 m and through the
4–14 m fade; and all representation transitions. Use the deterministic
[performance harness](../perf-qa.md) for repeated dense-forest baseline/current
runs on hardware WebGPU. The earlier screenshot handoff's baseline `83762407^`
tests the preceding fixes; use `83762407` to isolate this effect pass.

## Source validation

Regression checks cover optical-thickness response, dry/wet roughness, canopy
visibility and donor normals, deterministic scale behavior, shared vertex-buffer
layout, LOD node preservation, atlas visibility round-trip, material metadata,
bake-state restoration, and WGSL/GLSL generation for foliage, procedural/authored
parallax bark and impostors. Shader generation without a device does not establish
driver compilation, visual approval or frame pacing.

Lint and production build pass (the existing large-chunk warning remains). The
final full unit run passes **4,162 of 4,163 tests**. Its sole failure is the
previously known local asset blocker,
`public/assets/bushes/bush-arid-ocotillo-01.glb`; configured tree assets must also
be present before a complete bake. No atlas binaries or screenshots were generated.

## Research scope

The source links are inspiration for independent Three.js/TSL implementations;
no upstream shader code was copied:

- [Community Shaders Grass Lighting](https://github.com/community-shaders/skyrim-community-shaders/blob/dev/features/Grass%20Lighting/Shaders/GrassLighting/GrassLighting.hlsli)
  provides specular and normal-frame helpers in the currently inspected file.
  The prototype canopy grid and thin-sheet model above are Drusniel implementations.
- [Wetness Effects](https://github.com/community-shaders/skyrim-community-shaders/blob/dev/features/Wetness%20Effects/Shaders/WetnessEffects/WetnessEffects.hlsli)
  informs precipitation-aware wet reflectance. This pass reuses Drusniel's climate
  accumulator and local exposure estimate rather than introducing an occlusion buffer.
- [Extended Materials parallax](https://github.com/community-shaders/skyrim-community-shaders/blob/dev/features/Extended%20Materials/Shaders/ExtendedMaterials/ExtendedMaterialsParallaxCore.hlsli)
  motivates bounded traversal, distance fading and relief shadowing.

The attachment's spatial skylighting probes, screen-space contact shadows and
character-driven shrub disturbance remain separate proposals. They require
broader residency, depth-buffer or gameplay integration and measurement. No
screen-space skin SSS, general foliage GI pass or per-plant physics was added.
