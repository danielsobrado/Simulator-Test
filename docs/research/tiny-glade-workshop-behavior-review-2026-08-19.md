# Tiny Glade workshop behavior review

Date: 2026-08-19  
Status: Research/reference  
Purpose: Public-behavior reference for the Simulator workshop architecture  
Related architecture: `docs/architecture/workshop-geometry-framework.md`  
Related plan: `docs/plans/workshop-geometry-framework-plan-2026-08-19.md`

## Scope and evidence rule

This document records publicly observable and officially described Tiny Glade behavior that is useful as a product/architecture reference. It does **not** claim knowledge of Tiny Glade's private source code or internal architecture.

The goal for Simulator is not to clone Tiny Glade. The goal is to reach the same quality bar for direct, gridless, context-sensitive building interaction and then exceed it where Simulator has different requirements: a huge world, reusable assets, RPG gameplay semantics, collision/navigation, destruction/state, deterministic replay, and scalable rendering.

## Public Tiny Glade behaviors worth matching

### 1. Gridless building chemistry

Tiny Glade describes its core interaction as gridless building chemistry. Geometry adapts to nearby construction rather than behaving as isolated mesh pieces.

Officially described examples include:

- drawing a path through a building can create a door;
- raising a building can cause columns and beams to appear as supports;
- the game assembles bricks, pebbles and planks procedurally around the user's edits.

Architecture implication for Simulator:

- semantic relationships and local reactions must be first-class;
- auto-generated adaptation cannot be a collection of one-off tool hacks;
- reactions must be incremental, deterministic and local.

### 2. Curved/gridless walls and shape-following snapping

Tiny Glade's wall/fence interaction supports freeform curves. Its July 2025 stair-era fixes specifically improved wall snapping UI so the snap preview follows the shape of the wall instead of displaying only straight guide lines. Official patch notes also mention curve-processing numerical edge cases and zero-length curves.

Architecture implication for Simulator:

- `Path` cannot mean only a polyline;
- a reusable curve/topology kernel must precede advanced wall, fence, path, roof-boundary and traversal work;
- snapping must operate on parametric curves and arc-length coordinates, not only endpoints and axis-aligned bounds;
- numerical tolerances and degenerate-curve handling need a central policy.

### 3. Stairs are an adaptive traversal system, not a fixed stair mesh

Tiny Glade's stairs update generalized the tool beyond stairs. Official descriptions state that:

- the tool is node-based;
- it also supports bridges and walkways;
- segments turn into platforms or ladders depending on steepness/context;
- stairs can attach to walls and flattened roofs;
- they can snake around towers and create small platforms around corners;
- railings/supports adapt to the path;
- support state can depend on buildings, walls and other supported stairs;
- clutter can be placed on traversal surfaces;
- snapping can be explicitly disabled.

Architecture implication for Simulator:

- do not make `Stair` a narrow fixed geometry primitive;
- model a semantic `TraversalPath`/`TraversalNetwork` with nodes, edges, attachment constraints, width, clearance and style;
- resolve each edge into ramp/stair/platform/ladder/bridge/walkway geometry using deterministic context rules;
- supports, railings and corner platforms are dependent systems;
- traversal connections should feed navigation directly.

### 4. Geometry details are real pieces that adapt to openings and boundaries

The July 2026 public wooden-walls dev diary says the first wooden-wall prototype was only a texture, but the team chose individual procedural planks because the tactile look matters. It also describes planks being split to fit around arches, windows/doors and roof shapes. Rectangular/circular buildings can use horizontal or vertical layouts, while arbitrary curved freeform walls currently avoid horizontal planks because that layout is harder to resolve cleanly.

Architecture implication for Simulator:

- materials alone are not enough for AAA/Tiny-Glade-like authored surfaces;
- implement a reusable surface-layout system for bricks, planks, beams, roof tiles and similar repeated pieces;
- each surface needs a local 2D parameterization plus exclusion/trim masks for openings, roof intersections, corners and attachments;
- layout must clip/split elements deterministically instead of intersecting them visually;
- layout policy may vary by surface curvature and style.

### 5. Procedural details need temporal coherence

