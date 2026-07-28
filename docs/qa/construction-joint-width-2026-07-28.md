# Construction joint width — evidence (2026-07-28)

Headless joint / mortar-footprint evidence for First pass 4. Soft limestone uses
wider style-driven head and bed joints; legacy coursed rubble keeps prior
dimensions. Visual captures remain a Simulator-Test checklist.

## Gates

| Gate | Result |
| --- | --- |
| Legacy joint means stay in 12–30 / 8.4–21 mm | PASS |
| Soft limestone joints wider than legacy | PASS |
| Soft means inside YAML profile | PASS |
| Coarse LOD amplifies soft joints | PASS |
| Mortar safety overlap ≤ 3 mm | PASS |
| No new draw calls / materials / triangles | PASS (architecture) |

Overall: **PASS**

## Scene A — straight wall (seed 3141)

```text
Length:    24 m
Height:    3.5 m
Thickness: 0.8 m
```

### Joint statistics

| Style | Mean head | Mean bed | Head range | Bed range | Clamped H/B |
| --- | ---: | ---: | ---: | ---: | ---: |
| coursed-rubble | 20.8 mm | 14.8 mm | 12.2–29.9 | 8.4–21.0 | 0/0 |
| soft-limestone-rubble | 32.8 mm | 25.1 mm | 26.2–40.0 | 20.0–30.0 | 0/0 |

### Coarse amplification (soft limestone)

| Band | Mean head | Mean bed |
| --- | ---: | ---: |
| near | 32.8 mm | 25.1 mm |
| coarse | 38.9 mm | 29.9 mm |

### Approximate screen-space joint width (soft limestone, 60° FOV, 1080p)

Geometric projection only — not a GPU capture.

| Distance | Near head px | Near bed px |
| --- | ---: | ---: |
| 2 m | 15.34 | 11.75 |
| 5 m | 6.14 | 4.70 |
| 8 m | 3.83 | 2.94 |
| 12 m | 2.56 | 1.96 |
| 20 m | 1.53 | 1.18 |

| Distance | Coarse head px | Coarse bed px |
| --- | ---: | ---: |
| 2 m | 18.20 | 13.99 |
| 5 m | 7.28 | 5.59 |
| 8 m | 4.55 | 3.50 |
| 12 m | 3.03 | 2.33 |
| 20 m | 1.82 | 1.40 |

Initial readability targets: 2 m 4–10 px, 5 m 2–5 px, 8 m 1–3 px, 12 m 0.7–1.5 px.

### Payload

| Style | Near JSON bytes | Coarse JSON bytes | Pack ms | Coarse ms |
| --- | ---: | ---: | ---: | ---: |
| coursed-rubble | 135483 | 49597 | 6.38 | 1.056 |
| soft-limestone-rubble | 138295 | 54634 | 3.67 | 0.695 |

Soft vs coursed near payload delta: **2812 bytes** (includes mortarCorners + jointWidths on field stones).

### Mortar config

| Setting | Value |
| --- | --- |
| faceRecess | 0.035 m |
| safetyOverlap | 0.003 m |
| soft mortar colour | `#74746d` |

## Visual checklist (Simulator-Test)

1. **Scene A** — soft limestone 24 m wall at 2 / 5 / 8 / 12 / 20 m: joints obvious at 5–8 m, subtle at 12–20 m, not a black grid.
2. **Scene B** — coursed rubble beside soft limestone: legacy joints unchanged, soft wider but calmer.
3. **Scene C** — grazing light: recessed mortar, no background leaks, no dark silhouette rim.
4. **Scene D** — tight curve: no wedge gaps, curvature stone widths unchanged.
5. **Scene E** — doorway/arch: opening exact, mortar stops at jamb, dressings narrower.
6. **Scene F** — ruined top: mortar only behind survivors, no dark border on ruin teeth.
7. **Scene G** — near → coarse → shell → coarse → near: amplify only in coarse, no width pulse, near identical on return.

Tune order if joints look too dark: mortar colour → roughness → underside AO → recess → width last.

Raw JSON: `tmp/construction-joint-width-qa.json`
