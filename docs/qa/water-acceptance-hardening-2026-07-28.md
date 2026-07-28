# Water acceptance and hardening QA

Date: 2026-07-28

Status: automated contracts and headed runner implemented on `agent/water-acceptance-hardening`.

## Purpose

This gate validates the complete water path after W0, W1, W2, W3 and W4:

- deterministic water geography;
- walking into water;
- wading and swimming;
- explicit diving and surfacing;
- leaving the water again;
- refraction and foam quality paths;
- projected underwater caustics;
- frame-time and hitch limits;
- body identity through floating-origin movement.

The ordinary repository workflow validates source, tests, assets and the production bundle. The headed water runner remains a hardware-WebGPU release gate because hosted CI software adapters do not produce representative timing evidence.

## Automated repository verification

Pull requests and pushes to `main` run `.github/workflows/verify.yml`:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run validate:assets
npm test
npm run build
```

A failing test, asset validator or production build blocks the verification job.

## Headed water acceptance

Install Chromium once:

```text
npm run qa:workshop:install
```

Run the acceptance battery:

```text
npm run qa:water:acceptance
```

Useful options:

```text
npm run qa:water:acceptance -- --headed
npm run qa:water:acceptance -- --url http://127.0.0.1:5173 --existing-server
npm run qa:water:acceptance -- --allow-software
```

`--allow-software` is functional diagnostics only. The report marks performance as non-authoritative and disables timing thresholds. It must not be used for release performance evidence.

## Deterministic route discovery

The runner first opens the generated world without movement and searches a bounded canonical area around the origin.

A valid route requires:

- a dry starting point;
- a continuous route crossing the shoreline;
- a target with at least 80% water coverage;
- target depth of at least 2.2 m;
- finite terrain height along the route;
- no one-metre terrain jump greater than 6 m;
- a dry-to-deep route no more than 20 m beyond the selected wet candidate.

The route is deterministic for the same world and configuration. It stores the start, target, yaw, body ID, kind, surface elevation and target depth in the report.

## Movement sequence

The runner reloads into walk mode at the discovered dry start and executes:

1. `enter-water` — walk forward across the shoreline;
2. `dive` — continue forward while holding descend;
3. `surface` — release horizontal movement and swim upward;
4. `exit-water` — move backward to the original bank;
5. `settle` — release all movement and record the final state.

The runner samples the active camera, canonical focus, authoritative water query, streaming origin and water performance counters every 100 ms.

## Functional gates

The report fails unless all gates pass:

- route found;
- measured frames exist;
- entered water;
- reached swimming or submerged state;
- camera became submerged;
- camera surfaced after submersion;
- player returned to dry ground;
- wet samples retained one stable body ID;
- no body or depth discontinuity occurred on a floating-origin snap;
- projected caustics rendered on high or ultra quality.

## Provisional performance gates

On a hardware adapter:

- frame p95 must be at most 33.3 ms;
- hitch rate must be at most 2%;
- projected-caustic CPU submission overhead must be at most 4 ms.

These are release-safety ceilings, not final optimisation targets. The projected-caustic counter measures CPU submission overhead and does not replace GPU timestamps.

## Output

The runner writes:

```text
tmp/water-acceptance-latest.json
```

The report includes:

- WebGPU adapter identity;
- whether performance evidence is authoritative;
- discovered route;
- phase durations;
- water states and transitions;
- body IDs;
- maximum immersion depth;
- submerged frame count;
- projected-caustic frames and CPU cost;
- floating-origin snap evidence;
- ordinary performance report;
- all functional and performance gates.

## Manual visual checklist

The automated gate cannot judge image quality. Review the same run in headed mode and inspect:

- shallow seabed readability;
- continuous depth absorption;
- refraction around grass, rocks, trees and walls;
- geographic shore foam without tile-square edges;
- contact foam that does not cover all shallow water;
- river bands following current direction;
- water visible from below;
- projected caustics on submerged geometry only;
- no sky caustics;
- no colour or alpha pop while crossing the surface;
- no chunk seam or floating-origin discontinuity;
- stable low, medium, high and ultra quality fallbacks.

## Remaining exclusions

This gate does not implement or validate authoritative inland lakes, old water-domain save migration, boats, fish, breath/stamina, splash audio or wake particles. Those remain separate features.
