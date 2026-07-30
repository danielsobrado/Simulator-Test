# Post-processing

The world renderer has one optional WebGPU post-processing graph. Disabling the master toggle restores the original renderer and existing god-ray path.

## Graph

1. HDR scene MRT: colour, packed view normal, velocity, metalness/roughness and depth.
2. Existing volumetric or screen-space god rays.
3. Optional selective SSR.
4. Optional Three.js TRAA.
5. Exposure.
6. Optional depth of field.
7. Optional bloom.
8. Contrast and saturation.
9. Optional vignette.
10. Tone mapping and sRGB conversion.
11. Optional contrast-adaptive sharpening.
12. Optional film grain.

## Reactive materials

Water, vegetation, weather, particles, spells and fire use material-level MRT overrides with high velocity. This rejects stale temporal history for procedural fragment or vertex animation that cannot provide reliable object motion vectors. Water also writes a reflective metalness/roughness pair for the selective SSR pass.

## History invalidation

The TRAA graph is rebuilt after resize, camera replacement, floating-origin rebase, topology-changing setting updates and manual reset. Rebuilding disposes temporal history and starts from the current frame.

## Settings

All effects are in the Settings tab under **Post-processing**. God-ray technique remains in the existing God Rays section. Presets do not enable depth of field, vignette or grain.

## QA

```bash
npm run qa:postprocessing
npm run qa:postprocessing:install
npm run qa:postprocessing:browser -- --headed
npm test
npm run build
```

Headed WebGPU checks must cover water, dense vegetation, weather, spells, chunk streaming, camera-mode changes and floating-origin rebases.
