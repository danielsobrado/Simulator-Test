# World post-processing

The world viewport uses the WebGPU/TSL stack in `src/render/postprocessing/`.
`PostProcessingController` owns graph selection, temporal history, retained resources,
invalidation, diagnostics, failure recovery and renderer-output ownership.

`InfiniteTerrainView.render()` gives the existing volumetric god-ray path first refusal,
then the post-processing controller, then falls back to the normal scene render. A
post-processing shader or pipeline failure restores the original renderer tone mapping,
discards the failed graph and keeps the world playable. The failed topology is not
retried until settings or an explicit invalidation change the state.

## Render graph

`PostProcessingGraph` constructs this order:

1. One HDR scene pass writes colour, normal, velocity, material data and depth.
2. Screen-space shafts optionally add HDR radiance.
3. SSR optionally builds a minimum linear-depth hierarchy, traces selected surfaces,
   temporally resolves the trace and additively composites it.
4. TAA or TAAU optionally resolves the scene into full-resolution HDR history.
5. Depth of field optionally blurs the resolved image. Bloom reads the pre-DOF image.
6. Bloom optionally builds a half-resolution HDR pyramid.
7. Exposure, bloom composition, contrast, saturation and the selected tone curve run
   in linear HDR.
8. Vignette runs on display-linear colour when enabled.
9. `renderOutput(..., renderer.outputColorSpace)` performs the only output colour-space
   conversion.
10. Contrast-adaptive sharpening and zero-mean film grain run after conversion when
    enabled.
11. A non-final diagnostic view replaces the normal output.

TAAU is the only mode that uses `renderScale`. Plain TAA and disabled temporal AA render
the scene pass at scale 1.

Effect enables, AA mode, bloom level count, tone-map mode, shaft sample count, DOF tap
count and debug view are graph topology. Numeric uniform changes do not rebuild the
graph. A display resize keeps only the active topology and disposes stale-sized graphs.

## MRT layout

The scene pass calls `setMRT(mrt(...))` once.

| Name | Format and type | Colour space | Contents |
|---|---|---|---|
| `output` | RGBA half float | HDR linear | Scene colour and alpha |
| `normal` | RGBA unsigned byte | none | Packed view-space normal |
| `velocity` | RG half float | none | Three.js velocity in NDC convention |
| `material` | RGBA unsigned byte | none | Packed per-material metadata |
| `depth` | scene depth attachment | none | Raw device depth |

TAA stores ping-pong half-float colour and float linear-depth history at output
resolution. SSR owns equivalent history at its configured resolution.

## Material-data contract

The material attachment channels are:

| Channel | Meaning | Encoding |
|---|---|---|
| R | roughness | normalized `0..1` |
| G | reactive mask | normalized `0..1`; larger values reduce temporal history |
| B | reflection class | integer class divided by 255 |
| A | bloom boost | normalized `0..1`; multiplied by `bloom.bloomBoost` |

Reflection classes are `NONE=0`, `WATER=1`, `ICE=2`, `WET_STONE=3`,
`POLISHED_STONE=4` and `MAGICAL_MIRROR=5`.

Do not assign `material.mrtNode`. Three.js r185 can compile a per-material override
through non-MRT paths and create an invalid empty output struct. Instead:

1. Register metadata with `assignMaterialData()` or a named category helper.
2. The metadata stays in `material.userData.postProcessingMaterialData`, so clones keep
   it.
3. `PostProcessingMaterialData` installs non-enumerable `Material` accessors.
4. The pass-level MRT reads those values with `materialReference()` per rendered object.

Unregistered materials inherit the safe default `(roughness=1, reactive=0,
reflectionClass=NONE, bloomBoost=0)`.

Convenience helpers are:

- `assignTerrainMaterialData`
- `assignWaterMaterialData`
- `assignGrassMaterialData`
- `assignTreeFoliageMaterialData`
- `assignBushFoliageMaterialData`
- `assignParticleMaterialData`

The predefined categories are:

| Category | Roughness | Reactive | Reflection class | Bloom boost |
|---|---:|---:|---|---:|
| terrain | 1.00 | 0.00 | none | 0 |
| water | 0.08 | 0.85 | water | 0 |
| grass | 1.00 | 0.65 | none | 0 |
| tree foliage | 1.00 | 0.55 | none | 0 |
| bush foliage | 1.00 | 0.55 | none | 0 |
| particle | 1.00 | 1.00 | none | 0 |

This makes high/ultra selective SSR effective for registered reflective surfaces and
makes TAA/SSR reduce history on animated water, foliage and particles.

## Global reactive events

Short world transitions use `notifyReactive(event, transitionFrames)` without clearing
or reallocating history. The configured lifetime is consumed exactly once per rendered
frame. While active, TAA rejects whole-frame history and SSR history is marked invalid
for that frame.

Default lifetimes:

- terrain, voxel and construction edits: 2 frames
- streamed chunks, weather starts and spell starts: 3 frames
- chunk, vegetation and impostor LOD changes: 2 frames plus transition frames

Repeated events coalesce to the longest remaining lifetime.

## TAA controls

TAA/TAAU use:

- Halton jitter in scene-resolution pixels
- camera or velocity reprojection
- depth/background rejection
- YCoCg variance clipping
- per-material reactive weighting
- whole-frame reactive rejection
- motion and clip-distance feedback reduction

`historyClampStrength` is active. `0` disables variance clipping, `1` uses the normal
range and values above `1` tighten the accepted history range.

## Depth of field

DOF tap count is compile-time graph topology and supports 4–32 taps. Changing `taps`
builds or selects the matching retained graph. Focus distance remains a uniform and can
follow the player, selection, centre raycast or manual distance.

## History reset events

A full invalidation clears TAA colour/depth validity, SSR validity, ping-pong indices,
jitter index and the previous view-projection matrix.

Reset reasons include:

- startup, resize, render-scale change, graph rebuild and manual reset
- camera mode, teleport, FOV or active-camera changes and player spawn
- floating-origin rebase, world load/import/restore and mass chunk reassignment

Projection restoration runs in `finally` blocks. An error during uniform updates,
precompile, warmup or rendering cannot leave the active camera jittered.

## Resize contract

`InfiniteTerrainView.resize()` commits renderer size first, reads back the renderer CSS
size and then resizes post-processing resources with the renderer pixel ratio. Scene,
history and effect targets therefore use the same flooring as the drawing buffer.

`patchViewportFramebufferSources()` detaches cloned framebuffer/depth texture sources
to prevent Three.js r185 viewport-copy clones from sharing stale dimensions after
rapid DPR-sensitive resize changes.

## Diagnostics

Available debug views include HDR colour, depth, normal, velocity, material channels,
reactive mask, reflection class, bloom, SSR, TAA history and TAA rejection.

GPU timing collection is optional. Diagnostics must not become a required render path.

## QA

Static and production verification:

```bash
npm test
npm run build
npm run verify
```

Browser capture and acceptance tools:

```bash
npm run qa:postprocessing:install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
npm run qa:postprocessing
npm run qa:postprocessing:browser
node scripts/repro-post-resize-copy.mjs
```

Headed WebGPU review should cover water, dense vegetation, weather, spells, chunk
streaming, camera-mode changes, floating-origin rebases, every preset and rapid resize.
