# Collision acceptance battery

The collision acceptance battery turns the P8 performance and readiness requirements into repeatable hardware-WebGPU evidence.

It does not enable collision by default. Default-on remains a separate release decision after the complete release gate passes.

## Install the browser

```bash
npm install
npm run qa:collision:install
```

The runner uses the Playwright version pinned in the repository. It refuses software adapters such as SwiftShader, WARP, llvmpipe, and lavapipe.

## Run current executable coverage

```bash
npm run qa:collision
```

This starts a strict-port Vite server, runs every configured case three times, and evaluates the execution gate.

Use a visible browser when driver or WebGPU behaviour differs in headless mode:

```bash
npm run qa:collision -- --headed
```

Use an existing server:

```bash
npm run qa:collision -- --url http://127.0.0.1:5173
```

Use one repeat while debugging the harness:

```bash
npm run qa:collision -- --repeats 1
```

Generated output is restricted to a child of the repository `tmp` directory. Relative output paths are resolved from the repository root. The default output is:

```text
tmp/collision-acceptance/
  report.json
  report.md
  vite.log
  cases/
    <case-id>/
      run-01.json
      run-02.json
      run-03.json
```

## Run the release gate

```bash
npm run qa:collision:release
```

The release command applies the same runtime checks and additionally requires coverage for every P8 scenario listed in the implementation plan.

The two gates are intentionally different:

- **Execution gate:** all scenarios currently configured in `config/collision-acceptance.yaml` execute successfully.
- **Release gate:** the execution gate passes and every required P8 acceptance scenario is represented.

The release gate must remain red while required scenarios are missing. Do not remove required coverage entries merely to make it green.

## Current executable scenarios

The current matrix reuses deterministic P3-P8 fixtures:

- open-ground no-collision baseline;
- production tree trunk;
- production blocking rock;
- walkable rock BVH;
- placed-object doorway;
- construction wall;
- full-stack repeated chunk crossing.

Targeted fixture scenes enforce collision timing, readiness, query counts, hardware evidence, and hitches. They are not compared against the open-ground frame baseline because their rendered scenes differ.

The full-stack route is marked comparable and must stay within the configured frame-p95 regression allowance against the open-ground baseline. The baseline and collision-enabled case use the same spawn, direction, speed, warm-up, and 60-second measurement window. Configuration validation rejects future comparable cases that do not match their baseline route.

`collision-p8` preserves production debug settings. It does not force collider or broadphase debug rendering, so the performance capture excludes QA visualisation cost. P1-P7 visual fixtures still force their debug views for headed inspection.

## Required release coverage still missing

The plan currently requires additional deterministic scenarios for:

- dense forest running;
- scree-field traversal;
- a repeated walkable-rock climb loop;
- dense object-town traversal;
- a long curved-wall route;
- floating-origin rebase during movement;
- nearby construction edit and collision rebuild.

These remain visible in `report.json`, `report.md`, and the command exit status.

## Per-run gates

Each collision run requires:

- a recorded non-fallback hardware WebGPU adapter;
- the expected QA scenario and collision mode;
- zero hitches above the configured threshold;
- a passing in-app collision gate;
- ready collision with no provider failure;
- collision total p95 at or below the configured target;
- zero readiness misses, failed chunks, and final queue backlog;
- a canonical collision signature;
- scenario-specific minimum query evidence.

Minimum query evidence prevents a broken fixture from passing with unrealistically low timings because it performed no collision work.

## Configuration

The matrix and thresholds are kept in:

```text
config/collision-acceptance.yaml
```

Case IDs are path-safe identifiers because they are used as output-directory names. Gate and minimum-count fields are validated before any browser or server is started.

## Release decision

Collision may be considered for default-on only after all of the following are true:

1. `npm test`, production asset validation, and `npm run build` pass.
2. `npm run qa:collision:release` passes on representative hardware.
3. Repeated reports use a consistent hardware adapter.
4. The P8 scenario coverage list is complete.
5. The measured p95 target is accepted or revised with documented A/B evidence.
6. The architecture document reflects the final implementation.