Tiny Glade's stair beta notes explicitly mention changing behavior so a magic stair effect no longer reshuffles when a stair segment moves/changes. Other notes call out excessive stair-attached decoration recalculation. These are important clues about the desired user experience: an edit should not make unrelated procedural detail visibly reroll.

Architecture implication for Simulator:

- seeded randomness alone is insufficient if one changed loop index reshuffles every child;
- randomness must be domain-separated and anchored to stable semantic IDs/local cells;
- each generated detail should have a stable derivation key;
- local edits should preserve unaffected generated children;
- undo/redo should restore the same resolved detail exactly.

### 6. Auto-generated details have ownership and attachment semantics

Tiny Glade clutter is generated from contextual building features and can later be selected, moved, duplicated or detached from its original relationship. Official/community descriptions also show clutter associated with doors/windows and later becoming independently editable.

Architecture implication for Simulator:

- generated objects need provenance (`generatedBy`, rule ID, source entity IDs, deterministic key);
- users need a way to pin/promote/detach generated results into authored intent;
- users need a way to suppress an unwanted auto-result without disabling the entire rule globally;
- this requires a separate resolved-auto layer rather than mixing every generated child into authored canonical state.

### 7. Adaptive morphing is better than rejecting edits

Tiny Glade examples include:

- low windows turning into doors under normal snapping behavior;
- stair segments changing between walkways, stairs and ladders depending on slope;
- supports changing based on grounding/context.

Architecture implication for Simulator:

- distinguish hard invariants from soft/adaptive constraints;
- the editor should repair, clamp, morph or choose a valid variant before rejecting an edit;
- only fundamentally invalid topology/data should block commit;
- this is important for a "no wrong answers" direct-manipulation feel.

### 8. Style/property inheritance matters

Tiny Glade patch notes include fixes for snapped shapes inheriting floor patterns. This is a small feature with a large architecture implication: connected/generated structures inherit style context.

Architecture implication for Simulator:

- separate geometry relationships from style inheritance relationships;
- a semantic style resolver should determine inherited material/pattern/trim choices;
- local overrides must remain possible without breaking inheritance for other properties.

### 9. Procedural vegetation/detail must respect semantic exclusions

Tiny Glade patch notes include fixes for ivy growing over doors/windows.

Architecture implication for Simulator:

- decoration systems must consume semantic exclusion masks and sockets;
- vegetation must not discover openings by inspecting final triangles;
- opening, walkable, interactable and visibility regions should publish masks usable by moss/ivy/dirt/clutter systems.

### 10. High object counts require deliberate incremental/render architecture

Tiny Glade publicly increased its wall limit to 20,480 and has repeatedly optimized stair effects and GPU-driven rendering paths. Simulator has a much larger-world requirement than Tiny Glade, so a low arbitrary workshop entity cap is not a suitable architectural assumption.

Architecture implication for Simulator:

- use per-definition/local limits only as safety budgets, not product-shape constants;
- separate semantic definitions from world instances;
- make detail residency and LOD distance-driven;
- batch/instance repeated bricks, planks, tiles and clutter rather than creating one scene object per visual piece;
- evaluation cost should scale with the locally affected dependency neighborhood.

## Parity and beyond matrix

| Capability | Tiny Glade public behavior | Simulator architecture target |
|---|---|---|
| Gridless placement | Yes | Yes, semantic local-coordinate editing |
| Curved walls/fences | Yes | First-class curve/topology kernel |
| Context reactions | Path -> door, raised building -> supports | Generic deterministic reaction resolver |
| Adaptive stairs | Stairs/platforms/ladders, wall/roof attachment | General traversal network incl. bridges/ramps/walkways |
| Wall-following traversal | Stairs can snake around towers | Parametric host-follow constraints + corner transitions |
| Real repeated surface pieces | Individual bricks/planks | Surface-domain grammar for bricks/planks/tiles/beams |
| Opening-aware detail | Planks/ivy adapt around openings | Shared exclusion-mask/trim-domain system |
| Stable procedural appearance | Public fixes avoid reshuffling | Stable child keys + domain-separated random streams |
| Auto-detail editing | Generated clutter can become independently editable | Pin/promote/detach/suppress provenance model |
| Style inheritance | Connected/snapped style inheritance exists | Explicit style graph + local overrides |
| Undo/redo | Supported | Semantic command replay + deterministic resolved state |
| Runtime RPG semantics | Not a Tiny Glade goal | Rooms, portals, nav, cover, locks, destruction, AI sockets |
| Huge-world reuse | Tiny diorama scope | Definition/instance split + chunk residency + LOD |
| Stateful/destructible buildings | Not a core public goal | Runtime state overlays without mutating authored definition |
| Deterministic replay/debug | Not a public design claim | Explicit requirement |

