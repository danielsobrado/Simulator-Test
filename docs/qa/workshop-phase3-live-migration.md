# Workshop Phase 3 — Live component-controller migration

This closes the remaining Phase 3 migration gap: the live component editor now routes gesture history and undo/redo through the semantic interaction stack instead of owning a second array-based history implementation.

## Live path

`ProceduralWorkshopComponentController.js` is now a small migration layer over the proven Three.js manipulation core. Existing imports keep the same public module path.

The live controller owns only orchestration that is required to bridge the legacy visual manipulation code to:

- `LegacyWorkshopEditSession`,
- `WorkshopToolController`,
- `PreviewTransaction`,
- `WorkshopHistory`,
- `LegacyWorkshopEditStateAdapter`.

The previous implementation is retained byte-for-byte as `LegacyProceduralWorkshopComponentController.js` so the renderer/manipulation behavior is not rewritten at the same time as the transaction migration. Direct imports of that legacy core are forbidden by QA.

## Migrated behavior

- Transform-control drag starts one semantic gesture.
- Pointer movement remains visual preview only and creates no history entry.
- Transform release commits one semantic edit.
- Boundary resize starts one semantic gesture and commits once.
- Boundary resize cancel drops the semantic preview and reprojects the committed state.
- Opening placement is wrapped in one semantic gesture.
- Opening placement cancel drops the semantic gesture.
- Numeric edits, mirror, duplicate, repeat, delete, separate and resets route their existing final edit state through semantic history.
- Undo/redo is owned by `WorkshopHistory`; the live controller no longer uses `history[]` / `future[]`.
- Definition/component regeneration synchronizes the semantic edit session and clears stale history.

## Compatibility boundary

Three.js transform controls, snapping, opening solving, visual helpers and mesh groups are intentionally still in the legacy core. Moving those simultaneously would combine a behavioral renderer rewrite with the transaction migration and would make regression isolation much harder.

The live public controller is now small and the legacy core is behind one guarded import. Future tool slices can be moved out individually without changing consumers of `ProceduralWorkshopComponentController.js`.

## Acceptance

`npm run qa:workshop:interaction` additionally verifies:

1. the live controller remains a small semantic migration layer;
2. no other workshop module can import the legacy core directly;
3. a live edit gesture produces one semantic history entry;
4. undo/redo returns exact structured edit state;
5. cancelled preview leaves committed state unchanged;
6. external definition synchronization clears stale edit history.

No GitHub Actions are added and runtime generation/rendering behavior is unchanged.

## Remaining migration

TODO: Move Three.js helper presentation and individual manipulation tools out of the legacy core by tool slice as their semantic equivalents become authoritative.
