# Construction stone edge wear — evidence (2026-07-28)

Headless QA for worn arrises on `soft-limestone-rubble` (seed 3141).

## Metrics

| Metric | Flat | Relief only | Relief + edge wear |
| --- | ---: | ---: | ---: |
| Near stone triangles | 7840 | 10760 | 13096 |
| Mortar triangles | 3360 | 3360 | 3360 |
| Edge-wear stones | 0 | 0 | 146 |
| Edge-wear fallbacks | 0 | 0 | 0 |
| Edge-wear clamped | 0 | 0 | 5 |
| Flattened corners | 0 | 0 | 90 |
| Build p50 (ms) | 8.95 | 9.60 | 12.27 |
| Build p95 (ms) | 10.51 | 10.39 | 13.47 |

## Gates

| Gate | Target | Result |
| --- | --- | --- |
| Extra meshes | 0 | PASS |
| Mortar unchanged | yes | PASS |
| Coarse soft wear | yes | PASS |
| Near triangle multiplier | ≤ 2.0× | 1.670× PASS |
| Build p95 over Part 1 | ≤ 35% | 29.7% PASS |
| Fallback rate | < 0.5% | 0.000% PASS |
| Clamped rate | < 5% | 3.425% PASS |
| Wear applied | > 0 | PASS |

Overall: **PASS**

## Visual checklist (manual)

- [ ] Neutral material (white / roughness 1 / no normal)
- [ ] Top-left / top-right / bottom-left lighting
- [ ] Front and rear grazing light
- [ ] Door / window / quoin / coping
- [ ] Curve + module seam
- [ ] Moving-camera pass
- [ ] Silhouette mask vs uniform bevel