## Recommended "better than Tiny Glade" differentiators

### Definition vs instance

A workshop building definition should be reusable thousands of times. World placement/runtime state should be separate:

```text
WorkshopDefinition
    -> shared semantic asset

WorkshopInstance
    -> transform
    -> runtime door/window states
    -> damage/repair state
    -> gameplay ownership
    -> local variation seed/overrides
```

This is essential for Simulator's large map and is a capability Tiny Glade's small-diorama product does not need to expose publicly.

### Authored intent vs resolved automatic state

Use three layers:

```text
Authored WorkshopDocument
    -> deterministic resolution
ResolvedWorkshopModel
    -> builders/derivers
Geometry + gameplay products
```

Auto doors, supports, trims, clutter anchors and similar reaction outputs normally live in `ResolvedWorkshopModel`, not as silently persisted authored entities.

When the user explicitly edits an automatic result, persist an override/promotion/suppression record. This avoids stale generated state while preserving user control.

### Aesthetic resolver

Tiny Glade's strongest product feature is that edits tend to look good automatically. Simulator should encode this explicitly rather than depend on random decoration.

A deterministic `AestheticResolver` should choose among valid variants using:

- style profile;
- neighboring geometry;
- proportions;
- material family;
- repetition avoidance;
- curvature;
- support/opening context;
- local density targets;
- stable random stream.

It must never override explicit user choices.

### Semantic masks and fields

Publish reusable local fields/masks for:

- openings;
- roof intersection;
- terrain contact;
- walkable surface;
- attachment clearance;
- wetness/exposure;
- damage;
- decoration exclusion;
- structural support.

This allows bricks, planks, ivy, moss, dirt, snow, clutter and gameplay logic to agree about the same building instead of each rediscovering geometry independently.

### Property-based geometry robustness

Curve-heavy direct manipulation creates many edge cases. Add local fuzz/property tests that repeatedly split, merge, drag, undo and reconnect paths while asserting:

- finite geometry;
- no zero-length canonical segments;
- stable IDs where identity remains meaningful;
- valid host references;
- deterministic serialization;
- exact undo/redo semantic round trips;
- no unbounded reaction loops.

No GitHub Actions are required for this project. These tests should be runnable locally through deterministic scripts/harnesses.

## Review findings against the previous Simulator proposal

The previous architecture already had the correct central direction: semantic authoring state, dependency-driven derived geometry, preview transactions, constraints, reactions, planner/builder separation, RPG derivation, LOD/cache and preset migration.

The major missing pieces were:

1. first-class curves and robust topology;
2. a canonical distinction between authored state and automatically resolved state;
3. stable provenance/pinning/detaching/suppression for generated results;
4. temporal coherence of procedural randomness;
5. a generalized traversal system rather than a narrow `Stair` primitive;
6. a reusable repeated-surface layout/trim system for bricks/planks/tiles;
7. hard vs soft/adaptive constraints and morphing;
8. explicit style inheritance and aesthetic resolution;
9. definition/instance separation for the huge-world simulator;
10. spatial indexing and locality contracts for reaction/dependency work;
11. semantic exclusion masks/fields shared by detail systems;
12. stronger local fuzz/property/visual regression testing.

The architecture and implementation plan have been updated to make these first-class requirements.

## Public references

Primary reference behavior comes from official Tiny Glade/Pounce Light pages and announcements:

- Steam store: https://store.steampowered.com/app/2198150/Tiny_Glade/
- Steam announcements: https://steamcommunity.com/app/2198150/announcements/
- Steam all news / stairs update and patch notes: https://steamcommunity.com/app/2198150/allnews/
- Tiny Glade Steam community page / Wooden Walls dev diary: https://steamcommunity.com/app/2198150/

Treat these links as behavioral/product references only. They do not document Tiny Glade's internal code architecture.
