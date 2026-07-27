# Procedural Medieval Construction Plans

Status: workshop vertical slice implemented; live construction architecture proposed
Target: `Simulator-Test` / Three.js r185.1 / WebGPU-first renderer
Scope: procedural stone walls first, then reusable medieval construction systems

## Purpose

This folder defines both the implemented bounded procedural-object workshop and the longer-term
plan for live, editable, streamed construction.

The current repository already provides useful foundations:

- infinite logical world coordinates and floating origin;
- chunked terrain and deterministic world generation;
- sparse persistence;
- slope-aware object placement and foundations;
- procedural fallback models;
- GLB-backed static object rendering;
- instanced object rendering;
- WebGPU-first Three.js rendering;
- YAML configuration;
- existing performance and visual QA infrastructure.

The construction system must integrate with those systems. It must not become a second world model, an unbounded collection of individual stone objects, or a visual-only spline that cannot support saving, collision, damage, and simulation.

## Core decision

For the editor workshop, save **asset recipes** and use the baked result as a normal instanced game
object. For future live walls, save **construction intent**, compile **structural modules**, generate
**masonry detail**, and render **chunked derived geometry**.

```text
construction document
  -> canonical path and parameters
  -> structural grammar
  -> openings and junctions
  -> masonry layout
  -> render/collision/navigation products
  -> streamed runtime views
```

Generated stones are derived data. They are never authoritative world objects.

## Plan index

1. [Master architecture](00-master-plan.md)
2. [Construction domain and save format](01-construction-domain-and-save-format.md)
3. [Editor wall-path placement](02-editor-wall-path-placement.md)
4. [Structural grammar and modules](03-structural-grammar-and-modules.md)
5. [Masonry and stone generation](04-masonry-and-stone-generation.md)
6. [Geometry, materials, and stylized realism](05-geometry-materials-and-stylized-realism.md)
7. [Terrain, foundations, junctions, and openings](06-terrain-foundations-junctions-and-openings.md)
8. [Damage, weathering, ruins, and gameplay](07-damage-weathering-ruins-and-gameplay.md)
9. [LOD, streaming, and performance](08-lod-streaming-and-performance.md)
10. [Collision, navigation, and simulation](09-collision-navigation-and-simulation.md)
11. [Configuration, content authoring, and tooling](10-configuration-content-authoring-and-tooling.md)
12. [Testing, QA, and acceptance](11-testing-qa-and-acceptance.md)
13. [Delivery roadmap](12-delivery-roadmap.md)
14. [Architecture decisions](13-architecture-decisions.md)
15. [Open questions](14-open-questions.md)
16. [Implementation notes](IMPLEMENTATION-NOTES.md)
17. [Procedural object workshop](15-procedural-object-workshop.md)
18. [Arbitrary-footprint roofs (straight skeleton)](16-arbitrary-footprint-roofs.md) — planned
19. [Masonry LOD and far representation](17-masonry-lod-and-far-representation.md) — planned, evidence-gated
20. [Live spline editor and GPU-driven construction renderer](18-live-spline-editor-and-gpu-construction-renderer.md) — active, CPU reference path
21. [Tiny Glade-style wall builder](../tiny-glade-wall-builder/README.md) — active; the per-phase execution plan finishing doc 18's phases 4–6

Docs 16 and 17 were added 2026-07-25. Both are plans only; neither is
implemented. Doc 17 opens with a measurement phase that is explicitly permitted to
conclude that the rest should not be built.

## Terminology

- **Construction**: the authoritative authored or simulated structure.
- **Wall path**: ordered canonical control points defining the wall centerline.
- **Span**: a structurally continuous wall interval between junctions or features.
- **Module**: a semantic structural unit such as straight wall, corner, gate, buttress, or tower connector.
- **Masonry layout**: deterministic courses and stones generated inside a module.
- **Render chunk**: bounded derived geometry compiled for one or more nearby modules.
- **Style**: YAML-defined constraints controlling structure, masonry, materials, and decoration.
- **Seed**: deterministic random source derived from world seed, construction ID, module ID, and style version.

## Methodology

The plan uses a controlled combination of established procedural approaches:

- split and shape grammars for hierarchical architecture;
- context-sensitive rules for doors, corners, towers, and intersections;
- constrained interval packing for masonry courses;
- straight skeletons for roofs over arbitrary footprints (see doc 16);
- example/model-synthesis ideas only for local decorative choices;
- deterministic derived-data compilation;
- hierarchical LOD and chunk streaming.

Wave Function Collapse is not the structural authority. It may later be used for bounded decorative subproblems where contradictions are cheap to resolve.

## External references

- Wonka et al., *Instant Architecture*: https://doi.org/10.1145/882262.882324
- Müller et al., *Procedural Modeling of Buildings*: https://doi.org/10.1145/1179352.1141931
- Merrell, *Example-Based Model Synthesis*: https://doi.org/10.1145/1230100.1230119
- Aichholzer & Aurenhammer, *Straight Skeletons for General Polygonal Figures*: https://doi.org/10.1007/3-540-61332-3_144
- `tylermorganwall/raybevel` — straight-skeleton beveling reference: https://github.com/tylermorganwall/raybevel
- Three.js TSL specification: https://threejs.org/docs/TSL.html
- Three.js NodeMaterial documentation: https://threejs.org/docs/pages/NodeMaterial.html
- Three.js WebGPURenderer documentation: https://threejs.org/docs/pages/WebGPURenderer.html
