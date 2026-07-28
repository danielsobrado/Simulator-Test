# W2B Water Refraction and Scene Attenuation

Date: 2026-07-28

Status: implemented on `agent/w2b-refraction-depth`.

Dependencies: W0, W1, W3, W4, and W2A are merged on `main`.

## Objective

Use the already-rendered opaque scene to make shallow water reveal and distort the seabed while rejecting samples that belong to geometry in front of the water surface.

W2B adds screen-space refraction and per-channel attenuation without adding another world render, changing water geography, or making render data authoritative for simulation.

## Scope

Delivered:

- Opaque framebuffer colour sampling in the water material.
- Copied viewport depth sampling.
- Safe distorted viewport coordinates.
- Depth-aware rejection with undistorted fallback.
- Two-scale animated refraction driven by canonical current direction.
- RGB Beer-Lambert attenuation of the captured scene colour.
- Quality-tier gating.
- Startup validation and dependency-free reference functions.

Deferred to W2C:

- Geographic shore foam.
- Object-intersection foam.
- Projected underwater caustics.
- Final water visual and performance acceptance.

## Three.js r185 render contract

W2B uses the native TSL viewport nodes:

```text
viewportOpaqueMipTexture
viewportDepthTexture
viewportSafeUV
linearDepth
screenUV
```

`viewportOpaqueMipTexture` copies the opaque framebuffer at the point the transparent water is rendered. It therefore works in both current render paths:

```text
direct WebGPURenderer scene render
or
God Rays RenderPipeline scene pass
```

No dedicated second terrain/object render is introduced.

The water remains transparent and does not write depth. It manually composites opaque scene colour into its output on tiers where refraction is enabled.

## Quality tiers

| Tier | W2A depth optics | W2B refraction | Existing caustics |
|---|---:|---:|---:|
| Low | No | No | No |
| Medium | Yes | No | No |
| High | Yes | Yes | Yes |
| Ultra | Yes | Stronger | Stronger |

Medium is the primary fallback when framebuffer-copy cost or refraction artefacts are unacceptable. Low preserves the original pre-W2 water path.

## Distortion

Two FBM samples create a two-axis warp:

```text
coarse = fbm(worldXZ * coarseScale + current * coarseSpeed * time)
fine   = fbm(worldXZ * fineScale - current * fineSpeed * time)

warp.x = coarse * 0.70 + fine * 0.30
warp.y = coarse * -0.35 + fine * 0.65
```

The warp is multiplied by:

- configured refraction strength;
- quality-tier strength;
- a depth fade that removes distortion at the shoreline.

The final screen coordinate passes through `viewportSafeUV`, so distortion cannot sample outside the valid framebuffer.

## Depth rejection

A distorted sample may cross the silhouette of a foreground object. Sampling that colour would make an above-water object appear inside the water.

W2B compares the water fragment and distorted sample in view-distance metres:

```text
depthRange = cameraFar - cameraNear
waterDistance = linearWaterDepth * depthRange + cameraNear
sampleDistance = linearSampleDepth * depthRange + cameraNear

valid = sampleDistance >= waterDistance + depthBiasMeters
```

An invalid sample falls back to the undistorted screen coordinate before scene colour is read.

The comparison uses metres rather than a fixed normalised depth bias because imported-world camera far planes can be tens of kilometres larger than the ordinary world camera. A fixed normalised bias would change its physical meaning with the far plane.

## RGB attenuation

The accepted opaque scene colour is filtered using the W2A optical path:

```text
transmission.rgb = exp(-absorptionCoefficients.rgb * opticalDistance)
filtered = sceneColor * transmission
         + bodyColor * (1 - transmission)
```

The default coefficients remove red fastest, green next, and blue slowest. The result is blended with the configured body colour and existing bounded surface detail.

On high and ultra tiers the water shader has already composited the copied opaque scene, so material opacity becomes semantic water coverage rather than applying a second transparency blend.

## Configuration

Visual-only configuration lives under `water.refraction` in `config/water-visual.yaml`:

```yaml
refraction:
  enabled: true
  strength: 0.012
  coarseScale: 0.045
  fineScale: 0.16
  coarseSpeed: 0.05
  fineSpeed: 0.13
  depthFadeStart: 0.08
  depthFadeEnd: 1.8
  depthBiasMeters: 0.15
  mipLevel: 0
  sceneColorStrength: 0.94
  absorptionCoefficients: [0.72, 0.28, 0.12]
```

These values do not affect terrain, body identity, swimming, collision, navigation, persistence, or `waterDomainVersion`.

## Performance boundary

W2B adds on high and ultra tiers:

- two FBM evaluations;
- one copied viewport colour sample;
- one copied viewport depth sample;
- RGB exponentiation and compositing.

Medium avoids all W2B framebuffer-copy work. W2B does not add CPU/GPU readbacks, per-frame JavaScript allocation, a second scene render, or new streamed textures.

## Validation

Focused coverage includes:

- distortion depth fade and hard bounds;
- quality-tier feature selection;
- view-distance foreground rejection;
- RGB attenuation order;
- disabled-refraction fallback;
- configuration validation;
- viewport colour/depth node usage;
- safe UV clamping;
- undistorted fallback before colour sampling;
- manual coverage compositing;
- the two-FBM shader budget.

## Headed acceptance still required

- Walk through shallow procedural ocean and imported river water.
- Confirm terrain detail remains visible and bends continuously.
- Verify foreground grass, rocks, trees, walls, and the player-held view do not leak into distorted water samples.
- Inspect river banks, coast silhouettes, and chunk borders.
- Cross floating-origin rebases with no refraction discontinuity.
- Inspect high-elevation rivers and far-terrain camera mode.
- Enter and leave underwater view repeatedly.
- Compare medium, high, and ultra tiers.
- Measure framebuffer-copy, first-use compilation, and steady water-pass GPU time.

## Completion boundary

W2B is complete when high and ultra water refract only opaque geometry behind the surface, invalid distorted samples fall back without halos, RGB attenuation remains stable across camera far-plane changes, and the headed performance gate is acceptable.
