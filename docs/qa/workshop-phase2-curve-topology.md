# Workshop Phase 2 — Curve, tolerance and topology kernel

Phase 2 establishes the renderer-free geometric language needed by future gridless walls, fences, paths and traversal tools. Existing workshop rendering and legacy generators remain authoritative in this phase.

## Delivered curve kernel

- `CurvePath` owns ordered paths with stable path, control-point and segment IDs.
- `CurveSegment` supports line, circular arc and bounded quadratic Bézier segments.
- `CurveSampling` provides deterministic length evaluation and distance-based sampling.
- `CurveProjection` provides point-to-segment/path projection and definition-local path coordinates.
- `CurveIntersections` provides analytic line/arc operations and deterministic sampled fallback when a quadratic segment participates.
- `GeometryTolerancePolicy` centralizes all geometric tolerances used by the new kernel.

Committed paths reject sub-tolerance segments. Preview paths may temporarily contain degenerate segments, but evaluation and projection must remain finite.

## Delivered topology kernel

- `TopologyGraph` exposes deterministic point adjacency and connected components.
- `PathTopology` validates committed path invariants and implements compatible point edits plus split/merge operations.
- `TopologyRemap` maps hosted segment coordinates across topology changes.
- `FootprintTopology` validates closed path topology, winding, area and non-adjacent self-intersections.

Control-point edits preserve stable segment IDs with identity remaps. Line and arc splits preserve hosted coordinates deterministically. Compatible line-line and co-circular arc-arc merges emit inverse-compatible remap data. General quadratic merging is intentionally not implemented because it would require additional provenance or approximation rules and is not required by current workshop tools.

## Tolerance policy

`config/workshop-curve-kernel.yaml` is the reviewed Phase 2 tuning contract. Runtime-safe defaults are centralized in `CurveKernelConstants.js`; tests assert the YAML contract and runtime defaults stay synchronized. No curve/topology module defines a private epsilon.

## Migration boundary

This phase does not:

- replace current wall or roof generators;
- change workshop rendering;
- migrate openings onto curve hosts yet;
- introduce NURBS or general CAD splines;
- add interaction/history behavior beyond the Phase 1 semantic kernel.

Those responsibilities remain in later phases.

## Acceptance gate

`npm run qa:workshop:curves` verifies:

1. deterministic curve serialization;
2. finite line/arc/quadratic evaluation and arc-length behavior;
3. repeated projection stability;
4. local path-coordinate round trips;
5. line/arc intersections, including collinear overlap endpoints;
6. finite degenerate preview behavior;
7. committed topology validation;
8. deterministic split/merge remaps;
9. hosted coordinate survival across compatible control-point edits and line/arc split/merge;
10. explicit authored ID collisions are rejected;
11. footprint topology and self-intersection detection;
12. 300 deterministic fuzz cases without NaN/Infinity;
13. YAML/runtime tolerance synchronization and no Three.js imports in the kernel.

Phase 0 compatibility and Phase 1 semantic-kernel gates remain independent and must continue to pass.
