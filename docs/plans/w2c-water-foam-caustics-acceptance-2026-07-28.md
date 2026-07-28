# W2C Water Foam, Underwater Caustics, and Acceptance

Date: 2026-07-28

Status: implemented on `agent/w2c-foam-caustics-acceptance`.

Dependencies: W2B is open on `agent/w2b-refraction-depth`; this PR is stacked on that branch.

## Objective

Complete the visible W2 surface work without changing water geography or simulation authority.

W2C adds:

- shore foam driven by the streamed geographic shore-distance field;
- river flow bands driven by the streamed current field;
- scene-depth intersection foam on high and ultra quality;
- a depth-reconstructing underwater caustic projection pass;
- focused contracts and telemetry for final headed acceptance.

## Geographic foam

The water field already stores shore distance in channel A. W2C uses that value directly:

```text
shore = 1 - smoothstep(0, shoreWidth, shoreDistance)
```

Existing FBM noise only breaks up the edge. It does not decide where the shoreline is.

This keeps foam:

- continuous across streamed chunk borders;
- stable across floating-origin rebases;
- independent from tile-square boundaries;
- consistent with the CPU water-domain query.

## River flow bands

The streamed flow texture remains the authority for moving river bands.

The band contribution is zero when the decoded current magnitude is below the existing current threshold. Oceans therefore do not gain artificial river streaks from the fallback animation vector.

```text
flowBand = shapedSine(worldPosition · current - time)
         * streamedCurrentStrength
         * flowStrength
```

## Intersection foam

High and ultra already read copied opaque depth for W2B refraction. W2C reuses that depth rather than adding another scene sample.

The accepted depth is the same depth chosen by refraction rejection:

```text
acceptedDistance = mix(baseDistance, distortedDistance, validDistortion)
sceneGap = max(acceptedDistance - waterDistance, 0)
contact = 1 - smoothstep(
  intersectionDepth,
  intersectionDepth + intersectionSoftness,
  sceneGap
)
```

This produces contact foam where the visible opaque scene is close behind the water surface, including shallow banks, steep terrain, rocks, walls, and other intersecting geometry.

Medium quality keeps geographic foam but avoids copied-depth intersection work.

## Underwater projected caustics

Surface caustic highlights remain in the water material. W2C adds a separate underwater render pass so caustics are projected onto visible geometry rather than painted on the water plane.

The pass:

1. Renders the existing scene into a colour and depth pass.
2. Reconstructs world position from scene depth.
3. Rejects sky pixels.
4. Rejects geometry above the current local water surface.
5. Fades with depth below the surface.
6. Fades with camera distance.
7. Adds a bounded animated interference pattern.

The player water sample supplies the local surface height. This is correct for the current body around the player and avoids any GPU readback.

The first implementation intentionally limits the effect to a configured distance. It does not attempt to identify multiple unrelated water bodies in one underwater frame.

## Render ownership

`UnderwaterViewController` owns the temporary render hook, matching its existing ownership of underwater fog, lighting, and god-ray bypass.

When projected caustics are active:

```text
terrainView.render
  -> underwater caustic pipeline while blend > 0
  -> original render otherwise
```

The original render and prewarm methods are restored during disposal.

## Quality tiers

| Tier | Shore foam | Intersection foam | Surface caustic | Projected underwater caustic |
|---|---:|---:|---:|---:|
| Low | No | No | No | No |
| Medium | Yes | No | No | No |
| High | Yes | Yes | Yes | Yes |
| Ultra | Stronger | Stronger | Stronger | Stronger |

## Configuration

Visual-only settings remain in `config/water-visual.yaml`.

```yaml
water:
  foam:
    enabled: true
    color: '#e8fbff'
    intensity: 0.78
    shoreWidth: 1.6
    noiseStrength: 0.42
    flowStrength: 0.32
    flowBandScale: 0.58
    flowBandSpeed: 0.42
    flowBandContrast: 2.4
    intersectionDepth: 0.28
    intersectionSoftness: 0.38
    intersectionStrength: 0.82
  projectedCaustics:
    enabled: true
    color: '#b9f4e5'
    intensity: 0.16
    scale: 0.42
    speed: 0.55
    contrast: 2.6
    depthFadeStart: 0.15
    depthFadeEnd: 6
    maxDistance: 45
```

These settings do not change terrain, water body identity, swimming, collision, navigation, persistence, or `waterDomainVersion`.

## Telemetry

The underwater projection pass reports:

- `waterProjectedCausticFrames`;
- `waterProjectedCausticCpuMs`.

The CPU value measures render-call submission overhead. It is not a GPU timestamp and must not be used as the final GPU performance verdict.

## Automated coverage

Focused tests cover:

- geographic shore-distance falloff;
- flow-band dependence on streamed current;
- intersection-gap falloff;
- quality-tier cost boundaries;
- foam and caustic configuration validation;
- projected caustic depth and distance bounds;
- world-position reconstruction from scene depth;
- sky and above-surface rejection;
- render-hook installation, prewarming, and restoration;
- material ordering for surface caustics and foam.

## Headed acceptance battery

### Geography

- Procedural ocean shoreline.
- Imported Azgaar coastline.
- Narrow imported river.
- Wide river and river junction.
- River mouth.
- High-elevation river.
- Live painted water and sculpted bank.

### Camera and movement

- Walk parallel to the shoreline.
- Walk from dry ground through wading into swimming.
- Dive below the surface and look at the bed.
- Surface repeatedly while moving.
- Cross a chunk border above and below water.
- Trigger a floating-origin rebase while following a river.

### Geometry intersections

- Rock crossing the waterline.
- Tree trunk at a river bank.
- Construction wall entering the water.
- Steep terrain bank.
- Player-held and foreground geometry near the screen edge.

### Render paths

- Direct renderer with god rays disabled.
- Screen-space god rays enabled above water.
- Volumetric god rays enabled above water.
- Underwater god-ray bypass and projected caustics.
- Low, medium, high, and ultra water tiers.

### Performance

Record:

- first-use shader and post-process compilation hitch;
- water pass GPU time where browser timestamp queries are available;
- frame p50, p95, p99, and maximum;
- `waterProjectedCausticCpuMs`;
- framebuffer-copy cost from W2B;
- sustained movement and chunk-streaming backlog;
- memory before and after repeated diving.

## Merge gate

W2C is ready to merge only when:

- shore foam follows geography without chunk seams;
- foreground geometry does not leak through refraction;
- intersection foam does not cover all shallow water uniformly;
- projected caustics affect visible submerged geometry but not sky or above-water geometry;
- surface transitions have no colour, alpha, or render-path pop;
- medium remains a stable no-refraction/no-post-process fallback;
- the full test suite and production build pass;
- high and ultra remain within the agreed frame budget.
