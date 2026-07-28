# W2A Water Depth Optics Implementation

Date: 2026-07-28

Status: implemented on `agent/w2a-depth-absorption`.

Dependencies: W0, W1, W3, and W4 are merged on `main`.

## Objective

Make water transparency and colour communicate the authoritative water-column depth before adding screen-space refraction.

A shallow shoreline must reveal the terrain below it. Increasing depth or viewing the same water at a grazing angle must reduce transmission predictably. FBM and Voronoi animation remain surface detail rather than depth authority.

## Scope

Delivered in W2A:

- Depth-driven shallow-to-deep colour.
- Beer-Lambert-style scalar transmission.
- View-angle-aware optical distance.
- Bounded minimum and maximum opacity.
- Matching surface tint when viewed from below.
- Quality-tier gating.
- Startup validation and a dependency-free CPU reference implementation.

Explicitly deferred to W2B:

- Opaque scene-colour capture.
- Scene-depth capture and linearisation.
- Per-channel attenuation of the captured scene colour.
- Screen-space refraction and depth rejection.

Explicitly deferred to W2C:

- Geographic shore foam.
- Object-intersection foam.
- Underwater projected caustics.
- Final visual and performance acceptance battery.

## Optical model

The authoritative vertical depth comes from `waterField.b`.

The approximate path through the water is:

```text
viewCosine = clamp(abs(viewDirection.y), minimumViewCosine, 1)
opticalDistance = min(depth / viewCosine, maximumOpticalDistance)
transmission = exp(-absorptionDensity * opticalDistance)
opacity = mix(minimumOpacity, maximumOpacity, 1 - transmission)
```

This makes grazing views less transparent than vertical views through the same water column while keeping the result bounded.

The surface colour uses a smooth depth blend:

```text
shallowColor -> deepColor
```

When the camera is below the water surface, the result blends toward `underwaterColor`. The existing Voronoi colour is mixed over this body colour using `surfaceDetailStrength` and the existing distance fade.

The current W2A blend is intentionally scalar. True wavelength-specific attenuation of the already-rendered terrain requires the opaque scene colour, which begins in W2B.

## Quality tiers

| Tier | Depth optics | Streamed current | Caustic highlight |
|---|---:|---:|---:|
| Low | No | No | No |
| Medium | Yes | Yes | No |
| High | Yes | Yes | Yes |
| Ultra | Yes | Yes | Stronger |

Low preserves the pre-W2A material path exactly. This provides a compatibility and performance fallback.

## Configuration

Configuration remains visual-only in `config/water-visual.yaml`:

```yaml
water:
  optics:
    shallowColor: '#72d8e8'
    deepColor: '#0b4a68'
    underwaterColor: '#15596d'
    absorptionDensity: 0.42
    minimumOpacity: 0.08
    maximumOpacity: 0.94
    shallowDepth: 0.2
    deepDepth: 6
    maximumOpticalDistance: 14
    minimumViewCosine: 0.22
    surfaceDetailStrength: 0.28
    underwaterTintStrength: 0.35
```

These settings do not change terrain generation, water-body identity, swimming, collision, navigation, or `waterDomainVersion`.

## CPU reference

`WaterOptics.js` mirrors the shader's scalar depth, view-angle, transmission, opacity, and depth-mix calculations.

It exists for:

- deterministic validation;
- configuration tuning;
- regression tests;
- future W2B comparison against screen-space optical results.

It is not queried during rendering or player movement.

## Validation

Focused coverage includes:

- monotonic opacity with increasing depth;
- decreasing transmission with increasing depth;
- increased optical distance at grazing angles;
- maximum optical-distance clamping;
- opacity bounds;
- shallow and deep colour-mix boundaries;
- colour-format validation;
- opacity and depth-range validation;
- quality-tier feature selection.

## Headed acceptance still required

- Walk along a shallow shoreline and confirm the seabed remains readable.
- Move from shallow to deep water and confirm a continuous opacity transition.
- Inspect the same water vertically and at a grazing angle.
- Cross ocean and river chunk borders without optical seams.
- Inspect high-elevation imported rivers.
- Enter and leave the water repeatedly without a colour or alpha pop.
- View the surface from below and confirm the underside tint remains coherent.
- Compare low, medium, high, and ultra tiers.
- Measure first-use shader compilation and steady water-pass GPU time.

## Completion boundary

W2A is complete when the depth field, not Voronoi patterning, owns transparency on medium and higher tiers, and the headed checks show no chunk seam, shoreline opacity inversion, or underwater transition regression.
