# Clod-poc → SimCity walk-mode port — 2026-07-27

Port of procedural tree look, weather overlays, and spell VFX from
`drusniel-voxels-bevy/tools/clod-poc` into SimCity-DnD’s existing stylized forest
runtime (not the GPU tree/understory ring).

## What landed

| Area | Location | Notes |
| --- | --- | --- |
| Bark / procedural textures | `src/editor/stylized/forest/ProceduralBarkTextures.js` | Already matched clod `barkSynth` / `periodicNoise`; left as-is |
| Morphology | `src/editor/stylized/forest/morphology/` | derive / pack / clamp; wired into `ForestSpeciesRegistry` + lean in `TreeLodAssembler` |
| Tree materials / wind | `StylizedTreeMaterials.js` | Trunk flare scale softens canopy wind |
| Understory | `ForestBushGeometry.js` + bush config | Softer normals, denser clusters; opt-in `FOREST_UNDERSTORY_PROTOTYPES` includes ferns |
| Weather | `src/editor/weather/` | Meadow / rain / snow / sandstorm / storm / wind + UI panel |
| Spells | `src/editor/spells/` | Keys 1–6 in walk mode; earth is **VFX-only** (no CLOD dig) |
| Audio | `src/editor/audio/` | Procedural WebAudio bus; spell casts, jump, orbit/player mode |

## Config

```yaml
weather:
  enabled: true
  mode: off   # meadow | rain | snow | sandstorm | storm | wind
  intensity: 0.7
  windX: -0.42
  windZ: 0.18

spells:
  enabled: true
```

Live weather toggles: bottom-right **Weather** panel. Spell menu: floating nav (drag by title).

## Out of scope

- GPU tree residency / CLOD understory ring
- Earth spell terrain convergence / dig commands
- Replacing `StylizedSkyView` lighting (weather is overlay-only)

## Re-port script

```powershell
node scripts/port-clod-weather-spells.mjs
```

Rewrites weather/spell sources from clod-poc and regenerates shims under
`src/editor/_clod_shims/`.
