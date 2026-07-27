# W3 Swimming and Underwater View Implementation

Date: 2026-07-27

Status: implemented in `agent/w3-swimming-underwater`.

Dependency: W0 and W1 are merged on `main`. W2 optics remain independent and are not required for this phase.

## Delivered

- Dry, wading, swimming, and submerged player states.
- Hysteresis around wading, swimming, and head-submersion transitions.
- Wading drag while retaining ground contact.
- Buoyant swimming with configurable horizontal and vertical speed.
- `Space` swims upward; `Ctrl` or `C` swims downward.
- Jumping is disabled while swimming.
- Leaving water restores normal gravity and ground collision.
- Player status exposes water state, depth, surface height, body ID, and head-submersion state.
- Underwater fog, background tint, light reduction, sky suppression, god-ray suppression, and a reduced camera near plane.
- Time-based visual blending when crossing the water surface.
- Surface visual state is restored when leaving walk mode or disposing the controller.

## Player state contract

```text
dry
  -> wading at wadeDepth + hysteresis
  -> swimming at swimDepth + hysteresis
  -> submerged when the eye passes below the surface + hysteresis
```

Exit thresholds subtract the same hysteresis. This prevents rapid toggling when movement or floating-point noise places the player close to a boundary.

Player status now includes:

```ts
waterState
waterDepth
waterSurfaceHeight
waterBodyId
headSubmerged
```

## Physics

Walking remains authoritative while dry or wading. Wading scales horizontal speed by the configured drag between the wade and swim thresholds.

Swimming uses:

- `swimSpeed` for horizontal movement;
- `verticalSwimSpeed` for explicit ascent and descent;
- `buoyancy` as a spring toward the natural surface-floating height;
- `swimDrag` to damp vertical velocity;
- the existing terrain heightfield as the seabed collision authority.

No collision readbacks or render-derived water queries are introduced.

## Underwater rendering boundary

W3 changes camera-local atmosphere only:

- scene background and exponential fog blend toward underwater colours;
- directional and hemisphere lighting are reduced;
- the sky and cloud-transmission domes are hidden when fully submerged;
- god rays are suspended while underwater;
- the first-person near plane blends from 0.5 m to the configured underwater value.

W3 does not add refraction, Beer–Lambert absorption, caustics, surface foam, or depth-driven water colour. Those remain W2 or later polish work.

## Configuration

Underwater visuals live under `player.water.underwater` in `config/water-domain.yaml`:

```yaml
underwater:
  backgroundColor: '#0b3342'
  fogColor: '#1b6070'
  fogDensity: 0.055
  lightScale: 0.38
  transitionSeconds: 0.28
  nearPlane: 0.15
```

These values do not change generated terrain or persisted water-domain version 2 metadata.

## Validation

Focused dependency-free Node suite: 8 tests passed.

Coverage includes:

- wade and swim hysteresis;
- independent head-submersion hysteresis;
- wading drag;
- buoyant surface movement;
- ascend and descend controls;
- submerged-to-surface recovery;
- water exit restoring gravity;
- dry-land backwards compatibility;
- bounded underwater visual blending;
- underwater configuration validation.

## Headed acceptance still required

- Walk from dry land through shallow water into swimming depth.
- Dive below the surface and return without visual flicker.
- Verify `Space`, `Ctrl`, and `C` behaviour while swimming.
- Cross chunk boundaries and floating-origin rebases while submerged.
- Enter and exit edit mode while underwater and confirm atmosphere restores.
- Check procedural oceans and imported Azgaar rivers at low and high elevations.
- Verify no new frame hitch appears on first submersion.
