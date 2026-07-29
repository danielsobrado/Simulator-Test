# Collision acceptance battery

The collision acceptance battery turns the executable P8 collision checks into repeatable hardware-WebGPU evidence.

It does not enable collision by default. Default-on remains a separate release decision after the complete release gate passes.

## Install the browser

```bash
npm install
npm run qa:collision:install
```

The runner uses the Playwright version pinned in the repository. It rejects:

- WebGL renderer fallback;
- software WebGPU implementations such as SwiftShader, WARP, llvmpipe, and lavapipe;
- fallback adapters;
- adapters without a stable vendor, architecture, or description identity.

## Run current executable coverage

```bash
npm run qa:collision
```

This starts one strict-port Vite server, runs every configured case three times, and evaluates the execution gate.

Use a visible browser when headless driver behaviour differs:

```bash
npm run qa:collision -- --headed
```

Headed acceptance still uses production collision debug settings. It does not add debug geometry to a performance run.

For a visual collider inspection, run a single scenario explicitly with debug enabled:

```bash
npm run qa:perf -- \
  --qa collision-p5 \
  --headed \
  --collisionDebug colliders,broadphase \
  --screenshot tmp/collision-p5-debug.png
```

Debug-enabled captures are intentionally rejected by the production acceptance gate.

Use an existing server:

```bash
npm run qa:collision -- --url http://127.0.0.1:5173
```

Use one repeat while debugging the harness:

```bash
npm run qa:collision -- --repeats 1
```

Generated output is restricted to a child of the repository `tmp` directory. Relative paths are resolved from the repository root.

```text
tmp/collision-acceptance/
  report.json
  report.md
  vite.log
  cases/
    <case-id>/
      run-01.json
      run-01.png
      run-02.json
      run-02.png
      run-03.json
      run-03.png
```

Every raw report records the measured renderer backend, hardware adapter, viewport, matching screenshot path, frame distribution, collision timings, readiness, provider status, canonical signature, and operational counters.

## Run the release gate

```bash
npm run qa:collision:release
```

The release command applies the execution checks and additionally requires every P8 scenario and definition-of-done item declared in `requiredCoverage`.

The gates are intentionally different:

- **Execution gate:** all cases currently configured in `config/collision-acceptance.yaml` pass.
- **Release gate:** the execution gate passes and every required release scenario has deterministic evidence.

The release gate must remain red while required scenarios are missing. Do not remove coverage requirements merely to make it green.

## Current executable scenarios

The current matrix reuses deterministic P3-P8 fixtures:

- open-ground collision-disabled reference;
- production tree trunk;
- production blocking rock;
- walkable rock BVH;
- placed-object doorway;
- construction wall;
- full-stack repeated collision chunk crossing.

The open-ground frame result is an absolute reference only. It is not compared to the collision-enabled route because collision can change the travelled path, streaming focus, visible geometry, and workload.

A controlled frame A/B remains a release requirement. It needs a path-locked or collision-neutral route that proves both variants traverse equivalent world positions and workloads.

## Per-run gates

Every run requires:

- an identifiable non-fallback hardware WebGPU adapter;
- proof that the measured renderer canvas uses WebGPU rather than WebGL;
- the configured viewport and matching screenshot evidence;
- all collision debug flags disabled;
- the expected scenario and collision mode;
- no more than the configured hitch allowance;
- collision timing samples for collision-enabled cases;
- collision total p95 at or below the YAML threshold;
- ready collision with no provider failure;
- readiness misses, failed chunks, and final queue depth within limits;
- a non-empty canonical collision signature;
- scenario-specific minimum collision work;
- provider-specific evidence for named fixtures.

Provider-specific evidence prevents false positives. For example, the tree scenario requires loaded tree colliders, the blocking-rock scenario requires blocking rocks, and the walkable-rock scenario requires walkable rock instances.

## Cross-repeat gates

Each collision-enabled case must reproduce one identical canonical signature across every repeat. A non-empty but changing signature fails execution.

All reports must also use one consistent hardware-adapter identity.

## Threshold ownership

`config/collision-acceptance.yaml` is the acceptance policy. Its collision p95 threshold is authoritative.

The in-app report still includes its provisional built-in gate for diagnostics, but the aggregate battery does not use that hard-coded value as release policy.

## Required release coverage still missing

The plan currently requires deterministic evidence for:

- dense forest running;
- scree-field traversal;
- a repeated walkable-rock climb loop;
- dense object-town traversal;
- a long curved-wall route;
- controlled collision-on versus collision-off frame A/B;
- floating-origin rebase during movement;
- nearby construction edit and collision rebuild;
- a collision-chunk unload/reload cycle proving collider and prototype-resource counts do not grow;
- a minimum 10-minute streaming, movement, and collision soak.

The soak implementation must preserve full-duration aggregate and hitch accounting. The current `FrameProfiler` retains at most 20,000 frames, so a future soak must not infer ten-minute stability solely from its retained frame array.

These requirements remain visible in `report.json`, `report.md`, and the release command exit status.

## Configuration safety

The matrix and thresholds are kept in:

```text
config/collision-acceptance.yaml
```

Validation rejects:

- duplicate or path-like case IDs;
- invalid viewport or timing values;
- unsupported counters;
- unsupported provider components or metrics;
- a collision-enabled baseline;
- invalid output paths outside the repository `tmp` tree;
- non-HTTP external server URLs.

The orchestrator bounds browser-child execution time, handles Vite spawn failures, limits captured server-log size, and uses unique temporary runner files so concurrent standalone runs cannot overwrite each other.

## Release decision

Collision may be considered for default-on only after all of the following are true:

1. `npm test`, production asset validation, and `npm run build` pass.
2. `npm run qa:collision:release` passes on representative hardware.
3. Repeated reports use one identifiable hardware adapter.
4. The complete P8 coverage list passes, including controlled A/B, unload/reload, and soak evidence.
5. The measured p95 target is accepted or revised with documented evidence.
6. The architecture document reflects the final implementation.
