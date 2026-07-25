# Geometry, Materials, and Stylized Realism Plan

## Implementation status (2026-07-25)

| Section | Status |
|---|---|
| §5 stylized stone shape | **Implemented** — `beveledBox` is the bevelled prism; controlled corner offsets come from `stoneJitter`'s skew and rotation lanes. The section's warning against global shader vertex noise still holds: all shaping happens at generation time, on whole units |
| §8 colour hierarchy | **Partial** — style palette, stable per-stone tint (a curated ramp with a rare outlier), upward lightening and lower-wall dampness are baked into vertex colours. Stone category, world-space geological variation, moss and damage layers are not |
| §9 mortar rendering | **Implemented** for the near case — AO-like joint emphasis via baked per-vertex occlusion |
| §13 edge outlines | **Followed** — no inverted hulls. Readability comes from bevel lighting plus the baked contact occlusion this section prefers. A scene-wide outline or AO post effect remains explicitly optional |
| §14 lighting | **Implemented** — metalness 0, high varied roughness, restrained normals, no fake emissive. The duplicate second sun that contradicted "walls must work with the existing scene light setup" was removed |
| §6 material architecture | **Not implemented** — the workshop still uses `MeshStandardMaterial`, not `MeshStandardNodeMaterial` with the named TSL nodes. None of `StoneBaseColorNode` … `DamageExposureNode` exist |
| §7 material inputs | **Partial** — per-stone randomness and AO reach the shader as vertex colours rather than as packed attributes |
| §2 LOD representations | **Not implemented** — the workshop bakes one representation per asset |

## 1. Objective

Compile structural and masonry descriptions into efficient Three.js geometry and a reusable WebGPU-first stylized stone material.

## 2. Rendering strategy

Use different representations by LOD.

### Near

- merged individual stone geometry;
- visible bevels;
- recessed mortar backing;
- per-stone attributes;
- full top and silhouette detail.

### Medium

- simplified wall shell;
- coarse geometric course relief;
- material-generated joint/stone variation;
- preserved openings, corners, buttresses, and crenellations.

### Far

- low-poly semantic silhouette;
- no individual stones;
- simplified top profile;
- baked or analytical macro color and roughness.

## 3. Why not one `InstancedMesh` per stone family

Instancing can be effective for a bounded archetype library, but unrestricted per-stone deformation creates problems:

- many archetype buckets;
- multiple draw calls;
- difficult exact interval fitting;
- poor handling of arches and damage;
- excess per-instance data;
- culling granularity mismatches.

Preferred near implementation:

- generate low-poly stone shapes;
- append them into one indexed geometry per render chunk;
- retain compact per-vertex/per-face attributes.

Optional optimization after profiling:

- use a small set of instanced archetypes for ordinary field stones;
- compile unique boundary/arch/damage stones into merged geometry.

Do not adopt hybrid complexity until measurements justify it.

## 4. Geometry compiler

Input:

- structural modules;
- masonry stone descriptions;
- LOD tier;
- render-chunk bounds.

Output:

- positions;
- normals;
- indices;
- UV or triplanar coordinates;
- stone attributes;
- material region;
- bounding box/sphere;
- generation revision.

Compiler responsibilities:

- reject non-finite data;
- enforce vertex/index limits;
- choose 16- or 32-bit indices;
- weld only where it does not erase hard edges;
- compute flat/smoothed normals by style;
- produce closed core/foundation silhouettes;
- avoid hidden internal faces where safely known.

## 5. Stylized stone shape

Recommended near stone:

- 8-corner prism;
- controlled corner offsets;
- one bevel ring;
- mostly planar front face with optional subtle bulge;
- flat or weighted normals;
- no high-segment subdivision.

Exaggerate bevel width slightly for readability at game scale.

Avoid global vertex noise in the shader because it:

- can open mortar gaps;
- changes collision silhouette;
- creates temporal instability across LOD;
- distorts carefully fitted joints.

Use shader displacement only for very small surface relief.

## 6. Material architecture

Use `MeshStandardNodeMaterial` through `three/webgpu` and TSL functions through `three/tsl`.

Material modules:

```text
StoneBaseColorNode
StoneMacroVariationNode
StoneGrainNode
MortarNode
EdgeWearNode
DampnessNode
MossNode
LimewashNode
DamageExposureNode
```

