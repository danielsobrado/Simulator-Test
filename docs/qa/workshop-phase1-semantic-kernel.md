# Workshop Phase 1 — Semantic Kernel

Phase 1 introduces the semantic editing kernel as a sidecar to the existing procedural workshop. The current generator and renderer remain authoritative; this phase does not replace geometry generation or change runtime visuals.

## Delivered contracts

- `WorkshopEntity` owns stable typed entity records with explicit parent and dependency links.
- `WorkshopDocument` owns a versioned, deterministic entity collection and validates references and parent topology.
- `WorkshopPatch` applies atomic entity changes and produces an inverse patch.
- `WorkshopCommandBus` maps semantic commands to patches and reports dependency impact.
- `WorkshopPreviewTransaction` supports multi-command preview, one atomic commit, cancellation, and stale-edit rejection.
- `WorkshopDependencyGraph` resolves deterministic dependency order and affected descendants.
- `WorkshopRecipeBridge` converts the existing normalized recipe to semantic entities and resolves it back without changing rendering authority.
- `WorkshopResolvedModel` exposes the document, dependency order, and legacy-compatible resolved recipe in one read model.

## Migration boundary

The semantic kernel is deliberately additive. Existing `ProceduralAssetStore`, component generation, material resolution, LOD generation, WebGPU preview, and runtime object installation continue to consume the existing recipe format.

The bridge initially gives semantic ownership to:

- recipe settings and material documents,
- composition primitives,
- component transforms,
- opening attachments,
- opening assemblies.

Unknown future semantic entities may coexist in a document without affecting the resolved legacy recipe until a later phase assigns rendering behavior to them.

## Acceptance gates

`npm run qa:workshop:kernel` must prove:

1. every Phase 0 compatibility recipe survives recipe → document → resolved recipe normalization unchanged;
2. document entity ordering is deterministic;
3. invalid references and parent cycles are rejected;
4. patches are atomic and invertible;
5. semantic commands mutate only through patches;
6. preview transactions do not mutate the committed document before commit;
7. cancellation is lossless and commit increments the committed revision once;
8. stale preview transactions are rejected;
9. dependency impact is deterministic and cycle-safe.

Phase 0 compatibility and visual QA remain separate gates. No GitHub Actions are introduced.
