# Prop collision P0 baseline

Date: **2026-07-27**  
Collision runtime: **disabled**  
Purpose: control evidence before P1/P2 add collision work

## Existing movement baseline

The latest trusted no-collision `chunk-cross` baseline is inherited from [`../perf-qa.md`](../perf-qa.md) and was captured with:

```text
?qa=chunk-cross&warmup=2&duration=12&speed=run&hitchMs=33.3
```

| Metric | Baseline |
|---|---:|
| Average FPS | ~100.9 |
| Frame dt p50 | ~6.9 ms |
| Frame dt p95 | ~7.0 ms |
| Frame dt p99 | ~14 ms |
| Maximum frame dt | ~1048 ms |
| Hitches over 33.3 ms | 11 |
| Grass rebuilds | 9 |
| Flower rebuilds | 6 |
| Tree rebuilds | 1 |
| Rock rebuilds | 1 |
| Terrain assignments | 7 |
| Terrain uploads | 7 |
| Floating-origin snaps | 0 |

The recorded outliers are dominated by asynchronous chunk-boundary streaming and upload work. These values are a pre-collision control, not a future collision budget.

## P0 deterministic fixture

Open:

```text
http://localhost:5173/?qa=collision-p0&download=0
```

The fixture contains a tree, medium and walkable rocks, a wall corner, doorway, low/high steps, valid/steep ramps, and a construction crossing a canonical chunk boundary.

The fixture is visual only in P0. It changes no player movement or collision behaviour.

When ready, the browser exposes:

```js
window.__collisionP0Qa.status
window.__collisionP0Qa.descriptor
```

Expected status: `ready`.

## Acceptance checks

```bash
npm test
npm run build
```

Manual check:

1. Open the fixture URL.
2. Confirm every fixture element appears once.
3. Reload and compare the descriptor.
4. Trigger a floating-origin rebase and confirm the fixture stays fixed in canonical space.
5. Open the normal application without `qa=collision-p0` and confirm no fixture is created.
