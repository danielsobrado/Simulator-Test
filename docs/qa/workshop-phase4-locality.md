# Workshop Phase 4 — Composition promotion and locality

Phase 4 promotes the existing workshop composition model into explicit semantic ownership and adds the locality infrastructure required before wall/opening reactions become more complex.

The legacy procedural generator and renderer remain authoritative for geometry. This phase changes semantic ownership and derived indexing/invalidation only.

## Composition ownership

`WorkshopRecipeBridge` now delegates composition entity creation and reconstruction to `model/composition/WorkshopCompositionEntities.js`.

Stable entity IDs remain:

```text
composition:<primitive-id>
```

The current rectangle, circle and wall records are therefore authored semantic entities rather than recipe-bridge implementation details.

`WorkshopCompositionProjection` resolves those entities through the existing `planWorkshopComposition` function. It intentionally reuses the existing material-region and RPG derivation rather than duplicating it. The projection publishes the same material regions, collision slabs, walkable floors, room boundaries, foundation contacts and cover surfaces while also grouping them by semantic composition entity.

## Typed relationships

`WorkshopRelationshipGraph` derives deterministic typed edges from the semantic document:

- `PARENT`: semantic containment/inheritance;
- `DEPENDENCY`: explicit dependency edges.

The graph supports typed incoming/outgoing queries without inspecting rendered scene objects.

## Spatial locality

`WorkshopSpatialIndex` is a definition-local 2D uniform-grid index. It currently indexes composition rectangles, circles and walls plus any future entity that explicitly publishes `properties.spatialBounds`.

Queries are deterministic and return sorted entity IDs. The index supports:

- AABB queries;
- radius queries;
- entity-neighborhood queries;
- incremental updates for an explicit dirty entity set.

Incremental updates call `getEntity` only for the supplied IDs and do not scan `listEntities`. This is the contract reaction systems will use instead of whole-document candidate scans.

## Dirty domains

Phase 4 introduces the full planned dirty-domain vocabulary:

`TOPOLOGY`, `GEOMETRY`, `SURFACE_LAYOUT`, `STYLE`, `MATERIAL`, `COLLISION`, `NAVIGATION`, `ROOMS`, `PORTALS`, `SUPPORTS`, `FOUNDATION`, `DECORATION`, `LOD`, `BOUNDS`, and `SPATIAL_INDEX`.

`planWorkshopInvalidation` compares touched entities before/after the patch, assigns domains by semantic entity type/change, then propagates only across typed relationships. Parent inheritance propagates style/material/decoration only; explicit dependencies propagate the relevant dirty domains to dependents. Unrelated siblings remain clean.

`WorkshopCommandBus` now includes the resulting immutable dirty plan on successful events as `event.dirty`, while preserving the existing `impactedIds` compatibility field.

## Locality state

`WorkshopLocalityState` consumes command-bus events. It rebuilds the inexpensive relationship view for the committed document and incrementally updates the spatial index only for entities whose dirty domains include `SPATIAL_INDEX`.

## Acceptance gates

`npm run qa:workshop:locality` verifies:

1. composition primitives have stable semantic ownership;
2. projected material regions and RPG semantics equal the existing composition planner output;
3. typed relationship queries are deterministic;
4. spatial neighborhood queries are deterministic;
5. incremental spatial updates do not scan the full document;
6. a local primitive edit does not dirty an unrelated sibling;
7. command events expose exact entity/domain dirty sets;
8. locality state consumes those events without renderer dependencies;
9. YAML locality constants match runtime defaults.

Phase 0 compatibility, Phase 1 semantic-kernel, Phase 2 curve, and Phase 3 interaction suites remain separate regression gates. No GitHub Actions are added.
