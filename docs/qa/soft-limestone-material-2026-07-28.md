# Soft limestone material — evidence (2026-07-28)

Headless material comparison for `soft-limestone` vs legacy `limestone`.
Geometry, hashes, and save schema are unchanged. Style remains opt-in via
`soft-limestone-rubble`.

## Gates

| Gate | Result |
| --- | --- |
| Legacy limestone palette unchanged | PASS |
| Soft mean chroma < 50% of legacy | PASS |
| Soft procedural texture less variable | PASS |
| Soft bump weaker than legacy default | PASS |
| Soft normal weaker than legacy default | PASS |
| Workshop ↔ construction surface parity | PASS |
| Mortar colour `#74746d` | PASS |

Overall: **PASS**

## Soft surface constants

| Parameter | Soft limestone | Legacy default |
| --- | ---: | ---: |
| bumpScale | 0.028 | 0.055 |
| bumpTextureScale | 0.55 | 1 |
| roughnessBase | 238 | 226 |
| roughnessVariation | 10 | 26 |
| normalScale | 0.28 | 0.55 |
| envMapIntensity | 0.58 | 0.72 |
| brightness | 0.97–1.025 | 0.94–1.04 |
| weatheringStrength | 0.075 | 0.14 |

## Palette chroma

| Palette | Mean chroma | Base |
| --- | ---: | --- |
| soft-limestone | 11.20 | `[188, 186, 176]` / `#bcbab0` |
| limestone (legacy) | 44.80 | `[194, 180, 148]` / `#c4b794` |

Texture luma σ: soft 2.255 vs legacy 5.061.

Raw JSON: `tmp/soft-limestone-material-qa.json`

## Visual checklist (Simulator-Test)

Fixed wall: `soft-limestone-rubble`, seed `3141`, 24×3.5×0.8 flat.

1. Direct 45° sun — soft matte highlights, no chalk clipping.
2. Grazing light — bevels readable; bump does not dominate.
3. Overcast — low saturation, per-stone variation survives.
4. Workshop beside live wall — matching hue / roughness / normals.
5. Selection — stone tint only; mortar stays dark.
6. Distance 2 / 8 / 20 m + coarse LOD — grain fades first; joints remain.

## Non-goals confirmed

- Legacy `limestone` / `limestone-masonry` unchanged.
- No geometry hash or record version change.
- No additional textures or draw calls.
