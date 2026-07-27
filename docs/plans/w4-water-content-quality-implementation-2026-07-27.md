# W4 Water Content and Quality Implementation

Date: 2026-07-27

Status: implemented on `agent/w4-water-content-quality`.

Dependency: W0, W1, and W3 are merged on `main`. W2 depth optics remains independent.

## Scope

W4 adds bounded water-content and simulation integrations without changing deterministic terrain geography or persisted water-domain version 2.

Delivered:

- Streamed river-current textures.
- Flow-driven surface animation.
- Configurable water quality tiers.
- Shallow-water caustic highlight modulation for high tiers.
- Depth-, shore-, kind-, coverage-, and current-aware aquatic placement.
- Rooted and floating aquatic placement modes.
- Player current drift.
- Player water transition events for audio, particles, wildlife, and later stamina systems.
- CPU water-navigation samples for future boats, AI, and path planning.

## Explicitly deferred

Authored lake levels are not included in this phase.

Stable inland lake support changes deterministic geography and persistence. It requires:

- connected-body identity;
- stable body IDs;
- per-body surface elevations;
- import mapping or authored water-body records;
- a water-domain version and migration decision.

Adding a lake heuristic only in rendering would reproduce the global sea-level problem W0 and W1 removed.

## Streamed current field

Each generated page now includes:

```ts
page.waterFlowPixels
page.waterFlowWidth
page.waterFlowHeight
```

The field is a shared-edge `(chunkSize + 1) × (chunkSize + 1)` `RG8` texture.

| Channel | Meaning |
|---|---|
| R | Cell-space flow X encoded from `[-1, 1]` to `[0, 255]` |
| G | Cell-space flow Z encoded from `[-1, 1]` to `[0, 255]` |

The field is generated in the chunk worker beside the semantic `RGBA16F` water field and transferred with the page. Resident render slots allocate their textures once and reuse them.

For a `64 × 64` page, the current texture costs 8,450 bytes. At 49 resident slots the fixed allocation is approximately 404 KiB before staging.

Dry interpolation vertices inherit a weighted neighbouring current. This prevents river animation from stopping before the visual bank interpolation reaches zero.

## Coordinate contract

Generator and field samples use terrain-cell coordinates:

```text
+X east
+Z south
```

Canonical world and render coordinates use:

```text
+X east
+Z north
```

The CPU query adapter and water shader negate the cell-space Z component exactly once. Player physics, navigation samples, events, and shader animation therefore consume the same canonical-world direction.

## Quality tiers

Visual configuration lives in `config/water-visual.yaml`, separate from deterministic terrain configuration.

| Tier | Streamed current animation | Caustic modulation |
|---|---:|---:|
| Low | No | No |
| Medium | Yes | No |
| High | Yes | Yes |
| Ultra | Yes | Stronger |

Quality tiers do not change:

- coverage;
- body identity;
- surface or bed height;
- water depth;
- player collision or swimming thresholds;
- navigation results.

The high-tier caustic term is a bounded shallow-water surface highlight. It is not the W2 underwater projection or scene-depth refraction pass.

## Aquatic content

Aquatic scatter no longer accepts a candidate from tile ID alone.

Each candidate must satisfy configured rules for:

- water coverage;
- depth range;
- shore-distance range;
- water kind;
- maximum current.

Rooted prototypes use `bedHeight`. Surface prototypes use `surfaceHeight` and retain their authored offset. Existing lotus colony rules automatically select the surface placement profile, while weeds and rooted plants use the bed profile.

The candidate remains deterministic because the evaluator adds only metadata derived from the canonical water query; it does not change candidate authority fields or random rolls.

## Simulation hooks

`PlayerController` exposes immutable transition events:

```text
water-enter
water-exit
water-state-change
water-submerge
water-surface
water-body-change
```

Events include previous/current water state, body, kind, depth, surface height, current direction, and timestamp. No audio or particle implementation is hard-coded into the player controller.

Swimming applies a bounded configurable drift using the canonical current direction. Wading remains ground-authoritative and is not carried by currents in this phase.

## Navigation hook

Terrain water queries now provide canonical and render-space navigation samples. A sample reports:

- navigable state;
- kind and body ID;
- surface and bed height;
- depth and shore distance;
- current direction and strength.

Thresholds are caller-owned, allowing boats, fish, and amphibious AI to use different requirements without changing geography.

## Validation

Focused dependency-free coverage includes:

- RG current encoding and decoding;
- shared-edge current continuity;
- cell-to-world flow-axis conversion;
- player current drift;
- rooted and floating aquatic placement;
- depth, shore, kind, and current rejection;
- quality-tier feature selection and validation;
- navigation thresholds;
- immutable water transition events;
- regeneration of pages missing the new current field.

## Headed acceptance still required

- Confirm imported river highlights move downstream.
- Confirm currents remain continuous across chunk borders and floating-origin rebases.
- Confirm rooted plants remain on the bed and lotus leaves remain at the visual surface.
- Compare low, medium, high, and ultra water tiers.
- Measure field generation, upload bytes, aquatic rebuild time, and frame time.
- Confirm no visible first-use shader hitch after prewarming each active quality tier.
