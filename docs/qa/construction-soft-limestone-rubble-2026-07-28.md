# Soft limestone rubble — packing evidence (2026-07-28)

Headless packing comparison of `soft-limestone-rubble` against `coursed-rubble`.
Style remains **opt-in**; `DEFAULT_CONSTRUCTION_STYLE_KEY` is still `coursed-rubble`.

## Gates

| Gate | Threshold | Result |
| --- | --- | --- |
| Stone count vs coursed-rubble | within ±15% | PASS |
| Module budget | under `MAX_MODULE_STONES`, not overBudget | PASS |
| Pack p95 vs coursed-rubble | module fixtures within +15% (+2 ms floor) | PASS |
| Draw calls | unchanged (same mesh slots: mortar + stone) | PASS (architecture) |

Overall: **PASS**

## Measurements

| Fixture | Coursed stones | Soft stones | Ratio | Coursed p95 ms | Soft p95 ms | Soft split cells |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 m module | 113 | 96 | 0.850 | 1.77 | 0.86 | 20 |
| 24 m straight | 201 | 195 | 0.970 | 1.35 | 1.13 | 44 |
| 100 m straight | 787 | 835 | 1.061 | 4.33 | 3.01 | 203 |
| 200 m straight | 1693 | 1635 | 0.966 | 6.89 | 8.93 | 377 |
| 4 m radius quarter | 109 | 108 | 0.991 | 0.50 | 0.23 | 10 |

Raw JSON: `tmp/construction-soft-limestone-qa.json`

## Visual checklist (Simulator-Test)

Capture the same wall in each style with identical seed/path/lighting:

1. Straight 24 m × 3.5 m × 0.8 m flat top — courses calm, occasional paired splits, pale palette.
2. S-curve — no module seam, subtle face offsets.
3. Grazing light — depth offsets readable, no detached stones.
4. Neutral overcast — narrow colour range, joints dark but not black outlines.
5. Selected wall — stone tint only; mortar stays dark.

Reference criteria: mostly horizontal courses, low bed movement, mild joint lean,
medium-large stones with occasional small pairs, low rotation, low saturation.

## Notes

- Existing `limestone` palette is unchanged; soft style uses `soft-limestone`.
- Packer shaping (inset/depth/offset/splitMaxDepth) is style-driven; defaults
  preserve prior coursed-rubble behaviour.