Compose one material family instead of cloning one material per wall.

## 7. Material inputs

Per-vertex or per-stone packed attributes:

- stone random value;
- stone category;
- palette coordinate;
- wear;
- dampness;
- moss susceptibility;
- mortar mask/edge distance;
- face orientation;
- local damage.

Global/environment inputs:

- world-space position;
- normal;
- biome/moisture;
- height;
- sun exposure;
- wetness/rain state if available;
- construction style uniforms;
- time only for subtle wet response, not random flicker.

## 8. Color hierarchy

Base color should combine:

1. style palette;
2. stone category;
3. stable per-stone tint;
4. low-frequency world-space geological variation;
5. upward dust/lightening;
6. lower-wall dampness;
7. moss/lichen;
8. damage/exposed-core adjustment.

Limit each layer. Strong uncoordinated procedural noise will make the wall unreadable.

## 9. Mortar rendering

Near:

- actual recessed backing surface;
- small material darkening near stone edges;
- AO-like joint emphasis.

Medium:

- coarse joint height/normal representation;
- style-controlled mortar color;
- analytic or texture-atlas mask.

Far:

- no high-frequency joints;
- macro value shift only.

## 10. Triplanar or local mapping

Use local wall coordinates for deterministic mapping:

- U: distance along path/module;
- V: height;
- W: depth.

For irregular stone grain, world/local triplanar mapping can avoid UV seams.

Do not let floating-origin rebasing change texture phase. Use canonical or stable construction-local coordinates supplied as attributes/uniform offsets.

## 11. Surface detail assets

Optional small reusable texture set:

- stone grain normal;
- stone grain roughness;
- moss mask noise;
- mortar micro-normal.

Requirements:

- seamless;
- tileable;
- shared across styles;
- compressed when pipeline supports it;
- no unique textures per construction.

The first slice can use pure TSL procedural detail if it meets visual quality and cost.

## 12. Style variants

Examples:

- grey granite;
- warm limestone;
- dark volcanic stone;
- red sandstone;
- mossy temperate ruin;
- dry desert ashlar;
- limewashed village rubble.

Variants change palette and parameter ranges, not shader source.

## 13. Edge outlines

Do not default to inverted-hull outlines for all walls.

Problems:

- extra draw;
- silhouette thickness varies with distance;
- conflicts at intersections;
- can overwhelm realistic lighting.

Prefer:

- exaggerated bevel lighting;
- controlled AO/contact shadows;
- optional scene-wide outline/post effect if the whole game adopts it.

## 14. Lighting

Walls must work with the existing scene light setup and future environment lighting.

Material should remain PBR-compatible:

- metalness near zero;
- high but varied roughness;
- normal detail restrained;
- no fake emissive except explicit magical features.

## 15. Render chunks

Create chunks by:

- world chunk overlap;
- structural junction boundaries;
- maximum vertex budget;
- LOD/culling convenience.

Each render chunk owns:

- group of meshes by material family and LOD;
- bounds;
- revision;
- disposal lifecycle;
- pick proxy reference.

Replace chunks atomically after rebuild.

## 16. Shadows

Near and medium wall shells cast and receive shadows.

Far LOD policy may:

- cast simplified shadows;
- stop casting beyond configured distance;
- retain receiving to stay grounded.

Profile shadow cost separately from main geometry.

## 17. Resource lifecycle

On replacement or unload:

- remove meshes from scene;
- dispose unique geometry;
- retain shared materials/textures;
- release worker output buffers;
- clear caches by revision;
- avoid duplicate disposal of shared resources.

## 18. Tests

- finite geometry;
- index validity;
- bounds contain vertices;
- deterministic geometry hash;
- material attribute ranges;
- no material-per-stone growth;
- stable texture phase across floating-origin rebase;
- disposal counters;
- WebGPU compile smoke test;
- WebGL fallback only if current renderer policy requires it.

## 19. Visual acceptance

Capture at minimum:

- direct sun;
- overcast/soft light;
- wet lower wall;
- mossy wall;
- desert wall;
- near corner;
- gate arch;
- medium LOD;
- far silhouette;
- LOD transition sequence.

The stone hierarchy must remain visible without looking noisy or plastic.
