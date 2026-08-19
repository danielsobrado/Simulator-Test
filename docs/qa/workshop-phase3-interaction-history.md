# Workshop Phase 3 — Commands, preview, history and replay

Phase 3 adds the transactional interaction layer required before semantic wall and opening migration. It builds on the Phase 1 command bus and the Phase 2 curve/topology kernel. Existing runtime rendering and procedural generation remain authoritative.

## Transaction model

Direct manipulation follows one rule:

```text
Committed document + latest gesture command candidate = preview document
```

Pointer movement replaces the candidate preview. It does not dispatch committed commands and does not create history entries. Pointer-up/confirm dispatches exactly one logical command; cancel discards the preview document.

`PreviewTransaction` rejects stale commits if another committed edit changed the base document during the gesture. A failed commit remains open so the caller may cancel or retry after resolving the conflict.

## History

`WorkshopHistory` subscribes to the semantic command bus and records invertible patches. Undo and redo use the same validation path as normal commits. History actions do not recursively create history entries, and unrelated edits clear the redo branch.

Document revisions remain monotonic. Exact round-trip means authored semantic entities and relationships return exactly; undo does not decrement the revision counter.

## Replay

`WorkshopReplayRecorder` records canonical JSON-compatible commands only after successful dispatch. `replayWorkshopCommands` applies the same command stream to a clean document and accepts a bus configurator for domain-specific command handlers.

This keeps replay deterministic without persisting renderer objects, pointer events, or mesh transforms.

## Generated detail ownership

Automatic output is not silently promoted into authored geometry. Pin/detach/suppress commands create a small authored `generation-control` record referencing the derived target and its deterministic provenance key. Reset-to-auto removes that control record.

- **pinned** — preserve a semantic snapshot and keep the generated result under authored control;
- **detached** — preserve a semantic snapshot and mark it independent from future automatic updates;
- **suppressed** — persist a local negative override for one derived result;
- **reset-to-auto** — delete the override and allow normal automatic resolution again.

The reaction engine added in a later phase will interpret these controls.

## Renderer independence

`SelectionController` and `HandleController` contain interaction state only and have no Three.js imports. Rendering/hit-test helpers can therefore be replaced without modifying selection semantics.

`LegacyWorkshopEditStateAdapter` is the migration seam for current component transforms, opening attachments and opening assemblies. It converts a complete legacy edit state into one dependency-safe semantic batch command. The existing `ProceduralWorkshopComponentController` remains compatibility-only and receives no new semantic responsibilities in this phase.

## Acceptance gate

`npm run qa:workshop:interaction` verifies:

1. repeated drag previews create zero history entries until commit;
2. one gesture commit creates one semantic history entry;
3. cancel restores the committed semantic state exactly;
4. undo/redo round-trip authored entities exactly;
5. replay reproduces the same semantic document;
6. stale gesture commits are rejected without closing the transaction;
7. selection/handle controllers are renderer-free;
8. generated controls pin/detach/suppress/reset deterministically;
9. legacy edit-state batches preserve attachment/assembly dependency validity;
10. YAML constants remain synchronized with code defaults.

No GitHub Actions are introduced.
